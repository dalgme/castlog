import Link from "next/link";

import { requireRole, getSessionUser } from "@/lib/auth/session";
import { canExecTenant } from "@/lib/auth/exec-policy";
import { getTenantModules, requireModule } from "@/lib/modules/server";
import { isExtraFeatureEnabled } from "@/lib/features/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { isPracticeMode } from "@/lib/practice/server";
import { formatKrMobile } from "@/lib/auth/phone";
import { resolvePage, totalPages, withParams } from "@/lib/ui/paging";
import { Pagination, SearchForm } from "@/components/layout/list-controls";
import { PageHeader } from "@/components/layout/header";
import { EmptyState } from "@/components/layout/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import { EngagementDialog } from "@/components/integrations/engagement-dialog";

import { InviteExpertDialog } from "./invite-dialog";
import { ExpertRatingCell } from "./rating-cell";
import { ExpertRecruitFieldsCell } from "./recruit-fields-cell";
import { ExpertNotesCell } from "./notes-cell";
import { ExpertRecommendDialog } from "./recommend-dialog";
import { InvitationActions } from "./invitation-actions";
import { ExpertQuickTag } from "./expert-quick-tag";
import { ExpertsTabs } from "./experts-tabs";

export const metadata = { title: "전문가" };

/** 연결 상태 표기 */
const LINK_STATUS_LABEL: Record<
  string,
  { label: string; variant: "default" | "secondary" | "destructive" | "outline" }
> = {
  active: { label: "연결됨", variant: "default" },
  pending: { label: "대기중", variant: "secondary" },
  revoked: { label: "해제됨", variant: "destructive" },
};

/**
 * 전문가 목록 (기획 재개정 2026-08-22 — 등록플랫폼 전면 공개)
 *
 * 캐스트로그는 전문가 등록플랫폼이다: 등록한 전문가는 "여러 기업이 나를
 * 찾아 섭외한다"는 기대로 등록하므로, **섭외에 필요한 정보(프로필 + 연락처)는
 * 전 테넌트에 공개**한다. 비밀정보만 게이트를 유지한다 —
 * 주민번호(프로젝트 계약 게이트)·계좌(지급 단계)·서류/이력서(전문가의 열람
 * 허용 grants)·자사 평가·등급·섭외이력(테넌트 격리).
 * - '전체': 플랫폼에 등록된 모든 전문가 / '연결됨': 관계기업에 자사가 있는 전문가
 * - 지역 / 날짜(기간) / 분야(내부용=섭외분야) / 분야(전문가용=강의분야) 필터와
 *   성명·지역·분야 정렬. 필터 선택지는 데이터에서 자동 추출.
 */
const PAGE_SIZE = 30;
const POOL_FETCH_LIMIT = 2000;

const SCOPE_FILTERS = [
  { key: "all", label: "전체" },
  { key: "linked", label: "연결됨" },
  { key: "favorite", label: "즐겨찾기" },
  { key: "vip", label: "VIP" },
] as const;

const PERIOD_FILTERS = [
  { key: "1m", label: "최근 1개월", days: 31 },
  { key: "3m", label: "최근 3개월", days: 92 },
  { key: "6m", label: "최근 6개월", days: 183 },
  { key: "1y", label: "최근 1년", days: 366 },
] as const;

const SORT_OPTIONS = [
  { key: "name", label: "성명순" },
  { key: "region", label: "지역순" },
  { key: "rfield", label: "섭외분야순" },
  { key: "efield", label: "강의분야순" },
] as const;

type SearchParams = {
  q?: string;
  scope?: string;
  region?: string;
  period?: string;
  rfield?: string;
  efield?: string;
  sort?: string;
  page?: string;
};

export default async function TenantExpertsPage({
  params,
  searchParams,
}: {
  params: { tenantSlug: string };
  searchParams?: SearchParams;
}) {
  await requireRole(["platform_admin", "org_admin", "manager", "staff"]);
  await requireModule("experts");

  if (!hasSupabaseEnv()) {
    return (
      <div>
        <PageHeader title="전문가" />
        <main className="p-5">
          <EmptyState
            title="서버 설정 대기 중"
            description="Supabase 환경변수가 설정되면 전문가 목록이 표시됩니다."
          />
        </main>
      </div>
    );
  }

  const supabase = createClient();
  const admin = createAdminClient();
  const modules = await getTenantModules();
  const practice = await isPracticeMode();
  // '코드 없이 바로 섭외(예외)'는 기본 숨김 — 관리모드에서 회사별로 연다 (기획 17)
  const directEngagementOn = await isExtraFeatureEnabled("direct_engagement");

  const basePath = `/${params.tenantSlug}/experts`;
  const query = (searchParams?.q ?? "").trim();
  const scope =
    SCOPE_FILTERS.find((s) => s.key === searchParams?.scope)?.key ?? "all";
  const regionFilter = (searchParams?.region ?? "").trim();
  const periodFilter =
    PERIOD_FILTERS.find((p) => p.key === searchParams?.period)?.key ?? "";
  const rfieldFilter = (searchParams?.rfield ?? "").trim();
  const efieldFilter = (searchParams?.efield ?? "").trim();
  const sortKey =
    SORT_OPTIONS.find((s) => s.key === searchParams?.sort)?.key ?? "name";
  const paging = resolvePage(searchParams?.page, PAGE_SIZE);

  const activeParams: Record<string, string | undefined> = {
    q: query || undefined,
    scope: scope === "all" ? undefined : scope,
    region: regionFilter || undefined,
    period: periodFilter || undefined,
    rfield: rfieldFilter || undefined,
    efield: efieldFilter || undefined,
    sort: sortKey === "name" ? undefined : sortKey,
  };
  /** 현재 조건에서 일부만 바꾼 링크 */
  const linkWith = (patch: Record<string, string | undefined>) =>
    withParams(basePath, activeParams, patch);

  // ── 데이터 로드 ──────────────────────────────────────────────────────────
  // 전체 풀은 RLS 밖(전 테넌트 공개 정책 변경)이므로 admin으로 **열람 가능한
  // 컬럼만** 명시해 가져온다. 연락처는 여기서 아예 가져오지 않는다 — 연결된
  // 전문가의 연락처만 아래 links(세션·RLS) 경유로 얻는다.
  const [
    poolResult,
    { data: linkRows },
    { data: invitations },
    { data: recruitFields },
    { data: recruitAssignments },
    { data: expertiseFieldRows },
    { data: expertiseAssignments },
  ] = await Promise.all([
    admin
      .from("experts")
      .select("id, name, phone, email, specialty, region, career_years, created_at")
      .eq("is_practice", practice)
      // 관리모드에서 이용 중지된 전문가는 공개 풀에서 제외한다 (기존 이력
      // 화면은 링크 기반 RLS 조회라 이름 표기가 유지된다)
      .eq("is_active", true)
      .order("created_at", { ascending: false })
      .limit(POOL_FETCH_LIMIT),
    supabase
      .from("expert_tenant_links")
      .select("status, experts (id)"),
    supabase
      .from("expert_invitations")
      .select("id, invited_name, invited_phone, status, expires_at, created_at")
      .eq("status", "pending")
      .order("created_at", { ascending: false })
      .limit(50),
    supabase
      .from("tenant_recruit_fields")
      .select("id, name")
      .eq("is_active", true)
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true }),
    supabase.from("expert_tenant_recruit_fields").select("expert_id, field_id"),
    admin
      .from("expertise_fields")
      .select("id, name")
      .eq("is_active", true)
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true }),
    admin.from("expert_expertise_fields").select("expert_id, field_id"),
  ]);

  // 부재 폴백 (§14-10): is_active 컬럼이 아직 없는 환경(42703)에서만 필터
  // 없이 재시도한다 — 일시 오류에까지 폴백하면 중지 제외가 무효화된다 (리뷰 12)
  let poolRows = poolResult.data;
  if (poolResult.error?.code === "42703") {
    ({ data: poolRows } = await admin
      .from("experts")
      .select("id, name, phone, email, specialty, region, career_years, created_at")
      .eq("is_practice", practice)
      .order("created_at", { ascending: false })
      .limit(POOL_FETCH_LIMIT));
  }

  // 자사 연결 상태 (RLS 범위 — 관계기업 판정)
  const linkByExpert = new Map<string, { status: string }>();
  for (const link of linkRows ?? []) {
    if (!link.experts) continue;
    const prev = linkByExpert.get(link.experts.id);
    // active > pending > revoked 우선
    if (prev && prev.status === "active") continue;
    if (prev && prev.status === "pending" && link.status === "revoked") continue;
    linkByExpert.set(link.experts.id, { status: link.status });
  }

  // 연습모드에서는 **자기 연습 테넌트에 연결된 시드 전문가만** 보인다.
  // 연습 시드는 회사마다 같은 이름(가온 강사 등)으로 생성되므로, 전 플랫폼의
  // 연습 시드를 다 보이면 동명 전문가가 여러 벌 나타난다. 실모드의 전체 풀
  // 공개 정책은 실전문가(is_practice=false)에만 적용된다.
  const visiblePool = practice
    ? (poolRows ?? []).filter((e) => linkByExpert.has(e.id))
    : (poolRows ?? []);

  // 섭외분야(내부용) — 테넌트 격리
  const recruitNameById = new Map((recruitFields ?? []).map((f) => [f.id, f.name]));
  const recruitByExpert = new Map<string, string[]>();
  for (const a of recruitAssignments ?? []) {
    const name = recruitNameById.get(a.field_id);
    if (!name) continue;
    const list = recruitByExpert.get(a.expert_id) ?? [];
    list.push(name);
    recruitByExpert.set(a.expert_id, list);
  }

  // 강의분야(전문가용) — 전역
  const expertiseNameById = new Map(
    (expertiseFieldRows ?? []).map((f) => [f.id, f.name])
  );
  const expertiseByExpert = new Map<string, string[]>();
  for (const a of expertiseAssignments ?? []) {
    const name = expertiseNameById.get(a.field_id);
    if (!name) continue;
    const list = expertiseByExpert.get(a.expert_id) ?? [];
    list.push(name);
    expertiseByExpert.set(a.expert_id, list);
  }

  // ── 필터 ────────────────────────────────────────────────────────────────
  // 등급(즐겨찾기·VIP)은 필터와 이름 앞 별·VIP 버튼에 쓰므로 페이지 전 범위로
  // 미리 읽는다 (자사 태그 전체 — RLS 테넌트 격리, 건수 작음)
  const { data: allTagRows } = await supabase
    .from("expert_tenant_tags")
    .select("expert_id, tag");
  const tagAllByExpert = new Map(
    (allTagRows ?? []).map((t) => [t.expert_id, t.tag])
  );

  const lowered = query.toLowerCase();
  const queryDigits = query.replace(/\D/g, "").replace(/^0/, "");
  const periodDays = PERIOD_FILTERS.find((p) => p.key === periodFilter)?.days;
  const periodCutoff = periodDays
    ? Date.now() - periodDays * 24 * 60 * 60 * 1000
    : null;

  let rows = visiblePool.filter((expert) => {
    const link = linkByExpert.get(expert.id);
    if (scope === "linked" && (!link || link.status === "revoked")) return false;
    if (
      (scope === "favorite" || scope === "vip") &&
      tagAllByExpert.get(expert.id) !== scope
    )
      return false;
    if (regionFilter && (expert.region ?? "") !== regionFilter) return false;
    if (periodCutoff && new Date(expert.created_at).getTime() < periodCutoff)
      return false;
    if (
      rfieldFilter &&
      !(recruitByExpert.get(expert.id) ?? []).includes(rfieldFilter)
    )
      return false;
    if (
      efieldFilter &&
      !(expertiseByExpert.get(expert.id) ?? []).includes(efieldFilter)
    )
      return false;
    if (lowered) {
      const haystack = [
        expert.name,
        expert.specialty ?? "",
        expert.region ?? "",
        expert.email ?? "",
        ...(expertiseByExpert.get(expert.id) ?? []),
        ...(recruitByExpert.get(expert.id) ?? []),
      ]
        .join(" ")
        .toLowerCase();
      const phoneHit =
        queryDigits.length >= 4 &&
        expert.phone.replace(/\D/g, "").includes(queryDigits);
      if (!haystack.includes(lowered) && !phoneHit) return false;
    }
    return true;
  });

  // ── 정렬 ────────────────────────────────────────────────────────────────
  const firstOf = (m: Map<string, string[]>, id: string) =>
    (m.get(id) ?? [])[0] ?? "";
  rows = rows.sort((a, b) => {
    switch (sortKey) {
      case "region":
        return (
          (a.region ?? "힣힣").localeCompare(b.region ?? "힣힣", "ko") ||
          a.name.localeCompare(b.name, "ko")
        );
      case "rfield":
        return (
          (firstOf(recruitByExpert, a.id) || "힣힣").localeCompare(
            firstOf(recruitByExpert, b.id) || "힣힣",
            "ko"
          ) || a.name.localeCompare(b.name, "ko")
        );
      case "efield":
        return (
          (firstOf(expertiseByExpert, a.id) || "힣힣").localeCompare(
            firstOf(expertiseByExpert, b.id) || "힣힣",
            "ko"
          ) || a.name.localeCompare(b.name, "ko")
        );
      default:
        return a.name.localeCompare(b.name, "ko");
    }
  });

  const totalCount = rows.length;
  const pageCount = totalPages(totalCount, PAGE_SIZE);
  const pageRows = rows.slice(paging.from, paging.to + 1);

  // 지역 선택지 자동 추출 (건수 상위 12개)
  const regionCounts = new Map<string, number>();
  for (const e of visiblePool) {
    if (!e.region) continue;
    regionCounts.set(e.region, (regionCounts.get(e.region) ?? 0) + 1);
  }
  const regionOptions = Array.from(regionCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([name]) => name);

  // 자사 등급·평가·평점·메모 (자사 주관 기록 — 테넌트 격리)
  const linkedIds = pageRows
    .filter((e) => linkByExpert.get(e.id))
    .map((e) => e.id);
  const pageIds = pageRows.map((e) => e.id);
  const [
    { data: tagRows },
    { data: evaluationRows },
    profilesResult,
    notesResult,
  ] = await Promise.all([
    linkedIds.length
      ? supabase
          .from("expert_tenant_tags")
          .select("expert_id, tag, note")
          .in("expert_id", linkedIds)
      : Promise.resolve({ data: null }),
    linkedIds.length
      ? supabase
          .from("expert_evaluations")
          .select("expert_id, score")
          .in("expert_id", linkedIds)
      : Promise.resolve({ data: null }),
    pageIds.length
      ? supabase
          .from("expert_tenant_profiles")
          .select("expert_id, rating")
          .in("expert_id", pageIds)
      : Promise.resolve({ data: null, error: null }),
    // 메모 건수 — 테이블 미생성(마이그레이션 전)이면 빈 목록으로 동작
    pageIds.length
      ? supabase
          .from("expert_tenant_notes")
          .select("expert_id")
          .in("expert_id", pageIds)
      : Promise.resolve({ data: null, error: null }),
  ]);
  const ratingByExpert = new Map(
    (profilesResult.data ?? []).map((p) => [p.expert_id, p.rating])
  );
  const noteCountByExpert = new Map<string, number>();
  for (const n of notesResult.data ?? []) {
    noteCountByExpert.set(
      n.expert_id,
      (noteCountByExpert.get(n.expert_id) ?? 0) + 1
    );
  }
  // 섭외분야 셀용 — 전문가별 선택된 분야 id (recruitAssignments는 자사분만, RLS)
  const recruitIdsByExpert = new Map<string, string[]>();
  for (const a of recruitAssignments ?? []) {
    const list = recruitIdsByExpert.get(a.expert_id) ?? [];
    list.push(a.field_id);
    recruitIdsByExpert.set(a.expert_id, list);
  }
  const recruitOptions = (recruitFields ?? []).map((f) => ({
    id: f.id,
    name: f.name,
  }));
  const tagByExpert = new Map(
    (tagRows ?? []).map((t) => [t.expert_id, { tag: t.tag, note: t.note }])
  );
  const scoreByExpert = new Map<string, { sum: number; count: number }>();
  for (const row of evaluationRows ?? []) {
    if (row.score === null) continue;
    const acc = scoreByExpert.get(row.expert_id) ?? { sum: 0, count: 0 };
    acc.sum += row.score;
    acc.count += 1;
    scoreByExpert.set(row.expert_id, acc);
  }

  const sessionUser = await getSessionUser();
  // 전문가 평점·등급·메모는 레벨 4(대리)부터 — 서버 게이트(expertRecord)와 같은 기준
  const canManageTags = await canExecTenant("expertRecord", sessionUser);

  const activeExpertOptions = Array.from(linkByExpert.entries())
    .filter(([, v]) => v.status === "active")
    .map(([id]) => {
      const expert = visiblePool.find((e) => e.id === id);
      return expert ? { id, name: expert.name } : null;
    })
    .filter((v): v is { id: string; name: string } => v !== null);

  // 프로젝트 연결 옵션은 operations 모듈 활성 시에만 (CLAUDE.md 1-2-6)
  const { data: projects } = modules.operations
    ? await supabase
        .from("projects")
        .select("id, name")
        .in("status", ["planned", "active"])
        .order("created_at", { ascending: false })
    : { data: null };

  const pendingInvitations = invitations ?? [];

  /** 필터 칩 그룹 — 데이터에서 자동 추출된 선택지 (details로 접고 편다) */
  const filterGroup = (
    title: string,
    paramKey: "region" | "period" | "rfield" | "efield",
    current: string,
    options: { value: string; label: string }[]
  ) => (
    <details open={Boolean(current)} className="group">
      <summary className="inline-flex h-8 cursor-pointer list-none items-center gap-1 rounded-md border px-2.5 text-xs font-medium hover:bg-secondary [&::-webkit-details-marker]:hidden">
        {title}
        {current && (
          <Badge className="ml-1 h-4 px-1 text-[10px]">
            {options.find((o) => o.value === current)?.label ?? current}
          </Badge>
        )}
        <span className="text-muted-foreground group-open:hidden">▾</span>
        <span className="hidden text-muted-foreground group-open:inline">▴</span>
      </summary>
      <div className="mt-1.5 flex flex-wrap gap-1">
        <Button
          asChild
          size="sm"
          variant={!current ? "default" : "outline"}
          className="h-7 px-2 text-xs"
        >
          <Link href={linkWith({ [paramKey]: undefined, page: undefined })}>
            전체
          </Link>
        </Button>
        {options.map((o) => (
          <Button
            key={o.value}
            asChild
            size="sm"
            variant={current === o.value ? "default" : "outline"}
            className="h-7 px-2 text-xs"
          >
            <Link href={linkWith({ [paramKey]: o.value, page: undefined })}>
              {o.label}
            </Link>
          </Button>
        ))}
        {options.length === 0 && (
          <span className="text-xs text-muted-foreground">
            선택지가 없습니다
          </span>
        )}
      </div>
    </details>
  );

  return (
    <div>
      <PageHeader
        title="전문가"
        actions={
          <div className="flex items-center gap-2">
            <Button asChild variant="outline" size="sm">
              <a
                href={`/${params.tenantSlug}/experts/export`}
                title="현재 조회된 전문가 목록을 엑셀 파일로 내려받습니다"
              >
                엑셀 다운로드
              </a>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href={`/${params.tenantSlug}/experts/cancellations`}>
                취소 내역
              </Link>
            </Button>
            <ExpertRecommendDialog />
            {directEngagementOn && (
              <EngagementDialog
                experts={activeExpertOptions}
                projects={projects}
              />
            )}
            <InviteExpertDialog />
          </div>
        }
      />
      <main className="space-y-5 p-5">
        <ExpertsTabs tenantSlug={params.tenantSlug} active="list" />
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <SearchForm
              action={basePath}
              defaultValue={query}
              placeholder="이름 · 전문분야 · 지역 · 강의분야"
              hidden={{
                scope: activeParams.scope,
                region: activeParams.region,
                period: activeParams.period,
                rfield: activeParams.rfield,
                efield: activeParams.efield,
                sort: activeParams.sort,
              }}
            />
            <div className="flex flex-wrap gap-1">
              {SCOPE_FILTERS.map((filter) => (
                <Button
                  key={filter.key}
                  asChild
                  size="sm"
                  variant={scope === filter.key ? "default" : "outline"}
                  className="h-8 px-2.5 text-xs"
                >
                  <Link
                    href={linkWith({
                      scope: filter.key === "all" ? undefined : filter.key,
                      page: undefined,
                    })}
                  >
                    {filter.label}
                  </Link>
                </Button>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap items-start gap-2">
            {filterGroup(
              "지역",
              "region",
              regionFilter,
              regionOptions.map((r) => ({ value: r, label: r }))
            )}
            {filterGroup(
              "날짜(기간)",
              "period",
              periodFilter,
              PERIOD_FILTERS.map((p) => ({ value: p.key, label: p.label }))
            )}
            {filterGroup(
              "섭외분야",
              "rfield",
              rfieldFilter,
              (recruitFields ?? []).map((f) => ({ value: f.name, label: f.name }))
            )}
            {filterGroup(
              "강의분야",
              "efield",
              efieldFilter,
              (expertiseFieldRows ?? []).map((f) => ({
                value: f.name,
                label: f.name,
              }))
            )}
            <div className="ml-auto flex flex-wrap items-center gap-1">
              <span className="text-xs text-muted-foreground">정렬</span>
              {SORT_OPTIONS.map((s) => (
                <Button
                  key={s.key}
                  asChild
                  size="sm"
                  variant={sortKey === s.key ? "secondary" : "ghost"}
                  className="h-7 px-2 text-xs"
                >
                  <Link
                    href={linkWith({
                      sort: s.key === "name" ? undefined : s.key,
                      page: undefined,
                    })}
                  >
                    {s.label}
                  </Link>
                </Button>
              ))}
            </div>
          </div>
        </div>

        {pendingInvitations.length > 0 && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">
                대기중 등록 요청 ({pendingInvitations.length})
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>이름</TableHead>
                      <TableHead>휴대폰</TableHead>
                      <TableHead>만료일</TableHead>
                      <TableHead className="w-72" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pendingInvitations.map((inv) => (
                      <TableRow key={inv.id}>
                        <TableCell>{inv.invited_name ?? "-"}</TableCell>
                        <TableCell>
                          {inv.invited_phone
                            ? formatKrMobile(inv.invited_phone)
                            : "-"}
                        </TableCell>
                        <TableCell>
                          {new Date(inv.expires_at).toLocaleDateString("ko-KR")}
                        </TableCell>
                        <TableCell>
                          <InvitationActions
                            invitationId={inv.id}
                            hasPhone={Boolean(inv.invited_phone)}
                          />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        )}

        {pageRows.length === 0 ? (
          <EmptyState
            title="조건에 맞는 전문가가 없습니다"
            description="검색어나 필터를 바꿔 보세요. 아직 아무도 등록되지 않았다면 ‘일괄 등록’ 또는 ‘전문가 등록 요청’으로 시작하세요."
          />
        ) : (
          <Card>
            <CardContent className="pt-6">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    {/* 컬럼명 마우스 오버 설명 (기획 확정 2026-08-23) */}
                    <TableRow>
                      <TableHead
                        className="cursor-help"
                        title="전문가 이름 — 클릭하면 상세 화면으로 이동합니다"
                      >
                        이름
                      </TableHead>
                      <TableHead
                        className="cursor-help"
                        title="전문가 연락처 — 등록플랫폼 공개 정보입니다"
                      >
                        휴대폰
                      </TableHead>
                      <TableHead
                        className="cursor-help"
                        title="전문가 본인이 입력한 전문분야 (전 기업 공통 표시)"
                      >
                        전문분야
                      </TableHead>
                      <TableHead
                        className="cursor-help"
                        title="전문가 본인이 선택한 강의·멘토링 가능 분야 (전 기업 공통 표시)"
                      >
                        강의분야
                      </TableHead>
                      <TableHead
                        className="cursor-help"
                        title="우리 회사가 내부 기준으로 붙인 섭외분야 — 전문가·타사에 보이지 않습니다. 선택지는 설정 > 기업관리 > 섭외분야에서 관리합니다"
                      >
                        섭외분야
                      </TableHead>
                      <TableHead
                        className="cursor-help"
                        title="전문가 프로필의 거주지·활동지역"
                      >
                        지역
                      </TableHead>
                      <TableHead
                        className="cursor-help"
                        title="전문가 프로필의 경력 연차"
                      >
                        경력
                      </TableHead>
                      <TableHead
                        className="cursor-help"
                        title="우리 회사의 평가 — 자사 평점(1~10, 직접 지정)과 프로젝트 평가 평균. 클릭해 점수를 매기면 변경이 평가 로그로 남습니다. 전문가에게 보이지 않습니다"
                      >
                        자사 평가
                      </TableHead>
                      <TableHead
                        className="cursor-help"
                        title="우리 회사 내부 메모 — 댓글처럼 쌓이고 작성자·일시가 남습니다. 전문가에게 보이지 않습니다"
                      >
                        메모
                      </TableHead>
                      <TableHead
                        className="cursor-help"
                        title="우리 회사와의 연결 상태 — 연결됨 / 대기중 / 미연결"
                      >
                        상태
                      </TableHead>
                      <TableHead className="w-20" />
                      <TableHead
                        className="w-16 cursor-help"
                        title="VIP 지정 — 클릭으로 켜고 끕니다 (연결된 전문가만)"
                      >
                        VIP
                      </TableHead>
                      {/* 등급 컬럼을 대체 — VIP 옆 버튼식 토글 (기획 2026-08-30 — 23번) */}
                      <TableHead
                        className="w-16 cursor-help"
                        title="주의 지정 — 클릭으로 켜고 끕니다 (사유 필수 · 섭외 후보군 화면에 함께 표시 · 전문가에게 보이지 않음)"
                      >
                        주의
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pageRows.map((expert) => {
                      const link = linkByExpert.get(expert.id);
                      const isLinked = Boolean(link && link.status !== "revoked");
                      const status = link
                        ? (LINK_STATUS_LABEL[link.status] ?? {
                            label: "대기중",
                            variant: "secondary" as const,
                          })
                        : { label: "미연결", variant: "outline" as const };
                      const expertiseNames = expertiseByExpert.get(expert.id) ?? [];
                      return (
                        <TableRow key={expert.id}>
                          <TableCell className="whitespace-nowrap font-medium">
                            <ExpertQuickTag
                              expertId={expert.id}
                              expertName={expert.name}
                              tag={tagAllByExpert.get(expert.id) ?? null}
                              target="favorite"
                              canManage={canManageTags}
                              linkActive={link?.status === "active"}
                            />
                            <Link
                              href={`/${params.tenantSlug}/experts/${expert.id}`}
                              className="underline-offset-4 hover:underline"
                            >
                              {expert.name}
                            </Link>
                          </TableCell>
                          <TableCell>{formatKrMobile(expert.phone)}</TableCell>
                          <TableCell>{expert.specialty ?? "-"}</TableCell>
                          <TableCell className="max-w-[180px] truncate text-xs">
                            {expertiseNames.length > 0
                              ? expertiseNames.join(" · ")
                              : "-"}
                          </TableCell>
                          <TableCell>
                            <ExpertRecruitFieldsCell
                              expertId={expert.id}
                              expertName={expert.name}
                              options={recruitOptions}
                              selectedIds={recruitIdsByExpert.get(expert.id) ?? []}
                              canManage={canManageTags}
                            />
                          </TableCell>
                          <TableCell>{expert.region ?? "-"}</TableCell>
                          <TableCell>
                            {expert.career_years != null
                              ? `${expert.career_years}년`
                              : "-"}
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-sm">
                            {(() => {
                              // 자사 평가 = 프로젝트 평가 평균(읽기) + 자사 평점(직접 지정, §4 테넌트 격리)
                              const acc = scoreByExpert.get(expert.id);
                              const avg =
                                acc && acc.count > 0
                                  ? (acc.sum / acc.count).toFixed(1)
                                  : null;
                              return (
                                <ExpertRatingCell
                                  expertId={expert.id}
                                  expertName={expert.name}
                                  avg={avg}
                                  myRating={ratingByExpert.get(expert.id) ?? null}
                                  canManage={canManageTags}
                                />
                              );
                            })()}
                          </TableCell>
                          <TableCell>
                            <ExpertNotesCell
                              expertId={expert.id}
                              expertName={expert.name}
                              count={noteCountByExpert.get(expert.id) ?? 0}
                              canManage={canManageTags}
                            />
                          </TableCell>
                          <TableCell>
                            <Badge variant={status.variant}>{status.label}</Badge>
                          </TableCell>
                          <TableCell>
                            {isLinked ? (
                              <Link
                                href={`/${params.tenantSlug}/experts/${expert.id}/documents`}
                                className="text-sm font-medium text-brand underline-offset-4 hover:underline"
                              >
                                서류
                              </Link>
                            ) : null}
                          </TableCell>
                          <TableCell>
                            <ExpertQuickTag
                              expertId={expert.id}
                              expertName={expert.name}
                              tag={tagAllByExpert.get(expert.id) ?? null}
                              target="vip"
                              canManage={canManageTags}
                              linkActive={link?.status === "active"}
                            />
                          </TableCell>
                          <TableCell>
                            <ExpertQuickTag
                              expertId={expert.id}
                              expertName={expert.name}
                              tag={tagAllByExpert.get(expert.id) ?? null}
                              tagNote={tagByExpert.get(expert.id)?.note ?? null}
                              target="caution"
                              canManage={canManageTags}
                              linkActive={link?.status === "active"}
                            />
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
              <p className="mt-3 text-xs text-muted-foreground">
                등록플랫폼의 모든 전문가에게 연락해 섭외를 시작할 수 있습니다.
                서류(이력서·통장사본 등)는 전문가가 열람을 허용해야 보이고,
                주민등록번호·계좌는 계약·지급 단계에서만 열립니다.
                평가·등급·섭외이력은 우리 회사 데이터만 표시됩니다.
              </p>
            </CardContent>
          </Card>
        )}

        <Pagination
          basePath={basePath}
          params={activeParams}
          page={paging.page}
          pageCount={pageCount}
          totalCount={totalCount}
          unitLabel="명"
        />
      </main>
    </div>
  );
}
