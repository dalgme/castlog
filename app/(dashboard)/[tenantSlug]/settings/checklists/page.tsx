import { redirect } from "next/navigation";

import { requireUser } from "@/lib/auth/session";
import { gradeFromUser, roleFromUser, tenantIdFromUser } from "@/lib/auth/tenant";
import { getAdminScopes } from "@/lib/auth/admin-scopes";
import { canViewAllProjects, isUserGrade } from "@/lib/auth/grades";
import { getTenantModules } from "@/lib/modules/server";
import { createClient } from "@/lib/supabase/server";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { ensureTenantTemplates } from "@/lib/checklists/server";
import {
  CHECKLIST_KINDS,
  CHECKLIST_KIND_DESCRIPTIONS,
  CHECKLIST_KIND_LABELS,
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
export default async function ChecklistTemplatesPage({
  params,
}: {
  params: { tenantSlug: string };
}) {
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
      .select("id, kind, name, sort_order, updated_at")
      .eq("is_active", true)
      .order("kind", { ascending: true })
      .order("sort_order", { ascending: true });
    if (error && error.code === "42P01") {
      missingTable = true;
    } else {
      const ids = (rows ?? []).map((r) => r.id);
      const { data: items } = ids.length
        ? await supabase
            .from("checklist_template_items")
            .select("id, template_id, sort_order, phase, category, subcategory, title, offset_days, quantity, note")
            .in("template_id", ids)
            .order("sort_order", { ascending: true })
        : { data: [] };
      templates = (rows ?? [])
        .filter((r): r is typeof r & { kind: ChecklistKind } =>
          (CHECKLIST_KINDS as readonly string[]).includes(r.kind)
        )
        .map((r) => ({
          id: r.id,
          kind: r.kind,
          name: r.name,
          updatedAt: r.updated_at,
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
        }));
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
          회사 표준 양식입니다. 임직원 누구나 항목을 추가·수정·삭제할 수 있고, 모든
          변경은 로그에 남습니다. 프로젝트에서는 이 표준을 불러와 프로젝트별로
          고쳐 씁니다 — 여기서 고쳐도 이미 불러간 프로젝트에는 영향이 없습니다.
        </p>
        {missingTable ? (
          <EmptyState
            title="체크리스트 기능이 아직 준비되지 않았습니다"
            description="마이그레이션(20260905000004) 적용 후 사용할 수 있습니다 — 캐스트로그에 알려 주세요."
          />
        ) : (
          CHECKLIST_KINDS.map((kind) => (
            <section key={kind} className="space-y-3">
              <div>
                <h2 className="text-base font-bold">{CHECKLIST_KIND_LABELS[kind]}</h2>
                <p className="text-xs text-muted-foreground">{CHECKLIST_KIND_DESCRIPTIONS[kind]}</p>
              </div>
              <TemplateEditor kind={kind} templates={templates.filter((t) => t.kind === kind)} />
            </section>
          ))
        )}
      </main>
    </div>
  );
}
