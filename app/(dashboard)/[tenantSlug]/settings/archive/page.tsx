import { requireRole } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { gradeFromUser } from "@/lib/auth/tenant";
import { canViewAllProjects, isUserGrade } from "@/lib/auth/grades";
import { getTenantModules } from "@/lib/modules/server";
import { getAdminScopes } from "@/lib/auth/admin-scopes";
import { PROJECT_STATUS_LABELS } from "@/lib/operations/steps";
import { roleFromUser } from "@/lib/auth/tenant";
import { PageHeader } from "@/components/layout/header";
import { EmptyState } from "@/components/layout/empty-state";
import { SettingsTabs } from "@/components/layout/settings-tabs";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { redirect } from "next/navigation";

export const metadata = { title: "프로젝트 보관" };

/**
 * 종결 프로젝트 보관(아카이브) 현황 — 대표·이사 전용 (기획 2026-08-30).
 *
 * 캐스트로그의 보관 체계는 "별도 창고"가 아니라 **상태 전환 + 전량 보존**이다:
 * 종결 처리하면 projects.status가 completed로 바뀔 뿐, 세션·섭외·수락서·지급·
 * 감사 기록은 전부 그 자리에 남는다(§14-4 — 삭제 대신 상태 전환). 이 화면은
 * 그 체계를 눈으로 확인하는 자리다 — 종결·취소·보류 건이 연도별로 몇 개이고
 * 어떤 것들인지.
 */
export default async function ProjectArchivePage({
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
  const grade = gradeFromUser(user);
  if (!isUserGrade(grade) || !canViewAllProjects(grade)) {
    // 전사 프로젝트 열람 권한이 없으면 이 화면 자체가 성립하지 않는다 (§3-1)
    redirect(`/${params.tenantSlug}/settings/me`);
  }

  if (!hasSupabaseEnv()) {
    return (
      <div className="min-h-screen bg-secondary/50">
        <PageHeader title="프로젝트 보관" />
        <main className="mx-auto max-w-4xl p-4 sm:p-6">
          <EmptyState title="서버 설정 대기 중" />
        </main>
      </div>
    );
  }

  const [modules, scopes] = await Promise.all([
    getTenantModules(),
    getAdminScopes(),
  ]);
  const role = roleFromUser(user);
  const isCeo = role === "org_admin" || role === "platform_admin";

  const supabase = createClient();
  const { data: archived } = await supabase
    .from("projects")
    .select("id, name, code, business_year, client_name, status, closed_at, ends_on")
    .in("status", ["completed", "cancelled", "on_hold"])
    .order("business_year", { ascending: false })
    .order("closed_at", { ascending: false, nullsFirst: false });

  const rows = archived ?? [];
  const byYear = new Map<number, typeof rows>();
  for (const p of rows) {
    const list = byYear.get(p.business_year) ?? [];
    list.push(p);
    byYear.set(p.business_year, list);
  }
  const years = Array.from(byYear.keys()).sort((a, b) => b - a);

  const statusBadge = (status: string) =>
    status === "completed" ? (
      <Badge className="bg-emerald-600 hover:bg-emerald-600">종결</Badge>
    ) : status === "cancelled" ? (
      <Badge variant="outline">취소</Badge>
    ) : (
      <Badge variant="secondary">보류</Badge>
    );

  return (
    <div className="min-h-screen bg-secondary/50">
      <PageHeader title="설정" />
      <SettingsTabs
        tenantSlug={params.tenantSlug}
        showStaff={isCeo || scopes.staff}
        showSms={isCeo || scopes.sending}
        showOrg={isCeo || Object.values(scopes).some(Boolean)}
        showRules={modules.approvals && (isCeo || scopes.approvals)}
        showArchive={true}
      />
      <main className="mx-auto max-w-4xl space-y-4 p-4 sm:p-6">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">보관 체계 안내</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm leading-relaxed text-muted-foreground">
            <p>
              캐스트로그의 프로젝트 보관은 <b>상태 전환 + 전량 보존</b>입니다.
              프로젝트를 종결 처리하면 상태만 &lsquo;종결&rsquo;로 바뀌고, 세션·섭외
              이력·수락서·지급·감사 기록은 전부 그 자리에 남습니다 — 별도 창고로
              옮기거나 지우지 않습니다.
            </p>
            <ul className="list-disc space-y-1 pl-5">
              <li>
                종결·취소·보류 프로젝트는 아래 목록과 프로젝트 화면에서 계속 열람할
                수 있습니다 (통계·엑셀 내보내기 포함).
              </li>
              <li>
                예외는 법정 보존기간이 지난 민감정보(주민등록번호 키 위임)뿐입니다 —
                이것만 자동 파기됩니다 (§5).
              </li>
              <li>
                기록이 없는 빈 프로젝트(중복 생성 등)만 프로젝트 화면의 &lsquo;기본정보
                수정 &gt; 프로젝트 삭제&rsquo;로 지울 수 있습니다.
              </li>
            </ul>
          </CardContent>
        </Card>

        {years.length === 0 ? (
          <EmptyState
            title="보관된 프로젝트가 없습니다"
            description="종결·취소·보류 처리된 프로젝트가 여기에 연도별로 모입니다."
          />
        ) : (
          years.map((year) => {
            const list = byYear.get(year) ?? [];
            return (
              <Card key={year}>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm">
                    {year}년 ({list.length}건)
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="divide-y text-sm">
                    {list.map((p) => (
                      <li
                        key={p.id}
                        className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2"
                      >
                        <a
                          href={`/${params.tenantSlug}/projects/${p.id}`}
                          className="font-medium underline-offset-2 hover:underline"
                        >
                          {p.name}
                        </a>
                        {p.code && (
                          <span className="font-mono text-xs text-muted-foreground">
                            {p.code}
                          </span>
                        )}
                        {p.client_name && (
                          <span className="text-xs text-muted-foreground">
                            {p.client_name}
                          </span>
                        )}
                        <span className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
                          {p.closed_at
                            ? `종결 ${new Date(p.closed_at).toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul" })}`
                            : p.ends_on
                              ? `종료 예정 ${p.ends_on}`
                              : null}
                          {statusBadge(p.status)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            );
          })
        )}

        <p className="text-xs text-muted-foreground">
          상태 라벨:{" "}
          {Object.entries(PROJECT_STATUS_LABELS)
            .map(([, label]) => label)
            .join(" · ")}
          . 이 화면은 대표·이사만 볼 수 있습니다 (전사 열람 권한 — §3-1).
        </p>
      </main>
    </div>
  );
}
