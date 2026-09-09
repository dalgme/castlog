import "server-only";

import { createClient } from "@/lib/supabase/server";
import { getTenantModules } from "@/lib/modules/server";
import { practiceFromUser } from "@/lib/auth/tenant";
import {
  requireProjectTeam as requireProjectTeamShared,
  type ActorGate,
  type ProjectActor,
} from "@/lib/projects/team";
import type { QuoteDocType } from "./logs";

export {
  QUOTE_DOC_LABELS,
  QUOTE_LOG_ACTION_LABELS,
  type QuoteDocType,
  type QuoteLogRow,
} from "./logs";

/**
 * 견적·내부실견적·정산 서버 공용 — 모듈 게이트, 권한, 변경 로그
 * (기획 지시 2026-09-09).
 */

/**
 * 모듈 게이트 — 네비게이션 숨김만으로는 안 된다(URL 직접 접근). 서버 액션마다
 * 확인한다 (CLAUDE.md §1-2 규칙 3).
 */
export async function requireQuotesModule(projectId: string): Promise<ActorGate> {
  const modules = await getTenantModules();
  if (!modules.quotes) {
    return {
      ok: false,
      error:
        "견적·정산 기능이 이 회사에 켜져 있지 않습니다 (사용 기능 설정). 대표에게 문의하거나 설정 > 사용 기능에서 요청하세요.",
    };
  }
  return requireProjectTeamShared(projectId, "exec:quote");
}

export type QuoteLogEntry = {
  docType: QuoteDocType;
  docId?: string | null;
  projectId?: string | null;
  version?: number | null;
  action: string;
  itemTitle?: string | null;
  field?: string | null;
  before?: string | null;
  after?: string | null;
};

/** 변경 로그 — 언제·누가·어떤 값을 (기획 지시 01·02·03: 이전본 보관 + 로그) */
export async function logQuote(actor: ProjectActor, entry: QuoteLogEntry): Promise<void> {
  const supabase = createClient();
  await supabase.from("quote_logs").insert({
    tenant_id: actor.tenantId,
    project_id: entry.projectId ?? null,
    doc_type: entry.docType,
    doc_id: entry.docId ?? null,
    version: entry.version ?? null,
    action: entry.action,
    item_title: entry.itemTitle ?? null,
    field: entry.field ?? null,
    before_value: entry.before ?? null,
    after_value: entry.after ?? null,
    actor_user_id: actor.userId,
    actor_name: actor.name,
    is_practice: practiceFromUser(actor.user),
  });
}
