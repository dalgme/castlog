import Link from "next/link";
import { Inbox, ArrowRight } from "lucide-react";

import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { LogoMark } from "@/components/brand/logo";
import { PortalHeader } from "@/components/expert/portal-header";
import { PeriodSelector } from "@/components/expert/period-selector";
import {
  resolvePeriod,
  inRange,
  type PeriodParams,
} from "@/lib/experts/stats-period";
import { PageHeader } from "@/components/layout/header";
import { EmptyState } from "@/components/layout/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export const metadata = { title: "전문가 포털" };

const won = (value: number | null | undefined) =>
  `${(value ?? 0).toLocaleString("ko-KR")}원`;

function StatTile({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded-xl border bg-secondary/70 p-3.5">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-lg font-bold tabular-nums text-brand-navy">
        {value}
      </p>
      {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

/**
 * 전문가 포털 대시보드 — 로그인 직후 "현재 상태별" 요약 (설계문서 3.2, 8.1).
 * CASTLOG 브랜드 히어로 + 가장 급한 대기중 섭외를 최상단에, 그 아래 활동 통계.
 * 전 기업 통합 이력 기준. 모바일 완전 대응 최우선.
 */
export default async function ExpertPortalPage({
  searchParams,
}: {
  searchParams?: PeriodParams;
}) {
  const user = await requireUser("/expert/login");
  const period = resolvePeriod(searchParams ?? {}, Date.now());

  if (!hasSupabaseEnv() || !user) {
    return (
      <div className="min-h-screen bg-muted">
        <PageHeader title="전문가 포털" />
        <main className="p-5">
          <EmptyState
            title="서버 설정 대기 중"
            description="Supabase 환경변수가 설정되면 포털이 표시됩니다."
          />
        </main>
      </div>
    );
  }

  const supabase = createClient();

  const { data: expert } = await supabase
    .from("experts")
    .select("id, name, specialty, region, career_years")
    .eq("auth_user_id", user.id)
    .maybeSingle();

  if (!expert) {
    return (
      <div className="min-h-screen bg-muted">
        <PortalHeader showTabs={false} />
        <main className="p-5">
          <EmptyState
            title="전문가 프로필이 없습니다"
            description="기업에서 받은 등록 링크로 등록을 완료하면 프로필이 생성됩니다."
          />
        </main>
      </div>
    );
  }

  const [{ data: engagements }, { data: payments }, { count: activeLinks }] =
    await Promise.all([
      supabase
        .from("expert_engagements")
        .select(
          `id, role_description, fee_amount, status, created_at, responded_at,
           starts_on, ends_on, project_id, token_expires_at,
           tenants (name), projects (name)`
        )
        .eq("expert_id", expert.id)
        .order("created_at", { ascending: false }),
      supabase
        .from("expert_portal_payments")
        .select("net_amount, withholding_amount, status, paid_at, confirmed_at, created_at")
        .limit(1000),
      supabase
        .from("expert_tenant_links")
        .select("id", { count: "exact", head: true })
        .eq("expert_id", expert.id)
        .eq("status", "active"),
    ]);

  const engagementRows = engagements ?? [];
  const paymentRows = payments ?? [];
  const now = Date.now();

  // 히어로의 "대기중 섭외"는 지금 시점 상태(기간과 무관).
  const pending = engagementRows.filter(
    (e) =>
      e.status === "requested" && new Date(e.token_expires_at).getTime() >= now
  );

  // ── 이하 통계는 선택된 기간(period) 기준으로 계산 ──
  // 섭외는 요청 접수일(created_at) 기준으로 기간 판정.
  const periodEngagements = engagementRows.filter((e) =>
    inRange(e.created_at, period)
  );
  const periodAccepted = periodEngagements.filter((e) => e.status === "accepted");

  const projectSet = new Set(
    periodAccepted.map((e) => e.project_id).filter(Boolean) as string[]
  );

  // 지급은 지급/확정 시각(paid_at→confirmed_at→created_at) 기준으로 기간 판정.
  const periodPayments = paymentRows.filter((p) =>
    inRange(p.paid_at ?? p.confirmed_at ?? p.created_at, period)
  );
  const periodRevenue = periodPayments.reduce(
    (sum, p) => sum + (p.net_amount ?? 0),
    0
  );
  const periodTax = periodPayments.reduce(
    (sum, p) => sum + (p.withholding_amount ?? 0),
    0
  );
  const acceptanceRate =
    periodEngagements.length > 0
      ? Math.round((periodAccepted.length / periodEngagements.length) * 100)
      : 0;

  const profileLine = [
    expert.specialty,
    expert.region,
    expert.career_years != null ? `경력 ${expert.career_years}년` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="min-h-screen bg-muted">
      <PortalHeader />
      <main className="mx-auto max-w-4xl space-y-5 p-4 sm:p-6">
        {/* 브랜드 히어로 — 인사 + 오늘의 섭외 상태 */}
        <section className="relative overflow-hidden rounded-2xl bg-brand-navy px-6 py-7 text-white sm:px-8">
          <LogoMark
            width={190}
            height={234}
            className="pointer-events-none absolute -right-8 -top-10 opacity-[0.12]"
          />
          <div className="relative">
            <p className="text-sm text-brand-sky">전문가 섭외 포털</p>
            <h2 className="mt-1 text-xl font-bold sm:text-2xl">
              {expert.name} 전문가님, 환영합니다
            </h2>
            {profileLine && (
              <p className="mt-1 text-sm text-white/70">{profileLine}</p>
            )}

            <div className="mt-5">
              {pending.length > 0 ? (
                <div className="flex flex-wrap items-center gap-3">
                  <span className="inline-flex items-center gap-2 rounded-full bg-brand-amber px-3.5 py-1.5 text-sm font-semibold text-brand-navy">
                    <Inbox className="h-4 w-4" aria-hidden />
                    응답이 필요한 섭외 {pending.length}건
                  </span>
                  <Button
                    asChild
                    size="sm"
                    className="bg-white text-brand-navy hover:bg-white/90"
                  >
                    <Link href="/expert/engagements">
                      지금 확인하기
                      <ArrowRight className="ml-1 h-4 w-4" aria-hidden />
                    </Link>
                  </Button>
                </div>
              ) : (
                <p className="text-sm text-white/75">
                  지금 응답이 필요한 섭외 요청이 없습니다. 새 섭외가 오면 여기에서
                  가장 먼저 알려드립니다.
                </p>
              )}
            </div>
          </div>
        </section>

        {/* 가장 급한 것: 대기중 섭외 요청 (최대 3건) */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Inbox className="h-4 w-4 text-brand" aria-hidden />
              대기중 섭외 요청
              <span className="text-brand">({pending.length})</span>
            </CardTitle>
            {pending.length > 3 && (
              <Button asChild variant="ghost" size="sm">
                <Link href="/expert/engagements">더보기</Link>
              </Button>
            )}
          </CardHeader>
          <CardContent>
            {pending.length === 0 ? (
              <p className="py-2 text-sm text-muted-foreground">
                지금 응답이 필요한 섭외 요청이 없습니다.
              </p>
            ) : (
              <ul className="divide-y">
                {pending.slice(0, 3).map((e) => (
                  <li key={e.id} className="py-3">
                    <Link
                      href="/expert/engagements"
                      className="flex flex-wrap items-center gap-2"
                    >
                      <span className="text-sm font-semibold text-brand-navy">
                        {e.tenants?.name ?? "(기업)"}
                      </span>
                      {e.projects?.name && (
                        <span className="text-xs text-muted-foreground">
                          {e.projects.name}
                        </span>
                      )}
                      <Badge className="ml-auto" variant="default">
                        응답 필요
                      </Badge>
                    </Link>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {e.role_description}
                      {e.fee_amount != null && ` · ${won(e.fee_amount)}`}
                    </p>
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {(e.starts_on || e.ends_on) && (
                        <span className="rounded bg-secondary/70 px-1.5 py-0.5 text-[11px] text-muted-foreground">
                          활동 {e.starts_on ?? "?"}
                          {e.ends_on ? ` ~ ${e.ends_on}` : ""}
                        </span>
                      )}
                      <span className="rounded bg-secondary/70 px-1.5 py-0.5 text-[11px] text-muted-foreground">
                        요청 {new Date(e.created_at).toLocaleString("ko-KR")}
                      </span>
                      <span className="rounded bg-[#FFF3D6] px-1.5 py-0.5 text-[11px] font-semibold text-[#8A6A00]">
                        회신마감 {new Date(e.token_expires_at).toLocaleString("ko-KR")}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {pending.length > 0 && (
              <Button
                asChild
                variant="outline"
                size="sm"
                className="mt-3 w-full"
              >
                <Link href="/expert/engagements">섭외 요청 전체 보기</Link>
              </Button>
            )}
          </CardContent>
        </Card>

        {/* 활동 통계 — 선택 기간 기준 */}
        <Card>
          <CardHeader className="gap-3 pb-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <CardTitle className="text-base">내 활동 통계</CardTitle>
                <p className="mt-1 text-xs text-muted-foreground">
                  <span className="font-semibold text-brand">{period.label}</span>{" "}
                  기준
                </p>
              </div>
              <PeriodSelector
                preset={period.preset}
                from={period.from}
                to={period.to}
              />
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
              <StatTile
                label="참여 프로젝트"
                value={`${projectSet.size}건`}
                hint="기간 내 수락 기준"
              />
              <StatTile label="수익(실지급)" value={won(periodRevenue)} />
              <StatTile label="원천징수 합계" value={won(periodTax)} />
              <StatTile
                label="연결 기업"
                value={`${activeLinks ?? 0}곳`}
                hint="현재 기준"
              />
              <StatTile
                label="섭외 수락"
                value={`${periodAccepted.length}건`}
                hint={`요청 ${periodEngagements.length}건 중`}
              />
              <StatTile label="수락률" value={`${acceptanceRate}%`} />
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button asChild variant="outline" size="sm">
                <Link href="/expert/projects">프로젝트별 관리</Link>
              </Button>
              <Button asChild variant="outline" size="sm">
                <Link href="/expert/history">히스토리</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
