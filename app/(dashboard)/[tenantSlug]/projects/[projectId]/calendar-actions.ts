"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { requireExecGrade } from "@/lib/auth/exec-gate";
import { isPracticeMode } from "@/lib/practice/server";

/**
 * 프로젝트 캘린더 일정표 — 일자 스캐폴드 관리 (기획 확정 2026-08-30 — 29번).
 * 세션 자체는 engagement_slots(세션 계획 등록)가 원본이다. 여기서는 세션이
 * 아직 없는 날짜 열만 만들고 지운다. 게이트는 세션 입력 축(planInput)과 동일.
 */

export type CalendarResult = { ok: true } | { ok: false; error: string };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
/** 한 번에 만들 수 있는 기간 상한 — 잘못된 입력(연 단위)으로 수백 행 생성 방지 */
const MAX_RANGE_DAYS = 62;

const rangeSchema = z.object({
  fromDate: z.string().regex(DATE_RE, "시작일을 입력하세요."),
  toDate: z.string().regex(DATE_RE, "종료일을 입력하세요."),
});

/**
 * 기간으로 일자 생성 — "7/26~7/28"이면 26·27·28 세 열이 생긴다.
 * 개별 날짜 추가는 from=to로 호출한다. 이미 있는 날짜는 조용히 건너뛴다(멱등).
 */
export async function addCalendarDays(
  projectId: string,
  fromDate: string,
  toDate: string
): Promise<CalendarResult> {
  if (!hasSupabaseEnv()) return { ok: false, error: "서버 설정이 완료되지 않았습니다." };
  const auth = await requireExecGrade("planInput");
  if (!auth.ok) return auth;

  const parsed = rangeSchema.safeParse({ fromDate, toDate });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "날짜를 확인하세요." };
  }
  const from = new Date(`${parsed.data.fromDate}T00:00:00Z`);
  const to = new Date(`${parsed.data.toDate}T00:00:00Z`);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    return { ok: false, error: "날짜 형식이 올바르지 않습니다." };
  }
  if (from.getTime() > to.getTime()) {
    return { ok: false, error: "종료일은 시작일 이후여야 합니다." };
  }
  const dayCount =
    Math.round((to.getTime() - from.getTime()) / (24 * 60 * 60 * 1000)) + 1;
  if (dayCount > MAX_RANGE_DAYS) {
    return {
      ok: false,
      error: `한 번에 최대 ${MAX_RANGE_DAYS}일까지 만들 수 있습니다 (규칙). 기간을 나눠 추가해 주세요.`,
    };
  }

  const supabase = createClient();
  // 프로젝트 존재·가시성 확인 (RLS 범위)
  const { data: project } = await supabase
    .from("projects")
    .select("id")
    .eq("id", projectId)
    .maybeSingle();
  if (!project) return { ok: false, error: "프로젝트를 찾을 수 없습니다." };

  const isPractice = await isPracticeMode();
  const rows = Array.from({ length: dayCount }, (_, i) => {
    const d = new Date(from.getTime() + i * 24 * 60 * 60 * 1000);
    return {
      tenant_id: auth.tenantId,
      project_id: projectId,
      day: d.toISOString().slice(0, 10),
      is_practice: isPractice,
      created_by: auth.userId,
    };
  });

  const { error } = await supabase
    .from("project_calendar_days")
    .upsert(rows, { onConflict: "project_id,day", ignoreDuplicates: true });
  if (error) {
    return {
      ok: false,
      error: "일자 생성에 실패했습니다 (시스템 오류). 잠시 후 다시 시도해 주세요.",
    };
  }

  revalidatePath("/[tenantSlug]/projects/[projectId]", "page");
  return { ok: true };
}

/** 일자 삭제 — 그 날짜에 세션이 남아 있으면 거부 (세션부터 정리) */
export async function removeCalendarDay(
  projectId: string,
  day: string
): Promise<CalendarResult> {
  if (!hasSupabaseEnv()) return { ok: false, error: "서버 설정이 완료되지 않았습니다." };
  const auth = await requireExecGrade("planInput");
  if (!auth.ok) return auth;
  if (!DATE_RE.test(day)) return { ok: false, error: "날짜 형식이 올바르지 않습니다." };

  const supabase = createClient();
  // 프로젝트 가시성 확인 — 배정 밖 프로젝트의 일자를 지울 수 없다 (리뷰 P2-1)
  const { data: project } = await supabase
    .from("projects")
    .select("id")
    .eq("id", projectId)
    .maybeSingle();
  if (!project) return { ok: false, error: "프로젝트를 찾을 수 없습니다." };

  const { count, error: countError } = await supabase
    .from("engagement_slots")
    .select("id", { count: "exact", head: true })
    .eq("project_id", projectId)
    .eq("slot_date", day);
  if (countError) {
    // 검사 실패를 통과로 취급하지 않는다 (리뷰 P3 — §12-9 시스템 결함 분류)
    return {
      ok: false,
      error: "세션 확인에 실패했습니다 (시스템 오류). 잠시 후 다시 시도해 주세요.",
    };
  }
  if ((count ?? 0) > 0) {
    return {
      ok: false,
      error:
        "이 날짜에 등록된 세션이 있습니다 (규칙). 세션 계획 등록에서 세션을 삭제하거나 날짜를 옮긴 뒤 지워 주세요.",
    };
  }

  const { error } = await supabase
    .from("project_calendar_days")
    .delete()
    .eq("project_id", projectId)
    .eq("day", day);
  if (error) {
    return { ok: false, error: "일자 삭제에 실패했습니다 (시스템 오류). 잠시 후 다시 시도해 주세요." };
  }

  revalidatePath("/[tenantSlug]/projects/[projectId]", "page");
  return { ok: true };
}
