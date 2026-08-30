import "server-only";

import { createClient } from "@/lib/supabase/server";
import { gradeRank, isUserGrade, type UserGrade } from "@/lib/auth/grades";
import type { EngineLineStep } from "@/lib/approvals/engine";

/**
 * 결재라인 직접 선택 + 임원 고정 (기획 확정 2026-08-30 — 30번).
 *
 * 상신자는 **자신보다 높은 직급**의 결재자(PL·PM을 맡은 상급자 등)를 순서대로
 * 고를 수 있고, 선택과 무관하게 **상무이사(director)·대표(ceo)는 라인 끝에
 * 고정(필수)** 으로 붙는다 — 같은 직급이 여럿이면 가장 먼저 등록된 사람
 * (직급 폴백과 동일 규칙). 선택이 없으면 고정 임원만으로 라인이 만들어진다.
 *
 * 반환 실패 = 고정 임원조차 없는 경우(1인 기업 등) — 호출자가 기존 폴백
 * (직급 에스컬레이션·자가결재)으로 넘긴다.
 */
export async function buildLineWithFixedTail(
  tenantId: string,
  requesterUserId: string,
  approverIds: string[]
): Promise<
  | { ok: true; steps: EngineLineStep[]; description: string }
  | { ok: false; error: string }
> {
  const supabase = createClient();
  const [{ data: requester }, { data: staff }] = await Promise.all([
    supabase
      .from("users")
      .select("grade")
      .eq("id", requesterUserId)
      .maybeSingle(),
    supabase
      .from("users")
      .select("id, name, grade")
      .eq("tenant_id", tenantId)
      .eq("is_active", true)
      .order("created_at", { ascending: true }),
  ]);

  const requesterGrade: UserGrade = isUserGrade(requester?.grade ?? "")
    ? (requester!.grade as UserGrade)
    : "staff";
  const requesterRank = gradeRank(requesterGrade);
  const byId = new Map((staff ?? []).map((u) => [u.id, u]));

  // ① 선택된 결재자 검증 — 자사 활성 + 상신자 제외 + **상위 직급만**
  const ids = Array.from(new Set(approverIds.filter(Boolean)));
  if (ids.includes(requesterUserId)) {
    return { ok: false, error: "상신자 본인은 결재자로 지정할 수 없습니다." };
  }
  const picked: { id: string; name: string }[] = [];
  for (const id of ids) {
    const found = byId.get(id);
    if (!found) {
      return { ok: false, error: "결재자는 자사 소속 활성 직원이어야 합니다." };
    }
    if (!isUserGrade(found.grade) || gradeRank(found.grade) <= requesterRank) {
      return {
        ok: false,
        error: `결재자는 상신자보다 높은 직급이어야 합니다 (규칙) — ${found.name}님을 확인하세요.`,
      };
    }
    // 상무이사·대표는 선택이 아니라 고정 tail이다 — UI만 거르면 조작 요청으로
    // '대표가 먼저, 상무가 나중' 같은 역전 라인이 만들어진다 (리뷰 P2-2,
    // 게이트는 서버 강제 원칙)
    if (found.grade === "director" || found.grade === "ceo") {
      return {
        ok: false,
        error: `상무이사·대표는 고정 결재선으로 자동 포함됩니다 (규칙) — ${found.name}님은 선택에서 제외해 주세요.`,
      };
    }
    picked.push({ id: found.id, name: found.name });
  }

  // ② 고정 임원 tail — 상무이사·대표 (등록순 1인). 상신자와 같은/낮은 직급
  // 단계는 생략한다 (리뷰 P3-2: director 상신 시 동급 대입 방지, ceo 상신 시
  // 하급 단독 결재 방지 — 그 경우 호출자 폴백이 자가결재를 처리한다)
  const firstOfGrade = (grade: UserGrade) =>
    gradeRank(grade) > requesterRank
      ? ((staff ?? []).find(
          (u) => u.grade === grade && u.id !== requesterUserId
        ) ?? null)
      : null;
  const tail: { id: string; name: string }[] = [];
  for (const grade of ["director", "ceo"] as UserGrade[]) {
    const found = firstOfGrade(grade);
    if (found && !tail.some((t) => t.id === found.id)) {
      tail.push({ id: found.id, name: found.name });
    }
  }

  const line = [...picked, ...tail];
  if (line.length === 0) {
    return {
      ok: false,
      error:
        "지정할 수 있는 결재선이 없습니다 (상위 직급·임원 계정 없음). 직급 폴백으로 진행됩니다.",
    };
  }

  return {
    ok: true,
    steps: line.map((p, index) => ({
      stepOrder: index + 1,
      stepKind: "approval" as const,
      approverUserId: p.id,
    })),
    description: line.map((p) => p.name).join(" → "),
  };
}
