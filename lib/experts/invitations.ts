import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { hashLinkToken } from "@/lib/auth/tokens";
import type { Tables } from "@/lib/supabase/database.types";

/** 등록 요청 링크 유효기간 (일) */
export const INVITATION_EXPIRES_DAYS = 7;

export type InvitationLookup =
  | {
      ok: true;
      invitation: Tables<"expert_invitations">;
      tenantName: string;
    }
  | { ok: false; reason: "not_found" | "expired" | "already_used" | "revoked" };

/**
 * 공개 /j/{token} 토큰 검증 — 서버(service_role) 전용.
 * anon RLS 정책을 열지 않고 여기서만 조회한다 (원문 토큰은 해시로 대조).
 */
export async function lookupInvitationByToken(
  token: string
): Promise<InvitationLookup> {
  const admin = createAdminClient();

  const { data: invitation } = await admin
    .from("expert_invitations")
    .select("*")
    .eq("token_hash", hashLinkToken(token))
    .maybeSingle();

  if (!invitation) return { ok: false, reason: "not_found" };
  if (invitation.status === "completed") return { ok: false, reason: "already_used" };
  if (invitation.status === "revoked") return { ok: false, reason: "revoked" };

  if (
    invitation.status === "expired" ||
    new Date(invitation.expires_at).getTime() < Date.now()
  ) {
    if (invitation.status === "pending") {
      await admin
        .from("expert_invitations")
        .update({ status: "expired" })
        .eq("id", invitation.id);
    }
    return { ok: false, reason: "expired" };
  }

  const { data: tenant } = await admin
    .from("tenants")
    .select("name")
    .eq("id", invitation.tenant_id)
    .maybeSingle();

  return { ok: true, invitation, tenantName: tenant?.name ?? "" };
}
