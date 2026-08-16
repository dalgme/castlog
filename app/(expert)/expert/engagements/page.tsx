import Link from "next/link";
import { Inbox, FileSignature } from "lucide-react";

import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { formatKrw } from "@/lib/approvals/constants";
import { ENGAGEMENT_STATUS_LABELS } from "@/lib/integrations/engagements";
import { PortalHeader } from "@/components/expert/portal-header";
import { PageIntro, Tag, MetaRow, ENGAGEMENT_TONE } from "@/components/expert/ui";
import { MarkReadOnView } from "@/components/expert/mark-read-on-view";
import { EmptyState } from "@/components/layout/empty-state";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

import { EngagementRespondButtons } from "./respond-buttons";

export const metadata = { title: "섭외 요청" };

/**
 * 전문가 포털 섭외함 — 전 기업 통합 이력 (설계문서 3.2).
 * 각 건은 기업별로 구분 표시. 모바일 완전 대응 최우선.
 */
export default async function ExpertEngagementsPage() {
  const user = await requireUser("/expert/login");

  if (!hasSupabaseEnv() || !user) {
    return (
      <div className="min-h-screen bg-muted">
        <PortalHeader />
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
      <div className="min-h-screen bg-muted">
        <PortalHeader />
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
  const pendingCount = rows.filter(
    (e) =>
      e.status === "requested" &&
      new Date(e.token_expires_at).getTime() >= now
  ).length;

  return (
    <div className="min-h-screen bg-muted">
      <PortalHeader />
      <main className="mx-auto max-w-4xl space-y-4 p-4 sm:p-6">
        <MarkReadOnView categories={["engagement_request", "engagement_cancelled"]} />
        <PageIntro
          eyebrow="ENGAGEMENTS"
          title="섭외 요청"
          description="기업이 보낸 섭외 요청을 확인하고 수락·거절로 응답하세요. 수락 시 계약이 성립됩니다."
          action={
            pendingCount > 0 ? (
              <Tag tone="amber" className="px-3 py-1 text-sm">
                응답 대기 {pendingCount}건
              </Tag>
            ) : undefined
          }
        />

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
              <Card key={engagement.id} className="overflow-hidden shadow-sm">
                {answerable && <div className="h-1 bg-brand-amber" />}
                <CardContent className="pt-5">
                  <div className="flex flex-wrap items-center gap-2">
                    <Inbox className="h-4 w-4 text-brand" aria-hidden />
                    <span className="font-bold text-brand-navy">
                      {engagement.tenants?.name ?? "(기업)"}
                    </span>
                    {engagement.projects?.name && (
                      <span className="text-sm text-muted-foreground">
                        {engagement.projects.name}
                      </span>
                    )}
                    <Tag
                      className="ml-auto"
                      tone={ENGAGEMENT_TONE[engagement.status] ?? "gray"}
                    >
                      {ENGAGEMENT_STATUS_LABELS[engagement.status] ??
                        engagement.status}
                    </Tag>
                  </div>

                  <div className="mt-3 space-y-1.5">
                    <MetaRow label="역할">{engagement.role_description}</MetaRow>
                    {(engagement.starts_on || engagement.ends_on) && (
                      <MetaRow label="기간">
                        {engagement.starts_on ?? "?"} ~ {engagement.ends_on ?? "?"}
                      </MetaRow>
                    )}
                    {engagement.fee_amount !== null && (
                      <MetaRow label="의뢰비용">
                        {formatKrw(engagement.fee_amount)}
                      </MetaRow>
                    )}
                    <MetaRow label="요청 일시">
                      {new Date(engagement.created_at).toLocaleString("ko-KR")}
                    </MetaRow>
                    {answerable && (
                      <p className="text-sm">
                        <span className="mr-2 text-muted-foreground">회신 마감</span>
                        <span className="font-semibold text-[#8A6A00]">
                          {new Date(engagement.token_expires_at).toLocaleString("ko-KR")}
                        </span>
                      </p>
                    )}
                    {engagement.message && (
                      <p className="mt-2 whitespace-pre-wrap rounded-lg bg-[#F2F6FF] p-3 text-sm text-[#33405A]">
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
                  {engagement.status === "accepted" && (
                    <Button
                      asChild
                      variant="outline"
                      size="sm"
                      className="mt-3"
                    >
                      <Link href={`/expert/engagements/${engagement.id}/acceptance`}>
                        <FileSignature className="mr-1.5 h-4 w-4" aria-hidden />
                        섭외수락서 보기
                      </Link>
                    </Button>
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
