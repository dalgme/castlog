"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { isMissingColumnError, isMissingTableError } from "@/lib/supabase/errors";
import { explainActionError } from "@/lib/ux/action-errors";
import { roleFromUser, tenantIdFromUser } from "@/lib/auth/tenant";

/**
 * 프로젝트 리뷰 탭 (기획 지시 2026-09-21) — HWP '프로젝트 리뷰' 양식.
 *
 * 1) 완료 사업 결과 요약표의 체크·수기 항목 → project_reviews (프로젝트당 1행)
 * 2) 전문가 평가 행 · 운영 특이사항 행 → project_review_items (행 단위 등록/수정)
 *
 * 쓰기 권한은 RLS(app.is_project_team — 대표·이사 전원, 그 외 배정된 팀원·개설자)가
 * 강제한다. 여기서는 로그인·테넌트만 확인하고 거부는 규칙 문구로 돌려준다 (§12-9).
 * 리뷰는 사업이 끝난 뒤 쓰는 기록이라 프로젝트 상태(종료 포함)로 막지 않는다.
 */

type Result = { ok: true } | { ok: false; error: string };

const TABLE_MISSING =
  "리뷰 저장소가 아직 이 서버에 준비되지 않았습니다 (시스템 설정). 관리자에게 마이그레이션(0007) 적용을 요청해 주세요.";

async function requireStaffSession(): Promise<
  { ok: true; userId: string; tenantId: string; role: string } | { ok: false; error: string }
> {
  if (!hasSupabaseEnv()) return { ok: false, error: "서버 설정이 완료되지 않았습니다." };
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const tenantId = tenantIdFromUser(user);
  const role = roleFromUser(user);
  if (!user || !tenantId || !role || role === "expert") {
    return { ok: false, error: "로그인이 필요합니다." };
  }
  return { ok: true, userId: user.id, tenantId, role };
}

async function failure(
  error: { code?: string | null; message?: string },
  fallback: string
): Promise<{ ok: false; error: string }> {
  if (isMissingTableError(error) || isMissingColumnError(error)) {
    return { ok: false, error: TABLE_MISSING };
  }
  return { ok: false, error: await explainActionError(error.message, fallback) };
}

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `${max}자 이내로 적어 주세요.`)
    .transform((v) => (v === "" ? null : v))
    .nullable();

const reviewSchema = z.object({
  projectId: z.string().uuid(),
  contractType: z.enum(["private", "bid"]).nullable(),
  recruitDone: z.boolean().nullable(),
  recruitNote: optionalText(300),
  depositDone: z.boolean(),
  formTransferDone: z.boolean(),
  formTransferNote: optionalText(300),
  clientContact: optionalText(200),
  eventDatesText: optionalText(300),
  venueText: optionalText(300),
});

export type ProjectReviewInput = z.infer<typeof reviewSchema>;

/** 요약표 체크·수기 항목 저장 — 등록/수정 모두 이 하나 (프로젝트당 1행 upsert) */
export async function saveProjectReview(input: ProjectReviewInput): Promise<Result> {
  const auth = await requireStaffSession();
  if (!auth.ok) return auth;
  const parsed = reviewSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "입력값을 확인하세요." };
  }
  const d = parsed.data;
  const supabase = createClient();
  const { error } = await supabase.from("project_reviews").upsert(
    {
      tenant_id: auth.tenantId,
      project_id: d.projectId,
      contract_type: d.contractType,
      recruit_done: d.recruitDone,
      recruit_note: d.recruitNote,
      deposit_done: d.depositDone,
      form_transfer_done: d.formTransferDone,
      form_transfer_note: d.formTransferNote,
      client_contact: d.clientContact,
      event_dates_text: d.eventDatesText,
      venue_text: d.venueText,
      created_by: auth.userId,
      updated_by: auth.userId,
    },
    { onConflict: "project_id" }
  );
  if (error) return failure(error, "리뷰 요약표를 저장하지 못했습니다. 다시 시도해 주세요.");
  await supabase.from("audit_logs").insert({
    tenant_id: auth.tenantId,
    actor_auth_user_id: auth.userId,
    actor_role: auth.role,
    action: "project_review.save",
    resource_type: "project",
    resource_id: d.projectId,
  });
  revalidatePath("/[tenantSlug]/projects/[projectId]", "page");
  return { ok: true };
}

const itemSchema = z.object({
  id: z.string().uuid().nullable(),
  projectId: z.string().uuid(),
  section: z.enum(["expert", "ops"]),
  sortOrder: z.number().int().min(0).max(10000),
  subject: z.string().trim().max(120, "구분(이름)은 120자 이내로 적어 주세요."),
  expertId: z.string().uuid().nullable(),
  form: optionalText(200),
  body: z.string().trim().max(5000, "내용은 5000자 이내로 적어 주세요."),
});

export type ReviewItemInput = z.infer<typeof itemSchema>;

/** 리뷰 행 등록(id 없음) / 수정(id 있음) — 행마다 '등록'→'수정' 버튼 */
export async function saveReviewItem(
  input: ReviewItemInput
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const auth = await requireStaffSession();
  if (!auth.ok) return auth;
  const parsed = itemSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "입력값을 확인하세요." };
  }
  const d = parsed.data;
  if (!d.subject && !d.expertId) {
    return { ok: false, error: "구분(이름)을 적어 주세요 (상태 미충족)." };
  }
  const supabase = createClient();
  if (d.id) {
    const { data, error } = await supabase
      .from("project_review_items")
      .update({
        subject: d.subject,
        form: d.form,
        body: d.body,
        sort_order: d.sortOrder,
        updated_by: auth.userId,
      })
      .eq("id", d.id)
      .eq("project_id", d.projectId)
      .select("id")
      .maybeSingle();
    if (error) return failure(error, "리뷰 행을 수정하지 못했습니다. 다시 시도해 주세요.");
    if (!data) {
      return {
        ok: false,
        error: "수정할 행을 찾지 못했습니다 (권한 규칙 또는 이미 삭제됨). 새로고침 후 다시 시도해 주세요.",
      };
    }
    revalidatePath("/[tenantSlug]/projects/[projectId]", "page");
    return { ok: true, id: data.id };
  }
  const { data, error } = await supabase
    .from("project_review_items")
    .insert({
      tenant_id: auth.tenantId,
      project_id: d.projectId,
      section: d.section,
      sort_order: d.sortOrder,
      subject: d.subject,
      expert_id: d.expertId,
      form: d.form,
      body: d.body,
      created_by: auth.userId,
      updated_by: auth.userId,
    })
    .select("id")
    .single();
  if (error) {
    if (error.code === "23505") {
      return { ok: false, error: "이 전문가의 평가 행은 이미 등록돼 있습니다. 새로고침 후 '수정'으로 고쳐 주세요." };
    }
    return failure(error, "리뷰 행을 등록하지 못했습니다. 다시 시도해 주세요.");
  }
  revalidatePath("/[tenantSlug]/projects/[projectId]", "page");
  return { ok: true, id: data.id };
}

/** 직접 추가한 행 삭제 — 확인창을 거친 뒤에만 */
export async function deleteReviewItem(id: string): Promise<Result> {
  const auth = await requireStaffSession();
  if (!auth.ok) return auth;
  if (!z.string().uuid().safeParse(id).success) {
    return { ok: false, error: "대상을 확인할 수 없습니다 (시스템 결함). 새로고침 후 다시 시도해 주세요." };
  }
  const supabase = createClient();
  const { error } = await supabase.from("project_review_items").delete().eq("id", id);
  if (error) return failure(error, "리뷰 행을 삭제하지 못했습니다. 다시 시도해 주세요.");
  revalidatePath("/[tenantSlug]/projects/[projectId]", "page");
  return { ok: true };
}
