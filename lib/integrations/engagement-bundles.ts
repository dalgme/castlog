import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { hashLinkToken } from "@/lib/auth/tokens";
import { parseModuleFlags } from "@/lib/modules/modules";
import type { Tables } from "@/lib/supabase/database.types";
import { applyEngagementResponse } from "./engagements";

/**
 * 묶음 섭외 (기획 확정 2026-08-30 — 20번).
 *
 * 한 프로젝트에서 여러 세션에 참여하는 전문가에게 섭외 요청 문자 1건 +
 * 승인 URL 1개(/b/{token})를 보낸다. URL에서 각 건이 리스트업되고, 건별로
 * 수락/거절을 고른 뒤 한 번에 회신한다.
 *
 * 원칙: 묶음은 발송·응답 '포장'일 뿐이다. 계약 성립·수락서·자리 전환 등
 * 실제 효과는 전부 건별(applyEngagementResponse)로 일어난다 — 묶음이
 * 도메인 로직을 복제하지 않는다.
 */

export type BundleLookup =
  | {
      ok: true;
      bundle: Tables<"engagement_bundles">;
      tenantName: string;
      projectName: string | null;
      expertName: string;
      /** 묶인 섭외 건 — 응답 가능 여부는 건별 status로 판정 */
      items: Tables<"expert_engagements">[];
    }
  | {
      ok: false;
      reason: "not_found" | "expired" | "already_responded" | "canceled";
      summary?: {
        tenantId: string;
        tenantName: string;
        programName: string | null;
        itemCount: number;
      };
    };

/** 공개 /b/{token} 검증 — service_role 전용 (anon RLS 정책 없음). */
export async function lookupEngagementBundleByToken(
  token: string
): Promise<BundleLookup> {
  const admin = createAdminClient();

  const { data: bundle } = await admin
    .from("engagement_bundles")
    .select("*")
    .eq("token_hash", hashLinkToken(token))
    .maybeSingle();
  if (!bundle) return { ok: false, reason: "not_found" };

  // 모듈 비활성 시 연결 테이블 접근도 차단 (CLAUDE.md 1-2-6)
  const { data: tenant } = await admin
    .from("tenants")
    .select("name, feature_flags")
    .eq("id", bundle.tenant_id)
    .maybeSingle();
  if (!parseModuleFlags(tenant?.feature_flags).experts) {
    return { ok: false, reason: "not_found" };
  }

  const { data: items } = await admin
    .from("expert_engagements")
    .select("*")
    .eq("bundle_id", bundle.id)
    .order("starts_on", { ascending: true, nullsFirst: false })
    .order("starts_time", { ascending: true, nullsFirst: false });

  const summary = {
    tenantId: bundle.tenant_id,
    tenantName: tenant?.name ?? "",
    programName: items?.[0]?.program_name ?? null,
    itemCount: items?.length ?? 0,
  };

  if (bundle.status === "canceled") {
    return { ok: false, reason: "canceled", summary };
  }
  if (bundle.status === "responded") {
    return { ok: false, reason: "already_responded", summary };
  }
  if (
    bundle.status === "expired" ||
    new Date(bundle.token_expires_at).getTime() < Date.now()
  ) {
    // 묶음만 만료 표시한다 — 건별 만료·자리 해제는 /e와 동일하게 크론이
    // 처리한다 (건별 token_expires_at이 묶음과 같은 마감으로 발급된다).
    if (bundle.status !== "expired") {
      await admin
        .from("engagement_bundles")
        .update({ status: "expired" })
        .eq("id", bundle.id)
        .eq("status", "requested");
    }
    return { ok: false, reason: "expired", summary };
  }

  const [{ data: project }, { data: expert }] = await Promise.all([
    bundle.project_id
      ? admin
          .from("projects")
          .select("name")
          .eq("id", bundle.project_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    admin
      .from("experts")
      .select("name")
      .eq("id", bundle.expert_id)
      .maybeSingle(),
  ]);

  return {
    ok: true,
    bundle,
    tenantName: tenant?.name ?? "",
    projectName: project?.name ?? null,
    expertName: expert?.name ?? "",
    items: items ?? [],
  };
}

export type BundleDecision = {
  engagementId: string;
  decision: "accepted" | "declined";
};

export type BundleRespondResult =
  | {
      ok: true;
      accepted: number;
      declined: number;
      /** 그 사이 상태가 바뀌어 처리하지 못한 건 */
      failed: { engagementId: string; error: string }[];
    }
  | { ok: false; error: string };

/**
 * 묶음 일괄 회신 — 건별 applyEngagementResponse 반복 (계약 성립·수락서·자리
 * 전환은 전부 건별 로직에 위임). 응답 대기 건 전부에 대한 결정이 있어야 한다 —
 * 일부만 회신하면 '한 번에 회신'이라는 약속이 깨지고 잔여 건이 조용히 만료된다.
 */
export async function respondEngagementBundleByToken(
  token: string,
  decisions: BundleDecision[],
  responseNote: string | null
): Promise<BundleRespondResult> {
  const lookup = await lookupEngagementBundleByToken(token);
  if (!lookup.ok) {
    return { ok: false, error: "유효하지 않거나 만료된 섭외 링크입니다." };
  }

  const pendingItems = lookup.items.filter((i) => i.status === "requested");
  if (pendingItems.length === 0) {
    return { ok: false, error: "응답할 수 있는 섭외 건이 없습니다." };
  }

  const byId = new Map(decisions.map((d) => [d.engagementId, d.decision]));
  if (byId.size !== decisions.length) {
    return { ok: false, error: "같은 건에 대한 결정이 중복되었습니다." };
  }
  for (const item of pendingItems) {
    if (!byId.has(item.id)) {
      return {
        ok: false,
        error: "모든 건에 대해 수락 또는 거절을 선택한 뒤 회신해 주세요.",
      };
    }
  }
  const pendingIds = new Set(pendingItems.map((i) => i.id));
  for (const d of decisions) {
    if (!pendingIds.has(d.engagementId)) {
      return { ok: false, error: "이 묶음에 속하지 않거나 이미 처리된 건이 포함되어 있습니다." };
    }
  }

  let accepted = 0;
  let declined = 0;
  const failed: { engagementId: string; error: string }[] = [];
  for (const item of pendingItems) {
    const decision = byId.get(item.id)!;
    const result = await applyEngagementResponse(
      item.id,
      decision,
      responseNote,
      null // 공개 링크 응답 — 세션 없음
    );
    if (!result.ok) {
      failed.push({ engagementId: item.id, error: result.error });
      continue;
    }
    if (decision === "accepted") accepted += 1;
    else declined += 1;
  }

  if (accepted + declined === 0) {
    return {
      ok: false,
      error: `회신 처리에 실패했습니다. (${failed[0]?.error ?? "원인 미상"})`,
    };
  }

  // 응답 대기 건이 남지 않았으면 묶음을 닫는다 (CAS — 동시 회신 대비)
  const admin = createAdminClient();
  const { count: remaining } = await admin
    .from("expert_engagements")
    .select("id", { count: "exact", head: true })
    .eq("bundle_id", lookup.bundle.id)
    .eq("status", "requested");
  if ((remaining ?? 0) === 0) {
    await admin
      .from("engagement_bundles")
      .update({ status: "responded", responded_at: new Date().toISOString() })
      .eq("id", lookup.bundle.id)
      .eq("status", "requested");
  }

  return { ok: true, accepted, declined, failed };
}
