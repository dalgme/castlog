import { NextResponse, type NextRequest } from "next/server";

import { requireRole } from "@/lib/auth/session";
import { requireModule } from "@/lib/modules/server";
import { createClient } from "@/lib/supabase/server";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { PAYMENT_TYPE_LABELS } from "@/lib/payments/tax";
import { xlsxResponse } from "@/lib/exports/xlsx";
import { logAudit } from "@/lib/audit/log";

const BATCH_STATUS: Record<string, string> = {
  pending: "결재 대기",
  approval_in_progress: "결재 진행중",
  confirmed: "지급 확정",
  paid: "지급 완료",
  canceled: "취소",
};

/**
 * 지급 건·지급 명세 엑셀 내보내기 (2시트).
 * 명세는 스냅샷 값(소득유형·세액) 기준 — 세액은 참고 계산임을 컬럼명에 명시.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { tenantSlug: string } }
) {
  const user = await requireRole(["platform_admin", "org_admin", "manager", "staff"]);
  await requireModule("experts");
  if (!hasSupabaseEnv()) {
    return NextResponse.redirect(
      new URL(`/${params.tenantSlug}/payments`, request.url)
    );
  }

  const supabase = createClient();

  const [{ data: batches }, { data: items }] = await Promise.all([
    supabase
      .from("expert_payment_batches")
      .select(
        "id, title, status, total_gross, total_withholding, total_net, created_at, confirmed_at, paid_at, projects (name)"
      )
      .order("created_at", { ascending: false })
      .limit(1000),
    supabase
      .from("expert_payment_items")
      .select(
        `payment_type, gross_amount, withholding_amount, net_amount,
         experts (name),
         expert_payment_batches!inner (title, status, created_at, projects (name))`
      )
      .neq("expert_payment_batches.status", "canceled")
      .limit(5000),
  ]);

  const batchRows = (batches ?? []).map((batch) => ({
    지급건: batch.title,
    프로젝트: batch.projects?.name ?? "",
    상태: BATCH_STATUS[batch.status] ?? batch.status,
    "총비용(원)": batch.total_gross,
    "원천징수(원,참고)": batch.total_withholding,
    "실지급(원)": batch.total_net,
    생성일: batch.created_at.slice(0, 10),
    확정일: batch.confirmed_at ? batch.confirmed_at.slice(0, 10) : "",
    지급일: batch.paid_at ? batch.paid_at.slice(0, 10) : "",
  }));

  const itemRows = (items ?? []).map((item) => ({
    지급건: item.expert_payment_batches?.title ?? "",
    프로젝트: item.expert_payment_batches?.projects?.name ?? "",
    전문가: item.experts?.name ?? "",
    소득유형: PAYMENT_TYPE_LABELS[item.payment_type] ?? item.payment_type,
    "총비용(원)": item.gross_amount,
    "원천징수(원,참고)": item.withholding_amount,
    "실지급(원)": item.net_amount,
    상태:
      BATCH_STATUS[item.expert_payment_batches?.status ?? ""] ??
      item.expert_payment_batches?.status ??
      "",
  }));

  await logAudit(supabase, user, {
    action: "export.payments",
    resourceType: "export",
    afterData: { rows: batchRows.length + itemRows.length },
  });

  return xlsxResponse("지급내역", [
    ["지급건", batchRows],
    ["지급명세", itemRows],
  ]);
}
