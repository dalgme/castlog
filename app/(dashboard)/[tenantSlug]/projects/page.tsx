import Link from "next/link";

import { requireRole } from "@/lib/auth/session";
import { requireModule } from "@/lib/modules/server";
import { createClient } from "@/lib/supabase/server";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { PROJECT_STATUS_LABELS } from "@/lib/operations/steps";
import { PageHeader } from "@/components/layout/header";
import { EmptyState } from "@/components/layout/empty-state";
import { Badge } from "@/components/ui/badge";
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
 * TODO(단계 13): 엑셀 내보내기 (CLAUDE.md Always 6)
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

  return (
    <div>
      <PageHeader
        title="프로젝트"
        actions={<CreateProjectDialog tenantSlug={params.tenantSlug} />}
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
