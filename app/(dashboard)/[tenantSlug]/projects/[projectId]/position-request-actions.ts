"use server";

import { gradeFromUser, roleFromUser } from "@/lib/auth/tenant";
import { canExec, execDeniedMessage } from "@/lib/auth/exec-permissions";
import { requireUser } from "@/lib/auth/session";
import { getTenantModules } from "@/lib/modules/server";
import {
  getPositionContext,
  getSlotCandidates,
  type SlotCandidate,
  type SlotContext,
} from "@/lib/integrations/slot-candidates";
import { evaluatePlanGate } from "@/lib/integrations/engagement-plans";

/**
 * 섭외 요청 팝업이 열릴 때 필요한 것을 한 번에 가져온다.
 *
 * 후보군 계산은 후보 수만큼 일정 겹침을 판독하므로 가볍지 않다. 화면을 열 때가
 * 아니라 **팝업을 열 때** 부르도록 서버 액션으로 뺀다 — 프로젝트 상세를 여는
 * 것만으로 모든 코드넘버의 후보군을 계산하면 목록 화면이 느려진다.
 */
export type PositionRequestData =
  | {
      ok: true;
      context: SlotContext;
      candidates: SlotCandidate[];
      /** 섭외계획 품의가 필요한데 아직 승인되지 않았다 */
      planBlocked: boolean;
      planMessage: string;
    }
  | { ok: false; error: string };

export async function loadPositionRequestData(
  positionId: string
): Promise<PositionRequestData> {
  const user = await requireUser();
  const role = roleFromUser(user);
  if (!user || !role) {
    return { ok: false, error: "로그인이 필요합니다." };
  }
  if (!canExec("planInput", gradeFromUser(user), role)) {
    return { ok: false, error: execDeniedMessage("planInput") };
  }

  const modules = await getTenantModules();
  if (!modules.experts) {
    return { ok: false, error: "전문가 모듈이 비활성화된 테넌트입니다." };
  }

  // 가시성은 RLS가 판정한다 — 못 보는 프로젝트의 코드넘버는 여기서 null이 된다
  const context = await getPositionContext(positionId);
  if (!context) return { ok: false, error: "대상을 찾을 수 없습니다." };
  // 배정 상태에서는 다른 전문가로 바꿔 넣을 수 있어야 한다 —
  // 요청이 나간 뒤(requested/filled)에만 잠근다
  if (context.status !== "open" && context.status !== "assigned") {
    return { ok: false, error: "이미 섭외 요청이 나갔거나 확정된 인원입니다." };
  }

  const gate = await evaluatePlanGate(context.projectId, modules.approvals);
  const candidates = await getSlotCandidates(context);

  return {
    ok: true,
    context,
    candidates,
    planBlocked: gate.required && !gate.allowed,
    planMessage: gate.required ? gate.message : "",
  };
}
