import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { logEngagementEvent } from "@/lib/integrations/engagement-events";
import { hashLinkToken } from "@/lib/auth/tokens";
import { parseExpertsLite, parseModuleFlags } from "@/lib/modules/modules";
import type { Tables } from "@/lib/supabase/database.types";
import { createEngagementAcceptance } from "./acceptance";
import { refreshProjectEngagementStage } from "./project-engagement";

/**
 * 전문가 섭외 연동 로직 (experts ↔ operations — CLAUDE.md 1-2-6)
 *
 * 연동 로직은 이 모듈(lib/integrations/)에 격리한다.
 * 섭외 승인 = 계약 성립 — Phase 2에서 이 시점에 주민번호 키 위임
 * (tax_project_grants 래핑)이 발생한다. 훅 위치를 여기에 둔다.
 */

export const ENGAGEMENT_EXPIRES_DAYS = 14;

// 라벨 사전 — engagement-stage.ts와 같은 원칙 (요청중/거절/취소/요청 만료)
export const ENGAGEMENT_STATUS_LABELS: Record<string, string> = {
  requested: "요청중",
  accepted: "수락(계약 성립)",
  declined: "거절",
  canceled: "취소",
  expired: "요청 만료",
};

/**
 * 실패 화면에도 실어 보내는 요약 — "이미 응답/만료" 한 줄만 남기면 문자 링크가
 * 유일한 접점인 전문가가 행사 정보를 다시 볼 곳이 없다 (검수 C2). 회사 브랜딩도
 * 실패 분기에서 유지한다 (§16 — 검수 C5).
 */
export type EngagementLookupSummary = {
  tenantId: string;
  tenantName: string;
  programName: string | null;
  startsOn: string | null;
  endsOn: string | null;
  startsTime: string | null;
  endsTime: string | null;
  locationName: string | null;
  feeAmount: number | null;
  /** 이미 응답한 경우 — 무엇으로 응답했는지 */
  respondedAs: "accepted" | "declined" | null;
};

export type EngagementLookup =
  | {
      ok: true;
      engagement: Tables<"expert_engagements">;
      tenantName: string;
      projectName: string | null;
      expertName: string;
    }
  | {
      ok: false;
      reason: "not_found" | "expired" | "already_responded" | "canceled";
      summary?: EngagementLookupSummary;
    };

/**
 * 공개 /e/{token} 검증 — service_role 전용 (anon RLS 정책 없음).
 * 모듈 게이트: 테넌트의 experts 모듈이 꺼져 있으면 연결 테이블 접근도 차단.
 */
export async function lookupEngagementByToken(
  token: string
): Promise<EngagementLookup> {
  const admin = createAdminClient();

  const { data: engagement } = await admin
    .from("expert_engagements")
    .select("*")
    .eq("token_hash", hashLinkToken(token))
    .maybeSingle();

  if (!engagement) return { ok: false, reason: "not_found" };

  // 모듈 비활성 시 접근 차단 (CLAUDE.md 1-2-6 연동 규칙)
  const { data: tenant } = await admin
    .from("tenants")
    .select("name, feature_flags")
    .eq("id", engagement.tenant_id)
    .maybeSingle();
  const modules = parseModuleFlags(tenant?.feature_flags);
  if (!modules.experts) return { ok: false, reason: "not_found" };

  const summary: EngagementLookupSummary = {
    tenantId: engagement.tenant_id,
    tenantName: tenant?.name ?? "",
    programName: engagement.program_name,
    startsOn: engagement.starts_on,
    endsOn: engagement.ends_on,
    startsTime: engagement.starts_time,
    endsTime: engagement.ends_time,
    locationName: engagement.location_name,
    feeAmount: engagement.fee_amount,
    respondedAs:
      engagement.status === "accepted" || engagement.status === "declined"
        ? engagement.status
        : null,
  };

  if (engagement.status === "canceled") {
    return { ok: false, reason: "canceled", summary };
  }
  if (engagement.status !== "requested") {
    return { ok: false, reason: "already_responded", summary };
  }
  if (new Date(engagement.token_expires_at).getTime() < Date.now()) {
    // 라이트 모드 테넌트는 만료 처리하지 않는다 — 크론과 같은 이유 (리뷰 7):
    // 발송된 링크가 없는 수기 관리 건을, 전문가가 라이트 전환 전의 옛 링크를
    // 여는 행위가 만료·자리 해제시켜서는 안 된다. 화면에는 만료로만 보여 준다.
    if (parseExpertsLite(tenant?.feature_flags)) {
      return { ok: false, reason: "expired", summary };
    }
    const { data: expired } = await admin
      .from("expert_engagements")
      .update({ status: "expired" })
      .eq("id", engagement.id)
      .eq("status", "requested")
      .select("id")
      .maybeSingle();
    // 크론 만료와 같은 후처리 — 자리를 풀지 않으면 코드넘버가 requested 자리 +
    // expired 건으로 영구 잠기고, 크론(status=requested 조건)도 다시 못 잡는다.
    if (expired) {
      const { releasePositionsForEngagement } = await import(
        "./engagement-lifecycle"
      );
      await releasePositionsForEngagement(engagement.id);
      await logEngagementEvent({
        tenantId: engagement.tenant_id,
        engagementId: engagement.id,
        type: "expired",
        actorKind: "system",
        actorLabel: "시스템",
        isPractice: engagement.is_practice,
      });
      if (engagement.project_id) {
        try {
          await refreshProjectEngagementStage(engagement.project_id);
        } catch {
          // 단계 갱신 실패가 만료 처리 자체를 막지 않는다
        }
      }
    }
    return { ok: false, reason: "expired", summary };
  }

  const [{ data: project }, { data: expert }] = await Promise.all([
    engagement.project_id
      ? admin
          .from("projects")
          .select("name")
          .eq("id", engagement.project_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    admin.from("experts").select("name").eq("id", engagement.expert_id).maybeSingle(),
  ]);

  return {
    ok: true,
    engagement,
    tenantName: tenant?.name ?? "",
    projectName: project?.name ?? null,
    expertName: expert?.name ?? "",
  };
}

/**
 * 전문가 본인의 일정 충돌 건수 (검수 C6) — /e 화면에서 수락 전에 보여 준다.
 * 확정(accepted)된 타 섭외 + 본인이 등록한 외부 일정과의 날짜 겹침만 센다.
 * 어느 회사의 무슨 일인지는 밝히지 않는다 (테넌트 격리).
 */
export async function countExpertScheduleConflicts(
  engagement: Tables<"expert_engagements">
): Promise<number> {
  if (!engagement.starts_on) return 0;
  const admin = createAdminClient();
  const from = engagement.starts_on;
  const to = engagement.ends_on ?? engagement.starts_on;

  const [{ count: engagementCount }, { data: externals }] = await Promise.all([
    admin
      .from("expert_engagements")
      .select("id", { count: "exact", head: true })
      .eq("expert_id", engagement.expert_id)
      .eq("status", "accepted")
      .eq("is_practice", engagement.is_practice)
      .neq("id", engagement.id)
      .lte("starts_on", to)
      // ends_on이 null인 당일 건이 흔하다 — gte만 쓰면 NULL 행이 빠져
      // 정확히 그 흔한 경우를 놓친다 (리뷰 2)
      .or(`ends_on.gte.${from},and(ends_on.is.null,starts_on.gte.${from})`),
    admin
      .from("expert_external_schedules")
      .select("starts_at, ends_at")
      .eq("expert_id", engagement.expert_id),
  ]);

  // timestamptz는 KST 기준 날짜로 바꿔 비교한다 — UTC slice는 오전 9시 이전
  // 일정을 전날로 만들어 경계 하루가 어긋난다 (리뷰 10)
  const kstDate = (iso: string) =>
    new Date(iso).toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });
  const externalCount = (externals ?? []).filter((s) => {
    if (!s.starts_at) return false;
    const sStart = kstDate(s.starts_at);
    const sEnd = kstDate(s.ends_at ?? s.starts_at);
    return sStart <= to && sEnd >= from;
  }).length;

  return (engagementCount ?? 0) + externalCount;
}

/**
 * 섭외 응답 공통 처리 (공개 링크·포털 공용) — service_role.
 * 수락 = 계약 성립. Phase 2: 여기서 tax_project_grants 래핑을 생성한다.
 */
export async function applyEngagementResponse(
  engagementId: string,
  decision: "accepted" | "declined",
  responseNote: string | null,
  actorAuthUserId: string | null,
  /** 전화 등으로 수락을 확인해 담당자가 수동 처리하는 경우 (기획 확정 2026-08-23) */
  manualActor?: { userId: string; role: string; name: string }
): Promise<{ ok: true } | { ok: false; error: string }> {
  const admin = createAdminClient();

  const { data: updated, error } = await admin
    .from("expert_engagements")
    .update({
      status: decision,
      responded_at: new Date().toISOString(),
      response_note: responseNote,
    })
    .eq("id", engagementId)
    .eq("status", "requested")
    .select("id, tenant_id, expert_id, project_id, is_practice, experts (name)")
    .maybeSingle();

  if (error || !updated) {
    return { ok: false, error: "이미 처리되었거나 응답할 수 없는 요청입니다." };
  }

  // Phase 2 훅: decision === 'accepted' 시점에 해당 프로젝트·기업 권한자용
  // 주민번호 키 래핑(tax_project_grants)을 생성한다 (설계문서 4.4).

  // 관계기업 실증 — 이 기업의 섭외를 처음 수락한 시각을 링크에 남긴다
  // (개정 2026-08-22). 링크는 섭외 전제조건이라 이미 존재한다. 컬럼 미적용
  // DB에서도 수락 처리가 죽으면 안 되므로 실패는 삼킨다.
  if (decision === "accepted") {
    try {
      await admin
        .from("expert_tenant_links")
        .update({ engaged_at: new Date().toISOString() })
        .eq("expert_id", updated.expert_id)
        .eq("tenant_id", updated.tenant_id)
        .is("engaged_at", null);
    } catch {
      // 관계 실증 기록 실패는 수락 처리를 막지 않는다
    }
  }

  // 단계 28-B: 수락 시 등록된 서명·날인으로 섭외수락서 자동 생성 (멱등).
  //  실패해도 수락 자체는 유지 — 예외를 삼킨다.
  if (decision === "accepted") {
    try {
      await createEngagementAcceptance(
        updated.id,
        manualActor ? "manual" : actorAuthUserId ? "portal" : "public_link"
      );
    } catch {
      // 수락서 생성 실패는 수락 처리를 막지 않는다 (감사로그는 acceptance 내부에서 기록)
    }
  }

  // Phase B: 넘버링코드(포지션)와 연결된 요청이면 상태를 함께 전환한다.
  //  수락 → filled(확정), 거절 → open(다시 후보 탐색 가능)
  try {
    if (decision === "accepted") {
      await admin
        .from("engagement_slot_positions")
        .update({ status: "filled" })
        .eq("engagement_id", updated.id);
    } else {
      await admin
        .from("engagement_slot_positions")
        .update({ status: "open", engagement_id: null, expert_id: null })
        .eq("engagement_id", updated.id);
    }
  } catch {
    // 포지션 동기화 실패가 수락·거절 처리를 막지 않는다.
  }

  // 프로젝트 단계 재판정 — 전원 수락이면 '수락서 송신 가능'으로 저절로 넘어간다.
  // 포지션 상태를 바꾼 뒤에 불러야 정확하다.
  if (updated.project_id) {
    try {
      await refreshProjectEngagementStage(updated.project_id);
    } catch {
      // 단계 갱신 실패가 수락·거절 처리를 막지 않는다.
    }
  }

  await admin.from("audit_logs").insert({
    tenant_id: updated.tenant_id,
    actor_auth_user_id: manualActor?.userId ?? actorAuthUserId,
    actor_role: manualActor?.role ?? "expert",
    action:
      decision === "accepted" ? "engagement.accept" : "engagement.decline",
    resource_type: "expert_engagement",
    resource_id: updated.id,
    after_data: {
      project_id: updated.project_id,
      ...(manualActor ? { manual: true } : {}),
    },
  });

  // 섭외 이력 — 동의는 전문가 이름, 수동 처리는 담당자 이름으로 남긴다
  await logEngagementEvent({
    tenantId: updated.tenant_id,
    engagementId: updated.id,
    type: manualActor
      ? "manual_accepted"
      : decision === "accepted"
        ? "accepted"
        : "declined",
    actorKind: manualActor ? "staff" : "expert",
    actorLabel: manualActor
      ? manualActor.name
      : (updated.experts?.name ?? "(전문가)"),
    note: responseNote,
    isPractice: updated.is_practice ?? false,
  });

  return { ok: true };
}
