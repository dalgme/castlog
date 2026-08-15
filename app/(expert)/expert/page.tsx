import Link from "next/link";

import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { PortalHeader } from "@/components/expert/portal-header";
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
    <div className="rounded-lg border bg-background p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-lg font-bold tabular-nums">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

/**
 * 전문가 포털 대시보드 — 로그인 직후 "현재 상태별" 요약 (설계문서 3.2, 8.1).
 * 가장 급한 대기중 섭외 요청을 최상단에 최대 3건 노출하고, 그 아래 통계를 보여준다.
 * 전 기업 통합 이력 기준. 모바일 완전 대응 최우선.
 */
export default async function ExpertPortalPage() {
  const user = await requireUser("/expert/login");

  if (!hasSupabaseEnv() || !user) {
    return (
      <div className="min-h-screen bg-secondary/50">
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
      <div className="min-h-screen bg-secondary/50">
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
           project_id, token_expires_at, tenants (name), projects (name)`
        )
        .eq("expert_id", expert.id)
        .order("created_at", { ascending: false }),
      supabase
        .from("expert_portal_payments")
        .select("net_amount, withholding_amount")
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
  const monthAgo = now - 30 * 24 * 60 * 60 * 1000;

  const pending = engagementRows.filter(
    (e) =>
      e.status === "requested" &&
      new Date(e.token_expires_at).getTime() >= now
  );
  const accepted = engagementRows.filter((e) => e.status === "accepted");

  const projectSet = new Set(
    accepted.map((e) => e.project_id).filter(Boolean) as string[]
  );
  const recentProjectSet = new Set(
    accepted
      .filter((e) => new Date(e.responded_at ?? e.created_at).getTime() >= monthAgo)
      .map((e) => e.project_id)
      .filter(Boolean) as string[]
  );

  const totalRevenue = paymentRows.reduce(
    (sum, p) => sum + (p.net_amount ?? 0),
    0
  );
  const totalTax = paymentRows.reduce(
    (sum, p) => sum + (p.withholding_amount ?? 0),
    0
  );
  const acceptanceRate =
    engagementRows.length > 0
      ? Math.round((accepted.length / engagementRows.length) * 100)
      : 0;

  return (
    <div className="min-h-screen bg-secondary/50">
      <PortalHeader />
      <main className="mx-auto max-w-2xl space-y-4 p-4 sm:p-5">
        <div>
          <p className="text-sm text-muted-foreground">안녕하세요,</p>
          <h2 className="text-lg font-bold">{expert.name} 전문가님</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {[
              expert.specialty,
              expert.region,
              expert.career_years != null ? `경력 ${expert.career_years}년` : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>

        {/* 가장 급한 것: 대기중 섭외 요청 (최대 3건) */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
            <CardTitle className="text-sm">
              대기중 섭외 요청{" "}
              <span className="text-primary">({pending.length})</span>
            </CardTitle>
            {pending.length > 3 && (
              <Button asChild variant="ghost" size="sm">
                <Link href="/expert/engagements">더보기</Link>
              </Button>
            )}
          </CardHeader>
          <CardContent>
            {pending.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                지금 응답이 필요한 섭외 요청이 없습니다.
              </p>
            ) : (
              <ul className="divide-y">
                {pending.slice(0, 3).map((e) => (
                  <li key={e.id} className="py-2.5">
                    <Link
                      href="/expert/engagements"
                      className="flex flex-wrap items-center gap-2"
                    >
                      <span className="text-sm font-semibold">
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

        {/* 통계 */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">내 활동 통계</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              <StatTile
                label="참여 프로젝트"
                value={`${projectSet.size}건`}
                hint={`최근 1개월 ${recentProjectSet.size}건`}
              />
              <StatTile label="누적 수익(실지급)" value={won(totalRevenue)} />
              <StatTile label="원천징수 합계" value={won(totalTax)} />
              <StatTile label="연결 기업" value={`${activeLinks ?? 0}곳`} />
              <StatTile
                label="섭외 수락"
                value={`${accepted.length}건`}
                hint={`전체 ${engagementRows.length}건 중`}
              />
              <StatTile label="수락률" value={`${acceptanceRate}%`} />
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
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
