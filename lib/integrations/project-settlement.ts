import "server-only";

import { createClient } from "@/lib/supabase/server";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { calculateWithholding, isPaymentType } from "@/lib/payments/tax";
import { formatKrw } from "@/lib/approvals/constants";
import { roleTypeLabel } from "@/lib/integrations/engagement-roles";
import { projectStage, type ProjectStage } from "@/lib/integrations/project-stage";

/**
 * 프로젝트 종료·지급 품의 — 마감 화면과 회계 검토 화면이 함께 쓰는 데이터.
 *
 * 화면 두 개(담당자의 마감 입력, 회계담당자의 지급 검토)가 같은 숫자를 봐야
 * 한다. 각자 집계하면 담당자 화면의 '전체 금액'과 회계 화면의 '전체 금액'이
 * 달라지고, 그 차이는 아무도 설명하지 못한다.
 *
 * 원천세·실지급액은 **참고치**다 (lib/payments/tax.ts). 세액 확정은 세무 검토를
 * 거친다 — 화면에도 그렇게 적는다.
 */

/** 한 전문가가 한 세션에 참여한 건 — 만족도 평가와 지급이 붙는 최소 단위 */
export type SettlementLine = {
  engagementId: string;
  expertId: string;
  expertName: string;
  slotId: string | null;
  sessionName: string;
  schedule: string;
  positionCode: string | null;
  paymentType: string | null;
  gross: number;
  withholding: number;
  net: number;
  /** 이 세션 건의 만족도 (0~100, 5점 단위). 미입력이면 null */
  satisfaction: number | null;
  memo: string | null;
};

export type ProjectSettlement = {
  stage: ProjectStage;
  projectName: string;
  projectCode: string | null;
  businessYear: number | null;
  clientName: string | null;
  settlementApprovalId: string | null;
  settlementReviewedAt: string | null;
  settlementNote: string | null;
  lines: SettlementLine[];
  /** 참여 전문가 인원 (중복 제외) */
  expertCount: number;
  totalGross: number;
  totalWithholding: number;
  totalNet: number;
  /** 만족도가 아직 안 들어온 건 수 */
  unratedCount: number;
  /** 참여율(기여도) 합계 — 100이어야 다음으로 넘어간다 */
  contributionTotal: number;
};

function scheduleText(
  date: string | null,
  starts: string | null,
  ends: string | null
): string {
  if (!date) return "-";
  const time =
    starts && ends ? ` ${starts.slice(0, 5)}~${ends.slice(0, 5)}` : "";
  return `${date}${time}`;
}

export async function getProjectSettlement(
  projectId: string
): Promise<ProjectSettlement | null> {
  if (!hasSupabaseEnv()) return null;
  const supabase = createClient();

  const { data: project } = await supabase
    .from("projects")
    .select(
      "id, name, code, business_year, client_name, engagement_stage, settlement_approval_id, settlement_reviewed_at, settlement_note"
    )
    .eq("id", projectId)
    .maybeSingle();
  if (!project) return null;

  // 확정된 참여 건 — 수락(계약 성립)된 섭외만 지급 대상이다
  const { data: engagements } = await supabase
    .from("expert_engagements")
    .select("id, expert_id, fee_amount, session_name, position_code, role_type")
    .eq("project_id", projectId)
    .eq("status", "accepted");
  const rows = engagements ?? [];

  // 세션 정보는 코드넘버 자리를 통해 붙는다 (일정·세션명의 출처는 세션이다)
  const { data: slots } = await supabase
    .from("engagement_slots")
    .select("id, slot_date, starts_time, ends_time, session_name, role_type")
    .eq("project_id", projectId);
  const slotById = new Map((slots ?? []).map((s) => [s.id, s]));

  const slotIds = (slots ?? []).map((s) => s.id);
  const { data: positions } = slotIds.length
    ? await supabase
        .from("engagement_slot_positions")
        .select("engagement_id, slot_id")
        .in("slot_id", slotIds)
    : { data: [] };
  const slotByEngagement = new Map(
    (positions ?? [])
      .filter((p) => p.engagement_id)
      .map((p) => [p.engagement_id as string, p.slot_id])
  );

  const expertIds = Array.from(new Set(rows.map((r) => r.expert_id)));
  const [{ data: experts }, { data: taxProfiles }, { data: evaluations }, { data: contributions }] =
    await Promise.all([
      expertIds.length
        ? supabase.from("experts").select("id, name").in("id", expertIds)
        : Promise.resolve({ data: [] }),
      expertIds.length
        ? supabase
            .from("expert_tax_profiles")
            .select("expert_id, payment_type")
            .in("expert_id", expertIds)
        : Promise.resolve({ data: [] }),
      supabase
        .from("expert_evaluations")
        .select("expert_id, slot_id, satisfaction, memo")
        .eq("project_id", projectId),
      supabase
        .from("project_contributions")
        .select("percentage")
        .eq("project_id", projectId),
    ]);

  const nameById = new Map((experts ?? []).map((e) => [e.id, e.name]));
  const paymentTypeById = new Map(
    (taxProfiles ?? []).map((t) => [t.expert_id, t.payment_type])
  );
  const evalKey = (expertId: string, slotId: string | null) =>
    `${expertId}::${slotId ?? ""}`;
  const evalByKey = new Map(
    (evaluations ?? []).map((e) => [evalKey(e.expert_id, e.slot_id), e])
  );

  const lines: SettlementLine[] = rows.map((row) => {
    const slotId = slotByEngagement.get(row.id) ?? null;
    const slot = slotId ? slotById.get(slotId) : undefined;
    const paymentType = paymentTypeById.get(row.expert_id) ?? null;
    const gross = row.fee_amount ?? 0;
    const calc = isPaymentType(paymentType)
      ? calculateWithholding(paymentType, gross)
      : { gross, withholding: 0, net: gross };
    const evaluation = evalByKey.get(evalKey(row.expert_id, slotId));

    return {
      engagementId: row.id,
      expertId: row.expert_id,
      expertName: nameById.get(row.expert_id) ?? "-",
      slotId,
      sessionName:
        slot?.session_name ??
        row.session_name ??
        roleTypeLabel(slot?.role_type ?? row.role_type) ??
        "세션",
      schedule: slot
        ? scheduleText(slot.slot_date, slot.starts_time, slot.ends_time)
        : "-",
      positionCode: row.position_code,
      paymentType,
      gross: calc.gross,
      withholding: calc.withholding,
      net: calc.net,
      satisfaction: evaluation?.satisfaction ?? null,
      memo: evaluation?.memo ?? null,
    };
  });

  lines.sort(
    (a, b) =>
      a.schedule.localeCompare(b.schedule) ||
      a.expertName.localeCompare(b.expertName)
  );

  return {
    stage: projectStage(project.engagement_stage),
    projectName: project.name,
    projectCode: project.code,
    businessYear: project.business_year,
    clientName: project.client_name,
    settlementApprovalId: project.settlement_approval_id,
    settlementReviewedAt: project.settlement_reviewed_at,
    settlementNote: project.settlement_note,
    lines,
    expertCount: new Set(lines.map((l) => l.expertId)).size,
    totalGross: lines.reduce((s, l) => s + l.gross, 0),
    totalWithholding: lines.reduce((s, l) => s + l.withholding, 0),
    totalNet: lines.reduce((s, l) => s + l.net, 0),
    unratedCount: lines.filter((l) => l.satisfaction === null).length,
    contributionTotal: (contributions ?? []).reduce(
      (s, c) => s + c.percentage,
      0
    ),
  };
}

/** 지급품의서 본문 — 회계 검토 팝업과 결재 본문이 같은 글을 쓴다 */
export function buildSettlementDocument(data: ProjectSettlement): string {
  const header = [
    `사업명: ${data.projectName}`,
    data.projectCode ? `프로젝트 코드: ${data.projectCode}` : null,
    data.businessYear ? `사업연도: ${data.businessYear}` : null,
    data.clientName ? `발주처: ${data.clientName}` : null,
    `참여 전문가: ${data.expertCount}명 (참여 건 ${data.lines.length}건)`,
    `전체 금액: ${formatKrw(data.totalGross)}`,
    `전체 원천세(참고): ${formatKrw(data.totalWithholding)}`,
    `전체 실지급액(참고): ${formatKrw(data.totalNet)}`,
  ]
    .filter(Boolean)
    .join("\n");

  const table = data.lines
    .map(
      (l, i) =>
        `${i + 1}. ${l.expertName} — ${l.sessionName} · ${l.schedule}` +
        `${l.positionCode ? ` · ${l.positionCode}` : ""}` +
        ` · ${formatKrw(l.gross)} (원천세 ${formatKrw(l.withholding)} / 실지급 ${formatKrw(l.net)})` +
        `${l.satisfaction !== null ? ` · 만족도 ${l.satisfaction}점` : ""}`
    )
    .join("\n");

  return [
    "【 사업 개요 】",
    header,
    "",
    "【 지급 내역 】",
    table || "(지급 대상이 없습니다)",
    "",
    data.settlementNote ? `【 회계 검토 메모 】\n${data.settlementNote}\n` : "",
    "【 검토 요청 】",
    "위 내역으로 프로젝트를 종료하고 전문가 지급을 진행하고자 합니다.",
    "※ 원천세·실지급액은 참고 계산치이며, 세액 확정은 세무 검토를 거칩니다.",
  ]
    .join("\n")
    .trim();
}
