import Link from "next/link";
import { AlertTriangle } from "lucide-react";

import { requireRole } from "@/lib/auth/session";
import { getTenantModules } from "@/lib/modules/server";
import { createClient } from "@/lib/supabase/server";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { PROJECT_STATUS_LABELS } from "@/lib/operations/steps";
import { formatKrw } from "@/lib/approvals/constants";
import { PageHeader } from "@/components/layout/header";
import { EmptyState } from "@/components/layout/empty-state";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const metadata = { title: "임원 현황" };

/**
 * 단계 24: 총괄 임원 대시보드 — 직원별·프로젝트별 업무현황 (org_admin 전용).
 * 사업연도 축(CLAUDE.md 12-7). 프로젝트·스텝·기여도·섭외를 집계한다(테넌트 격리).
 */
export default async function ExecutivePage({
  params,
  searchParams,
}: {
  params: { tenantSlug: string };
  searchParams: { year?: string };
}) {
  await requireRole(["platform_admin", "org_admin"]);
  // 임원 현황은 프로젝트 기초 위의 통계 — 공통 기반

  if (!hasSupabaseEnv()) {
    return (
      <div>
        <PageHeader title="임원 현황" />
        <main className="p-5">
          <EmptyState
            title="서버 설정 대기 중"
            description="Supabase 환경변수가 설정되면 표시됩니다."
          />
        </main>
      </div>
    );
  }

  const currentYear = new Date().getFullYear();
  const year = /^\d{4}$/.test(searchParams.year ?? "")
    ? parseInt(searchParams.year!, 10)
    : currentYear;
  const slug = params.tenantSlug;

  const supabase = createClient();
  const modules = await getTenantModules();

  const [{ data: projectsData }, { data: usersData }] = await Promise.all([
    supabase
      .from("projects")
      .select("id, name, status, closed_at, budget_amount, category_id")
      .eq("business_year", year)
      .order("created_at", { ascending: false }),
    supabase.from("users").select("id, name, department").order("name"),
  ]);

  const projects = projectsData ?? [];
  const users = usersData ?? [];
  const projectIds = projects.map((p) => p.id);

  const [{ data: stepsData }, { data: contribData }, engagementsResult] =
    await Promise.all([
      projectIds.length
        ? supabase
            .from("project_lifecycle_steps")
            .select("project_id, assignee_user_id, status")
            .in("project_id", projectIds)
        : Promise.resolve({ data: [] }),
      projectIds.length
        ? supabase
            .from("project_contributions")
            .select("project_id, user_id, percentage")
            .in("project_id", projectIds)
        : Promise.resolve({ data: [] }),
      modules.experts && projectIds.length
        ? supabase
            .from("expert_engagements")
            .select("project_id, status")
            .in("project_id", projectIds)
            .eq("status", "accepted")
        : Promise.resolve({ data: [] }),
    ]);

  const steps = stepsData ?? [];
  const contributions = contribData ?? [];
  const acceptedEngagements = engagementsResult.data ?? [];

  // ── 직원별 집계 ────────────────────────────────────────────────────────────
  type StaffAgg = {
    assigned: number;
    completed: number;
    projects: Set<string>;
    contribSum: number;
  };
  const staffAgg = new Map<string, StaffAgg>();
  const ensure = (uid: string): StaffAgg => {
    let a = staffAgg.get(uid);
    if (!a) {
      a = { assigned: 0, completed: 0, projects: new Set(), contribSum: 0 };
      staffAgg.set(uid, a);
    }
    return a;
  };
  for (const s of steps) {
    if (!s.assignee_user_id) continue;
    const a = ensure(s.assignee_user_id);
    a.assigned += 1;
    if (s.status === "completed") a.completed += 1;
  }
  for (const c of contributions) {
    const a = ensure(c.user_id);
    a.projects.add(c.project_id);
    a.contribSum += c.percentage;
  }

  // ── 프로젝트별 집계 ────────────────────────────────────────────────────────
  const projStepTotal = new Map<string, number>();
  const projStepDone = new Map<string, number>();
  for (const s of steps) {
    projStepTotal.set(s.project_id, (projStepTotal.get(s.project_id) ?? 0) + 1);
    if (s.status === "completed" || s.status === "skipped") {
      projStepDone.set(s.project_id, (projStepDone.get(s.project_id) ?? 0) + 1);
    }
  }
  const projEngagements = new Map<string, number>();
  for (const e of acceptedEngagements) {
    if (!e.project_id) continue;
    projEngagements.set(e.project_id, (projEngagements.get(e.project_id) ?? 0) + 1);
  }
  const projContribTotal = new Map<string, number>();
  for (const c of contributions) {
    projContribTotal.set(
      c.project_id,
      (projContribTotal.get(c.project_id) ?? 0) + c.percentage
    );
  }

  // ── CEO 축: 카테고리별 · 담당 편중 · 전사 예산 ─────────────────────────────
  const { data: categoryRows } = await supabase
    .from("project_categories")
    .select("id, name");
  const categoryNameById = new Map(
    (categoryRows ?? []).map((c) => [c.id, c.name])
  );

  type CategoryAgg = { name: string; projects: number; budget: number };
  const categoryAgg = new Map<string, CategoryAgg>();
  for (const p of projects) {
    const key = p.category_id ?? "__none__";
    const name = p.category_id
      ? (categoryNameById.get(p.category_id) ?? "(삭제된 분야)")
      : "미분류";
    const agg = categoryAgg.get(key) ?? { name, projects: 0, budget: 0 };
    agg.projects += 1;
    agg.budget += p.budget_amount ?? 0;
    categoryAgg.set(key, agg);
  }
  const categoryRowsAgg = Array.from(categoryAgg.values()).sort(
    (a, b) => b.projects - a.projects
  );

  const totalBudget = projects.reduce((sum, p) => sum + (p.budget_amount ?? 0), 0);
  const activeProjects = projects.filter((p) => p.status === "active").length;
  const closedProjects = projects.filter((p) => p.closed_at).length;

  // PM 편중 — 한 사람이 진행 중 프로젝트를 몇 개나 이고 있는가.
  // 인원 배분이 무너진 상태는 숫자로 보이지 않으면 아무도 손대지 않는다.
  const liveProjectIds = projects
    .filter((p) => p.status !== "completed" && p.status !== "canceled")
    .map((p) => p.id);
  const { data: pmAssignments } = liveProjectIds.length
    ? await supabase
        .from("project_assignments")
        .select("user_id, project_id, assignment_role")
        .in("project_id", liveProjectIds)
        .in("assignment_role", ["pm", "deputy_pm"])
    : { data: [] };
  const loadByUser = new Map<string, { pm: number; deputy: number }>();
  for (const a of pmAssignments ?? []) {
    const cur = loadByUser.get(a.user_id) ?? { pm: 0, deputy: 0 };
    if (a.assignment_role === "pm") cur.pm += 1;
    else cur.deputy += 1;
    loadByUser.set(a.user_id, cur);
  }
  const loadRows = Array.from(loadByUser.entries())
    .map(([userId, load]) => ({
      userId,
      name: users.find((u) => u.id === userId)?.name ?? "(직원)",
      ...load,
      total: load.pm + load.deputy,
    }))
    .sort((a, b) => b.pm - a.pm || b.total - a.total);
  const maxPmLoad = loadRows.length > 0 ? Math.max(...loadRows.map((r) => r.pm)) : 0;
  // PM을 아무도 맡지 않은 진행 프로젝트 — 책임자 공백이다.
  const projectsWithPm = new Set(
    (pmAssignments ?? [])
      .filter((a) => a.assignment_role === "pm")
      .map((a) => a.project_id)
  );
  const pmlessProjects = liveProjectIds.filter((id) => !projectsWithPm.has(id));

  const yearOptions = [currentYear + 1, currentYear, currentYear - 1, currentYear - 2];

  return (
    <div>
      <PageHeader
        title="임원 현황"
        actions={
          <div className="flex items-center gap-1">
            {yearOptions.map((y) => (
              <Link
                key={y}
                href={`/${slug}/executive?year=${y}`}
                className={`rounded-md px-2.5 py-1 text-xs font-semibold ${
                  y === year
                    ? "bg-brand text-white"
                    : "text-muted-foreground hover:bg-secondary"
                }`}
              >
                {y}
              </Link>
            ))}
          </div>
        }
      />
      <main className="space-y-5 p-5">
        <p className="text-sm text-muted-foreground">
          {year}년 사업연도 기준 직원별·프로젝트별 업무현황입니다.
        </p>

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <ExecTile label="프로젝트" value={`${projects.length}건`} />
          <ExecTile label="진행 중" value={`${activeProjects}건`} />
          <ExecTile label="종료" value={`${closedProjects}건`} />
          <ExecTile label="전사 예산" value={formatKrw(totalBudget)} />
        </div>

        {pmlessProjects.length > 0 && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
            <AlertTriangle className="mt-0.5 h-4 w-4 flex-none" aria-hidden />
            <span>
              PM이 지정되지 않은 진행 프로젝트가 <b>{pmlessProjects.length}건</b>{" "}
              있습니다. 책임자가 없으면 마감·섭외가 아무에게도 잡히지 않습니다.
            </span>
          </div>
        )}

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">분야 카테고리별 현황</CardTitle>
          </CardHeader>
          <CardContent>
            {categoryRowsAgg.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {year}년 프로젝트가 없습니다.
              </p>
            ) : (
              <ul className="space-y-1.5">
                {categoryRowsAgg.map((c) => (
                  <li
                    key={c.name}
                    className="flex flex-wrap items-center gap-2 rounded-md border p-2.5 text-sm"
                  >
                    <span className="font-medium">{c.name}</span>
                    <span className="text-muted-foreground">{c.projects}건</span>
                    <span className="ml-auto tabular-nums text-muted-foreground">
                      예산 {formatKrw(c.budget)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-2 text-xs text-muted-foreground">
              분야는 기업 관리 화면에서 설정합니다. ‘미분류’가 많으면 개설 시 분야를
              고르지 않고 있다는 뜻입니다.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">PM·부PM 담당 편중 (진행 중 기준)</CardTitle>
          </CardHeader>
          <CardContent>
            {loadRows.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                진행 중 프로젝트에 배정된 PM·부PM이 없습니다.
              </p>
            ) : (
              <ul className="space-y-1.5">
                {loadRows.map((r) => (
                  <li
                    key={r.userId}
                    className="flex flex-wrap items-center gap-2 rounded-md border p-2.5 text-sm"
                  >
                    <span className="font-medium">{r.name}</span>
                    <span className="text-muted-foreground">
                      PM {r.pm} · 부PM {r.deputy}
                    </span>
                    {maxPmLoad >= 3 && r.pm === maxPmLoad && (
                      <Badge variant="destructive">최다 PM</Badge>
                    )}
                    <span className="ml-auto text-xs text-muted-foreground">
                      합계 {r.total}건
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">직원별 업무현황</CardTitle>
          </CardHeader>
          <CardContent>
            {users.length === 0 ? (
              <p className="text-sm text-muted-foreground">직원이 없습니다.</p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>직원</TableHead>
                      <TableHead>부서</TableHead>
                      <TableHead className="text-right">담당 스텝</TableHead>
                      <TableHead className="text-right">완료</TableHead>
                      <TableHead className="text-right">참여 프로젝트</TableHead>
                      <TableHead className="text-right">기여도 합</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {users.map((u) => {
                      const a = staffAgg.get(u.id);
                      return (
                        <TableRow key={u.id}>
                          <TableCell className="font-medium">{u.name}</TableCell>
                          <TableCell className="text-muted-foreground">
                            {u.department ?? "-"}
                          </TableCell>
                          <TableCell className="text-right">
                            {a?.assigned ?? 0}
                          </TableCell>
                          <TableCell className="text-right text-muted-foreground">
                            {a?.completed ?? 0}
                          </TableCell>
                          <TableCell className="text-right">
                            {a?.projects.size ?? 0}
                          </TableCell>
                          <TableCell className="text-right">
                            {a?.contribSum ?? 0}%
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">
              프로젝트별 현황 ({projects.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            {projects.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {year}년 프로젝트가 없습니다.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>프로젝트</TableHead>
                      <TableHead>상태</TableHead>
                      <TableHead className="text-right">스텝 진행</TableHead>
                      {modules.experts && (
                        <TableHead className="text-right">섭외 성사</TableHead>
                      )}
                      <TableHead className="text-right">기여도</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {projects.map((p) => {
                      const total = projStepTotal.get(p.id) ?? 0;
                      const contribTotal = projContribTotal.get(p.id) ?? 0;
                      return (
                        <TableRow key={p.id}>
                          <TableCell className="font-medium">
                            <Link
                              href={`/${slug}/projects/${p.id}`}
                              className="hover:underline"
                            >
                              {p.name}
                            </Link>
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant={
                                p.status === "completed"
                                  ? "default"
                                  : p.status === "cancelled"
                                    ? "destructive"
                                    : "secondary"
                              }
                            >
                              {PROJECT_STATUS_LABELS[p.status] ?? p.status}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right text-muted-foreground">
                            {projStepDone.get(p.id) ?? 0}/{total}
                          </TableCell>
                          {modules.experts && (
                            <TableCell className="text-right">
                              {projEngagements.get(p.id) ?? 0}
                            </TableCell>
                          )}
                          <TableCell className="text-right">
                            {contribTotal === 100 ? (
                              <span className="text-muted-foreground">완료</span>
                            ) : (
                              <span className="text-amber-700">{contribTotal}%</span>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}

/** 임원 요약 타일 */
function ExecTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-white p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-lg font-bold tabular-nums text-brand-navy">{value}</p>
    </div>
  );
}
