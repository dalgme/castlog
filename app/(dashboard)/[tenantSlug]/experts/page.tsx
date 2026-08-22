import Link from "next/link";

import { requireRole, getSessionUser } from "@/lib/auth/session";
import { roleFromUser } from "@/lib/auth/tenant";
import { getTenantModules, requireModule } from "@/lib/modules/server";
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
import { ExpertRecommendDialog } from "./recommend-dialog";
import { InvitationActions } from "./invitation-actions";
import { ExpertTagCell } from "./expert-tag-cell";

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
 * 전문가 목록 (기획 개정 2026-08-22 — 플랫폼 전체 풀 공개)
 *
 * - '전체': 캐스트로그(전문가 등록플랫폼)에 등록된 모든 전문가.
 *   **미연결 전문가의 연락처(휴대폰·이메일)는 비공개** — 이름·지역·분야·경력
 *   같은 프로필만 보이고, 연결(등록 요청 수락·보유자료 등록) 후에 공개된다.
 *   섭외이력·평가·등급은 자사 데이터만 (§4 테넌트 격리 유지).
 * - '연결됨': 관계기업에 자사가 있는(expert_tenant_links) 전문가.
 * - 지역 / 날짜(기간) / 분야(내부용=섭외분야) / 분야(전문가용=강의분야) 필터와
 *   성명·지역·분야 정렬을 제공한다. 필터 선택지는 데이터에서 자동 추출.
 */
const PAGE_SIZE = 30;
const POOL_FETCH_LIMIT = 2000;

const SCOPE_FILTERS = [
  { key: "all", label: "전체" },
  { key: "linked", label: "연결됨" },
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
  { key: "rfield", label: "분야(내부용)순" },
  { key: "efield", label: "분야(전문가용)순" },
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
    { data: poolRows },
    { data: linkRows },
    { data: invitations },
    { data: recruitFields },
    { data: recruitAssignments },
    { data: expertiseFieldRows },
    { data: expertiseAssignments },
  ] = await Promise.all([
    admin
      .from("experts")
      .select("id, name, specialty, region, career_years, created_at")
      .eq("is_practice", practice)
      .order("created_at", { ascending: false })
      .limit(POOL_FETCH_LIMIT),
    supabase
      .from("expert_tenant_links")
      .select("status, experts (id, name, phone, email)"),
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

  // 자사 연결 상태·연락처 (RLS 범위)
  const linkByExpert = new Map<
    string,
    { status: string; phone: string | null; email: string | null }
  >();
  for (const link of linkRows ?? []) {
    if (!link.experts) continue;
    const prev = linkByExpert.get(link.experts.id);
    // active > pending > revoked 우선
    if (prev && prev.status === "active") continue;
    if (prev && prev.status === "pending" && link.status === "revoked") continue;
    linkByExpert.set(link.experts.id, {
      status: link.status,
      phone: link.experts.phone,
      email: link.experts.email,
    });
  }

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

  // 강의(멘토링) 분야(전문가용) — 전역
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
  const lowered = query.toLowerCase();
  const queryDigits = query.replace(/\D/g, "").replace(/^0/, "");
  const periodDays = PERIOD_FILTERS.find((p) => p.key === periodFilter)?.days;
  const periodCutoff = periodDays
    ? Date.now() - periodDays * 24 * 60 * 60 * 1000
    : null;

  let rows = (poolRows ?? []).filter((expert) => {
    const link = linkByExpert.get(expert.id);
    if (scope === "linked" && (!link || link.status === "revoked")) return false;
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
        ...(expertiseByExpert.get(expert.id) ?? []),
        ...(recruitByExpert.get(expert.id) ?? []),
        // 연락처는 연결된 전문가만 검색 대상 (미연결은 비공개)
        link?.email ?? "",
      ]
        .join(" ")
        .toLowerCase();
      const phoneHit =
        queryDigits.length >= 4 &&
        Boolean(link?.phone?.replace(/\D/g, "").includes(queryDigits));
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
  for (const e of poolRows ?? []) {
    if (!e.region) continue;
    regionCounts.set(e.region, (regionCounts.get(e.region) ?? 0) + 1);
  }
  const regionOptions = Array.from(regionCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([name]) => name);

  // 자사 등급·평가 (연결 전문가만 — 테넌트 격리)
  const linkedIds = pageRows
    .filter((e) => linkByExpert.get(e.id))
    .map((e) => e.id);
  const [{ data: tagRows }, { data: evaluationRows }] = await Promise.all([
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
  ]);
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
  const canManageTags = ["org_admin", "manager"].includes(
    roleFromUser(sessionUser) ?? ""
  );

  const activeExpertOptions = Array.from(linkByExpert.entries())
    .filter(([, v]) => v.status === "active")
    .map(([id]) => {
      const expert = (poolRows ?? []).find((e) => e.id === id);
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
              <a href={`/${params.tenantSlug}/experts/export`}>엑셀</a>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href={`/${params.tenantSlug}/experts/import`}>일괄 등록</Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href={`/${params.tenantSlug}/experts/manage`}>
                전문가 관리
              </Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href={`/${params.tenantSlug}/experts/cancellations`}>
                취소 내역
              </Link>
            </Button>
            <ExpertRecommendDialog />
            <EngagementDialog
              experts={activeExpertOptions}
              projects={projects}
            />
            <InviteExpertDialog />
          </div>
        }
      />
      <main className="space-y-5 p-5">
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
              "분야(내부용)",
              "rfield",
              rfieldFilter,
              (recruitFields ?? []).map((f) => ({ value: f.name, label: f.name }))
            )}
            {filterGroup(
              "분야(전문가용)",
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
                    <TableRow>
                      <TableHead>이름</TableHead>
                      <TableHead>휴대폰</TableHead>
                      <TableHead>전문분야</TableHead>
                      <TableHead>강의(멘토링) 분야</TableHead>
                      <TableHead>지역</TableHead>
                      <TableHead>경력</TableHead>
                      <TableHead>자사 평균</TableHead>
                      <TableHead>등급</TableHead>
                      <TableHead>상태</TableHead>
                      <TableHead className="w-20" />
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
                          <TableCell className="font-medium">
                            {isLinked ? (
                              <Link
                                href={`/${params.tenantSlug}/experts/${expert.id}`}
                                className="underline-offset-4 hover:underline"
                              >
                                {expert.name}
                              </Link>
                            ) : (
                              expert.name
                            )}
                          </TableCell>
                          <TableCell>
                            {link?.phone ? (
                              formatKrMobile(link.phone)
                            ) : (
                              <span
                                className="text-xs text-muted-foreground"
                                title="연락처는 연결(등록 요청 수락) 후 공개됩니다"
                              >
                                비공개
                              </span>
                            )}
                          </TableCell>
                          <TableCell>{expert.specialty ?? "-"}</TableCell>
                          <TableCell className="max-w-[180px] truncate text-xs">
                            {expertiseNames.length > 0
                              ? expertiseNames.join(" · ")
                              : "-"}
                          </TableCell>
                          <TableCell>{expert.region ?? "-"}</TableCell>
                          <TableCell>
                            {expert.career_years != null
                              ? `${expert.career_years}년`
                              : "-"}
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-sm">
                            {(() => {
                              if (!isLinked) {
                                return (
                                  <span className="text-muted-foreground">-</span>
                                );
                              }
                              const acc = scoreByExpert.get(expert.id);
                              if (!acc || acc.count === 0) {
                                return (
                                  <span className="text-muted-foreground">
                                    평가 없음
                                  </span>
                                );
                              }
                              // 자사에서 매긴 평가의 평균만 보여 준다 (§4).
                              return (
                                <strong>{(acc.sum / acc.count).toFixed(1)}</strong>
                              );
                            })()}
                          </TableCell>
                          <TableCell>
                            {isLinked ? (
                              <ExpertTagCell
                                expertId={expert.id}
                                tag={tagByExpert.get(expert.id)?.tag ?? null}
                                note={tagByExpert.get(expert.id)?.note ?? null}
                                canManage={canManageTags}
                              />
                            ) : (
                              <span className="text-xs text-muted-foreground">
                                -
                              </span>
                            )}
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
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
              <p className="mt-3 text-xs text-muted-foreground">
                미연결 전문가의 연락처는 비공개입니다 — ‘전문가 등록 요청’ 링크를
                보내 전문가가 수락(연결)하면 공개됩니다. 평가·등급·섭외이력은
                우리 회사 데이터만 표시됩니다.
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
