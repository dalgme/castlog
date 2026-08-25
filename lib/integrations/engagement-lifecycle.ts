import "server-only";
import { logEngagementEvent } from "@/lib/integrations/engagement-events";

import { createAdminClient } from "@/lib/supabase/admin";
import { hasSupabaseEnv } from "@/lib/supabase/env";

/**
 * 섭외 건과 넘버링코드(포지션)의 상태 동기화 — 한곳으로 모은다.
 *
 * 이걸 분리하는 이유: 섭외가 끝나는 경로가 넷(수락·거절·취소·만료)인데 각자
 * 포지션을 따로 건드리다 보니 서로 어긋났다. 취소는 포지션을 안 풀어서 코드넘버
 * 자리가 영구히 잠겼고, 자리 해제는 섭외 건을 안 닫아서 회사가 해제했다고 믿는
 * 자리를 전문가가 나중에 수락할 수 있었다. 한 함수로 모아 양쪽을 항상 같이 옮긴다.
 */

/** 섭외가 끝났을 때 그 코드넘버 자리를 다시 미섭외로 되돌린다. */
export async function releasePositionsForEngagement(
  engagementId: string
): Promise<void> {
  const admin = createAdminClient();
  await admin
    .from("engagement_slot_positions")
    .update({ status: "open", engagement_id: null, expert_id: null })
    .eq("engagement_id", engagementId);
}

export type ExpiryResult = {
  expired: number;
  positionsReleased: number;
};

/**
 * 응답 기한이 지난 섭외요청을 만료 처리한다 (Vercel Cron).
 *
 * 왜 필요한가: 만료 판정이 '전문가가 링크를 열었을 때'에만 있었다. 회신하지
 * 않은 전문가는 링크를 아예 열지 않으므로 그 요청은 영원히 '요청중'으로 남았다.
 * 그 결과 (1) 코드넘버 자리가 잠겨 다른 전문가를 붙일 수 없고, (2) 섭외 현황이
 * 사실과 달라지며, (3) 다른 회사의 후보군 화면에서 죽은 요청이 계속
 * '섭외 진행 중'으로 집계됐다.
 *
 * service_role로 전 테넌트를 한 번에 처리한다 — 만료는 테넌트 업무가 아니라
 * 시간에 따른 사실 반영이다.
 */
export async function expireOverdueEngagements(): Promise<ExpiryResult> {
  if (!hasSupabaseEnv()) return { expired: 0, positionsReleased: 0 };

  const admin = createAdminClient();
  const now = new Date().toISOString();

  // 라이트 모드 테넌트는 만료 대상에서 제외한다 — 링크를 발송한 적이 없으므로
  // '링크 만료'가 성립하지 않는다. 전화 섭외가 기한보다 오래 걸린다고 타이머가
  // 요청중 건을 지우고 자리를 비워서는 안 된다 (docs/decisions/experts-lite.md).
  const { data: liteTenants } = await admin
    .from("tenants")
    .select("id")
    .eq("feature_flags->>experts_lite", "true");
  const liteIds = (liteTenants ?? []).map((t) => t.id);

  let expireQuery = admin
    .from("expert_engagements")
    .update({ status: "expired" })
    .eq("status", "requested")
    .lt("token_expires_at", now);
  if (liteIds.length > 0) {
    expireQuery = expireQuery.not("tenant_id", "in", `(${liteIds.join(",")})`);
  }
  const { data: expired } = await expireQuery.select("id, tenant_id, is_practice");

  const rows = expired ?? [];
  if (rows.length === 0) return { expired: 0, positionsReleased: 0 };

  const { data: released } = await admin
    .from("engagement_slot_positions")
    .update({ status: "open", engagement_id: null, expert_id: null })
    .in(
      "engagement_id",
      rows.map((r) => r.id)
    )
    .select("id");

  // 만료는 사람이 한 행위가 아니므로 actor는 비운다. 그래도 기록은 남긴다 —
  // "요청했는데 왜 자리가 비었나"를 나중에 설명할 수 있어야 한다.
  await admin.from("audit_logs").insert(
    rows.map((r) => ({
      tenant_id: r.tenant_id,
      actor_auth_user_id: null,
      actor_role: "system",
      action: "engagement.expire",
      resource_type: "expert_engagement",
      resource_id: r.id,
    }))
  );

  // 섭외 이력 — 만료는 시스템 이벤트로 남긴다
  for (const r of rows) {
    await logEngagementEvent({
      tenantId: r.tenant_id,
      engagementId: r.id,
      type: "expired",
      actorKind: "system",
      actorLabel: "시스템",
      isPractice: r.is_practice,
    });
  }

  return { expired: rows.length, positionsReleased: released?.length ?? 0 };
}
