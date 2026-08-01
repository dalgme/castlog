import Link from "next/link";

import { requireRole } from "@/lib/auth/session";
import { getTenantModules } from "@/lib/modules/server";
import { createClient } from "@/lib/supabase/server";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { formatKrw } from "@/lib/approvals/constants";
import { PageHeader } from "@/components/layout/header";
import { EmptyState } from "@/components/layout/empty-state";
import { Card, CardContent } from "@/components/ui/card";

export const metadata = { title: "대시보드" };

function StatCard({
  label,
  value,
  sub,
  href,
}: {
  label: string;
  value: string;
  sub?: string;
  href?: string;
}) {
  const body = (
    <Card className={href ? "transition-colors hover:border-brand/50" : ""}>
      <CardContent className="pt-5">
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        <p className="mt-1 text-2xl font-extrabold">{value}</p>
        {sub && <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>}
      </CardContent>
    </Card>
  );
  return href ? <Link href={href}>{body}</Link> : body;
}

/**
 * 테넌트 대시보드 — 사업연도 축 통계 (CLAUDE.md 12-7).
 * 활성 모듈의 카드만 표시한다 (모듈 구조 1-2).
 */
export default async function DashboardPage({
  params,
  searchParams,
}: {
  params: { tenantSlug: string };
  searchParams: { year?: string };
}) {
  await requireRole(["platform_admin", "org_admin", "manager", "staff"]);

  if (!hasSupabaseEnv()) {
    return (
      <>
        <PageHeader title="대시보드" />
        <main className="p-5">
          <EmptyState
            title="서버 설정 대기 중"
            description="Supabase 환경변수가 설정되면 현황이 표시됩니다."
          />
        </main>
      </>
    );
  }

  const currentYear = new Date().getFullYear();
  const year = /^\d{4}$/.test(searchParams.year ?? "")
    ? parseInt(searchParams.year!, 10)
    : currentYear;
  const yearStart = `${year}-01-01T00:00:00Z`;
  const yearEnd = `${year + 1}-01-01T00:00:00Z`;

  const supabase = createClient();
  const modules = await getTenantModules();
  const slug = params.tenantSlug;

  // 모듈별 통계 병렬 조회 (count는 head 요청 — 데이터 미전송)
  const [
    projectsTotal,
    projectsActive,
    expertsLinked,
    engagementsAccepted,
    approvalsInProgress,
    approvalsCompleted,
    batchesConfirmed,
  ] = await Promise.all([
    modules.operations
      ? supabase
          .from("projects")
          .select("id", { count: "exact", head: true })
          .eq("business_year", year)
      : Promise.resolve({ count: null }),
    modules.operations
      ? supabase
          .from("projects")
          .select("id", { count: "exact", head: true })
          .eq("business_year", year)
          .eq("status", "active")
      : Promise.resolve({ count: null }),
    modules.experts
      ? supabase
          .from("expert_tenant_links")
          .select("id", { count: "exact", head: true })
          .eq("status", "active")
      : Promise.resolve({ count: null }),
    modules.experts
      ? supabase
          .from("expert_engagements")
          .select("id", { count: "exact", head: true })
          .eq("status", "accepted")
          .gte("created_at", yearStart)
          .lt("created_at", yearEnd)
      : Promise.resolve({ count: null }),
    modules.approvals
      ? supabase
          .from("approvals")
          .select("id", { count: "exact", head: true })
          .eq("status", "in_progress")
      : Promise.resolve({ count: null }),
    modules.approvals
      ? supabase
          .from("approvals")
          .select("id", { count: "exact", head: true })
          .eq("status", "approved")
          .gte("completed_at", yearStart)
          .lt("completed_at", yearEnd)
      : Promise.resolve({ count: null }),
    modules.experts
      ? supabase
          .from("expert_payment_batches")
          .select("total_gross, total_net, status")
          .in("status", ["confirmed", "paid"])
          .gte("created_at", yearStart)
          .lt("created_at", yearEnd)
      : Promise.resolve({ data: null }),
  ]);

  const paymentRows =
    "data" in batchesConfirmed ? (batchesConfirmed.data ?? []) : [];
  const paymentTotals = paymentRows.reduce(
    (acc, b) => ({
      gross: acc.gross + b.total_gross,
      net: acc.net + b.total_net,
    }),
    { gross: 0, net: 0 }
  );

  const yearOptions = [currentYear + 1, currentYear, currentYear - 1, currentYear - 2];

  return (
    <>
      <PageHeader
        title="대시보드"
        actions={
          <div className="flex items-center gap-1">
            {yearOptions.map((y) => (
              <Link
                key={y}
                href={`/${slug}/dashboard?year=${y}`}
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
          {year}년 사업연도 기준 현황입니다.
        </p>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {modules.operations && (
            <>
              <StatCard
                label={`${year}년 프로젝트`}
                value={String(("count" in projectsTotal ? projectsTotal.count : 0) ?? 0)}
                sub={`진행중 ${("count" in projectsActive ? projectsActive.count : 0) ?? 0}건`}
                href={`/${slug}/projects`}
              />
            </>
          )}
          {modules.experts && (
            <>
              <StatCard
                label="연결 전문가"
                value={String(("count" in expertsLinked ? expertsLinked.count : 0) ?? 0)}
                sub="활성 연결 기준"
                href={`/${slug}/experts`}
              />
              <StatCard
                label={`${year}년 섭외 성사`}
                value={String(
                  ("count" in engagementsAccepted ? engagementsAccepted.count : 0) ?? 0
                )}
                sub="수락(계약 성립) 건"
              />
            </>
          )}
          {modules.approvals && (
            <StatCard
              label="결재 진행중"
              value={String(
                ("count" in approvalsInProgress ? approvalsInProgress.count : 0) ?? 0
              )}
              sub={`${year}년 승인 완료 ${("count" in approvalsCompleted ? approvalsCompleted.count : 0) ?? 0}건`}
              href={`/${slug}/approvals`}
            />
          )}
        </div>

        {modules.experts && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <StatCard
              label={`${year}년 확정 지급 건`}
              value={`${paymentRows.length}건`}
              href={`/${slug}/payments`}
            />
            <StatCard
              label="확정 총비용"
              value={formatKrw(paymentTotals.gross)}
              sub="원천징수 포함 (참고)"
            />
            <StatCard
              label="확정 실지급액"
              value={formatKrw(paymentTotals.net)}
            />
          </div>
        )}

        {!modules.operations && !modules.experts && !modules.approvals && (
          <EmptyState
            title="활성화된 모듈이 없습니다"
            description="플랫폼 관리자에게 모듈 활성화를 요청하세요."
          />
        )}
      </main>
    </>
  );
}
