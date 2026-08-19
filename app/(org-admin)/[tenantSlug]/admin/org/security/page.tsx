import Link from "next/link";
import { redirect } from "next/navigation";
import { ShieldAlert, ShieldCheck, KeyRound, Lock } from "lucide-react";

import { requireUser, postLoginPath } from "@/lib/auth/session";
import { canViewSecurity } from "@/lib/auth/admin-scopes";
import { roleFromUser, tenantIdFromUser } from "@/lib/auth/tenant";
import { createClient } from "@/lib/supabase/server";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { PageHeader } from "@/components/layout/header";
import { EmptyState } from "@/components/layout/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  RRN_PROJECT_LIMIT,
  rrnAccessReasonLabel,
  rrnAccessTypeLabel,
} from "@/lib/integrations/rrn-access";
import { foldQuotaRows, getSecuritySummary } from "@/lib/integrations/rrn-security";

import { OverLimitPanel, type PendingRequest } from "./over-limit-panel";

export const metadata = { title: "보안 현황" };

const LOG_LIMIT = 200;

/**
 * 기업 보안 현황 — 대표 또는 audit 위임자(보안책임자) 전용.
 *
 * 조회 '실행'과 조회 '감시'는 다른 권한이다(CLAUDE.md §5). 이 화면은 감시 전용이며
 * 번호·암호문·복호화 자료는 어떤 형태로도 다루지 않는다. 조회 실행 화면은
 * 기업 관리 페이지의 지정자 전용 패널에 있다.
 */
export default async function SecurityPage({
  params,
  searchParams,
}: {
  params: { tenantSlug: string };
  searchParams: { from?: string; to?: string };
}) {
  const gateUser = await requireUser();
  if (!gateUser) return null;
  if (!(await canViewSecurity())) redirect(postLoginPath(gateUser));

  if (!hasSupabaseEnv()) {
    return (
      <div className="min-h-screen bg-secondary/50">
        <PageHeader title="보안 현황" />
        <main className="p-5">
          <EmptyState
            title="서버 설정 대기 중"
            description="Supabase 환경변수가 설정되면 표시됩니다."
          />
        </main>
      </div>
    );
  }

  const tenantId = tenantIdFromUser(gateUser);
  if (!tenantId) redirect(postLoginPath(gateUser));
  const isCeo = roleFromUser(gateUser) === "org_admin";

  const supabase = createClient();
  const from = searchParams.from ?? "";
  const to = searchParams.to ?? "";

  let logQuery = supabase
    .from("tax_access_logs")
    .select(
      "id, expert_id, project_id, project_name, reason, access_type, accessor_label, accessed_at, is_over_limit, over_limit_reason"
    )
    .order("accessed_at", { ascending: false })
    .limit(LOG_LIMIT);
  if (from) logQuery = logQuery.gte("accessed_at", `${from}T00:00:00+09:00`);
  if (to) logQuery = logQuery.lte("accessed_at", `${to}T23:59:59+09:00`);

  const [summary, { data: logs }, { data: requests }] = await Promise.all([
    getSecuritySummary(tenantId),
    logQuery,
    supabase
      .from("tax_access_requests")
      .select(
        "id, expert_id, project_id, reason, over_limit_reason, requested_by, created_at"
      )
      .eq("is_over_limit", true)
      .eq("status", "pending")
      .order("created_at", { ascending: true }),
  ]);

  const logRows = logs ?? [];
  const requestRows = requests ?? [];

  // 전문가·직원 이름은 RLS 안에서 조인 없이 한 번에 채운다.
  const expertIds = Array.from(
    new Set([
      ...logRows.map((l) => l.expert_id),
      ...requestRows.map((r) => r.expert_id),
    ])
  );
  const [{ data: experts }, { data: staff }] = await Promise.all([
    expertIds.length > 0
      ? supabase.from("experts").select("id, name").in("id", expertIds)
      : Promise.resolve({ data: [] as { id: string; name: string }[] }),
    supabase.from("users").select("id, name"),
  ]);
  const expertNameById = new Map((experts ?? []).map((e) => [e.id, e.name]));
  const staffNameById = new Map((staff ?? []).map((u) => [u.id, u.name]));

  const quotaRows = foldQuotaRows(logRows, expertNameById);
  const pendingRequests: PendingRequest[] = requestRows.map((r) => ({
    id: r.id,
    expertName: expertNameById.get(r.expert_id) ?? "전문가",
    projectName: r.project_id ? "프로젝트 건" : "프로젝트 미연결",
    reason: r.reason,
    overLimitReason: r.over_limit_reason,
    requesterName: r.requested_by
      ? staffNameById.get(r.requested_by) ?? "(지정자)"
      : "(지정자)",
    createdAt: r.created_at,
  }));

  const exportHref = `/${params.tenantSlug}/admin/org/security/export${
    from || to ? `?from=${from}&to=${to}` : ""
  }`;

  return (
    <div className="min-h-screen bg-secondary/50">
      <PageHeader
        title="보안 현황"
        actions={
          <div className="flex items-center gap-2">
            <Button asChild variant="outline" size="sm">
              <a href={exportHref}>조회 이력 엑셀</a>
            </Button>
            <Button asChild variant="ghost" size="sm">
              <Link href={`/${params.tenantSlug}/admin/org/audit`}>감사로그</Link>
            </Button>
            <Button asChild variant="ghost" size="sm">
              <Link href={`/${params.tenantSlug}/admin/org`}>기업 관리로</Link>
            </Button>
          </div>
        }
      />
      <main className="space-y-5 p-5">
        {summary.lockdown.locked && (
          <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-4">
            <ShieldAlert className="mt-0.5 h-5 w-5 flex-none text-destructive" aria-hidden />
            <div className="text-sm">
              <p className="font-semibold text-destructive">
                주민등록번호 조회가 전체 잠금 상태입니다
              </p>
              <p className="mt-1 text-muted-foreground">
                {summary.lockdown.byUs
                  ? "자사에서 비정상 접근이 감지되어 잠금이 발생했습니다."
                  : "플랫폼 차원의 보안 점검으로 잠금되었습니다."}{" "}
                {summary.lockdown.triggeredAt &&
                  `발생 ${new Date(summary.lockdown.triggeredAt).toLocaleString("ko-KR", {
                    timeZone: "Asia/Seoul",
                  })} · `}
                해제는 캐스트로그 운영자만 할 수 있습니다. 지원으로 문의해 주세요.
              </p>
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <SummaryTile
            label="조회 잠금"
            value={summary.lockdown.locked ? "잠김" : "정상"}
            tone={summary.lockdown.locked ? "bad" : "good"}
            icon={summary.lockdown.locked ? ShieldAlert : ShieldCheck}
          />
          <SummaryTile
            label="조회 키"
            value={summary.keyConfigured ? "설정됨" : "미설정"}
            tone={summary.keyConfigured ? "good" : "warn"}
            icon={KeyRound}
          />
          <SummaryTile
            label="시간당 상한 잠금"
            value={`${summary.rateLockedDesignees}명`}
            tone={summary.rateLockedDesignees > 0 ? "warn" : "good"}
            icon={Lock}
          />
          <SummaryTile
            label="최근 30일 조회"
            value={`${summary.recentAccessCount}건`}
            tone="neutral"
          />
          <SummaryTile
            label="한도 초과 조회"
            value={`${summary.overLimitAccessCount}건`}
            tone={summary.overLimitAccessCount > 0 ? "warn" : "good"}
          />
        </div>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">
              초과 조회 승인 대기 ({summary.pendingRequestCount})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="mb-3 text-xs leading-relaxed text-muted-foreground">
              프로젝트당 {RRN_PROJECT_LIMIT}회를 넘는 조회는 <b>차단하지 않되</b> 사유
              기재와 대표 승인을 거칩니다(세무조사·경정청구 등 정당한 초과가 실제로
              발생하기 때문입니다). 승인 1건은 조회 1회분이며, 조회가 이뤄지면
              소진되고 전문가 본인에게 초과 사실이 통지됩니다.
            </p>
            <OverLimitPanel requests={pendingRequests} canDecide={isCeo} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">
              프로젝트별 한도 사용 현황 (표시 구간 기준)
            </CardTitle>
          </CardHeader>
          <CardContent>
            {quotaRows.length === 0 ? (
              <p className="text-sm text-muted-foreground">조회 기록이 없습니다.</p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>프로젝트</TableHead>
                      <TableHead>전문가</TableHead>
                      <TableHead className="text-right">조회</TableHead>
                      <TableHead>상태</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {quotaRows.map((q) => (
                      <TableRow key={`${q.projectId ?? "-"}-${q.expertId}`}>
                        <TableCell className="text-sm">{q.projectName}</TableCell>
                        <TableCell className="text-sm">{q.expertName}</TableCell>
                        <TableCell className="text-right text-sm tabular-nums">
                          {q.used} / {q.limit}
                        </TableCell>
                        <TableCell>
                          {q.used > q.limit ? (
                            <Badge variant="destructive">한도 초과</Badge>
                          ) : q.used === q.limit ? (
                            <Badge variant="secondary">한도 도달</Badge>
                          ) : (
                            <span className="text-xs text-muted-foreground">여유</span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">주민등록번호 조회 이력</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <form method="get" className="flex flex-wrap items-end gap-3">
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">시작일</label>
                <Input type="date" name="from" defaultValue={from} className="h-9 w-40" />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">종료일</label>
                <Input type="date" name="to" defaultValue={to} className="h-9 w-40" />
              </div>
              <Button type="submit" size="sm">
                조회
              </Button>
              {(from || to) && (
                <Button asChild variant="ghost" size="sm">
                  <Link href={`/${params.tenantSlug}/admin/org/security`}>초기화</Link>
                </Button>
              )}
            </form>

            {logRows.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                해당 구간에 조회 기록이 없습니다. 전체 누적 {summary.totalAccessCount}건.
              </p>
            ) : (
              <>
                <p className="text-sm text-muted-foreground">
                  {logRows.length}건 표시 (최대 {LOG_LIMIT}건) · 전체 누적{" "}
                  {summary.totalAccessCount}건
                </p>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>조회 시각</TableHead>
                        <TableHead>전문가</TableHead>
                        <TableHead>프로젝트</TableHead>
                        <TableHead>사유</TableHead>
                        <TableHead>형태</TableHead>
                        <TableHead>조회자</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {logRows.map((log) => (
                        <TableRow key={log.id}>
                          <TableCell className="whitespace-nowrap text-sm">
                            {new Date(log.accessed_at).toLocaleString("ko-KR", {
                              timeZone: "Asia/Seoul",
                              month: "numeric",
                              day: "numeric",
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-sm">
                            {expertNameById.get(log.expert_id) ?? "전문가"}
                            {log.is_over_limit && (
                              <Badge variant="destructive" className="ml-1.5">
                                한도 초과
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {log.project_name ??
                              (log.project_id ? "(프로젝트)" : "프로젝트 미연결")}
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-sm">
                            {rrnAccessReasonLabel(log.reason)}
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                            {rrnAccessTypeLabel(log.access_type)}
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-sm">
                            {log.accessor_label ?? "-"}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}

function SummaryTile({
  label,
  value,
  tone,
  icon: Icon,
}: {
  label: string;
  value: string;
  tone: "good" | "warn" | "bad" | "neutral";
  icon?: typeof ShieldCheck;
}) {
  const toneClass =
    tone === "bad"
      ? "text-destructive"
      : tone === "warn"
        ? "text-amber-700"
        : tone === "good"
          ? "text-green-700"
          : "text-brand-navy";
  return (
    <div className="rounded-lg border bg-white p-3">
      <p className="flex items-center gap-1 text-xs text-muted-foreground">
        {Icon && <Icon className="h-3.5 w-3.5" aria-hidden />}
        {label}
      </p>
      <p className={`mt-1 text-lg font-bold ${toneClass}`}>{value}</p>
    </div>
  );
}
