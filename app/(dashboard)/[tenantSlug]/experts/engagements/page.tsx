import Link from "next/link";
import { FileSignature } from "lucide-react";

import { requireRole } from "@/lib/auth/session";
import { roleFromUser } from "@/lib/auth/tenant";
import { requireModule } from "@/lib/modules/server";
import { createClient } from "@/lib/supabase/server";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { formatKrw } from "@/lib/approvals/constants";
import { ENGAGEMENT_STATUS_LABELS } from "@/lib/integrations/engagements";
import {
  formatEventSchedule,
  roleTypeLabel,
} from "@/lib/integrations/engagement-roles";
import { ACCEPTANCE_STATUS_LABELS } from "@/lib/integrations/acceptance-workflow";
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

export const metadata = { title: "섭외 현황" };

const STATUS_ORDER = ["requested", "accepted", "declined", "canceled", "expired"];

const STATUS_VARIANT: Record<
  string,
  "default" | "secondary" | "outline" | "destructive"
> = {
  requested: "secondary",
  accepted: "default",
  declined: "destructive",
  canceled: "outline",
  expired: "outline",
};

/**
 * 기업 화면 — 섭외 현황 집계 보드 (Phase C).
 * 요청/수락/반려(거절)/회수/만료를 한 곳에서 집계하고, 건별 수락서 진행 상태를 함께 본다.
 * 가시성은 프로젝트 배정을 따른다(권한자=전체, 담당자=배정된 프로젝트 건만).
 */
export default async function EngagementStatusPage({
  params,
}: {
  params: { tenantSlug: string };
}) {
  const user = await requireRole([
    "platform_admin",
    "org_admin",
    "manager",
    "staff",
  ]);
  await requireModule("experts");

  if (!hasSupabaseEnv()) {
    return (
      <div>
        <PageHeader title="섭외 현황" />
        <main className="p-5">
          <EmptyState
            title="서버 설정 대기 중"
            description="Supabase 환경변수가 설정되면 표시됩니다."
          />
        </main>
      </div>
    );
  }

  const role = roleFromUser(user);
  const canSeeAll = role === "org_admin" || role === "manager" || role === "platform_admin";

  const supabase = createClient();

  // 프로젝트 RLS가 배정 기준으로 이미 좁혀져 있다 — 보이는 프로젝트만 대상으로 삼는다.
  const { data: visibleProjects } = await supabase
    .from("projects")
    .select("id, name");
  const visibleIds = (visibleProjects ?? []).map((p) => p.id);
  const projectNameById = new Map(
    (visibleProjects ?? []).map((p) => [p.id, p.name])
  );

  const { data: engagementRows } = await supabase
    .from("expert_engagements")
    .select(
      `id, expert_id, project_id, role_description, role_type, program_name,
       fee_amount, starts_on, ends_on, starts_time, ends_time, status,
       created_at, responded_at, response_note, token_expires_at,
       experts (name)`
    )
    .order("created_at", { ascending: false })
    .limit(300);

  // 담당자는 배정된 프로젝트 건만. 프로젝트 미연결 건은 권한자만 조회.
  const rows = (engagementRows ?? []).filter((e) =>
    e.project_id ? visibleIds.includes(e.project_id) : canSeeAll
  );

  const counts = STATUS_ORDER.reduce<Record<string, number>>((acc, s) => {
    acc[s] = rows.filter((r) => r.status === s).length;
    return acc;
  }, {});

  // 수락서 진행 상태 매핑
  const engagementIds = rows.map((r) => r.id);
  const { data: acceptanceRows } = engagementIds.length
    ? await supabase
        .from("engagement_acceptances")
        .select("engagement_id, status")
        .in("engagement_id", engagementIds)
    : { data: [] };
  const acceptanceByEngagement = new Map(
    (acceptanceRows ?? []).map((a) => [a.engagement_id, a.status])
  );

  return (
    <div>
      <PageHeader
        title="섭외 현황"
        actions={
          <Button asChild variant="ghost" size="sm">
            <Link href={`/${params.tenantSlug}/experts`}>전문가 목록</Link>
          </Button>
        }
      />
      <main className="space-y-4 p-5">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {STATUS_ORDER.map((s) => (
            <Card key={s}>
              <CardContent className="pt-6">
                <p className="text-xs text-muted-foreground">
                  {ENGAGEMENT_STATUS_LABELS[s] ?? s}
                </p>
                <p className="mt-1 text-2xl font-bold">{counts[s] ?? 0}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        {rows.length === 0 ? (
          <EmptyState
            title="섭외 건이 없습니다"
            description={
              canSeeAll
                ? "프로젝트의 섭외 테이블에서 넘버링코드별로 섭외를 요청해 보세요."
                : "배정된 프로젝트의 섭외 건이 여기에 표시됩니다."
            }
          />
        ) : (
          <Card>
            <CardContent className="pt-6">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>전문가</TableHead>
                    <TableHead>사업/프로젝트</TableHead>
                    <TableHead>역할</TableHead>
                    <TableHead>일정</TableHead>
                    <TableHead className="text-right">비용</TableHead>
                    <TableHead>상태</TableHead>
                    <TableHead>수락서</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((e) => {
                    const acceptanceStatus = acceptanceByEngagement.get(e.id);
                    return (
                      <TableRow key={e.id}>
                        <TableCell className="font-medium">
                          {e.experts?.name ?? "-"}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {e.program_name ??
                            (e.project_id ? projectNameById.get(e.project_id) : null) ??
                            "-"}
                        </TableCell>
                        <TableCell className="text-sm">
                          {[roleTypeLabel(e.role_type), e.role_description]
                            .filter(Boolean)
                            .join(" · ")}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {formatEventSchedule(
                            e.starts_on,
                            e.ends_on,
                            e.starts_time,
                            e.ends_time
                          ) ?? "-"}
                        </TableCell>
                        <TableCell className="text-right text-sm">
                          {e.fee_amount !== null ? formatKrw(e.fee_amount) : "-"}
                        </TableCell>
                        <TableCell>
                          <Badge variant={STATUS_VARIANT[e.status] ?? "outline"}>
                            {ENGAGEMENT_STATUS_LABELS[e.status] ?? e.status}
                          </Badge>
                          {e.status === "declined" && e.response_note && (
                            <p className="mt-1 max-w-[220px] text-xs text-muted-foreground">
                              사유: {e.response_note}
                            </p>
                          )}
                        </TableCell>
                        <TableCell>
                          {acceptanceStatus ? (
                            <Link
                              href={`/${params.tenantSlug}/experts/acceptances/${e.id}`}
                              className="inline-flex items-center gap-1 text-sm text-brand underline"
                            >
                              <FileSignature className="h-3.5 w-3.5" />
                              {ACCEPTANCE_STATUS_LABELS[acceptanceStatus] ??
                                acceptanceStatus}
                            </Link>
                          ) : (
                            <span className="text-xs text-muted-foreground">-</span>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}
      </main>
    </div>
  );
}
