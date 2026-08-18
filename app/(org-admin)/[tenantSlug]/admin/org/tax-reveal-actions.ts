"use server";

import { createClient as createSbClient } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createStoreBClient, hasStoreBEnv } from "@/lib/supabase/rrn-store-b";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { tenantIdFromUser } from "@/lib/auth/tenant";
import { notifyExpert } from "@/lib/experts/notifications";
import { getRrnLockdown, tripRrnLockdown } from "@/lib/integrations/rrn-lockdown";
import { blockInPractice } from "@/lib/practice/server";
import { logAudit } from "@/lib/audit/log";
import { resolveEmailProvider } from "@/lib/email/provider";
import {
  RRN_ACCESS_REASONS,
  RRN_PROJECT_LIMIT,
  isOverProjectLimit,
  isRateLimited,
  type RrnAccessReason,
} from "@/lib/integrations/rrn-access";

type Designee =
  | { ok: true; userId: string; email: string; tenantId: string; accessorLabel: string }
  | { ok: false; error: string };

/** 재인증(2차 수단) — 계정 비밀번호를 별도 확인. 조회 비밀번호와 구분된 요소. */
async function verifyAccountPassword(email: string, password: string): Promise<boolean> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon || !password) return false;
  try {
    const client = createSbClient(url, anon, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { error } = await client.auth.signInWithPassword({ email, password });
    return !error;
  } catch {
    return false;
  }
}

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
    email: user.email ?? "",
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
  expertName: string;
  wrappedPrivateKey: string;
  kdfSalt: string;
  wrapIv: string;
  wrappedDekForTenant: string;
  frontCiphertext: string;
  backCiphertext: string;
};

export type RevealAccessType = "file_generation" | "screen";

export type RevealResult =
  | { ok: true; material: RevealMaterial; overLimit: boolean }
  | { ok: false; error: string; needsOverLimitApproval?: true; usedCount?: number };

/**
 * 프로젝트당 조회 횟수 — tax_access_logs가 유일한 사실 원천이다(§5의 2회 한도).
 * project_id가 없는 grant(프로젝트 미연결)는 전문가 단위로 집계한다.
 */
async function countProjectAccess(
  admin: ReturnType<typeof createAdminClient>,
  tenantId: string,
  expertId: string,
  projectId: string | null
): Promise<number> {
  let q = admin
    .from("tax_access_logs")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .eq("expert_id", expertId);
  q = projectId ? q.eq("project_id", projectId) : q.is("project_id", null);
  const { count } = await q;
  return count ?? 0;
}

/**
 * 조회 자료 발급 + 게이트 강제(§5).
 *  - 지정자만, 프로젝트당 2회 한도, 시간당 상한, 승인된 지급 목적(사유) 필수.
 *  - 한도 초과는 **차단이 아니라** 사유 기재 + 대표 승인 + 전문가 통지로 처리한다.
 *  - 자료(암호문·래핑키)가 서버를 떠나는 시점 = 조회 발생 → tax_access_logs 기록 +
 *    전문가 즉시 통지. 서버는 복호화하지 않는다(브라우저에서만).
 */
export async function getRevealMaterial(
  grantId: string,
  reason: RrnAccessReason,
  accountPassword: string,
  accessType: RevealAccessType = "file_generation"
): Promise<RevealResult> {
  if (!hasSupabaseEnv()) return { ok: false, error: "서버 설정이 완료되지 않았습니다." };
  if (!hasStoreBEnv()) return { ok: false, error: "보안 저장소 연결이 설정되지 않았습니다." };
  // 연습모드에서는 주민번호 조회를 흉내조차 내지 않는다 — 연습용 키 위임 체계를
  // 따로 만들면 그 자체가 새로운 복호화 경로가 된다 (CLAUDE.md §5).
  const practice = await blockInPractice("taxAccess");
  if (!practice.ok) return practice;
  const d = await requireDesignee();
  if (!d.ok) return d;
  if (!(reason in RRN_ACCESS_REASONS)) {
    return { ok: false, error: "조회 사유를 선택하세요." };
  }

  // 재인증(2차 수단) — 조회 비밀번호와 별개로 계정 비밀번호를 재확인(§5)
  if (!(await verifyAccountPassword(d.email, accountPassword))) {
    return { ok: false, error: "재인증 실패 — 계정 비밀번호가 일치하지 않습니다." };
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

  // === 프로젝트당 2회 한도 (§5) ===
  // 초과를 차단하지는 않는다. 다만 초과 조회는 사전에 사유가 적히고 대표가 승인한
  // 건이어야 하며, 승인 1건은 조회 1회로 소진된다.
  const projectUsedCount = await countProjectAccess(
    admin,
    d.tenantId,
    grant.expert_id,
    grant.project_id
  );
  let overLimitApproval: { id: string; reason: string | null } | null = null;
  if (isOverProjectLimit(projectUsedCount)) {
    let approvalQuery = admin
      .from("tax_access_requests")
      .select("id, over_limit_reason")
      .eq("tenant_id", d.tenantId)
      .eq("expert_id", grant.expert_id)
      .eq("is_over_limit", true)
      .eq("status", "approved")
      .is("consumed_at", null);
    approvalQuery = grant.project_id
      ? approvalQuery.eq("project_id", grant.project_id)
      : approvalQuery.is("project_id", null);
    const { data: approved } = await approvalQuery
      .order("decided_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (!approved) {
      return {
        ok: false,
        needsOverLimitApproval: true,
        usedCount: projectUsedCount,
        error:
          `이 프로젝트에서 해당 전문가의 주민번호를 이미 ${projectUsedCount}회 조회했습니다(한도 ${RRN_PROJECT_LIMIT}회). ` +
          "초과 조회는 사유를 기재해 대표 승인을 받은 뒤 진행할 수 있습니다.",
      };
    }
    overLimitApproval = { id: approved.id, reason: approved.over_limit_reason };
  }

  const [{ data: tenantKey }, { data: front }, { data: tenant }, { data: expert }] =
    await Promise.all([
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
      admin.from("experts").select("name").eq("id", grant.expert_id).maybeSingle(),
    ]);

  // 전문가는 타 테넌트 projects를 RLS로 읽지 못한다 — 이력 화면에 쓸 이름을 스냅샷.
  let projectName: string | null = null;
  if (grant.project_id) {
    const { data: project } = await admin
      .from("projects")
      .select("name")
      .eq("id", grant.project_id)
      .maybeSingle();
    projectName = project?.name ?? null;
  }
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
    project_name: projectName,
    reason,
    access_type: accessType,
    accessor_label: d.accessorLabel,
    is_over_limit: overLimitApproval !== null,
    over_limit_reason: overLimitApproval?.reason ?? null,
  });

  // 승인 1건 = 조회 1회. 소진 처리해 같은 승인으로 두 번 조회할 수 없게 한다.
  if (overLimitApproval) {
    await admin
      .from("tax_access_requests")
      .update({ status: "fulfilled", consumed_at: new Date().toISOString() })
      .eq("id", overLimitApproval.id)
      .is("consumed_at", null);
  }

  await notifyExpert({
    expertId: grant.expert_id,
    category: "rrn_access",
    title: overLimitApproval
      ? `주민등록번호가 조회되었습니다 (한도 초과 ${projectUsedCount + 1}회차)`
      : "주민등록번호가 조회되었습니다",
    body:
      `${tenant?.name ? `${tenant.name} · ` : ""}${reasonLabel} · 조회자 ${d.accessorLabel}` +
      (overLimitApproval
        ? ` · 프로젝트당 ${RRN_PROJECT_LIMIT}회 한도를 넘긴 조회입니다(대표 승인). 사유: ${
            overLimitApproval.reason ?? "미기재"
          }`
        : ""),
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
    overLimit: overLimitApproval !== null,
    material: {
      expertName: expert?.name ?? "전문가",
      wrappedPrivateKey: tenantKey.wrapped_private_key,
      kdfSalt: tenantKey.kdf_salt,
      wrapIv: tenantKey.wrap_iv,
      wrappedDekForTenant: grant.wrapped_dek_for_tenant,
      frontCiphertext: front.front_ciphertext,
      backCiphertext: back.back_ciphertext,
    },
  };
}

export type OverLimitRequestResult = { ok: true } | { ok: false; error: string };

/**
 * 초과 조회 요청 — 지정자가 사유를 적어 대표 승인을 신청한다(§5).
 *
 * 한도 초과를 차단하지 않는 대신 여기에서 사유·요청자를 남긴다. 승인 권한은
 * 대표 전용이며 위임되지 않는다(승인 액션은 security/actions.ts).
 */
export async function requestOverLimitAccess(
  grantId: string,
  reason: RrnAccessReason,
  overLimitReason: string
): Promise<OverLimitRequestResult> {
  if (!hasSupabaseEnv()) return { ok: false, error: "서버 설정이 완료되지 않았습니다." };
  const practice = await blockInPractice("taxAccess");
  if (!practice.ok) return practice;
  const d = await requireDesignee();
  if (!d.ok) return d;
  if (!(reason in RRN_ACCESS_REASONS)) {
    return { ok: false, error: "조회 사유를 선택하세요." };
  }
  const note = overLimitReason.trim();
  if (note.length < 10) {
    return {
      ok: false,
      error: "초과 조회 사유를 10자 이상 구체적으로 적어 주세요 (예: 국세청 경정청구 대응).",
    };
  }

  const admin = createAdminClient();
  const { data: grant } = await admin
    .from("tax_project_grants")
    .select("id, expert_id, project_id")
    .eq("id", grantId)
    .eq("tenant_id", d.tenantId)
    .eq("status", "active")
    .eq("is_honeytoken", false)
    .maybeSingle();
  if (!grant) return { ok: false, error: "조회할 수 있는 대상이 아닙니다." };

  // 같은 대상에 대해 미처리(대기·미소진 승인) 요청이 있으면 중복 신청하지 않는다.
  let openQuery = admin
    .from("tax_access_requests")
    .select("id, status")
    .eq("tenant_id", d.tenantId)
    .eq("expert_id", grant.expert_id)
    .eq("is_over_limit", true)
    .in("status", ["pending", "approved"])
    .is("consumed_at", null);
  openQuery = grant.project_id
    ? openQuery.eq("project_id", grant.project_id)
    : openQuery.is("project_id", null);
  const { data: open } = await openQuery.limit(1).maybeSingle();
  if (open) {
    return {
      ok: false,
      error:
        open.status === "approved"
          ? "이미 승인된 초과 조회 건이 있습니다. 그대로 조회를 진행하세요."
          : "이미 대표 승인 대기 중인 초과 조회 요청이 있습니다.",
    };
  }

  const { error } = await admin.from("tax_access_requests").insert({
    tenant_id: d.tenantId,
    project_id: grant.project_id,
    expert_id: grant.expert_id,
    reason,
    status: "pending",
    requested_by: d.userId,
    is_over_limit: true,
    over_limit_reason: note,
  });
  if (error) return { ok: false, error: "요청을 저장하지 못했습니다." };

  // 사유 본문은 감사로그가 아니라 요청 레코드에 남긴다(감사로그는 메타데이터만).
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  await logAudit(supabase, user, {
    action: "rrn.over_limit.request",
    resourceType: "tax_access_requests",
    resourceId: grant.expert_id,
    afterData: { project_id: grant.project_id, reason },
  });

  await notifyCeoOfOverLimitRequest(d.tenantId, note);
  return { ok: true };
}

/** 대표에게 초과 조회 승인 요청 알림(이메일, best-effort). 직원용 알림함은 아직 없다. */
async function notifyCeoOfOverLimitRequest(
  tenantId: string,
  note: string
): Promise<void> {
  try {
    const provider = resolveEmailProvider();
    if (!provider) return;
    const admin = createAdminClient();
    const [{ data: ceos }, { data: tenant }] = await Promise.all([
      admin
        .from("users")
        .select("email")
        .eq("tenant_id", tenantId)
        .eq("grade", "ceo")
        .eq("is_active", true),
      admin.from("tenants").select("name, slug").eq("id", tenantId).maybeSingle(),
    ]);
    const to = (ceos ?? []).map((u) => u.email).filter(Boolean);
    if (to.length === 0) return;
    const from = process.env.EMAIL_FROM ?? "CASTLOG <noreply@castlog.kr>";
    await provider.send({
      from,
      to: to.join(","),
      subject: "[승인 요청] 주민등록번호 초과 조회 승인이 필요합니다",
      text:
        `${tenant?.name ?? "귀사"}에서 프로젝트당 조회 한도(${RRN_PROJECT_LIMIT}회)를 넘는\n` +
        `주민등록번호 조회 요청이 접수되었습니다.\n\n` +
        `사유: ${note}\n\n` +
        `승인·반려는 기업 관리 > 보안 현황 화면에서 대표 계정으로 처리할 수 있습니다.\n` +
        (tenant?.slug ? `/${tenant.slug}/admin/org/security\n` : ""),
    });
  } catch {
    // 알림 실패가 요청 접수를 되돌리지는 않는다. 화면 목록에 그대로 남는다.
  }
}
