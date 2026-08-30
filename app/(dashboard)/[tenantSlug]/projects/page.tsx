import Link from "next/link";

import { requireRole } from "@/lib/auth/session";
import { canExecTenant } from "@/lib/auth/exec-policy";
import { createClient } from "@/lib/supabase/server";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { PROJECT_STATUS_LABELS } from "@/lib/operations/steps";
import { PageHeader } from "@/components/layout/header";
import { EmptyState } from "@/components/layout/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ProjectTodoTicker } from "@/components/projects/todo-ticker";
import { projectStage } from "@/lib/integrations/project-stage";
import { isPlRole, isPmRole } from "@/lib/integrations/assignment-roles";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import { CreateProjectDialog } from "./create-project-dialog";

export const metadata = { title: "프로젝트" };

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  planned: "secondary",
  active: "default",
  on_hold: "outline",
  completed: "secondary",
  cancelled: "destructive",
};

/**
 * 프로젝트 목록 (operations 모듈) — 사업연도 축 정렬.
 */
export default async function ProjectsPage({
  params,
}: {
  params: { tenantSlug: string };
}) {
  const user = await requireRole(["platform_admin", "org_admin", "manager", "staff"]);
  // 프로젝트 목록은 공통 기반 — 모듈 게이트 없음
  // 생성은 대표·이사·팀장(role=manager 이상)만 — 사원·주임·대리에게 버튼을
  // 보여 주면 폼을 다 채운 뒤에야 서버에서 거부당한다(§14-7 죽은 버튼 금지)
  const canCreate = await canExecTenant("projectCreate", user);

  if (!hasSupabaseEnv()) {
    return (
      <div>
        <PageHeader title="프로젝트" />
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
  // 취소 보관 건은 목록에서 뺀다 — 별도 공간(설정 > 프로젝트 보관)으로
  // 이관된 것이다 (기획 확정 2026-08-30). 종결(완료)은 실적이므로 계속 표시.
  const [{ data: projects }, { count: archivedCount }] = await Promise.all([
    supabase
      .from("projects")
      .select(
        "id, name, code, business_year, client_name, status, starts_on, ends_on, engagement_stage, project_lifecycle_steps (status)"
      )
      .neq("status", "cancelled")
      .order("business_year", { ascending: false })
      .order("created_at", { ascending: false }),
    supabase
      .from("projects")
      .select("id", { count: "exact", head: true })
      .eq("status", "cancelled"),
  ]);

  const rows = projects ?? [];

  // 분야 카테고리 — 대표가 설정한 활성 항목만 개설 폼에 노출한다.
  const { data: categoryRows } = await supabase
    .from("project_categories")
    .select("id, name")
    .eq("is_active", true)
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });
  const categoryOptions = (categoryRows ?? []).map((c) => ({
    id: c.id,
    name: c.name,
  }));

  // PL·PM·부PM 표기 (RLS가 이미 볼 수 있는 배정만 돌려준다)
  const { data: assignments } = rows.length
    ? await supabase
        .from("project_assignments")
        .select("project_id, user_id, assignment_role")
        .in(
          "project_id",
          rows.map((r) => r.id)
        )
        .in("assignment_role", ["pl", "pl_pm", "pm", "deputy_pm"])
    : { data: null };

  // users 임베드는 타입 관계가 잡혀 있지 않아 별도 조회 후 매핑한다
  const leadUserIds = Array.from(
    new Set((assignments ?? []).map((a) => a.user_id))
  );
  const { data: leadUsers } = leadUserIds.length
    ? await supabase.from("users").select("id, name").in("id", leadUserIds)
    : { data: null };
  const nameById = new Map((leadUsers ?? []).map((u) => [u.id, u.name]));

  const leadByProject = new Map<
    string,
    { pl?: string; pm?: string; deputies: string[] }
  >();
  for (const a of assignments ?? []) {
    const name = nameById.get(a.user_id);
    if (!name) continue;
    const entry = leadByProject.get(a.project_id) ?? { deputies: [] };
    // PL·PM 겸임(pl_pm)은 양쪽 칸에 모두 표기한다
    if (isPlRole(a.assignment_role)) entry.pl = name;
    if (isPmRole(a.assignment_role)) entry.pm = name;
    if (a.assignment_role === "deputy_pm") entry.deputies.push(name);
    leadByProject.set(a.project_id, entry);
  }

  return (
    <div>
      <PageHeader
        title="프로젝트"
        actions={
          <div className="flex items-center gap-2">
            <Button asChild variant="outline" size="sm">
              <a href={`/${params.tenantSlug}/projects/export`}>엑셀</a>
            </Button>
            {canCreate ? (
              <CreateProjectDialog
                tenantSlug={params.tenantSlug}
                categories={categoryOptions}
              />
            ) : (
              // 버튼만 사라지면 개설을 누구에게 부탁해야 하는지 알 수 없다 (검수 F3)
              <span className="text-xs text-muted-foreground">
                프로젝트 개설 권한이 없습니다 (권한 규칙 — 기본 레벨 3)
              </span>
            )}
          </div>
        }
      />
      <main className="p-5">
        {rows.length === 0 ? (
          <EmptyState
            title="프로젝트가 없습니다"
            description="우측 상단 ‘프로젝트 생성’으로 첫 프로젝트를 만드세요."
          />
        ) : (
          <Card>
            <CardContent className="pt-6">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>사업연도</TableHead>
                      <TableHead>프로젝트명</TableHead>
                      <TableHead>발주처</TableHead>
                      <TableHead>기간</TableHead>
                      {/* PL·PM·부PM을 한 칸에 붙여 두면 누가 책임자인지
                          읽히지 않는다 — 칸을 나눈다 */}
                      <TableHead>PL</TableHead>
                      <TableHead>PM</TableHead>
                      <TableHead>부PM</TableHead>
                      <TableHead>진행</TableHead>
                      <TableHead>상태</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((project) => {
                      const steps = project.project_lifecycle_steps ?? [];
                      const done = steps.filter(
                        (s) => s.status === "completed" || s.status === "skipped"
                      ).length;
                      return (
                        <TableRow key={project.id}>
                          <TableCell>{project.business_year}</TableCell>
                          <TableCell className="font-medium">
                            <Link
                              href={`/${params.tenantSlug}/projects/${project.id}`}
                              className="text-brand underline-offset-4 hover:underline"
                            >
                              {project.name}
                            </Link>
                            {project.code && (
                              <span className="ml-2 font-mono text-xs text-muted-foreground">
                                {project.code}
                              </span>
                            )}
                            {/* 지금 할 일 전광판 — 단계 색 컬러바 + 흐르는 안내 */}
                            <ProjectTodoTicker
                              stage={projectStage(project.engagement_stage)}
                            />
                          </TableCell>
                          <TableCell>{project.client_name ?? "-"}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {project.starts_on ?? "?"} ~ {project.ends_on ?? "?"}
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-xs">
                            {leadByProject.get(project.id)?.pl ?? (
                              <span className="text-muted-foreground">미지정</span>
                            )}
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-xs">
                            {leadByProject.get(project.id)?.pm ?? (
                              <span className="text-muted-foreground">미지정</span>
                            )}
                          </TableCell>
                          <TableCell className="text-xs">
                            {(() => {
                              const deputies =
                                leadByProject.get(project.id)?.deputies ?? [];
                              if (deputies.length === 0) {
                                return <span className="text-muted-foreground">-</span>;
                              }
                              // 여러 명일 때 한 줄로 이어 붙이면 이름이 뭉개진다 — 줄로 쌓는다
                              return (
                                <ul className="space-y-0.5">
                                  {deputies.map((name) => (
                                    <li key={name}>{name}</li>
                                  ))}
                                </ul>
                              );
                            })()}
                          </TableCell>
                          <TableCell>
                            {steps.length > 0 ? `${done}/${steps.length}` : "-"}
                          </TableCell>
                          <TableCell>
                            <Badge variant={STATUS_VARIANT[project.status] ?? "secondary"}>
                              {PROJECT_STATUS_LABELS[project.status] ?? project.status}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        )}
        {(archivedCount ?? 0) > 0 && (
          <p className="text-xs text-muted-foreground">
            보관(취소) 처리된 프로젝트 {archivedCount}건은 이 목록에 나오지
            않습니다 —{" "}
            <a
              href={`/${params.tenantSlug}/settings/archive`}
              className="underline underline-offset-2"
            >
              설정 &gt; 프로젝트 보관
            </a>
            에서 확인하세요 (대표·이사).
          </p>
        )}
      </main>
    </div>
  );
}
