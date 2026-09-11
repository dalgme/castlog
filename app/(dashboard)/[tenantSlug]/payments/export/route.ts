import { NextResponse, type NextRequest } from "next/server";

import { requireRole } from "@/lib/auth/session";
import { canManagePayments } from "@/lib/auth/admin-scopes";
import { isExpertsLite, requireModule } from "@/lib/modules/server";
import { createClient } from "@/lib/supabase/server";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { PAYMENT_TYPE_LABELS, isPaymentType, splitWithholding } from "@/lib/payments/tax";
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
 * 지급 건·지급 명세 엑셀 내보내기 (3시트).
 * 명세는 스냅샷 값(소득유형·세액) 기준 — 세액은 참고 계산임을 컬럼명에 명시.
 *
 * 세 번째 시트 '연동'은 사람이 아니라 회계 프로그램(비즈로그 등)이 읽는다 —
 * 이름이 아니라 ID로 매칭해야 동명이인에서 무너지지 않는다. 확정·지급 완료
 * 건만 담고, 주민번호·계좌는 어떤 시트에도 넣지 않는다.
 * 계약: docs/integrations/bizlog-contract.md
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { tenantSlug: string } }
) {
  const user = await requireRole(["platform_admin", "org_admin", "manager", "staff"]);
  await requireModule("experts");
  if (await isExpertsLite()) {
    return NextResponse.json(
      { error: "라이트 모드에서는 지급 기능을 사용하지 않습니다." },
      { status: 403 }
    );
  }
  if (!(await canManagePayments())) {
    return NextResponse.json(
      { error: "지급 권한이 없습니다." },
      { status: 403 }
    );
  }
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
        `id, batch_id, engagement_id, expert_id, payment_type, gross_amount, withholding_amount, net_amount,
         experts (name),
         expert_payment_batches!inner (title, status, created_at, confirmed_at, paid_at, projects (id, code, name))`
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

  // 연동 시트 — 확정·지급 완료 건만. 세액 분리는 스냅샷과 일치할 때만 채운다
  // (세율이 바뀐 뒤 옛 건을 다시 내보내면 현재 식으로 나눈 값이 스냅샷과 어긋날 수 있다).
  const syncRows = (items ?? [])
    .filter((item) => {
      const status = item.expert_payment_batches?.status;
      return status === "confirmed" || status === "paid";
    })
    .map((item) => {
      const batch = item.expert_payment_batches;
      const split = isPaymentType(item.payment_type)
        ? splitWithholding(item.payment_type, item.gross_amount)
        : null;
      const splitMatches = split !== null && split.withholding === item.withholding_amount;
      return {
        지급ID: item.id,
        지급건ID: item.batch_id,
        섭외ID: item.engagement_id,
        프로젝트ID: batch?.projects?.id ?? "",
        프로젝트코드: batch?.projects?.code ?? "",
        프로젝트명: batch?.projects?.name ?? "",
        전문가ID: item.expert_id,
        전문가명: item.experts?.name ?? "",
        소득유형코드: item.payment_type,
        소득유형: PAYMENT_TYPE_LABELS[item.payment_type] ?? item.payment_type,
        "총비용(원)": item.gross_amount,
        "소득세(원)": splitMatches ? split.incomeTax : null,
        "지방소득세(원)": splitMatches ? split.localTax : null,
        "원천징수(원)": item.withholding_amount,
        "실지급(원)": item.net_amount,
        상태코드: batch?.status ?? "",
        확정일시: batch?.confirmed_at ?? "",
        지급일시: batch?.paid_at ?? "",
      };
    });

  await logAudit(supabase, user, {
    action: "export.payments",
    resourceType: "export",
    afterData: { rows: batchRows.length + itemRows.length, syncRows: syncRows.length },
  });

  return xlsxResponse("지급내역", [
    ["지급건", batchRows],
    ["지급명세", itemRows],
    ["연동", syncRows],
  ]);
}
