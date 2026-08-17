import Link from "next/link";

import { requireRole } from "@/lib/auth/session";
import { requireModule } from "@/lib/modules/server";
import { createClient } from "@/lib/supabase/server";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { PROJECT_STATUS_LABELS } from "@/lib/operations/steps";
import { PageHeader } from "@/components/layout/header";
import { EmptyState } from "@/components/layout/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
  await requireRole(["platform_admin", "org_admin", "manager", "staff"]);
  await requireModule("operations");

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
  const { data: projects } = await supabase
    .from("projects")
    .select(
      "id, name, code, business_year, client_name, status, starts_on, ends_on, project_lifecycle_steps (status)"
    )
    .order("business_year", { ascending: false })
    .order("created_at", { ascending: false });

  const rows = projects ?? [];

  // PM·부PM 표기 (RLS가 이미 볼 수 있는 배정만 돌려준다)
  const { data: assignments } = rows.length
    ? await supabase
        .from("project_assignments")
        .select("project_id, user_id, assignment_role")
        .in(
          "project_id",
          rows.map((r) => r.id)
        )
        .in("assignment_role", ["pm", "deputy_pm"])
    : { data: null };

  // users 임베드는 타입 관계가 잡혀 있지 않아 별도 조회 후 매핑한다
  const leadUserIds = Array.from(
    new Set((assignments ?? []).map((a) => a.user_id))
  );
  const { data: leadUsers } = leadUserIds.length
    ? await supabase.from("users").select("id, name").in("id", leadUserIds)
    : { data: null };
  const nameById = new Map((leadUsers ?? []).map((u) => [u.id, u.name]));

  const leadByProject = new Map<string, { pm?: string; deputy?: string }>();
  for (const a of assignments ?? []) {
    const name = nameById.get(a.user_id);
    if (!name) continue;
    const entry = leadByProject.get(a.project_id) ?? {};
    if (a.assignment_role === "pm") entry.pm = name;
    else entry.deputy = name;
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
            <CreateProjectDialog tenantSlug={params.tenantSlug} />
          </div>
        }
      />
      <main className="p-5">
        {rows.length === 0 ? (
          <EmptyState
            title="프로젝트가 없습니다"
            description="우측 상단 ‘프로젝트 생성’으로 첫 프로젝트를 만드세요. 기본 21스텝이 자동 구성됩니다."
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
                      <TableHead>PM · 부PM</TableHead>
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
                          </TableCell>
                          <TableCell>{project.client_name ?? "-"}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {project.starts_on ?? "?"} ~ {project.ends_on ?? "?"}
                          </TableCell>
                          <TableCell className="text-xs">
                            {(() => {
                              const lead = leadByProject.get(project.id);
                              if (!lead?.pm && !lead?.deputy) {
                                return (
                                  <span className="text-muted-foreground">미지정</span>
                                );
                              }
                              return (
                                <>
                                  {lead.pm ?? "-"}
                                  {lead.deputy && (
                                    <span className="text-muted-foreground">
                                      {" · "}
                                      {lead.deputy}
                                    </span>
                                  )}
                                </>
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
      </main>
    </div>
  );
}
