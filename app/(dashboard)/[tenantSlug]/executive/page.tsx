import Link from "next/link";

import { requireRole } from "@/lib/auth/session";
import { getTenantModules, requireModule } from "@/lib/modules/server";
import { createClient } from "@/lib/supabase/server";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { PROJECT_STATUS_LABELS } from "@/lib/operations/steps";
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
  await requireModule("operations");

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
      .select("id, name, status, closed_at")
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
