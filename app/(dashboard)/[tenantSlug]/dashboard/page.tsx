import Link from "next/link";

import { requireRole } from "@/lib/auth/session";
import { gradeFromUser } from "@/lib/auth/tenant";
import { canViewAllProjects, gradeLabel, gradeRank } from "@/lib/auth/grades";
import { getTenantModules, isExpertsLite } from "@/lib/modules/server";
import { canManagePayments } from "@/lib/auth/admin-scopes";
import { getTenantDashboard } from "@/lib/integrations/tenant-dashboard";
import { getMyWork } from "@/lib/integrations/my-work";
import { getUrgentCancellations } from "@/lib/integrations/urgent-cancellations";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { formatKrw } from "@/lib/approvals/constants";
import { PROJECT_STATUS_LABELS } from "@/lib/operations/steps";
import { PageHeader } from "@/components/layout/header";
import { EmptyState } from "@/components/layout/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { UrgentCancelMarquee } from "@/components/integrations/urgent-cancel-marquee";
import { createClient } from "@/lib/supabase/server";
import {
  ProjectCalendarWidget,
  type WidgetSession,
} from "./project-calendar-widget";
import { BarList } from "@/components/charts/bar-list";
import { Donut } from "@/components/charts/donut";

export const metadata = { title: "대시보드" };

/** 프로젝트 진행 현황 목록에 한 번에 보여 줄 최대 건수 */
const PROGRESS_ROW_LIMIT = 8;

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
    <Card className={href ? "h-full transition-colors hover:border-brand/50" : "h-full"}>
      <CardContent className="pt-5">
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        <p className="mt-1 text-2xl font-extrabold">{value}</p>
        {sub && <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>}
      </CardContent>
    </Card>
  );
  return href ? <Link href={href}>{body}</Link> : body;
}

/** 비용 묶음 안의 한 줄 — 금액은 오른쪽 정렬로 자릿수를 맞춘다 */
function MoneyRow({
  label,
  amount,
  note,
  strong,
}: {
  label: string;
  amount: number;
  note?: string;
  strong?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5 text-sm">
      <span className={strong ? "font-semibold" : "text-muted-foreground"}>
        {label}
        {note && (
          <span className="ml-1.5 text-xs font-normal text-muted-foreground">
            {note}
          </span>
        )}
      </span>
      <span
        className={
          strong
            ? "shrink-0 tabular-nums font-extrabold"
            : "shrink-0 tabular-nums font-medium"
        }
      >
        {formatKrw(amount)}
      </span>
    </div>
  );
}

const STATUS_COLORS: Record<string, string> = {
  active: "hsl(var(--brand))",
  planned: "hsl(var(--brand-sky))",
  on_hold: "hsl(var(--brand-amber))",
  completed: "hsl(var(--brand-navy))",
  cancelled: "hsl(var(--destructive))",
};

/**
 * 테넌트 대시보드 — 보는 사람의 등급에 따라 무엇을 먼저 보여 줄지 달라진다.
 *
 *  · 대표·이사   전사 통계·비용 총괄이 본업이다. 그래프 중심으로 전체를 편다.
 *  · 팀장        맡은 프로젝트의 진행과 비용. 통계는 자기 범위 안에서만 뜬다
 *                (RLS가 이미 범위를 좁힌다 — 화면에서 따로 거르지 않는다).
 *  · 대리 이하   통계보다 '오늘 내가 할 일'이 먼저다. 마감·결재 대기부터 띄운다.
 *
 * 집계 자체는 한 벌(getTenantDashboard)이고 배치만 다르다. 등급별로 집계를 따로
 * 만들면 한쪽만 고쳐지는 사고가 난다.
 */
export default async function DashboardPage({
  params,
  searchParams,
}: {
  params: { tenantSlug: string };
  searchParams: { year?: string };
}) {
  const user = await requireRole([
    "platform_admin",
    "org_admin",
    "manager",
    "staff",
  ]);

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

  const slug = params.tenantSlug;
  const grade = gradeFromUser(user);
  // 대표·이사 = 전사 축. 팀장 이하는 배정분만 보이므로 같은 화면이 자연히 좁아진다.
  const isExecutive = canViewAllProjects(grade);
  // 대리 이하 — 통계보다 개인 업무가 먼저 오는 배치
  const isJunior = grade !== null && gradeRank(grade) < gradeRank("team_lead");

  const modules = await getTenantModules();
  const [data, payments, myWork, urgentCancels, expertsLite] = await Promise.all([
    getTenantDashboard(year, modules),
    canManagePayments(),
    getMyWork(user?.id ?? "", slug, modules),
    // 확정 전문가의 갑작스러운 취소는 전 임직원이 즉시 알아야 한다
    modules.experts ? getUrgentCancellations() : Promise.resolve([]),
    isExpertsLite(),
  ]);

  const yearOptions = [currentYear + 1, currentYear, currentYear - 1, currentYear - 2];

  // ── 나의 프로젝트 캘린더 (기획 확정 2026-08-30 — 33번) ────────────────
  // RLS가 열람 범위를 정한다: 팀장 이하 = 배정 프로젝트만 → 자동으로 '나의'
  // 캘린더. 대표·이사 = 전사 → 탭으로 [내 프로젝트/전체/직원별]을 오간다.
  const supabase = createClient();
  const todayIso = new Date(Date.now() + 9 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10); // KST 기준 오늘
  // 월간 그리드 내비게이션 범위 — 지난달 1일 ~ 3개월 뒤 말일
  const kstNow = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const rangeStartDate = new Date(
    Date.UTC(kstNow.getUTCFullYear(), kstNow.getUTCMonth() - 1, 1)
  );
  const rangeEndDate = new Date(
    Date.UTC(kstNow.getUTCFullYear(), kstNow.getUTCMonth() + 4, 0)
  );
  const rangeStart = rangeStartDate.toISOString().slice(0, 10);
  const rangeEnd = rangeEndDate.toISOString().slice(0, 10);
  // 컨설팅 세션(34번)은 수행기간 전체를 그린다 — period_end_date 포함.
  // 범위는 시작일 기준(기간이 범위 앞에서 시작해 걸쳐 들어오는 건 다음 개선).
  const CALENDAR_LIMIT = 400;
  const [slotResult, myAssignResult, allAssignResult, staffResult] =
    await Promise.all([
      supabase
        .from("engagement_slots")
        .select(
          "id, project_id, slot_date, period_end_date, starts_time, ends_time, session_name"
        )
        .gte("slot_date", rangeStart)
        .lte("slot_date", rangeEnd)
        .order("slot_date", { ascending: true })
        .order("starts_time", { ascending: true })
        .limit(CALENDAR_LIMIT),
      supabase
        .from("project_assignments")
        .select("project_id")
        .eq("user_id", user?.id ?? ""),
      // 직원별 탭용 — 대표·이사만 (팀장 이하는 자기 배정만 RLS로 보인다)
      isExecutive
        ? supabase.from("project_assignments").select("project_id, user_id")
        : Promise.resolve({ data: [] as { project_id: string; user_id: string }[] }),
      isExecutive
        ? supabase
            .from("users")
            .select("id, name")
            .eq("is_active", true)
            .order("name", { ascending: true })
        : Promise.resolve({ data: [] as { id: string; name: string }[] }),
    ]);
  const calendarProjectIds = Array.from(
    new Set((slotResult.data ?? []).map((sl) => sl.project_id))
  );
  const { data: calendarProjects } = calendarProjectIds.length
    ? await supabase
        .from("projects")
        .select("id, name, status")
        .in("id", calendarProjectIds)
    : { data: [] as { id: string; name: string; status: string }[] };
  const calProjectById = new Map(
    (calendarProjects ?? []).map((pr) => [pr.id, pr])
  );
  const calendarSessions: WidgetSession[] = (slotResult.data ?? [])
    // 보관(취소) 프로젝트 일정은 캘린더에서 뺀다 (16번 확정과 동일 원칙)
    .filter((sl) => {
      const pr = calProjectById.get(sl.project_id);
      return pr !== undefined && pr.status !== "cancelled";
    })
    .map((sl) => ({
      id: sl.id,
      projectId: sl.project_id,
      projectName: calProjectById.get(sl.project_id)?.name ?? "(프로젝트)",
      date: sl.slot_date,
      endDate: sl.period_end_date ?? null,
      startsTime: sl.starts_time,
      endsTime: sl.ends_time,
      name: sl.session_name,
    }));
  // 400건 절단 — 조용히 빠지면 "일정이 없다"로 오독한다 (감사 P3-5)
  const calendarTruncated = (slotResult.data ?? []).length >= CALENDAR_LIMIT;
  const myProjectIds = Array.from(
    new Set((myAssignResult.data ?? []).map((a) => a.project_id))
  );
  const projectsByUser: Record<string, string[]> = {};
  for (const a of allAssignResult.data ?? []) {
    (projectsByUser[a.user_id] ??= []).push(a.project_id);
  }

  const statusSlices = Object.entries(data.projects.byStatus)
    .map(([status, count]) => ({
      label: PROJECT_STATUS_LABELS[status] ?? status,
      value: count,
      color: STATUS_COLORS[status] ?? "hsl(var(--muted-foreground))",
    }))
    .sort((a, b) => b.value - a.value);

  const progressRows = data.projects.rows.slice(0, PROGRESS_ROW_LIMIT);
  const budgetUsedPct =
    data.cost.budgetTotal > 0
      ? Math.round(
          ((data.cost.confirmedCost + data.cost.requestedCost) /
            data.cost.budgetTotal) *
            100
        )
      : null;

  // 비용 묶음은 지급 권한자에게만 전액을 편다 (finance 위임 — CLAUDE.md §3-1)
  const showCost = payments || isExecutive;

  const myWorkCard = (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
        <CardTitle className="text-sm">내 업무</CardTitle>
        <Button asChild variant="ghost" size="sm">
          <Link href={`/${slug}/my-work`}>전체 보기</Link>
        </Button>
      </CardHeader>
      <CardContent>
        <div
          className={`grid gap-3 text-center ${
            modules.approvals ? "grid-cols-4" : "grid-cols-3"
          }`}
        >
          <div>
            <p className="text-2xl font-extrabold text-destructive">
              {myWork.overdue.length}
            </p>
            <p className="text-xs text-muted-foreground">기한 지남</p>
          </div>
          <div>
            <p className="text-2xl font-extrabold text-brand-amber">
              {myWork.dueSoon.length}
            </p>
            <p className="text-xs text-muted-foreground">마감 임박</p>
          </div>
          <div>
            <p className="text-2xl font-extrabold">
              {myWork.awaitingReply.length}
            </p>
            <p className="text-xs text-muted-foreground">회신 대기 섭외</p>
          </div>
          {/* 내 결재 차례 — 배정이 없는 대표에게도 보이는 유일한 신호 (검수 A3).
              전자결재 미사용 회사에는 0만 보이는 칸을 두지 않는다 */}
          {modules.approvals && (
            <div>
              <p
                className={`text-2xl font-extrabold ${
                  myWork.myApprovals.length > 0 ? "text-brand" : ""
                }`}
              >
                {myWork.myApprovals.length}
              </p>
              <p className="text-xs text-muted-foreground">내 결재 차례</p>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );

  return (
    <>
      <UrgentCancelMarquee items={urgentCancels} tenantSlug={slug} />
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
        {/* 나의 프로젝트 캘린더 — 첫 화면 최상단 (33번) */}
        <ProjectCalendarWidget
          tenantSlug={slug}
          sessions={calendarSessions}
          myProjectIds={myProjectIds}
          isExecutive={isExecutive}
          staff={staffResult.data ?? []}
          projectsByUser={projectsByUser}
          todayIso={todayIso}
          rangeStart={rangeStart}
          rangeEnd={rangeEnd}
          truncated={calendarTruncated}
        />
        <p className="text-sm text-muted-foreground">
          {year}년 사업연도 기준 현황입니다.
          {!isExecutive && " 배정된 프로젝트만 집계됩니다."}
          {grade && (
            <span className="ml-1.5 text-xs">({gradeLabel(grade)} 화면)</span>
          )}
        </p>

        {/* 대리 이하 — 오늘 할 일부터 */}
        {isJunior && myWorkCard}

        {/* ---- 요약 숫자 ---------------------------------------------------- */}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard
            label={`${year}년 프로젝트`}
            value={`${data.projects.total}건`}
            sub={`진행중 ${data.projects.byStatus.active ?? 0} · 완료 ${
              data.projects.byStatus.completed ?? 0
            }`}
            href={`/${slug}/projects`}
          />
          {data.experts && (
            <>
              <StatCard
                label="연결 전문가"
                value={`${data.experts.linked}명`}
                sub="활성 연결 기준"
                href={`/${slug}/experts`}
              />
              <StatCard
                label={`${year}년 섭외 확정`}
                value={`${data.experts.engagements.accepted}건`}
                sub={`요청 중 ${data.experts.engagements.requested}건`}
                href={`/${slug}/experts/engagements`}
              />
            </>
          )}
          {data.approvals && (
            <StatCard
              label="결재 진행중"
              value={`${data.approvals.inProgress}건`}
              sub={`${year}년 승인 ${data.approvals.approvedThisYear} · 반려 ${data.approvals.rejectedThisYear}`}
              href={`/${slug}/approvals`}
            />
          )}
        </div>

        {/* ---- 프로젝트 진행 현황 (그래프) ------------------------------------ */}
        <div className="grid gap-3 lg:grid-cols-2">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">프로젝트 상태 구성</CardTitle>
            </CardHeader>
            <CardContent>
              {data.projects.total === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {year}년 프로젝트가 없습니다.
                </p>
              ) : (
                <Donut
                  slices={statusSlices}
                  centerValue={String(data.projects.total)}
                  centerLabel="전체"
                />
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">프로젝트 카테고리 구성</CardTitle>
            </CardHeader>
            <CardContent>
              <BarList
                items={data.categories.map((c) => ({
                  label: c.name,
                  value: c.count,
                  display: `${c.count}건`,
                  tone: c.name === "미지정" ? "gray" : "brand",
                }))}
                emptyText={`${year}년 프로젝트가 없습니다.`}
              />
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
            <CardTitle className="text-sm">
              프로젝트 진행률 (21스텝 기준)
            </CardTitle>
            {data.projects.rows.length > PROGRESS_ROW_LIMIT && (
              <Button asChild variant="ghost" size="sm">
                <Link href={`/${slug}/projects`}>
                  진행 {data.projects.rows.length}건
                </Link>
              </Button>
            )}
          </CardHeader>
          <CardContent>
            {progressRows.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                표시할 프로젝트가 없습니다.
              </p>
            ) : (
              <ul className="space-y-3">
                {progressRows.map((row) => (
                  <li key={row.id}>
                    <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
                      <Link
                        href={`/${slug}/projects/${row.id}`}
                        className="truncate font-medium text-brand underline-offset-4 hover:underline"
                      >
                        {row.name}
                      </Link>
                      <span className="flex shrink-0 items-center gap-2">
                        <Badge variant="secondary">
                          {PROJECT_STATUS_LABELS[row.status] ?? row.status}
                        </Badge>
                        <span className="tabular-nums text-xs text-muted-foreground">
                          {row.progress === null ? "스텝 없음" : `${row.progress}%`}
                        </span>
                      </span>
                    </div>
                    <div className="mt-1 h-2 overflow-hidden rounded-full bg-secondary">
                      <div
                        className="h-full rounded-full bg-brand"
                        style={{ width: `${row.progress ?? 0}%` }}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {/* 보관(취소) 건 — 진행 목록과 섞지 않고 분리 표시 (기획 2026-08-30).
                집계(상태 구성·예산)에는 그대로 포함되어 있다 */}
            {data.projects.archivedRows.length > 0 && (
              <details className="mt-4 rounded-md border bg-secondary/40 p-3">
                <summary className="cursor-pointer text-xs font-semibold text-muted-foreground">
                  보관(취소) 처리 {data.projects.archivedRows.length}건 — 설정
                  &gt; 프로젝트 보관에서 관리
                </summary>
                <ul className="mt-2 space-y-1 text-sm">
                  {data.projects.archivedRows.map((row) => (
                    <li key={row.id} className="flex items-baseline gap-2">
                      <Link
                        href={`/${slug}/projects/${row.id}`}
                        className="truncate text-muted-foreground underline-offset-4 hover:underline"
                      >
                        {row.name}
                      </Link>
                      <Badge variant="outline" className="text-[10px]">
                        보관(취소)
                      </Badge>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </CardContent>
        </Card>

        {/* ---- 비용 묶음 ------------------------------------------------------ */}
        {showCost && (
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
              <CardTitle className="text-sm">{year}년 비용 현황</CardTitle>
              {modules.experts && payments && !expertsLite && (
                <Button asChild variant="ghost" size="sm">
                  <Link href={`/${slug}/payments`}>지급 관리</Link>
                </Button>
              )}
            </CardHeader>
            <CardContent className="grid gap-6 lg:grid-cols-2">
              <div>
                <p className="mb-1 text-xs font-semibold text-muted-foreground">
                  예산 대비 집행
                </p>
                <div className="divide-y">
                  <MoneyRow label="총 예산" amount={data.cost.budgetTotal} strong />
                  <MoneyRow
                    label="계획 섭외비"
                    amount={data.cost.plannedCost}
                    note="세션 × 필요인원"
                  />
                  <MoneyRow
                    label="확정 섭외비"
                    amount={data.cost.confirmedCost}
                    note="수락 완료"
                  />
                  <MoneyRow
                    label="요청 중"
                    amount={data.cost.requestedCost}
                    note="수락 대기"
                  />
                </div>
                {budgetUsedPct !== null && (
                  <div className="mt-3">
                    <div className="flex items-baseline justify-between text-xs">
                      <span className="text-muted-foreground">
                        예산 소진율 (확정 + 요청 중)
                      </span>
                      <span
                        className={
                          budgetUsedPct > 100
                            ? "font-bold text-destructive"
                            : "font-bold"
                        }
                      >
                        {budgetUsedPct}%
                      </span>
                    </div>
                    <div className="mt-1 h-2.5 overflow-hidden rounded-full bg-secondary">
                      <div
                        className={
                          budgetUsedPct > 100
                            ? "h-full rounded-full bg-destructive"
                            : "h-full rounded-full bg-brand"
                        }
                        style={{ width: `${Math.min(100, budgetUsedPct)}%` }}
                      />
                    </div>
                  </div>
                )}
                {modules.experts && (
                  <div className="mt-4">
                    <p className="mb-1 text-xs font-semibold text-muted-foreground">
                      지급 확정
                    </p>
                    <div className="divide-y">
                      <MoneyRow
                        label="확정 총비용"
                        amount={data.cost.paidGross}
                        note={`${data.cost.paidBatches}건 · 원천징수 포함`}
                      />
                      <MoneyRow
                        label="실지급액"
                        amount={data.cost.paidNet}
                        strong
                      />
                    </div>
                  </div>
                )}
              </div>

              <div>
                <p className="mb-2 text-xs font-semibold text-muted-foreground">
                  프로젝트별 확정 섭외비
                </p>
                <BarList
                  items={progressRows
                    .filter((r) => r.confirmedCost + r.requestedCost > 0)
                    .map((r) => ({
                      label: r.name,
                      value: r.confirmedCost,
                      display: formatKrw(r.confirmedCost),
                      tone: r.budget > 0 && r.confirmedCost > r.budget
                        ? ("amber" as const)
                        : ("navy" as const),
                    }))}
                  emptyText="확정된 섭외비가 없습니다."
                />
                <p className="mt-3 text-xs text-muted-foreground">
                  예산을 넘긴 프로젝트는 막대가 주황으로 표시됩니다. 금액은 섭외
                  수락 시점의 의뢰비용 기준이며, 실제 지급액은 지급 확정 단계에서
                  정해집니다.
                </p>
              </div>
            </CardContent>
          </Card>
        )}

        {/* ---- 섭외 현황 ------------------------------------------------------ */}
        {data.experts && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">{year}년 섭외 결과 구성</CardTitle>
            </CardHeader>
            <CardContent>
              <Donut
                slices={[
                  {
                    label: "수락(확정)",
                    value: data.experts.engagements.accepted,
                    color: "hsl(var(--brand))",
                  },
                  {
                    label: "요청 중",
                    value: data.experts.engagements.requested,
                    color: "hsl(var(--brand-sky))",
                  },
                  {
                    label: "거절",
                    value: data.experts.engagements.declined,
                    color: "hsl(var(--brand-amber))",
                  },
                  {
                    label: "취소",
                    value: data.experts.engagements.canceled,
                    color: "hsl(var(--destructive))",
                  },
                ]}
                centerValue={String(
                  data.experts.engagements.accepted +
                    data.experts.engagements.requested +
                    data.experts.engagements.declined +
                    data.experts.engagements.canceled
                )}
                centerLabel="섭외 건"
              />
            </CardContent>
          </Card>
        )}

        {/* 팀장 이상 — 통계를 먼저 보고 개인 업무는 아래에 둔다 */}
        {!isJunior && myWorkCard}
      </main>
    </>
  );
}
