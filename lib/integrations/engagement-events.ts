import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

/**
 * 섭외 이력 로그 (기획 확정 2026-08-23).
 * 섭외 건별 타임라인 — 발송·동의·거절·수동 완료·재안내·취소·수락서 송부을
 * 일시·실행자와 함께 남긴다. 실행자는 사람이 읽는 이름으로 기록한다:
 * 전문가 동의는 전문가 이름, 수동 처리·발송은 담당자 이름, 자동 처리는 '시스템'.
 * 기록 실패가 본 흐름을 죽이면 안 된다 — 전부 best-effort.
 */

export type EngagementEventType =
  | "requested"
  | "reminded"
  | "accepted"
  | "declined"
  | "manual_accepted"
  | "canceled"
  | "urgent_canceled"
  | "expired"
  | "acceptance_sent"
  | "acceptance_confirmed";

export const ENGAGEMENT_EVENT_LABELS: Record<EngagementEventType, string> = {
  requested: "섭외요청 발송",
  reminded: "재안내 발송",
  accepted: "섭외 동의",
  declined: "섭외 거절",
  manual_accepted: "섭외 완료 (수동 처리)",
  canceled: "요청 회수",
  urgent_canceled: "긴급 취소",
  expired: "요청 만료",
  acceptance_sent: "수락서 송부",
  acceptance_confirmed: "수락서 확정",
};

export async function logEngagementEvent(input: {
  tenantId: string;
  engagementId: string;
  type: EngagementEventType;
  actorKind: "expert" | "staff" | "system";
  actorLabel: string;
  note?: string | null;
  isPractice?: boolean;
}): Promise<void> {
  try {
    const admin = createAdminClient();
    await admin.from("engagement_events").insert({
      tenant_id: input.tenantId,
      engagement_id: input.engagementId,
      event_type: input.type,
      actor_kind: input.actorKind,
      actor_label: input.actorLabel || "(미상)",
      note: input.note ?? null,
      is_practice: input.isPractice ?? false,
    });
  } catch {
    // 이력 기록은 본 흐름을 막지 않는다
  }
}

/** 담당자 표시 이름 — users.name (없으면 '(직원)') */
export async function staffActorLabel(authUserId: string): Promise<string> {
  try {
    const admin = createAdminClient();
    const { data } = await admin
      .from("users")
      .select("name")
      .eq("id", authUserId)
      .maybeSingle();
    return data?.name ?? "(직원)";
  } catch {
    return "(직원)";
  }
}
