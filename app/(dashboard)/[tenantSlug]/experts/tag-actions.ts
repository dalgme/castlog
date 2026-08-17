"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { roleFromUser, tenantIdFromUser } from "@/lib/auth/tenant";
import { getTenantModules } from "@/lib/modules/server";
import { isExpertTag } from "@/lib/integrations/expert-tags";

export type TagResult = { ok: true } | { ok: false; error: string };

const MANAGER_ROLES = ["org_admin", "manager"];

async function requireExpertManager(): Promise<
  { ok: true; userId: string; tenantId: string; role: string } | { ok: false; error: string }
> {
  if (!hasSupabaseEnv()) {
    return { ok: false, error: "서버 설정이 완료되지 않았습니다." };
  }
  const modules = await getTenantModules();
  if (!modules.experts) {
    return { ok: false, error: "전문가 모듈이 비활성화된 테넌트입니다." };
  }
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const tenantId = tenantIdFromUser(user);
  const role = roleFromUser(user);
  if (!user || !tenantId || !role || !MANAGER_ROLES.includes(role)) {
    return { ok: false, error: "전문가 등급 관리 권한이 없습니다(관리자 이상)." };
  }
  return { ok: true, userId: user.id, tenantId, role };
}

/**
 * 전문가 등급 지정·변경·해제 (자사 기준).
 * tag가 빈 값이면 해제한다. 등급 자체가 상태이므로 해제는 행 제거로 처리한다.
 */
export async function setExpertTag(
  expertId: string,
  tag: string,
  note?: string
): Promise<TagResult> {
  const auth = await requireExpertManager();
  if (!auth.ok) return auth;

  const supabase = createClient();

  // 자사와 활성 연결이 있는 전문가만 (RLS + 명시 확인)
  const { data: link } = await supabase
    .from("expert_tenant_links")
    .select("id, status")
    .eq("expert_id", expertId)
    .eq("tenant_id", auth.tenantId)
    .maybeSingle();
  if (!link || link.status !== "active") {
    return { ok: false, error: "활성 연결이 있는 전문가만 등급을 지정할 수 있습니다." };
  }

  if (!tag) {
    const { error } = await supabase
      .from("expert_tenant_tags")
      .delete()
      .eq("expert_id", expertId)
      .eq("tenant_id", auth.tenantId);
    if (error) return { ok: false, error: "해제에 실패했습니다." };
  } else {
    if (!isExpertTag(tag)) return { ok: false, error: "등급을 확인하세요." };
    if (tag === "caution" && !note?.trim()) {
      return { ok: false, error: "‘주의’ 등급은 사유를 함께 입력해 주세요." };
    }
    const { error } = await supabase.from("expert_tenant_tags").upsert(
      {
        tenant_id: auth.tenantId,
        expert_id: expertId,
        tag,
        note: note?.trim() || null,
        created_by: auth.userId,
      },
      { onConflict: "tenant_id,expert_id" }
    );
    if (error) return { ok: false, error: "등급 지정에 실패했습니다." };
  }

  await supabase.from("audit_logs").insert({
    tenant_id: auth.tenantId,
    actor_auth_user_id: auth.userId,
    actor_role: auth.role,
    action: tag ? "expert_tag.set" : "expert_tag.clear",
    resource_type: "expert",
    resource_id: expertId,
    after_data: tag ? { tag } : null,
  });

  revalidatePath("/[tenantSlug]/experts", "page");
  revalidatePath("/[tenantSlug]/experts/[expertId]", "page");
  return { ok: true };
}

/** 후기 작성 (정성 평가). 프로젝트 연결은 선택. */
export async function addExpertReview(
  expertId: string,
  body: string,
  projectId?: string
): Promise<TagResult> {
  const auth = await requireExpertManager();
  if (!auth.ok) return auth;

  const trimmed = body.trim();
  if (!trimmed) return { ok: false, error: "후기 내용을 입력하세요." };
  if (trimmed.length > 2000) {
    return { ok: false, error: "후기는 2000자 이내로 입력하세요." };
  }

  const supabase = createClient();
  const { error } = await supabase.from("expert_reviews").insert({
    tenant_id: auth.tenantId,
    expert_id: expertId,
    project_id: projectId || null,
    body: trimmed,
    author_user_id: auth.userId,
  });
  if (error) return { ok: false, error: "후기 저장에 실패했습니다." };

  revalidatePath("/[tenantSlug]/experts/[expertId]", "page");
  return { ok: true };
}

/** 후기 정정 — 삭제하지 않고 내용을 고친다 (§14-4). */
export async function updateExpertReview(
  reviewId: string,
  body: string
): Promise<TagResult> {
  const auth = await requireExpertManager();
  if (!auth.ok) return auth;

  const trimmed = body.trim();
  if (!trimmed) return { ok: false, error: "후기 내용을 입력하세요." };

  const supabase = createClient();
  const { error } = await supabase
    .from("expert_reviews")
    .update({ body: trimmed })
    .eq("id", reviewId);
  if (error) return { ok: false, error: "후기 수정에 실패했습니다." };

  revalidatePath("/[tenantSlug]/experts/[expertId]", "page");
  return { ok: true };
}
