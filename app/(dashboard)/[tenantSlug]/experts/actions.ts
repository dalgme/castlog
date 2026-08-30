"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { deniedExec } from "@/lib/monitoring/action-denials";
import { canExecTenant } from "@/lib/auth/exec-policy";
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
import { sendTenantSms } from "@/lib/sms/send";
import {
  EXPERT_INVITE_SMS_DEFAULT,
  EXPERT_INVITE_SMS_KEY,
  renderInviteSms,
} from "@/lib/messaging/templates";

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
  if (!user || !tenantId || !role) {
    return { ok: false, error: "로그인이 필요합니다." };
  }
  if (!(await canExecTenant("expertInvite", user))) {
    return { ok: false, error: await deniedExec("expertInvite") };
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
  if (!user || !tenantId || !role) {
    return { ok: false, error: "로그인이 필요합니다." };
  }
  if (!(await canExecTenant("expertInvite", user))) {
    return { ok: false, error: await deniedExec("expertInvite") };
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

export type RegenerateInvitationResult =
  | { ok: true; url: string }
  | { ok: false; error: string };

/**
 * 등록 요청 링크 재생성 (기획 확정 2026-08-22).
 * 새 토큰을 발급하고 유효기간을 다시 연다 — 이전 링크는 즉시 무효가 된다
 * (해시만 저장하므로 기존 원문 토큰은 복원할 수 없다. 재생성이 곧 회전이다).
 */
export async function regenerateExpertInvitation(
  invitationId: string
): Promise<RegenerateInvitationResult> {
  if (!hasSupabaseEnv()) {
    return { ok: false, error: "서버 설정이 완료되지 않았습니다." };
  }

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const tenantId = tenantIdFromUser(user);
  const role = roleFromUser(user);
  if (!user || !tenantId || !role) {
    return { ok: false, error: "로그인이 필요합니다." };
  }
  if (!(await canExecTenant("expertInvite", user))) {
    return { ok: false, error: await deniedExec("expertInvite") };
  }

  const token = generateLinkToken();
  const expiresAt = new Date(
    Date.now() + INVITATION_EXPIRES_DAYS * 24 * 60 * 60 * 1000
  ).toISOString();

  const { data: updated, error } = await supabase
    .from("expert_invitations")
    .update({ token_hash: hashLinkToken(token), expires_at: expiresAt })
    .eq("id", invitationId)
    .eq("status", "pending")
    .select("id")
    .maybeSingle();
  if (error || !updated) {
    return { ok: false, error: "재생성할 수 없는 요청입니다 (대기중 상태만 가능)." };
  }

  await supabase.from("audit_logs").insert({
    tenant_id: tenantId,
    actor_auth_user_id: user.id,
    actor_role: role,
    action: "expert_invitation.regenerate",
    resource_type: "expert_invitation",
    resource_id: invitationId,
  });

  revalidatePath("/[tenantSlug]/experts", "page");
  try {
    return { ok: true, url: buildPublicLink("expertJoin", token) };
  } catch {
    return { ok: true, url: `/j/${token}` };
  }
}

export type SendInvitationSmsResult =
  | { ok: true; testMode: boolean }
  | { ok: false; error: string };

/**
 * 등록 요청 문자 발송 (기획 확정 2026-08-22).
 * 문구는 설정 > SMS 설정의 '등록 요청 문자 문구'(tenant_message_templates,
 * 없으면 기본 문구)를 쓰고, {URL}에는 **새로 회전된 링크**가 들어간다 —
 * 원문 토큰은 해시로만 저장돼 있어 재발급 없이는 링크를 만들 수 없다.
 * 발신번호는 규칙대로 회사 대표번호.
 */
export async function sendExpertInvitationSms(
  invitationId: string
): Promise<SendInvitationSmsResult> {
  if (!hasSupabaseEnv()) {
    return { ok: false, error: "서버 설정이 완료되지 않았습니다." };
  }

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const tenantId = tenantIdFromUser(user);
  const role = roleFromUser(user);
  if (!user || !tenantId || !role) {
    return { ok: false, error: "로그인이 필요합니다." };
  }
  if (!(await canExecTenant("expertInvite", user))) {
    return { ok: false, error: await deniedExec("expertInvite") };
  }

  const { data: invitation } = await supabase
    .from("expert_invitations")
    .select("id, invited_name, invited_phone, status")
    .eq("id", invitationId)
    .maybeSingle();
  if (!invitation || invitation.status !== "pending") {
    return { ok: false, error: "발송할 수 없는 요청입니다 (대기중 상태만 가능)." };
  }
  if (!invitation.invited_phone) {
    return {
      ok: false,
      error: "이 요청에는 휴대폰 번호가 지정돼 있지 않습니다. 링크를 복사해 직접 전달하세요.",
    };
  }

  // 링크 회전 + 유효기간 갱신 (이전 링크는 무효)
  const token = generateLinkToken();
  const expiresAt = new Date(
    Date.now() + INVITATION_EXPIRES_DAYS * 24 * 60 * 60 * 1000
  ).toISOString();
  const { data: rotated } = await supabase
    .from("expert_invitations")
    .update({ token_hash: hashLinkToken(token), expires_at: expiresAt })
    .eq("id", invitationId)
    .eq("status", "pending")
    .select("id")
    .maybeSingle();
  if (!rotated) {
    return { ok: false, error: "링크 재발급에 실패했습니다. 다시 시도해 주세요." };
  }
  let url: string;
  try {
    url = buildPublicLink("expertJoin", token);
  } catch {
    return { ok: false, error: "공개 링크 기본 주소가 설정되지 않았습니다. 캐스트로그에 알려 주세요." };
  }

  // 문구 로드 (설정 > SMS 설정 — 없으면 기본 문구)
  const [{ data: template }, { data: tenant }] = await Promise.all([
    supabase
      .from("tenant_message_templates")
      .select("body")
      .eq("template_key", EXPERT_INVITE_SMS_KEY)
      .maybeSingle(),
    supabase.from("tenants").select("name").eq("id", tenantId).maybeSingle(),
  ]);
  const body = renderInviteSms(template?.body ?? EXPERT_INVITE_SMS_DEFAULT, {
    url,
    tenantName: tenant?.name ?? "",
    inviteeName: invitation.invited_name,
  });

  const result = await sendTenantSms({
    tenantId,
    senderUserId: user.id,
    messageType: "transactional",
    body,
    recipients: [
      {
        phone: invitation.invited_phone,
        expertId: null,
        name: invitation.invited_name ?? "",
      },
    ],
  });
  if (!result.ok) return result;
  if (result.summary.failed > 0) {
    return { ok: false, error: "문자 발송에 실패했습니다. 발송 이력에서 원인을 확인하세요." };
  }

  await supabase.from("audit_logs").insert({
    tenant_id: tenantId,
    actor_auth_user_id: user.id,
    actor_role: role,
    action: "expert_invitation.sms_send",
    resource_type: "expert_invitation",
    resource_id: invitationId,
  });

  revalidatePath("/[tenantSlug]/experts", "page");
  return { ok: true, testMode: result.summary.testMode };
}
