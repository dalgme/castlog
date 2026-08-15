import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { PortalHeader } from "@/components/expert/portal-header";
import { PageIntro } from "@/components/expert/ui";
import { EmptyState } from "@/components/layout/empty-state";

import { ProjectsView, type ProjectGroupDTO } from "./projects-view";

export const metadata = { title: "프로젝트별 관리" };

type EngagementRow = {
  id: string;
  role_description: string;
  fee_amount: number | null;
  status: string;
  starts_on: string | null;
  ends_on: string | null;
  created_at: string;
  responded_at: string | null;
  project_id: string | null;
  tenants: { name: string } | null;
  projects: { name: string } | null;
};

const minDate = (a: string | null, b: string | null) =>
  !a ? b : !b ? a : a < b ? a : b;
const maxDate = (a: string | null, b: string | null) =>
  !a ? b : !b ? a : a > b ? a : b;

/**
 * 전문가 포털 — 프로젝트별 관리 (설계문서 3.2 전 기업 통합 이력).
 * 섭외 이력을 프로젝트 단위로 묶고, 검색·정렬(날짜·사업·기관) + 섭외승인일·참여기간·
 * 지급일(섭외↔지급 연계)을 표시. 테넌트 격리: 각 건은 소속 기업이 명시된다.
 */
export default async function ExpertProjectsPage() {
  const user = await requireUser("/expert/login");

  if (!hasSupabaseEnv() || !user) {
    return (
      <div className="min-h-screen bg-muted">
        <PortalHeader />
        <main className="p-5">
          <EmptyState
            title="서버 설정 대기 중"
            description="Supabase 환경변수가 설정되면 표시됩니다."
          />
        </main>
      </div>
    );
  }

  const supabase = createClient();
  const { data: expert } = await supabase
    .from("experts")
    .select("id")
    .eq("auth_user_id", user.id)
    .maybeSingle();

  if (!expert) {
    return (
      <div className="min-h-screen bg-muted">
        <PortalHeader />
        <main className="p-5">
          <EmptyState
            title="전문가 프로필이 없습니다"
            description="등록 링크로 등록을 완료하면 프로젝트 이력이 표시됩니다."
          />
        </main>
      </div>
    );
  }

  const [{ data: engagements }, { data: payments }] = await Promise.all([
    supabase
      .from("expert_engagements")
      .select(
        `id, role_description, fee_amount, status, starts_on, ends_on, created_at,
         responded_at, project_id, tenants (name), projects (name)`
      )
      .eq("expert_id", expert.id)
      .order("created_at", { ascending: false }),
    supabase
      .from("expert_portal_payments")
      .select("engagement_id, paid_at, confirmed_at")
      .limit(1000),
  ]);

  const rows = (engagements ?? []) as EngagementRow[];

  // 섭외 → 지급일 매핑 (지급/확정 시각)
  const paidByEngagement = new Map<string, string>();
  for (const p of payments ?? []) {
    if (!p.engagement_id) continue;
    const when = p.paid_at ?? p.confirmed_at;
    if (!when) continue;
    const prev = paidByEngagement.get(p.engagement_id);
    if (!prev || when > prev) paidByEngagement.set(p.engagement_id, when);
  }

  const groups = new Map<string, ProjectGroupDTO>();
  for (const row of rows) {
    const key = row.project_id ?? `solo-${row.id}`;
    const createdAt = new Date(row.created_at).getTime();
    const paidAt = paidByEngagement.get(row.id) ?? null;
    const approvedAt = row.status === "accepted" ? row.responded_at : null;

    const existing = groups.get(key);
    if (existing) {
      existing.engagements.push({
        id: row.id,
        role: row.role_description,
        status: row.status,
        startsOn: row.starts_on,
        endsOn: row.ends_on,
        fee: row.fee_amount,
      });
      existing.totalFee += row.fee_amount ?? 0;
      existing.latestAt = Math.max(existing.latestAt, createdAt);
      existing.approvedAt = maxDate(existing.approvedAt, approvedAt);
      existing.periodStart = minDate(existing.periodStart, row.starts_on);
      existing.periodEnd = maxDate(existing.periodEnd, row.ends_on);
      existing.paidAt = maxDate(existing.paidAt, paidAt);
    } else {
      groups.set(key, {
        key,
        projectName: row.projects?.name ?? "단독 섭외",
        tenantName: row.tenants?.name ?? "(기업)",
        totalFee: row.fee_amount ?? 0,
        latestAt: createdAt,
        approvedAt,
        periodStart: row.starts_on,
        periodEnd: row.ends_on,
        paidAt,
        engagements: [
          {
            id: row.id,
            role: row.role_description,
            status: row.status,
            startsOn: row.starts_on,
            endsOn: row.ends_on,
            fee: row.fee_amount,
          },
        ],
      });
    }
  }

  const groupList = Array.from(groups.values());

  return (
    <div className="min-h-screen bg-muted">
      <PortalHeader />
      <main className="mx-auto max-w-4xl space-y-4 p-4 sm:p-6">
        <PageIntro
          eyebrow="PROJECTS"
          title="프로젝트별 관리"
          description="참여한 섭외를 프로젝트 단위로 묶어 봅니다. 사업·기관·역할로 검색하고 날짜·사업·기관·지급일로 정렬하세요."
        />
        {groupList.length === 0 ? (
          <EmptyState
            title="프로젝트 이력이 없습니다"
            description="섭외를 수락하면 프로젝트 단위로 여기에 정리됩니다."
          />
        ) : (
          <ProjectsView groups={groupList} />
        )}
      </main>
    </div>
  );
}
