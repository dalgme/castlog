import Link from "next/link";

import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { formatKrw } from "@/lib/approvals/constants";
import { ENGAGEMENT_STATUS_LABELS } from "@/lib/integrations/engagements";
import { PageHeader } from "@/components/layout/header";
import { EmptyState } from "@/components/layout/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

import { EngagementRespondButtons } from "./respond-buttons";

export const metadata = { title: "섭외 요청" };

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  requested: "default",
  accepted: "secondary",
  declined: "destructive",
  canceled: "outline",
  expired: "outline",
};

/**
 * 전문가 포털 섭외함 — 전 기업 통합 이력 (설계문서 3.2).
 * 각 건은 기업별로 구분 표시. 모바일 완전 대응 최우선.
 */
export default async function ExpertEngagementsPage() {
  const user = await requireUser("/expert/login");

  const headerActions = (
    <Button asChild variant="ghost" size="sm">
      <Link href="/expert">돌아가기</Link>
    </Button>
  );

  if (!hasSupabaseEnv() || !user) {
    return (
      <div className="min-h-screen bg-secondary/50">
        <PageHeader title="섭외 요청" actions={headerActions} />
        <main className="p-5">
          <EmptyState
            title="서버 설정 대기 중"
            description="Supabase 환경변수가 설정되면 표시됩니다."
          />
        </main>
      </div>
    );
  }

  const supabase = createClient();
  const { data: expert } = await supabase
    .from("experts")
    .select("id")
    .eq("auth_user_id", user.id)
    .maybeSingle();

  if (!expert) {
    return (
      <div className="min-h-screen bg-secondary/50">
        <PageHeader title="섭외 요청" actions={headerActions} />
        <main className="p-5">
          <EmptyState
            title="전문가 프로필이 없습니다"
            description="등록 링크로 등록을 완료하면 섭외 요청을 받을 수 있습니다."
          />
        </main>
      </div>
    );
  }

  const { data: engagements } = await supabase
    .from("expert_engagements")
    .select(
      `id, role_description, message, fee_amount, starts_on, ends_on, status,
       responded_at, response_note, created_at, token_expires_at,
       tenants (name), projects (name)`
    )
    .eq("expert_id", expert.id)
    .order("created_at", { ascending: false });

  const rows = engagements ?? [];
  const now = Date.now();

  return (
    <div className="min-h-screen bg-secondary/50">
      <PageHeader title="섭외 요청" actions={headerActions} />
      <main className="mx-auto max-w-2xl space-y-3 p-4 sm:p-5">
        {rows.length === 0 ? (
          <EmptyState
            title="섭외 요청이 없습니다"
            description="기업이 섭외를 요청하면 여기에 표시됩니다."
          />
        ) : (
          rows.map((engagement) => {
            const answerable =
              engagement.status === "requested" &&
              new Date(engagement.token_expires_at).getTime() >= now;
            return (
              <Card key={engagement.id}>
                <CardContent className="pt-5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">
                      {engagement.tenants?.name ?? "(기업)"}
                    </span>
                    {engagement.projects?.name && (
                      <span className="text-sm text-muted-foreground">
                        {engagement.projects.name}
                      </span>
                    )}
                    <Badge
                      className="ml-auto"
                      variant={STATUS_VARIANT[engagement.status] ?? "secondary"}
                    >
                      {ENGAGEMENT_STATUS_LABELS[engagement.status] ??
                        engagement.status}
                    </Badge>
                  </div>
                  <div className="mt-2 space-y-1 text-sm">
                    <p>
                      <span className="text-muted-foreground">역할</span>{" "}
                      {engagement.role_description}
                    </p>
                    {(engagement.starts_on || engagement.ends_on) && (
                      <p>
                        <span className="text-muted-foreground">기간</span>{" "}
                        {engagement.starts_on ?? "?"} ~ {engagement.ends_on ?? "?"}
                      </p>
                    )}
                    {engagement.fee_amount !== null && (
                      <p>
                        <span className="text-muted-foreground">의뢰비용</span>{" "}
                        {formatKrw(engagement.fee_amount)}
                      </p>
                    )}
                    {engagement.message && (
                      <p className="whitespace-pre-wrap rounded-md bg-secondary/60 p-2 text-muted-foreground">
                        {engagement.message}
                      </p>
                    )}
                    {engagement.response_note && (
                      <p className="text-xs text-muted-foreground">
                        내 의견: “{engagement.response_note}”
                      </p>
                    )}
                  </div>
                  {answerable && (
                    <EngagementRespondButtons engagementId={engagement.id} />
                  )}
                </CardContent>
              </Card>
            );
          })
        )}
      </main>
    </div>
  );
}
