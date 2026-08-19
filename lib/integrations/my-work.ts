import "server-only";

import { createClient } from "@/lib/supabase/server";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import type { ModuleFlags } from "@/lib/modules/modules";

/**
 * 내 업무 — 여러 프로젝트를 동시에 맡은 사람 관점의 집계.
 *
 * 프로젝트를 하나씩 열어봐야 무엇이 급한지 알 수 있는 구조에서는, PM이 프로젝트를
 * 다섯 개만 맡아도 놓치는 게 생긴다. 여기서는 **배정된 모든 프로젝트를 가로질러**
 * 마감이 임박했거나 이미 지난 것만 모은다.
 *
 * 무엇을 볼 수 있는지는 RLS가 정한다(배정 프로젝트 + 대표·이사는 전사). 이 모듈은
 * 별도의 가시성 규칙을 만들지 않는다 — 규칙을 두 곳에 두면 언젠가 어긋난다.
 */

/** 며칠 앞까지를 '임박'으로 볼 것인가 */
export const DUE_SOON_DAYS = 7;

export type WorkItem = {
  kind: "step" | "engagement" | "approval" | "session";
  title: string;
  projectId: string | null;
  projectName: string | null;
  /** 기준 일자 (마감일·일정일) */
  dueOn: string;
  /** 음수 = 지남, 0 = 오늘, 양수 = 남은 일수 */
  daysLeft: number;
  href: string;
  note?: string;
};

export type MyWork = {
  overdue: WorkItem[];
  dueSoon: WorkItem[];
  /** 회신을 기다리는 섭외 (마감 개념과 별개로 계속 신경 써야 하는 것) */
  awaitingReply: WorkItem[];
  myProjectCount: number;
};

function daysBetween(fromIso: string, target: string): number {
  const a = new Date(`${fromIso}T00:00:00+09:00`).getTime();
  const b = new Date(`${target}T00:00:00+09:00`).getTime();
  return Math.round((b - a) / 86400000);
}

export async function getMyWork(
  userId: string,
  tenantSlug: string,
  modules: ModuleFlags
): Promise<MyWork> {
  const empty: MyWork = {
    overdue: [],
    dueSoon: [],
    awaitingReply: [],
    myProjectCount: 0,
  };
  if (!hasSupabaseEnv()) return empty;

  const supabase = createClient();
  const today = new Date().toISOString().slice(0, 10);
  const horizon = new Date(Date.now() + DUE_SOON_DAYS * 86400000)
    .toISOString()
    .slice(0, 10);

  const { data: assignments } = await supabase
    .from("project_assignments")
    .select("project_id")
    .eq("user_id", userId);
  const myProjectIds = Array.from(
    new Set((assignments ?? []).map((a) => a.project_id))
  );
  if (myProjectIds.length === 0) return empty;

  const { data: projects } = await supabase
    .from("projects")
    .select("id, name, status")
    .in("id", myProjectIds);
  const projectNameById = new Map((projects ?? []).map((p) => [p.id, p.name]));
  // 종료된 프로젝트는 재촉할 대상이 아니다.
  const liveIds = (projects ?? [])
    .filter((p) => p.status !== "completed" && p.status !== "canceled")
    .map((p) => p.id);
  if (liveIds.length === 0) {
    return { ...empty, myProjectCount: myProjectIds.length };
  }

  const [{ data: steps }, { data: engagements }, { data: slots }] =
    await Promise.all([
      modules.operations
        ? supabase
            .from("project_lifecycle_steps")
            .select("id, project_id, title, due_on, status")
            .in("project_id", liveIds)
            .not("due_on", "is", null)
            .neq("status", "completed")
            .lte("due_on", horizon)
        : Promise.resolve({ data: null }),
      modules.experts
        ? supabase
            .from("expert_engagements")
            .select(
              "id, project_id, status, created_at, token_expires_at, program_name, experts (name)"
            )
            .in("project_id", liveIds)
            .eq("status", "requested")
        : Promise.resolve({ data: null }),
      modules.experts
        ? supabase
            .from("engagement_slots")
            .select("id, project_id, slot_date, session_name, required_count")
            .in("project_id", liveIds)
            .gte("slot_date", today)
            .lte("slot_date", horizon)
        : Promise.resolve({ data: null }),
    ]);

  const overdue: WorkItem[] = [];
  const dueSoon: WorkItem[] = [];
  const awaitingReply: WorkItem[] = [];

  for (const step of steps ?? []) {
    if (!step.due_on) continue;
    const daysLeft = daysBetween(today, step.due_on);
    const item: WorkItem = {
      kind: "step",
      title: step.title,
      projectId: step.project_id,
      projectName: projectNameById.get(step.project_id) ?? null,
      dueOn: step.due_on,
      daysLeft,
      href: `/${tenantSlug}/projects/${step.project_id}`,
    };
    (daysLeft < 0 ? overdue : dueSoon).push(item);
  }

  // 아직 채워지지 않은 자리가 있는 임박 세션 — 행사일이 다가오는데 사람이 없다.
  const slotIds = (slots ?? []).map((s) => s.id);
  const filledBySlot = new Map<string, number>();
  if (slotIds.length > 0) {
    const { data: positions } = await supabase
      .from("engagement_slot_positions")
      .select("slot_id, status")
      .in("slot_id", slotIds)
      .eq("status", "filled");
    for (const p of positions ?? []) {
      filledBySlot.set(p.slot_id, (filledBySlot.get(p.slot_id) ?? 0) + 1);
    }
  }
  for (const slot of slots ?? []) {
    const filled = filledBySlot.get(slot.id) ?? 0;
    const missing = slot.required_count - filled;
    if (missing <= 0) continue;
    dueSoon.push({
      kind: "session",
      title: `${slot.session_name ?? "세션"} — 미섭외 ${missing}명`,
      projectId: slot.project_id,
      projectName: projectNameById.get(slot.project_id) ?? null,
      dueOn: slot.slot_date,
      daysLeft: daysBetween(today, slot.slot_date),
      href: `/${tenantSlug}/projects/${slot.project_id}`,
      note: "행사일이 다가오는데 자리가 남아 있습니다.",
    });
  }

  for (const e of engagements ?? []) {
    const waited = Math.floor(
      (Date.now() - new Date(e.created_at).getTime()) / 86400000
    );
    const expiresOn = e.token_expires_at.slice(0, 10);
    awaitingReply.push({
      kind: "engagement",
      title: `${e.experts?.name ?? "전문가"} — ${e.program_name ?? "섭외 요청"}`,
      projectId: e.project_id,
      projectName: e.project_id
        ? (projectNameById.get(e.project_id) ?? null)
        : null,
      dueOn: expiresOn,
      daysLeft: daysBetween(today, expiresOn),
      href: `/${tenantSlug}/experts/engagements`,
      note: `${waited}일째 무응답`,
    });
  }

  const byDue = (a: WorkItem, b: WorkItem) => a.daysLeft - b.daysLeft;
  return {
    overdue: overdue.sort(byDue),
    dueSoon: dueSoon.sort(byDue),
    awaitingReply: awaitingReply.sort(byDue),
    myProjectCount: myProjectIds.length,
  };
}
