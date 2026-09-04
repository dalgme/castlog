"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { deniedExec } from "@/lib/monitoring/action-denials";
import { canExecTenant } from "@/lib/auth/exec-policy";
import { roleFromUser, tenantIdFromUser } from "@/lib/auth/tenant";
import { getTenantModules } from "@/lib/modules/server";
import { explainActionError } from "@/lib/ux/action-errors";

export type ManageResult = { ok: true } | { ok: false; error: string };

type Gate =
  | { ok: true; tenantId: string; userId: string }
  | { ok: false; error: string };

/** 평점·메모·섭외분야는 팀장 이상(manager)부터 — RLS와 같은 기준 */
async function gate(): Promise<Gate> {
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
  if (!(await canExecTenant("expertRecord", user))) {
    return { ok: false, error: await deniedExec("expertRecord") };
  }
  const modules = await getTenantModules();
  if (!modules.experts) {
    return { ok: false, error: "전문가 모듈이 비활성화된 테넌트입니다." };
  }
  return { ok: true, tenantId, userId: user.id };
}

const profileSchema = z.object({
  expertId: z.string().uuid(),
  rating: z.number().int().min(1).max(10).nullable(),
  memo: z.string().trim().max(2000),
});

/**
 * 테넌트별 전문가 평점·메모 저장 (전문가 관리 탭 — 기획 확정 2026-08-22).
 * 프로젝트 평가(expert_evaluations)와 별개인 회사 차원의 총평이다.
 * 전문가 본인에게는 보이지 않는다 (RLS).
 */
export async function saveExpertTenantProfile(input: {
  expertId: string;
  rating: number | null;
  memo: string;
}): Promise<ManageResult> {
  const g = await gate();
  if (!g.ok) return g;

  const parsed = profileSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "입력값을 확인하세요." };
  }

  const supabase = createClient();
  const { error } = await supabase.from("expert_tenant_profiles").upsert(
    {
      tenant_id: g.tenantId,
      expert_id: parsed.data.expertId,
      rating: parsed.data.rating,
      memo: parsed.data.memo || null,
      updated_by: g.userId,
    },
    { onConflict: "tenant_id,expert_id" }
  );
  if (error) {
    return {
      ok: false,
      error: await explainActionError(error.message, "평점·메모 저장에 실패했습니다."),
    };
  }

  revalidatePath("/[tenantSlug]/experts/manage", "page");
  return { ok: true };
}

/** 전문가에게 섭외분야 붙이기/떼기 */
export async function toggleExpertRecruitField(
  expertId: string,
  fieldId: string,
  on: boolean
): Promise<ManageResult> {
  const g = await gate();
  if (!g.ok) return g;

  if (!z.string().uuid().safeParse(expertId).success || !z.string().uuid().safeParse(fieldId).success) {
    return { ok: false, error: "잘못된 요청입니다." };
  }

  const supabase = createClient();
  if (on) {
    const { error } = await supabase.from("expert_tenant_recruit_fields").upsert(
      {
        tenant_id: g.tenantId,
        expert_id: expertId,
        field_id: fieldId,
        created_by: g.userId,
      },
      { onConflict: "tenant_id,expert_id,field_id", ignoreDuplicates: true }
    );
    if (error) {
      return {
        ok: false,
        error: await explainActionError(error.message, "섭외분야 추가에 실패했습니다."),
      };
    }
  } else {
    const { error } = await supabase
      .from("expert_tenant_recruit_fields")
      .delete()
      .eq("tenant_id", g.tenantId)
      .eq("expert_id", expertId)
      .eq("field_id", fieldId);
    if (error) {
      return {
        ok: false,
        error: await explainActionError(error.message, "섭외분야 삭제에 실패했습니다."),
      };
    }
  }

  revalidatePath("/[tenantSlug]/experts/manage", "page");
  // 전문가 목록의 섭외분야 셀에서도 쓴다 (기획 확정 2026-08-23)
  revalidatePath("/[tenantSlug]/experts", "page");
  return { ok: true };
}
