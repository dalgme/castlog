import { requireRole } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { formatKrMobile } from "@/lib/auth/phone";
import { resolvePage, totalPages, phoneSearchFragment } from "@/lib/ui/paging";
import { PageHeader } from "@/components/layout/header";
import { EmptyState } from "@/components/layout/empty-state";
import { SearchForm, Pagination } from "@/components/layout/list-controls";
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

export const metadata = { title: "전문가 DB — 캐스트로그 관리모드" };
export const dynamic = "force-dynamic";

const PAGE_SIZE = 30;
const BASE_PATH = "/platform-admin/experts";

/** 상태 필터 — 전체 / 활성 / 중지 / 계정 미연결(보유자료 미클레임) */
const STATUS_FILTERS = [
  { key: "all", label: "전체" },
  { key: "active", label: "활성" },
  { key: "inactive", label: "이용 중지" },
  { key: "unclaimed", label: "계정 미연결" },
] as const;
type StatusFilter = (typeof STATUS_FILTERS)[number]["key"];

function isStatusFilter(v: string | undefined): v is StatusFilter {
  return STATUS_FILTERS.some((f) => f.key === v);
}

/**
 * 전역 전문가 DB 목록 (기획 2026-08-30).
 *
 * 조회는 admin 클라이언트 + 공개 컬럼 명시 — 전 테넌트 공개(§4)의 확립된
 * 구현 관례를 따른다. 테넌트 격리 데이터(평가·메모·섭외이력)와 민감정보
 * (주민번호·계좌·서류 내용)는 관리모드에서도 싣지 않는다.
 *
 * 목록은 서버 검색 + 서버 페이징 — 전량 로드 후 자르는 방식은 규모가 커지면
 * 조용히 잘린다 (lib/ui/paging.ts 헤더 주석).
 */
export default async function PlatformExpertsPage({
  searchParams,
}: {
  searchParams: { q?: string; status?: string; page?: string };
}) {
  await requireRole(["platform_admin"]);

  const headerActions = (
    <div className="flex items-center gap-2">
      <Button asChild variant="outline" size="sm">
        <a href="/platform-admin/experts/export">엑셀 내보내기</a>
      </Button>
      <Button asChild variant="outline" size="sm">
        <a href="/platform-admin/expertise-fields">강의 분야</a>
      </Button>
      <Button asChild variant="outline" size="sm">
        <a href="/platform-admin">← 캐스트로그 관리모드</a>
      </Button>
    </div>
  );

  if (!hasSupabaseEnv()) {
    return (
      <div className="min-h-screen bg-secondary/50">
        <PageHeader title="전문가 DB" actions={headerActions} />
        <main className="mx-auto max-w-5xl p-4 sm:p-6">
          <EmptyState title="서버 설정 대기 중" />
        </main>
      </div>
    );
  }

  const q = searchParams.q?.trim() || "";
  const status: StatusFilter = isStatusFilter(searchParams.status)
    ? searchParams.status
    : "all";
  const paging = resolvePage(searchParams.page, PAGE_SIZE);
  const admin = createAdminClient();

  // 공개 컬럼만 명시 select (§4 관례) + 서버 검색·페이징
  let query = admin
    .from("experts")
    .select(
      "id, name, phone, email, organization, job_title, specialty, region, career_years, auth_user_id, is_active, created_at",
      { count: "exact" }
    )
    .eq("is_practice", false);

  if (q) {
    const phoneFragment = phoneSearchFragment(q);
    // PostgREST or= 문법 예약문자 제거 — 괄호는 그룹으로 해석돼 400을 낸다 (리뷰 8)
    const escaped = q.replace(/[%_,()\\]/g, "");
    const ors = [
      escaped ? `name.ilike.%${escaped}%` : null,
      escaped ? `email.ilike.%${escaped}%` : null,
      escaped ? `organization.ilike.%${escaped}%` : null,
      phoneFragment ? `phone.ilike.%${phoneFragment}%` : null,
    ].filter((v): v is string => v !== null);
    if (ors.length > 0) query = query.or(ors.join(","));
  }
  if (status === "active") query = query.eq("is_active", true);
  if (status === "inactive") query = query.eq("is_active", false);
  if (status === "unclaimed") query = query.is("auth_user_id", null);

  const [
    { data: experts, count },
    { count: totalCount },
    { count: claimedCount },
    { count: inactiveCount },
  ] = await Promise.all([
    query
      .order("created_at", { ascending: false })
      .range(paging.from, paging.to),
    admin
      .from("experts")
      .select("id", { count: "exact", head: true })
      .eq("is_practice", false),
    admin
      .from("experts")
      .select("id", { count: "exact", head: true })
      .eq("is_practice", false)
      .not("auth_user_id", "is", null),
    admin
      .from("experts")
      .select("id", { count: "exact", head: true })
      .eq("is_practice", false)
      .eq("is_active", false),
  ]);

  const rows = experts ?? [];

  // 이 페이지 행들의 관계기업 수 — 테넌트별 내용이 아니라 집계값만 (교차 노출 금지)
  const linkCounts = new Map<string, number>();
  if (rows.length > 0) {
    const { data: links } = await admin
      .from("expert_tenant_links")
      .select("expert_id, status")
      .in(
        "expert_id",
        rows.map((r) => r.id)
      )
      .eq("is_practice", false)
      .neq("status", "revoked");
    for (const link of links ?? []) {
      linkCounts.set(link.expert_id, (linkCounts.get(link.expert_id) ?? 0) + 1);
    }
  }

  const params = { q: q || undefined, status: status === "all" ? undefined : status };

  return (
    <div className="min-h-screen bg-secondary/50">
      <PageHeader title="전문가 DB" actions={headerActions} />
      <main className="mx-auto max-w-6xl space-y-4 p-4 sm:p-6">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-xl border bg-card p-3">
            <p className="text-2xl font-bold tabular-nums">
              {(totalCount ?? 0).toLocaleString("ko-KR")}
            </p>
            <p className="text-xs text-muted-foreground">등록 전문가</p>
          </div>
          <div className="rounded-xl border bg-card p-3">
            <p className="text-2xl font-bold tabular-nums">
              {(claimedCount ?? 0).toLocaleString("ko-KR")}
            </p>
            <p className="text-xs text-muted-foreground">계정 연결됨</p>
          </div>
          <div className="rounded-xl border bg-card p-3">
            <p className="text-2xl font-bold tabular-nums">
              {((totalCount ?? 0) - (claimedCount ?? 0)).toLocaleString("ko-KR")}
            </p>
            <p className="text-xs text-muted-foreground">계정 미연결 (보유자료)</p>
          </div>
          <div className="rounded-xl border bg-card p-3">
            <p className="text-2xl font-bold tabular-nums text-red-600">
              {(inactiveCount ?? 0).toLocaleString("ko-KR")}
            </p>
            <p className="text-xs text-muted-foreground">이용 중지</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <SearchForm
            action={BASE_PATH}
            defaultValue={q}
            placeholder="이름·휴대폰·이메일·소속 검색"
            hidden={{ status: params.status }}
          />
          <div className="flex gap-1">
            {STATUS_FILTERS.map((f) => (
              <Button
                key={f.key}
                asChild
                size="sm"
                variant={status === f.key ? "default" : "outline"}
              >
                <a
                  href={
                    f.key === "all"
                      ? q
                        ? `${BASE_PATH}?q=${encodeURIComponent(q)}`
                        : BASE_PATH
                      : `${BASE_PATH}?status=${f.key}${q ? `&q=${encodeURIComponent(q)}` : ""}`
                  }
                >
                  {f.label}
                </a>
              </Button>
            ))}
          </div>
        </div>

        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>이름</TableHead>
                    <TableHead>휴대폰</TableHead>
                    <TableHead>이메일</TableHead>
                    <TableHead>소속 · 직위</TableHead>
                    <TableHead>지역</TableHead>
                    <TableHead className="text-right" title="관계기업 수 — 테넌트별 내용은 격리되어 집계만 표시">
                      관계기업
                    </TableHead>
                    <TableHead>계정</TableHead>
                    <TableHead>상태</TableHead>
                    <TableHead>등록일</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((e) => (
                    <TableRow key={e.id}>
                      <TableCell className="font-medium">{e.name}</TableCell>
                      <TableCell className="whitespace-nowrap">
                        {formatKrMobile(e.phone)}
                      </TableCell>
                      <TableCell>{e.email ?? "-"}</TableCell>
                      <TableCell>
                        {[e.organization, e.job_title].filter(Boolean).join(" · ") ||
                          "-"}
                      </TableCell>
                      <TableCell>{e.region ?? "-"}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {linkCounts.get(e.id) ?? 0}
                      </TableCell>
                      <TableCell>
                        {e.auth_user_id ? (
                          <span className="text-xs text-muted-foreground">연결됨</span>
                        ) : (
                          <Badge variant="outline" className="text-xs">
                            미연결
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        {e.is_active ? (
                          <span className="text-xs text-muted-foreground">활성</span>
                        ) : (
                          <Badge className="bg-red-600 text-xs hover:bg-red-600">
                            이용 중지
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                        {new Date(e.created_at).toLocaleDateString("ko-KR", {
                          timeZone: "Asia/Seoul",
                        })}
                      </TableCell>
                      <TableCell>
                        <Button asChild variant="outline" size="sm">
                          <a href={`/platform-admin/experts/${e.id}`}>상세</a>
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                  {rows.length === 0 && (
                    <TableRow>
                      <TableCell
                        colSpan={10}
                        className="py-10 text-center text-sm text-muted-foreground"
                      >
                        {q || status !== "all"
                          ? "조건에 맞는 전문가가 없습니다."
                          : "등록된 전문가가 없습니다."}
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        <Pagination
          basePath={BASE_PATH}
          params={params}
          page={paging.page}
          pageCount={totalPages(count ?? 0, PAGE_SIZE)}
          totalCount={count ?? 0}
          unitLabel="명"
        />

        <p className="text-xs text-muted-foreground">
          이 화면은 전문가의 <b>전 테넌트 공개 프로필</b>만 다룹니다. 기업별
          평가·메모·섭외 이력은 테넌트 격리 대상이라 표시하지 않으며,
          주민등록번호·계좌·서류 내용은 플랫폼관리자도 접근할 수 없습니다.
        </p>
      </main>
    </div>
  );
}
