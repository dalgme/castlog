"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { generateLinkToken, hashLinkToken } from "@/lib/auth/tokens";
import { normalizeKrMobileE164 } from "@/lib/auth/phone";
import { roleFromUser, tenantIdFromUser } from "@/lib/auth/tenant";
import { buildPublicLink } from "@/lib/routing/links";
import {
  inviteCreateSchema,
  type InviteCreateInput,
} from "@/lib/experts/schemas";
import { INVITATION_EXPIRES_DAYS } from "@/lib/experts/invitations";
import { getTenantModules } from "@/lib/modules/server";

export type CreateInvitationResult =
  | { ok: true; url: string }
  | { ok: false; error: string };

/**
 * 전문가 등록 요청 생성 (기업 관리자 이상 — RLS도 동일 조건 강제).
 * 원문 토큰은 응답으로만 반환하고 DB에는 해시만 저장한다.
 * 링크의 SMS 발송은 단계 14 — 지금은 링크를 복사해 직접 전달한다.
 */
export async function createExpertInvitation(
  input: InviteCreateInput
): Promise<CreateInvitationResult> {
  if (!hasSupabaseEnv()) {
    return { ok: false, error: "서버 설정이 완료되지 않았습니다." };
  }

  const parsed = inviteCreateSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "입력값을 확인하세요.",
    };
  }

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // tenant_id는 JWT app_metadata에서만 읽는다 (CLAUDE.md 3 — 최우선 원칙)
  const tenantId = tenantIdFromUser(user);
  const role = roleFromUser(user);
  if (!user || !tenantId || !role || !["org_admin", "manager"].includes(role)) {
    return { ok: false, error: "등록 요청 생성 권한이 없습니다." };
  }

  // 모듈 게이트 — 네비 숨김만으로는 불충분 (CLAUDE.md 1-2)
  const modules = await getTenantModules();
  if (!modules.experts) {
    return { ok: false, error: "전문가 모듈이 비활성화된 테넌트입니다." };
  }

  const token = generateLinkToken();
  const invitedPhone = parsed.data.phone
    ? normalizeKrMobileE164(parsed.data.phone)
    : null;
  const expiresAt = new Date(
    Date.now() + INVITATION_EXPIRES_DAYS * 24 * 60 * 60 * 1000
  ).toISOString();

  const { data: invitation, error } = await supabase
    .from("expert_invitations")
    .insert({
      tenant_id: tenantId,
      token_hash: hashLinkToken(token),
      invited_name: parsed.data.name || null,
      invited_phone: invitedPhone,
      expires_at: expiresAt,
      created_by: user.id,
    })
    .select("id")
    .single();

  if (error || !invitation) {
    return { ok: false, error: "등록 요청 생성에 실패했습니다. 다시 시도해 주세요." };
  }

  await supabase.from("audit_logs").insert({
    tenant_id: tenantId,
    actor_auth_user_id: user.id,
    actor_role: role,
    action: "expert_invitation.create",
    resource_type: "expert_invitation",
    resource_id: invitation.id,
  });

  let url: string;
  try {
    url = buildPublicLink("expertJoin", token);
  } catch {
    // NEXT_PUBLIC_BASE_URL 미설정 환경 — 상대 경로로 대체
    url = `/j/${token}`;
  }

  revalidatePath("/[tenantSlug]/experts", "page");
  return { ok: true, url };
}

export type RevokeInvitationResult = { ok: true } | { ok: false; error: string };

/** 등록 요청 회수 — 대기중(pending) 요청만 회수 가능 */
export async function revokeExpertInvitation(
  invitationId: string
): Promise<RevokeInvitationResult> {
  if (!hasSupabaseEnv()) {
    return { ok: false, error: "서버 설정이 완료되지 않았습니다." };
  }

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const tenantId = tenantIdFromUser(user);
  const role = roleFromUser(user);
  if (!user || !tenantId || !role || !["org_admin", "manager"].includes(role)) {
    return { ok: false, error: "등록 요청 회수 권한이 없습니다." };
  }

  const { data: updated, error } = await supabase
    .from("expert_invitations")
    .update({ status: "revoked" })
    .eq("id", invitationId)
    .eq("status", "pending")
    .select("id")
    .maybeSingle();

  if (error || !updated) {
    return { ok: false, error: "회수할 수 없는 요청입니다." };
  }

  await supabase.from("audit_logs").insert({
    tenant_id: tenantId,
    actor_auth_user_id: user.id,
    actor_role: role,
    action: "expert_invitation.revoke",
    resource_type: "expert_invitation",
    resource_id: invitationId,
  });

  revalidatePath("/[tenantSlug]/experts", "page");
  return { ok: true };
}
