import Link from "next/link";
import { FileSignature } from "lucide-react";

import { requireRole } from "@/lib/auth/session";
import { canExecTenant } from "@/lib/auth/exec-policy";
import { roleFromUser } from "@/lib/auth/tenant";
import { isExpertsLite, requireModule } from "@/lib/modules/server";
import { createClient } from "@/lib/supabase/server";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { formatKrw } from "@/lib/approvals/constants";
import { ENGAGEMENT_STATUS_LABELS } from "@/lib/integrations/engagements";
import {
  formatEventSchedule,
  roleTypeLabel,
} from "@/lib/integrations/engagement-roles";
import { ACCEPTANCE_STATUS_LABELS } from "@/lib/integrations/acceptance-workflow";
import { resolvePage, totalPages, withParams } from "@/lib/ui/paging";
import { Pagination } from "@/components/layout/list-controls";
import { PageHeader } from "@/components/layout/header";

import { RemindButton } from "./remind-button";
import { EngagementHistoryDialog } from "../../projects/[projectId]/engagement-history-dialog";
import { ManualAcceptButton } from "../../projects/[projectId]/manual-accept-button";
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
const PAGE_SIZE = 50;

export default async function EngagementStatusPage({
  params,
  searchParams,
}: {
  params: { tenantSlug: string };
  searchParams?: { status?: string; page?: string };
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
  // 전화 섭외 수동 완료 — 실행 축(engagementRequest)과 같은 문턱 (기획 확정 2026-08-23)
  const canManualAccept = await canExecTenant("engagementRequest", user);
  // 라이트 모드 — 재안내(문자)는 숨긴다. 수동 완료가 기본 동작이 된다.
  const expertsLite = await isExpertsLite();

  const supabase = createClient();

  // 프로젝트 RLS가 배정 기준으로 이미 좁혀져 있다 — 보이는 프로젝트만 대상으로 삼는다.
  const { data: visibleProjects } = await supabase
    .from("projects")
    .select("id, name");
  const projectNameById = new Map(
    (visibleProjects ?? []).map((p) => [p.id, p.name])
  );

  // 가시성(배정 범위)은 expert_engagements RLS가 이미 강제한다 —
  //   권한자: 전체 / 담당자: 배정 프로젝트 건만, 프로젝트 미연결 건은 권한자만.
  // 예전에는 300건을 받아 JS로 다시 걸렀는데, 그러면 (1) 301번째부터 조용히
  // 사라지고 (2) 집계 숫자도 받아온 300건 기준이라 사실과 달랐다.
  const basePath = `/${params.tenantSlug}/experts/engagements`;
  const statusFilter = STATUS_ORDER.includes(searchParams?.status ?? "")
    ? (searchParams?.status as string)
    : "all";
  const paging = resolvePage(searchParams?.page, PAGE_SIZE);
  const activeParams = { status: statusFilter === "all" ? undefined : statusFilter };

  const SELECT_COLUMNS = `id, expert_id, project_id, role_description, role_type, program_name,
       fee_amount, starts_on, ends_on, starts_time, ends_time, status,
       created_at, responded_at, response_note, token_expires_at,
       experts (name)`;

  let listQuery = supabase
    .from("expert_engagements")
    .select(SELECT_COLUMNS, { count: "exact" });
  if (statusFilter !== "all") listQuery = listQuery.eq("status", statusFilter);

  // 집계는 전체 기준으로 따로 센다(페이지에 보이는 것만 세면 사실과 달라진다).
  const [{ data: engagementRows, count: listCount }, ...countResults] =
    await Promise.all([
      listQuery
        .order("created_at", { ascending: false })
        .range(paging.from, paging.to),
      ...STATUS_ORDER.map((s) =>
        supabase
          .from("expert_engagements")
          .select("id", { count: "exact", head: true })
          .eq("status", s)
      ),
    ]);

  const rows = engagementRows ?? [];
  const pageCount = totalPages(listCount, PAGE_SIZE);
  const counts = STATUS_ORDER.reduce<Record<string, number>>((acc, s, i) => {
    acc[s] = countResults[i]?.count ?? 0;
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
        {/* 집계 카드가 곧 필터다 — 숫자를 보고 그 상태만 바로 열어 본다 */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {STATUS_ORDER.map((s) => {
            const on = statusFilter === s;
            return (
              <Link
                key={s}
                href={withParams(basePath, {}, { status: on ? undefined : s })}
                className="block"
              >
                <Card
                  className={
                    "transition-colors " +
                    (on ? "border-brand bg-brand/5" : "hover:border-brand/40")
                  }
                >
                  <CardContent className="pt-6">
                    <p className="text-xs text-muted-foreground">
                      {ENGAGEMENT_STATUS_LABELS[s] ?? s}
                    </p>
                    <p className="mt-1 text-2xl font-bold">{counts[s] ?? 0}</p>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
        {statusFilter !== "all" && (
          <p className="text-xs text-muted-foreground">
            ‘{ENGAGEMENT_STATUS_LABELS[statusFilter] ?? statusFilter}’ 상태만
            보고 있습니다.{" "}
            <Link href={basePath} className="text-brand underline-offset-4 hover:underline">
              전체 보기
            </Link>
          </p>
        )}

        {rows.length === 0 ? (
          <EmptyState
            title="섭외 건이 없습니다"
            description={
              canSeeAll
                ? "프로젝트의 세션에서 코드넘버별로 섭외를 요청해 보세요."
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
                    <TableHead>이력</TableHead>
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
                          {e.status === "requested" ? (
                            <span className="inline-flex flex-wrap items-center gap-1.5">
                              {!expertsLite && (
                                <RemindButton
                                  engagementId={e.id}
                                  expertName={e.experts?.name ?? "전문가"}
                                  daysWaiting={Math.floor(
                                    (Date.now() - new Date(e.created_at).getTime()) /
                                      86400000
                                  )}
                                />
                              )}
                              {canManualAccept && (
                                <ManualAcceptButton
                                  engagementId={e.id}
                                  expertName={e.experts?.name ?? null}
                                  expertsLite={expertsLite}
                                />
                              )}
                            </span>
                          ) : acceptanceStatus ? (
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
                        <TableCell>
                          <EngagementHistoryDialog
                            engagementId={e.id}
                            expertName={e.experts?.name ?? null}
                          />
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}

        <Pagination
          basePath={basePath}
          params={activeParams}
          page={paging.page}
          pageCount={pageCount}
          totalCount={listCount}
        />
      </main>
    </div>
  );
}
