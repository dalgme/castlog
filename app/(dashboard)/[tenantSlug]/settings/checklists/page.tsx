import Link from "next/link";
import { redirect } from "next/navigation";

import { requireUser } from "@/lib/auth/session";
import { gradeFromUser, roleFromUser, tenantIdFromUser } from "@/lib/auth/tenant";
import { getAdminScopes } from "@/lib/auth/admin-scopes";
import { canViewAllProjects, isUserGrade } from "@/lib/auth/grades";
import { getTenantModules } from "@/lib/modules/server";
import { createClient } from "@/lib/supabase/server";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { cn } from "@/lib/utils";
import { ensureTenantTemplates } from "@/lib/checklists/server";
import {
  CHECKLIST_KINDS,
  CHECKLIST_KIND_DESCRIPTIONS,
  CHECKLIST_KIND_LABELS,
  isChecklistKind,
  type ChecklistKind,
} from "@/lib/checklists/kinds";
import { PageHeader } from "@/components/layout/header";
import { EmptyState } from "@/components/layout/empty-state";
import { SettingsTabs } from "@/components/layout/settings-tabs";

import { TemplateEditor, type TemplateView } from "./template-editor";

export const metadata = { title: "체크리스트 표준시트" };

/**
 * 설정 > 체크리스트 표준시트 (기획 지시 2026-09-05 — 14).
 * 임직원 누구나 수정하는 회사 표준 양식 6종. 각 프로젝트는 이 표준을 불러와
 * 프로젝트별로 고쳐 쓴다. 표준시트가 없는 회사에는 기본 양식을 1회 시드한다.
 */
/** 종류 탭 색 — 프로젝트 탭과 같은 결(진한 배경 = 활성) */
const KIND_TAB_CLASS: Record<ChecklistKind, { active: string; idle: string }> = {
  common: { active: "border-sky-600 bg-sky-600 text-white", idle: "border-sky-200 bg-sky-50 text-sky-800 hover:bg-sky-100" },
  typed: { active: "border-teal-600 bg-teal-600 text-white", idle: "border-teal-200 bg-teal-50 text-teal-800 hover:bg-teal-100" },
  kickoff: { active: "border-amber-600 bg-amber-600 text-white", idle: "border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100" },
  deadline: { active: "border-violet-600 bg-violet-600 text-white", idle: "border-violet-200 bg-violet-50 text-violet-800 hover:bg-violet-100" },
  venue: { active: "border-orange-600 bg-orange-600 text-white", idle: "border-orange-200 bg-orange-50 text-orange-800 hover:bg-orange-100" },
  supplies: { active: "border-emerald-600 bg-emerald-600 text-white", idle: "border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100" },
};

export default async function ChecklistTemplatesPage({
  params,
  searchParams,
}: {
  params: { tenantSlug: string };
  searchParams?: { kind?: string };
}) {
  // 탭은 URL 쿼리(?kind=)로 정한다 — 새로고침·링크 공유가 그대로 살아 있다 (기획 지시 2026-09-06)
  const activeKind: ChecklistKind = isChecklistKind(searchParams?.kind) ? searchParams.kind : "common";
  const user = await requireUser();
  if (!user) {
    return (
      <div>
        <PageHeader title="체크리스트 표준시트" />
        <main className="p-5">
          <EmptyState title="서버 설정 대기 중" description="Supabase 환경변수가 설정되면 표시됩니다." />
        </main>
      </div>
    );
  }
  const role = roleFromUser(user);
  const tenantId = tenantIdFromUser(user);
  if (!role || role === "expert" || !tenantId) redirect("/");

  const [scopes, modules] = await Promise.all([getAdminScopes(), getTenantModules()]);
  const isCeo = role === "org_admin" || role === "platform_admin";
  const grade = gradeFromUser(user);

  let templates: TemplateView[] = [];
  let missingTable = false;
  if (hasSupabaseEnv()) {
    await ensureTenantTemplates(tenantId);
    const supabase = createClient();
    const { data: rows, error } = await supabase
      .from("checklist_templates")
      .select("id, kind, name, sort_order, updated_at, updated_by")
      .eq("is_active", true)
      .order("kind", { ascending: true })
      .order("sort_order", { ascending: true });
    if (error && error.code === "42P01") {
      missingTable = true;
    } else {
      const ids = (rows ?? []).map((r) => r.id);
      // 마지막 수정자 — 회사 공용 시트라 "누가 언제 고쳤는지"가 보여야 한다
      const [{ data: items }] = await Promise.all([
        ids.length
          ? supabase
              .from("checklist_template_items")
              .select("id, template_id, sort_order, phase, category, subcategory, title, offset_days, quantity, note, updated_at, updated_by")
              .in("template_id", ids)
              .order("sort_order", { ascending: true })
          : Promise.resolve({ data: [] as { id: string; template_id: string; sort_order: number; phase: string | null; category: string | null; subcategory: string | null; title: string; offset_days: number | null; quantity: string | null; note: string | null; updated_at: string; updated_by: string | null }[] }),
      ]);
      const editorIds = Array.from(
        new Set(
          [...(rows ?? []).map((r) => r.updated_by), ...(items ?? []).map((it) => it.updated_by)].filter(
            (v): v is string => Boolean(v)
          )
        )
      );
      const { data: editors } = editorIds.length
        ? await supabase.from("users").select("id, name").in("id", editorIds)
        : { data: [] as { id: string; name: string }[] };
      const editorName = new Map((editors ?? []).map((u) => [u.id, u.name]));
      templates = (rows ?? [])
        .filter((r): r is typeof r & { kind: ChecklistKind } =>
          (CHECKLIST_KINDS as readonly string[]).includes(r.kind)
        )
        .map((r) => {
          const own = (items ?? []).filter((it) => it.template_id === r.id);
          // 항목 수정도 시트 수정으로 본다 — 가장 늦은 시각과 그때의 수정자
          const lastItem = own.reduce<(typeof own)[number] | null>(
            (m, it) => (m && m.updated_at > it.updated_at ? m : it), null
          );
          const latest =
            lastItem && lastItem.updated_at > r.updated_at
              ? { at: lastItem.updated_at, by: lastItem.updated_by }
              : { at: r.updated_at, by: r.updated_by };
          return {
          id: r.id,
          kind: r.kind,
          name: r.name,
          updatedAt: latest.at,
          updatedByName: latest.by ? (editorName.get(latest.by) ?? null) : null,
          items: (items ?? [])
            .filter((it) => it.template_id === r.id)
            .map((it) => ({
              id: it.id,
              phase: it.phase,
              category: it.category,
              subcategory: it.subcategory,
              title: it.title,
              offsetDays: it.offset_days,
              quantity: it.quantity,
              note: it.note,
            })),
          };
        });
    }
  }

  return (
    <div>
      <PageHeader title="체크리스트 표준시트" />
      <SettingsTabs
        tenantSlug={params.tenantSlug}
        showStaff={isCeo || scopes.staff}
        showSms={isCeo || scopes.sending}
        showOrg={isCeo || scopes.settings || scopes.modules}
        showRules={modules.approvals && (isCeo || scopes.approvals)}
        showArchive={isUserGrade(grade) && canViewAllProjects(grade)}
      />
      <main className="space-y-5 p-5">
        <p className="text-sm text-muted-foreground">
          회사 표준 양식입니다. <strong>회사 임직원 전체가 같은 시트를 공유</strong>합니다 — 누구 한 사람이
          여기서 고치면 모든 임직원에게 바로 반영되고, 모든 변경은 로그에 남습니다. 프로젝트에서는
          이 표준을 불러와 프로젝트별로 고쳐 씁니다 — 여기서 고쳐도 이미 불러간 프로젝트에는
          영향이 없습니다.
        </p>
        {missingTable ? (
          <EmptyState
            title="체크리스트 기능이 아직 준비되지 않았습니다"
            description="마이그레이션(20260905000004) 적용 후 사용할 수 있습니다 — 캐스트로그에 알려 주세요."
          />
        ) : (
          <>
            <nav className="flex flex-wrap gap-1 border-b" aria-label="체크리스트 종류">
              {CHECKLIST_KINDS.map((kind) => {
                const isActive = kind === activeKind;
                const count = templates.filter((t) => t.kind === kind).reduce((n, t) => n + t.items.length, 0);
                return (
                  <Link
                    key={kind}
                    href={`/${params.tenantSlug}/settings/checklists?kind=${kind}`}
                    aria-current={isActive ? "page" : undefined}
                    className={cn(
                      "-mb-px rounded-t-md border border-b-0 px-3 py-1.5 text-xs font-medium transition-colors",
                      isActive ? KIND_TAB_CLASS[kind].active : KIND_TAB_CLASS[kind].idle
                    )}
                  >
                    {CHECKLIST_KIND_LABELS[kind].replace(" 체크리스트", "")}
                    <span className={cn("ml-1 text-[10px]", isActive ? "text-white/80" : "opacity-70")}>{count}</span>
                  </Link>
                );
              })}
            </nav>
            <section className="space-y-3">
              <div>
                <h2 className="text-base font-bold">{CHECKLIST_KIND_LABELS[activeKind]}</h2>
                <p className="text-xs text-muted-foreground">{CHECKLIST_KIND_DESCRIPTIONS[activeKind]}</p>
              </div>
              <TemplateEditor kind={activeKind} templates={templates.filter((t) => t.kind === activeKind)} />
            </section>
          </>
        )}
      </main>
    </div>
  );
}
