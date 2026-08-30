import "server-only";

import { createClient } from "@/lib/supabase/server";
import type { EngineLineStep } from "@/lib/approvals/engine";

/**
 * 직접 지정 결재라인 검증·조립 (기획 확정 2026-08-30 — 18번).
 * 선택 순서 = 결재 순서. 상신자 본인 제외, 자사 활성 직원만.
 */
export async function buildManualApprovalLine(
  tenantId: string,
  requesterUserId: string,
  approverIds: string[]
): Promise<
  | { ok: true; steps: EngineLineStep[] }
  | { ok: false; error: string }
> {
  const ids = Array.from(new Set(approverIds.filter(Boolean)));
  if (ids.length === 0) {
    return { ok: false, error: "결재자를 한 명 이상 선택하세요." };
  }
  if (ids.includes(requesterUserId)) {
    return { ok: false, error: "상신자 본인은 결재자로 지정할 수 없습니다." };
  }
  const supabase = createClient();
  const { data: found } = await supabase
    .from("users")
    .select("id")
    .in("id", ids)
    .eq("tenant_id", tenantId)
    .eq("is_active", true);
  if (!found || found.length !== ids.length) {
    return { ok: false, error: "결재자는 자사 소속 활성 직원이어야 합니다." };
  }
  return {
    ok: true,
    steps: ids.map((approverUserId, index) => ({
      stepOrder: index + 1,
      stepKind: "approval" as const,
      approverUserId,
    })),
  };
}
