import "server-only";

import { createClient } from "@/lib/supabase/server";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { getMyTurnApprovals } from "@/lib/approvals/my-turn";
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
  /**
   * 거절·만료로 자리가 빈 섭외 — 재섭외가 필요하다 (검수 D1).
   * 전문가의 거절·만료는 어떤 능동 알림도 만들지 않아 담당자가 후순위 후보
   * 재요청 시점을 놓치던 비대칭을 메운다. 최근 14일 건만 모은다.
   */
  needsReengagement: WorkItem[];
  /**
   * 내 결재 차례 (검수 A3) — 배정 기준이 아니라 결재선 기준이다. 배정이 없는
   * 대표·이사도 결재는 온다. 승인 게이트에 걸린 팀이 이 신호로 풀린다.
   */
  myApprovals: WorkItem[];
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
    needsReengagement: [],
    myApprovals: [],
    myProjectCount: 0,
  };
  if (!hasSupabaseEnv()) return empty;

  const supabase = createClient();
  const today = new Date().toISOString().slice(0, 10);
  const horizon = new Date(Date.now() + DUE_SOON_DAYS * 86400000)
    .toISOString()
    .slice(0, 10);

  // 내 결재 차례 — **배정 조기 반환보다 앞**에서 모은다. 배정이 없는 대표에게
  // '내 업무'가 항상 0으로 보이던 것이 결재 신호 부재의 원인이었다 (검수 A3).
  const myApprovals: WorkItem[] = modules.approvals
    ? (await getMyTurnApprovals(userId)).map((a) => {
        const dueOn = a.createdAt.slice(0, 10);
        return {
          kind: "approval" as const,
          title: `${a.title}${a.requesterName ? ` — ${a.requesterName} 상신` : ""}`,
          projectId: null,
          projectName: null,
          dueOn,
          daysLeft: daysBetween(today, dueOn),
          href: `/${tenantSlug}/approvals/${a.id}`,
          note: "내 결재 차례입니다. 승인 전에는 다음 단계가 막혀 있습니다.",
        };
      })
    : [];

  const { data: assignments } = await supabase
    .from("project_assignments")
    .select("project_id")
    .eq("user_id", userId);
  const myProjectIds = Array.from(
    new Set((assignments ?? []).map((a) => a.project_id))
  );
  if (myProjectIds.length === 0) return { ...empty, myApprovals };

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
    return { ...empty, myApprovals, myProjectCount: myProjectIds.length };
  }

  const recent = new Date(Date.now() - 14 * 86400000).toISOString();
  const [{ data: steps }, { data: engagements }, { data: slots }, { data: dropped }] =
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
      // 거절·만료 — 재섭외 필요 (검수 D1)
      modules.experts
        ? supabase
            .from("expert_engagements")
            .select(
              "id, project_id, status, responded_at, token_expires_at, program_name, experts (name)"
            )
            .in("project_id", liveIds)
            .in("status", ["declined", "expired"])
            .gte("created_at", recent)
            .order("created_at", { ascending: false })
            .limit(20)
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

  // 거절·만료 — 자리가 다시 빈 건. 후순위 후보 재요청 시점을 놓치지 않게 한다
  const needsReengagement: WorkItem[] = (dropped ?? []).map((e) => {
    const at = (e.responded_at ?? e.token_expires_at).slice(0, 10);
    return {
      kind: "engagement" as const,
      title: `${e.experts?.name ?? "전문가"} — ${
        e.status === "declined" ? "거절" : "요청 만료"
      }${e.program_name ? ` · ${e.program_name}` : ""}`,
      projectId: e.project_id,
      projectName: e.project_id
        ? (projectNameById.get(e.project_id) ?? null)
        : null,
      dueOn: at,
      daysLeft: daysBetween(today, at),
      href: e.project_id
        ? `/${tenantSlug}/projects/${e.project_id}?tab=experts`
        : `/${tenantSlug}/experts/engagements`,
      note: "자리가 다시 비었습니다. 예비 후보에게 재섭외하세요.",
    };
  });

  const byDue = (a: WorkItem, b: WorkItem) => a.daysLeft - b.daysLeft;
  return {
    overdue: overdue.sort(byDue),
    dueSoon: dueSoon.sort(byDue),
    awaitingReply: awaitingReply.sort(byDue),
    needsReengagement: needsReengagement.sort(byDue),
    myApprovals: myApprovals.sort(byDue),
    myProjectCount: myProjectIds.length,
  };
}
