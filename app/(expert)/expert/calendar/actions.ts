"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import type { CalendarEvent } from "@/lib/experts/calendar-types";

async function currentExpertId(): Promise<string | null> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: expert } = await supabase
    .from("experts")
    .select("id")
    .eq("auth_user_id", user.id)
    .maybeSingle();
  return expert?.id ?? null;
}

/** 캘린더 이벤트 = 외부 일정(전문가 입력) + 캐스트로그 섭외(수락 파생) */
export async function getCalendarEvents(): Promise<CalendarEvent[]> {
  if (!hasSupabaseEnv()) return [];
  const supabase = createClient();
  const expertId = await currentExpertId();
  if (!expertId) return [];

  const [{ data: externals }, { data: engagements }] = await Promise.all([
    supabase
      .from("expert_external_schedules")
      .select(
        "id, title, org_name, location, starts_at, ends_at, all_day, memo, shared_with_tenants"
      )
      .eq("expert_id", expertId)
      .order("starts_at", { ascending: true }),
    supabase
      .from("expert_engagements")
      .select("id, role_description, starts_on, ends_on, status, tenants (name)")
      .eq("expert_id", expertId)
      .eq("status", "accepted")
      .not("starts_on", "is", null),
  ]);

  const events: CalendarEvent[] = [];

  for (const e of externals ?? []) {
    events.push({
      id: e.id,
      source: "external",
      title: e.title,
      orgName: e.org_name,
      location: e.location,
      start: e.starts_at,
      end: e.ends_at,
      allDay: e.all_day,
      memo: e.memo,
      shared: e.shared_with_tenants,
    });
  }

  for (const g of engagements ?? []) {
    if (!g.starts_on) continue;
    events.push({
      id: g.id,
      source: "castlog",
      title: g.role_description ?? "캐스트로그 섭외",
      orgName: g.tenants?.name ?? null,
      location: null,
      start: g.starts_on,
      end: g.ends_on,
      allDay: true,
      memo: null,
      shared: true,
    });
  }

  return events;
}

export type ScheduleResult = { ok: true } | { ok: false; error: string };

const scheduleSchema = z
  .object({
    title: z.string().trim().min(1, "제목을 입력하세요.").max(120),
    orgName: z.string().trim().max(120).optional(),
    location: z.string().trim().max(120).optional(),
    startsAt: z.string().min(1, "시작 일시를 입력하세요."),
    endsAt: z.string().optional(),
    allDay: z.boolean(),
    memo: z.string().trim().max(500).optional(),
    sharedWithTenants: z.boolean(),
  })
  .refine(
    (v) => !v.endsAt || new Date(v.endsAt).getTime() >= new Date(v.startsAt).getTime(),
    { message: "종료 일시는 시작 이후여야 합니다.", path: ["endsAt"] }
  );

export async function upsertExternalSchedule(
  id: string | null,
  input: z.input<typeof scheduleSchema>
): Promise<ScheduleResult> {
  if (!hasSupabaseEnv()) return { ok: false, error: "서버 설정이 완료되지 않았습니다." };
  const parsed = scheduleSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "입력값을 확인하세요." };
  }
  const d = parsed.data;

  const supabase = createClient();
  const expertId = await currentExpertId();
  if (!expertId) return { ok: false, error: "로그인이 필요합니다." };

  const row = {
    expert_id: expertId,
    title: d.title,
    org_name: d.orgName || null,
    location: d.location || null,
    starts_at: new Date(d.startsAt).toISOString(),
    ends_at: d.endsAt ? new Date(d.endsAt).toISOString() : null,
    all_day: d.allDay,
    memo: d.memo || null,
    shared_with_tenants: d.sharedWithTenants,
  };

  const query = id
    ? supabase.from("expert_external_schedules").update(row).eq("id", id)
    : supabase.from("expert_external_schedules").insert(row);
  const { error } = await query;
  if (error) return { ok: false, error: "저장에 실패했습니다." };

  revalidatePath("/expert/calendar");
  return { ok: true };
}

export async function deleteExternalSchedule(id: string): Promise<ScheduleResult> {
  if (!hasSupabaseEnv()) return { ok: false, error: "서버 설정이 완료되지 않았습니다." };
  const supabase = createClient();
  const { error } = await supabase
    .from("expert_external_schedules")
    .delete()
    .eq("id", id);
  if (error) return { ok: false, error: "삭제에 실패했습니다." };
  revalidatePath("/expert/calendar");
  return { ok: true };
}
