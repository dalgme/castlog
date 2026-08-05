import Link from "next/link";

import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { formatKrMobile } from "@/lib/auth/phone";
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

const LINK_STATUS_LABEL: Record<
  string,
  { label: string; variant: "default" | "secondary" | "destructive" }
> = {
  active: { label: "연결됨", variant: "default" },
  pending: { label: "대기중", variant: "secondary" },
  revoked: { label: "해제됨", variant: "destructive" },
};

/**
 * 전문가 포털 — 테넌트에 종속되지 않는 전역 경로 /expert (설계문서 5.2).
 * 전문가는 자신의 전 기업 통합 이력을 볼 수 있다 (설계문서 3.2).
 * 모바일 완전 대응 대상 (설계문서 8.1 최우선).
 */
export default async function ExpertPortalPage() {
  const user = await requireUser("/expert/login");

  const headerActions = (
    <form method="post" action="/auth/logout">
      <Button type="submit" variant="ghost" size="sm">
        로그아웃
      </Button>
    </form>
  );

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
    .select("id, name, phone, email, specialty, region, career_years, bio")
    .eq("auth_user_id", user.id)
    .maybeSingle();

  if (!expert) {
    return (
      <div className="min-h-screen bg-secondary/50">
        <PageHeader title="전문가 포털" actions={headerActions} />
        <main className="p-5">
          <EmptyState
            title="전문가 프로필이 없습니다"
            description="기업에서 받은 등록 링크로 등록을 완료하면 프로필이 생성됩니다."
          />
        </main>
      </div>
    );
  }

  const [{ data: links }, { data: paymentItems }] = await Promise.all([
    supabase
      .from("expert_tenant_links")
      .select("id, status, accepted_at, tenants (name)")
      .eq("expert_id", expert.id)
      .order("created_at", { ascending: false }),
    // 확정·완료된 지급만 보인다 (배치 RLS — 결재 중 내부 문서는 비노출)
    supabase
      .from("expert_payment_items")
      .select(
        `id, gross_amount, withholding_amount, net_amount, created_at,
         expert_payment_batches!inner (status, paid_at, confirmed_at, tenants (name))`
      )
      .eq("expert_id", expert.id)
      .order("created_at", { ascending: false })
      .limit(10),
  ]);

  const linkRows = links ?? [];
  const paymentRows = (paymentItems ?? []).filter(
    (item) => item.expert_payment_batches !== null
  );

  return (
    <div className="min-h-screen bg-secondary/50">
      <PageHeader title="전문가 포털" actions={headerActions} />
      <main className="mx-auto max-w-2xl space-y-4 p-4 sm:p-5">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
            <CardTitle className="text-sm">내 프로필</CardTitle>
            <div className="flex gap-2">
              <Button asChild variant="outline" size="sm">
                <Link href="/expert/engagements">섭외 요청</Link>
              </Button>
              <Button asChild variant="outline" size="sm">
                <Link href="/expert/documents">서류함</Link>
              </Button>
              <Button asChild variant="outline" size="sm">
                <Link href="/expert/profile">수정</Link>
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-1.5 text-sm">
            <p className="text-base font-bold">{expert.name}</p>
            <p className="text-muted-foreground">{formatKrMobile(expert.phone)}</p>
            {expert.email && <p className="text-muted-foreground">{expert.email}</p>}
            <div className="flex flex-wrap gap-x-4 gap-y-1 pt-1 text-muted-foreground">
              {expert.specialty && <span>전문분야: {expert.specialty}</span>}
              {expert.region && <span>지역: {expert.region}</span>}
              {expert.career_years != null && <span>경력: {expert.career_years}년</span>}
            </div>
            {expert.bio && (
              <p className="pt-2 text-muted-foreground">{expert.bio}</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">연결된 기업 ({linkRows.length})</CardTitle>
          </CardHeader>
          <CardContent>
            {linkRows.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                아직 연결된 기업이 없습니다.
              </p>
            ) : (
              <ul className="divide-y">
                {linkRows.map((link) => {
                  const status = LINK_STATUS_LABEL[link.status] ?? {
                    label: "대기중",
                    variant: "secondary" as const,
                  };
                  return (
                    <li
                      key={link.id}
                      className="flex items-center justify-between py-2.5 text-sm"
                    >
                      <span className="font-medium">
                        {link.tenants?.name ?? "(기업 정보 없음)"}
                      </span>
                      <Badge variant={status.variant}>{status.label}</Badge>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">지급 내역 ({paymentRows.length})</CardTitle>
          </CardHeader>
          <CardContent>
            {paymentRows.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                확정된 지급 내역이 없습니다. 지급이 확정되면 여기에 표시됩니다.
              </p>
            ) : (
              <ul className="divide-y">
                {paymentRows.map((item) => {
                  const batch = item.expert_payment_batches;
                  const paid = batch?.status === "paid";
                  return (
                    <li key={item.id} className="py-2.5 text-sm">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">
                          {batch?.tenants?.name ?? "(기업)"}
                        </span>
                        <Badge
                          className="ml-auto"
                          variant={paid ? "secondary" : "default"}
                        >
                          {paid ? "지급 완료" : "지급 확정"}
                        </Badge>
                      </div>
                      <div className="mt-0.5 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted-foreground">
                        <span>
                          실지급{" "}
                          <span className="font-semibold text-foreground">
                            {item.net_amount.toLocaleString("ko-KR")}원
                          </span>
                        </span>
                        <span>계약 {item.gross_amount.toLocaleString("ko-KR")}원</span>
                        <span>
                          원천징수 {item.withholding_amount.toLocaleString("ko-KR")}원
                        </span>
                        {(batch?.paid_at ?? batch?.confirmed_at) && (
                          <span>
                            {new Date(
                              (batch?.paid_at ?? batch?.confirmed_at)!
                            ).toLocaleDateString("ko-KR")}
                          </span>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
            <p className="mt-2 text-xs text-muted-foreground">
              원천징수액은 참고 계산이며 실제 세액은 지급 기업의 신고 기준을
              따릅니다.
            </p>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
