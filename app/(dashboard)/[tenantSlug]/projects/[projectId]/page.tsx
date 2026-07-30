import Link from "next/link";
import { notFound } from "next/navigation";

import { requireRole } from "@/lib/auth/session";
import { getTenantModules, requireModule } from "@/lib/modules/server";
import { createClient } from "@/lib/supabase/server";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import {
  PROJECT_STATUS_LABELS,
  STEP_TYPE_LABELS,
  type StepType,
} from "@/lib/operations/steps";
import { formatKrw } from "@/lib/approvals/constants";
import { ENGAGEMENT_STATUS_LABELS } from "@/lib/integrations/engagements";
import { PageHeader } from "@/components/layout/header";
import { EmptyState } from "@/components/layout/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EngagementDialog } from "@/components/integrations/engagement-dialog";
import { EngagementCancelButton } from "@/components/integrations/engagement-cancel-button";

import { StepStatusSelect } from "./step-status-select";

export const metadata = { title: "프로젝트 상세" };

const STEP_TYPE_ORDER: StepType[] = [
  "preparation",
  "recruitment",
  "operation",
  "settlement",
  "reporting",
];

/**
 * 프로젝트 상세 — 21스텝 라이프사이클 진행 관리 (operations 모듈).
 * 스텝은 오케스트레이션 전용 — 각 단계의 업무 데이터는 전용 화면에서 다룬다.
 * 조회는 모바일 대응, 입력은 PC 최적화 (CLAUDE.md 10).
 */
export default async function ProjectDetailPage({
  params,
}: {
  params: { tenantSlug: string; projectId: string };
}) {
  await requireRole(["platform_admin", "org_admin", "manager", "staff"]);
  await requireModule("operations");

  if (!hasSupabaseEnv()) {
    return (
      <div>
        <PageHeader title="프로젝트 상세" />
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

  const { data: project } = await supabase
    .from("projects")
    .select(
      "id, name, code, business_year, client_name, status, starts_on, ends_on, description"
    )
    .eq("id", params.projectId)
    .maybeSingle();

  if (!project) notFound();

  const modules = await getTenantModules();

  const [{ data: steps }, engagementsResult, expertsResult] = await Promise.all([
    supabase
      .from("project_lifecycle_steps")
      .select(
        "id, step_no, step_type, title, status, due_on, completed_at, users (name)"
      )
      .eq("project_id", project.id)
      .order("step_no", { ascending: true }),
    // 섭외 연동은 experts 모듈 활성 시에만 (CLAUDE.md 1-2-6)
    modules.experts
      ? supabase
          .from("expert_engagements")
          .select(
            "id, role_description, fee_amount, status, created_at, experts (name)"
          )
          .eq("project_id", project.id)
          .order("created_at", { ascending: false })
      : Promise.resolve({ data: null }),
    modules.experts
      ? supabase
          .from("expert_tenant_links")
          .select("expert_id, status, experts (id, name)")
          .eq("status", "active")
      : Promise.resolve({ data: null }),
  ]);

  const stepRows = steps ?? [];
  const engagements = engagementsResult.data ?? [];
  const connectedExperts = (expertsResult.data ?? [])
    .map((l) => l.experts)
    .filter((e): e is NonNullable<typeof e> => e !== null)
    .map((e) => ({ id: e.id, name: e.name }));
  const done = stepRows.filter(
    (s) => s.status === "completed" || s.status === "skipped"
  ).length;

  return (
    <div>
      <PageHeader
        title={project.name}
        actions={
          <Button asChild variant="ghost" size="sm">
            <Link href={`/${params.tenantSlug}/projects`}>목록으로</Link>
          </Button>
        }
      />
      <main className="space-y-5 p-5">
        <Card>
          <CardContent className="flex flex-wrap items-center gap-x-6 gap-y-2 pt-6 text-sm">
            <span>
              <span className="text-muted-foreground">사업연도</span>{" "}
              <strong>{project.business_year}</strong>
            </span>
            {project.code && (
              <span className="font-mono text-xs text-muted-foreground">
                {project.code}
              </span>
            )}
            {project.client_name && (
              <span>
                <span className="text-muted-foreground">발주처</span>{" "}
                {project.client_name}
              </span>
            )}
            <span>
              <span className="text-muted-foreground">기간</span>{" "}
              {project.starts_on ?? "?"} ~ {project.ends_on ?? "?"}
            </span>
            <Badge>{PROJECT_STATUS_LABELS[project.status] ?? project.status}</Badge>
            <span className="ml-auto text-muted-foreground">
              진행 {done}/{stepRows.length}
            </span>
          </CardContent>
        </Card>

        {project.description && (
          <Card>
            <CardContent className="pt-6 text-sm text-muted-foreground">
              {project.description}
            </CardContent>
          </Card>
        )}

        {modules.experts && (
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
              <CardTitle className="text-sm">
                전문가 섭외 ({engagements.length})
              </CardTitle>
              <EngagementDialog
                experts={connectedExperts}
                projects={null}
                defaultProjectId={project.id}
              />
            </CardHeader>
            <CardContent>
              {engagements.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  이 프로젝트에 섭외된 전문가가 없습니다. ‘섭외 요청’으로 동의
                  링크를 만들어 전달하세요.
                </p>
              ) : (
                <ul className="divide-y">
                  {engagements.map((engagement) => (
                    <li
                      key={engagement.id}
                      className="flex flex-wrap items-center gap-2 py-2.5 text-sm"
                    >
                      <span className="font-medium">
                        {engagement.experts?.name ?? "-"}
                      </span>
                      <span className="text-muted-foreground">
                        {engagement.role_description}
                      </span>
                      {engagement.fee_amount !== null && (
                        <span className="text-xs text-muted-foreground">
                          {formatKrw(engagement.fee_amount)}
                        </span>
                      )}
                      <Badge
                        className="ml-auto"
                        variant={
                          engagement.status === "accepted"
                            ? "default"
                            : engagement.status === "declined"
                              ? "destructive"
                              : "secondary"
                        }
                      >
                        {ENGAGEMENT_STATUS_LABELS[engagement.status] ??
                          engagement.status}
                      </Badge>
                      {engagement.status === "requested" && (
                        <EngagementCancelButton engagementId={engagement.id} />
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        )}

        {STEP_TYPE_ORDER.map((stepType) => {
          const group = stepRows.filter((s) => s.step_type === stepType);
          if (group.length === 0) return null;
          return (
            <Card key={stepType}>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">
                  {STEP_TYPE_LABELS[stepType]}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="divide-y">
                  {group.map((step) => (
                    <li
                      key={step.id}
                      className="flex flex-wrap items-center gap-2 py-2.5 text-sm"
                    >
                      <span className="w-8 shrink-0 font-mono text-xs text-muted-foreground">
                        {String(step.step_no).padStart(2, "0")}
                      </span>
                      <span
                        className={
                          step.status === "completed" || step.status === "skipped"
                            ? "flex-1 text-muted-foreground line-through"
                            : "flex-1 font-medium"
                        }
                      >
                        {step.title}
                      </span>
                      {step.users?.name && (
                        <span className="text-xs text-muted-foreground">
                          담당 {step.users.name}
                        </span>
                      )}
                      {step.due_on && (
                        <span className="text-xs text-muted-foreground">
                          기한 {step.due_on}
                        </span>
                      )}
                      <StepStatusSelect stepId={step.id} status={step.status} />
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          );
        })}
      </main>
    </div>
  );
}
