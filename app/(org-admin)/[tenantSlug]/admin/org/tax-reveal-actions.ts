"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createStoreBClient, hasStoreBEnv } from "@/lib/supabase/rrn-store-b";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { tenantIdFromUser } from "@/lib/auth/tenant";
import { notifyExpert } from "@/lib/experts/notifications";
import { getRrnLockdown, tripRrnLockdown } from "@/lib/integrations/rrn-lockdown";
import {
  RRN_ACCESS_REASONS,
  isRateLimited,
  type RrnAccessReason,
} from "@/lib/integrations/rrn-access";

type Designee =
  | { ok: true; userId: string; tenantId: string; accessorLabel: string }
  | { ok: false; error: string };

/**
 * 조회 주체 검증 — tax_access_grants 지정자(회계담당·대표)만 가능(§5).
 * 플랫폼관리자·비지정자는 거부. tenant_id는 JWT app_metadata에서만.
 */
async function requireDesignee(): Promise<Designee> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const tenantId = tenantIdFromUser(user);
  if (!user || !tenantId) return { ok: false, error: "권한이 없습니다." };

  const { data: grant } = await supabase
    .from("tax_access_grants")
    .select("role_label")
    .eq("tenant_id", tenantId)
    .eq("user_id", user.id)
    .is("revoked_at", null)
    .maybeSingle();
  if (!grant) {
    return {
      ok: false,
      error: "주민등록번호 조회 지정자(회계담당·대표)만 조회할 수 있습니다.",
    };
  }
  return {
    ok: true,
    userId: user.id,
    tenantId,
    accessorLabel: grant.role_label ?? "지정자",
  };
}

export type RevealTarget = {
  grantId: string;
  expertId: string;
  expertName: string;
};

export type ListResult =
  | { ok: true; targets: RevealTarget[] }
  | { ok: false; error: string };

/** 조회 가능한 전문가 목록 — 재래핑 완료(wrapped_dek_for_tenant)된 활성 grant. */
export async function listRevealTargets(): Promise<ListResult> {
  if (!hasSupabaseEnv()) return { ok: false, error: "서버 설정이 완료되지 않았습니다." };
  const d = await requireDesignee();
  if (!d.ok) return d;

  const lock = await getRrnLockdown();
  if (lock.locked) {
    return { ok: false, error: "보안 점검으로 주민번호 조회가 일시 잠금되었습니다. 운영자에게 문의하세요." };
  }

  const admin = createAdminClient();
  const { data: grants } = await admin
    .from("tax_project_grants")
    .select("id, expert_id, created_at")
    .eq("tenant_id", d.tenantId)
    .eq("status", "active")
    .eq("is_honeytoken", false) // 미끼는 목록에 절대 노출하지 않음
    .not("wrapped_dek_for_tenant", "is", null)
    .order("created_at", { ascending: false });

  const rows = grants ?? [];
  const ids = Array.from(new Set(rows.map((r) => r.expert_id)));
  const nameById = new Map<string, string>();
  if (ids.length > 0) {
    const { data: experts } = await admin
      .from("experts")
      .select("id, name")
      .in("id", ids);
    for (const e of experts ?? []) nameById.set(e.id, e.name);
  }

  // 전문가별 최신 grant 1개만 노출(중복 제거)
  const seen = new Set<string>();
  const targets: RevealTarget[] = [];
  for (const r of rows) {
    if (seen.has(r.expert_id)) continue;
    seen.add(r.expert_id);
    targets.push({
      grantId: r.id,
      expertId: r.expert_id,
      expertName: nameById.get(r.expert_id) ?? "전문가",
    });
  }
  return { ok: true, targets };
}

export type RevealMaterial = {
  wrappedPrivateKey: string;
  kdfSalt: string;
  wrapIv: string;
  wrappedDekForTenant: string;
  frontCiphertext: string;
  backCiphertext: string;
};

export type RevealResult =
  | { ok: true; material: RevealMaterial }
  | { ok: false; error: string };

/**
 * 조회 자료 발급 + 게이트 강제(§5).
 *  - 지정자만, 시간당 상한, 승인된 지급 목적(사유) 필수.
 *  - 자료(암호문·래핑키)가 서버를 떠나는 시점 = 조회 발생 → tax_access_logs 기록 +
 *    전문가 즉시 통지. 서버는 복호화하지 않는다(브라우저에서만).
 */
export async function getRevealMaterial(
  grantId: string,
  reason: RrnAccessReason
): Promise<RevealResult> {
  if (!hasSupabaseEnv()) return { ok: false, error: "서버 설정이 완료되지 않았습니다." };
  if (!hasStoreBEnv()) return { ok: false, error: "보안 저장소 연결이 설정되지 않았습니다." };
  const d = await requireDesignee();
  if (!d.ok) return d;
  if (!(reason in RRN_ACCESS_REASONS)) {
    return { ok: false, error: "조회 사유를 선택하세요." };
  }

  // 이미 잠금 상태면 즉시 차단
  const lock = await getRrnLockdown();
  if (lock.locked) {
    return { ok: false, error: "보안 점검으로 주민번호 조회가 일시 잠금되었습니다. 운영자에게 문의하세요." };
  }

  const admin = createAdminClient();

  // === 허니토큰 함정 ===
  // 미끼 grant에 대한 요청 = 정상 경로(listRevealTargets)를 벗어난 접근.
  // 즉시 전체 잠금 + 경보 후, 미끼임을 드러내지 않는 일반 오류로 응답.
  {
    const { data: probe } = await admin
      .from("tax_project_grants")
      .select("id, is_honeytoken, honeytoken_id")
      .eq("id", grantId)
      .eq("tenant_id", d.tenantId)
      .maybeSingle();
    if (probe?.is_honeytoken) {
      await tripRrnLockdown({
        reason: "honeytoken",
        honeytokenId: probe.honeytoken_id,
        userId: d.userId,
        tenantId: d.tenantId,
      });
      return { ok: false, error: "조회할 수 있는 대상이 아닙니다." };
    }
  }

  // 시간당 상한(사용자별) — 초과 시 자동 잠금 + 거부
  const hourAgo = new Date(Date.now() - 3600 * 1000).toISOString();
  const { data: rl } = await admin
    .from("tax_rate_limits")
    .select("id, count, locked_until")
    .eq("subject_type", "user")
    .eq("subject_id", d.userId)
    .gte("window_start", hourAgo)
    .order("window_start", { ascending: false })
    .maybeSingle();
  if (rl?.locked_until && new Date(rl.locked_until).getTime() > Date.now()) {
    return { ok: false, error: "시간당 조회 한도를 초과해 잠금되었습니다. 잠시 후 다시 시도하세요." };
  }
  const usedCount = rl?.count ?? 0;
  if (isRateLimited(usedCount)) {
    await admin
      .from("tax_rate_limits")
      .update({ locked_until: new Date(Date.now() + 3600 * 1000).toISOString() })
      .eq("id", rl!.id);
    return { ok: false, error: "시간당 조회 한도를 초과했습니다. 잠금되었습니다." };
  }

  // 재래핑 완료된 활성 grant
  const { data: grant } = await admin
    .from("tax_project_grants")
    .select("id, expert_id, project_id, front_id, wrapped_dek_for_tenant")
    .eq("id", grantId)
    .eq("tenant_id", d.tenantId)
    .eq("status", "active")
    .maybeSingle();
  if (!grant || !grant.wrapped_dek_for_tenant || !grant.front_id) {
    return { ok: false, error: "조회할 수 있는 대상이 아닙니다." };
  }

  const [{ data: tenantKey }, { data: front }, { data: tenant }] = await Promise.all([
    admin
      .from("tenant_rrn_keys")
      .select("wrapped_private_key, kdf_salt, wrap_iv")
      .eq("tenant_id", d.tenantId)
      .maybeSingle(),
    admin
      .from("rrn_fragments_front")
      .select("front_ciphertext")
      .eq("id", grant.front_id)
      .is("purged_at", null)
      .maybeSingle(),
    admin.from("tenants").select("name").eq("id", d.tenantId).maybeSingle(),
  ]);
  if (!tenantKey || !front) {
    return { ok: false, error: "조회 자료를 확인할 수 없습니다." };
  }

  // 뒷조각(저장소 B)
  const storeB = createStoreBClient();
  const { data: back } = await storeB
    .from("rrn_fragments_back")
    .select("back_ciphertext")
    .eq("front_id", grant.front_id)
    .maybeSingle();
  if (!back) return { ok: false, error: "분할 저장소 조각을 확인할 수 없습니다." };

  // === 조회 발생 기록 + 전문가 통지 + 상한 카운트 (자료 발급 = 조회) ===
  const reasonLabel = RRN_ACCESS_REASONS[reason];
  await admin.from("tax_access_logs").insert({
    expert_id: grant.expert_id,
    tenant_id: d.tenantId,
    tenant_name: tenant?.name ?? null,
    project_id: grant.project_id,
    reason,
    access_type: "screen",
    accessor_label: d.accessorLabel,
  });

  await notifyExpert({
    expertId: grant.expert_id,
    category: "rrn_access",
    title: "주민등록번호가 조회되었습니다",
    body: `${tenant?.name ? `${tenant.name} · ` : ""}${reasonLabel} · 조회자 ${d.accessorLabel}`,
    link: "/expert/tax-access",
    tenantId: d.tenantId,
  });

  // 상한 카운트: 현재 시간창 행이 있으면 +1, 없으면 새 창 생성
  if (rl) {
    await admin
      .from("tax_rate_limits")
      .update({ count: usedCount + 1 })
      .eq("id", rl.id);
  } else {
    await admin.from("tax_rate_limits").insert({
      subject_type: "user",
      subject_id: d.userId,
      window_start: new Date().toISOString(),
      count: 1,
    });
  }

  return {
    ok: true,
    material: {
      wrappedPrivateKey: tenantKey.wrapped_private_key,
      kdfSalt: tenantKey.kdf_salt,
      wrapIv: tenantKey.wrap_iv,
      wrappedDekForTenant: grant.wrapped_dek_for_tenant,
      frontCiphertext: front.front_ciphertext,
      backCiphertext: back.back_ciphertext,
    },
  };
}
