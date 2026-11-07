"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import { isMissingTableError } from "@/lib/supabase/errors";
import { practiceFromUser } from "@/lib/auth/tenant";
import { explainActionError } from "@/lib/ux/action-errors";
import { requireProjectTeam, requireTenantStaff, type ProjectActor } from "@/lib/projects/team";
import { generateLinkToken, hashLinkToken } from "@/lib/auth/tokens";
import { buildPublicLink } from "@/lib/routing/links";
import { generateClientPassword, hashClientPassword } from "@/lib/integrations/client-review";
import { CLIENT_LINK_DEFAULT_DAYS, CLIENT_LINK_MAX_DAYS } from "@/lib/integrations/client-review-shared";
import { movePrePlanStage } from "@/lib/integrations/pre-plan-stage";

/**
 * 발주처 검토 액션 (기획 승인 2026-11-07 — 3단계, 02·04번 + 보정).
 *  - 링크 만들기: 미리보기 뒤 호출. 비밀번호(직접 입력 또는 자동)·만료일 → URL+비밀번호를 **이때 한 번만** 돌려준다.
 *  - 회수: 담당자가 수동으로. (발주처가 회신하면 공개 액션이 자동 회수한다)
 *  - 건너뛰기: 발주처 검토가 필요 없는 사업 → 바로 후보 조정 단계(adjusting).
 */

type Result = { ok: true } | { ok: false; error: string };
const NOT_READY = "발주처 검토 기능이 아직 열리지 않았습니다 (상태 미충족 — 데이터베이스 마이그레이션 0014 적용 전). 관리자에게 적용을 요청해 주세요.";
const SYSTEM_FAIL = "저장하지 못했습니다 (시스템 오류). 잠시 후 다시 시도해 주세요.";

function revalidate() {
  revalidatePath("/[tenantSlug]/projects/[projectId]", "page");
}

type TeamList =
  | { ok: true; list: { id: string; project_id: string; status: string; revision: number; title: string }; actor: ProjectActor }
  | { ok: false; error: string };

async function loadListForTeam(listId: string): Promise<TeamList> {
  const supabase = createClient();
  const { data: list, error } = await supabase
    .from("candidate_lists")
    .select("id, project_id, status, revision, title")
    .eq("id", listId)
    .maybeSingle();
  if (error && isMissingTableError(error)) return { ok: false, error: NOT_READY };
  if (!list) return { ok: false, error: "리스트를 찾을 수 없습니다 (열람 범위 밖이거나 삭제됨)." };
  const gate = await requireProjectTeam(list.project_id, "exec:clientReview");
  if (!gate.ok) return { ok: false, error: gate.error };
  return { ok: true, list, actor: gate.actor };
}

const createSchema = z.object({
  password: z
    .string()
    .trim()
    .min(6, "비밀번호는 6자 이상이어야 합니다.")
    .max(32, "비밀번호는 32자 이내여야 합니다.")
    .optional()
    .or(z.literal("")),
  expiresDays: z.number().int().min(1, "유효기간은 1일 이상").max(CLIENT_LINK_MAX_DAYS, `유효기간은 ${CLIENT_LINK_MAX_DAYS}일 이내`).optional(),
});

export type CreateClientLinkResult =
  | { ok: true; url: string; password: string; expiresAt: string; round: number }
  | { ok: false; error: string };

export async function createClientReviewLink(listId: string, input: z.infer<typeof createSchema>): Promise<CreateClientLinkResult> {
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "입력값을 확인하세요." };
  const loaded = await loadListForTeam(listId);
  if (!loaded.ok) return { ok: false, error: loaded.error };
  const { list, actor } = loaded;
  const gate = { actor };
  if (!["internal_done", "client_sent", "client_replied"].includes(list.status)) {
    return { ok: false, error: "내부 검토가 완료된 리스트만 발주처에 보낼 수 있습니다 (상태 미충족). 리스트 작성 탭에서 내부 검토를 먼저 마치세요." };
  }
  const supabase = createClient();
  // 살아 있는 링크가 있으면 회수하고 새 라운드 — 발주처에 두 링크가 동시에 살아 있지 않게
  const { data: existing, error: existingError } = await supabase
    .from("client_review_links")
    .select("id, round, revoked_at, expires_at")
    .eq("list_id", listId)
    .order("round", { ascending: false });
  if (existingError) {
    if (isMissingTableError(existingError)) return { ok: false, error: NOT_READY };
    return { ok: false, error: await explainActionError(existingError.message, SYSTEM_FAIL) };
  }
  const now = new Date();
  for (const l of existing ?? []) {
    if (!l.revoked_at && new Date(l.expires_at) > now) {
      await supabase.from("client_review_links").update({ revoked_at: now.toISOString(), revoke_reason: "superseded" }).eq("id", l.id);
    }
  }
  const round = ((existing ?? [])[0]?.round ?? 0) + 1;
  const password = parsed.data.password?.trim() || generateClientPassword();
  const token = generateLinkToken();
  const expiresAt = new Date(now.getTime() + (parsed.data.expiresDays ?? CLIENT_LINK_DEFAULT_DAYS) * 86_400_000).toISOString();
  const { data: created, error } = await supabase
    .from("client_review_links")
    .insert({
      tenant_id: gate.actor.tenantId,
      project_id: list.project_id,
      list_id: listId,
      round,
      token_hash: hashLinkToken(token),
      password_hash: hashClientPassword(password),
      expires_at: expiresAt,
      created_by: gate.actor.userId,
      is_practice: practiceFromUser(gate.actor.user),
    })
    .select("id")
    .single();
  if (error || !created) return { ok: false, error: await explainActionError(error?.message ?? "", SYSTEM_FAIL) };

  if (list.status === "internal_done" || list.status === "client_replied") {
    await supabase.from("candidate_lists").update({ status: "client_sent" }).eq("id", listId);
  }
  await supabase.from("audit_logs").insert({
    tenant_id: gate.actor.tenantId,
    actor_auth_user_id: gate.actor.userId,
    actor_role: gate.actor.role,
    action: "client_review.link_created",
    resource_type: "client_review_link",
    resource_id: created.id,
    after_data: { list_id: listId, project_id: list.project_id, round, expires_at: expiresAt },
  });
  // 프로젝트 섭외 단계 → 발주처 검토 중 (4단계 단계값, 품의 전 구간에서만)
  await movePrePlanStage(supabase, list.project_id, "client_review");
  let url: string;
  try {
    url = buildPublicLink("clientReview", token);
  } catch {
    url = `/l/${token}`;
  }
  revalidate();
  return { ok: true, url, password, expiresAt, round };
}

export async function revokeClientReviewLink(linkId: string): Promise<Result> {
  const staff = await requireTenantStaff();
  if (!staff.ok) return staff;
  if (!z.string().uuid().safeParse(linkId).success) return { ok: false, error: "링크를 확인하세요." };
  const supabase = createClient();
  const { data: link, error } = await supabase.from("client_review_links").select("id, list_id, project_id, revoked_at").eq("id", linkId).maybeSingle();
  if (error && isMissingTableError(error)) return { ok: false, error: NOT_READY };
  if (!link) return { ok: false, error: "링크를 찾을 수 없습니다 (열람 범위 밖이거나 삭제됨)." };
  const gate = await requireProjectTeam(link.project_id, "exec:clientReview");
  if (!gate.ok) return gate;
  if (link.revoked_at) return { ok: false, error: "이미 회수된 링크입니다." };
  const { error: updateError } = await supabase
    .from("client_review_links")
    .update({ revoked_at: new Date().toISOString(), revoke_reason: "manual" })
    .eq("id", linkId);
  if (updateError) return { ok: false, error: await explainActionError(updateError.message, SYSTEM_FAIL) };
  await supabase.from("audit_logs").insert({
    tenant_id: gate.actor.tenantId,
    actor_auth_user_id: gate.actor.userId,
    actor_role: gate.actor.role,
    action: "client_review.link_revoked",
    resource_type: "client_review_link",
    resource_id: linkId,
    after_data: { list_id: link.list_id },
  });
  revalidate();
  return { ok: true };
}

/** 발주처 검토가 필요 없는 사업 — 바로 후보 조정 단계로 */
export async function skipClientReview(listId: string): Promise<Result> {
  const loaded = await loadListForTeam(listId);
  if (!loaded.ok) return { ok: false, error: loaded.error };
  const { list, actor } = loaded;
  const gate = { actor };
  if (!["internal_done", "client_sent", "client_replied"].includes(list.status)) {
    return { ok: false, error: "내부 검토가 완료된 리스트만 다음 단계로 넘길 수 있습니다 (상태 미충족)." };
  }
  const supabase = createClient();
  const { error } = await supabase.from("candidate_lists").update({ status: "adjusting" }).eq("id", listId);
  if (error) return { ok: false, error: await explainActionError(error.message, SYSTEM_FAIL) };
  await supabase.from("audit_logs").insert({
    tenant_id: gate.actor.tenantId,
    actor_auth_user_id: gate.actor.userId,
    actor_role: gate.actor.role,
    action: "client_review.skipped_or_closed",
    resource_type: "candidate_list",
    resource_id: listId,
    after_data: { from_status: list.status },
  });
  // 프로젝트 섭외 단계 → 후보 조정 중 (4단계 단계값, 품의 전 구간에서만)
  await movePrePlanStage(supabase, list.project_id, "adjusting");
  revalidate();
  return { ok: true };
}
