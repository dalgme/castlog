import Link from "next/link";
import { Inbox, FileSignature } from "lucide-react";

import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { formatKrw } from "@/lib/approvals/constants";
import { ENGAGEMENT_STATUS_LABELS } from "@/lib/integrations/engagements";
import {
  formatEventSchedule,
  roleTypeLabel,
} from "@/lib/integrations/engagement-roles";
import { PortalHeader } from "@/components/expert/portal-header";
import { PageIntro, Tag, MetaRow, ENGAGEMENT_TONE } from "@/components/expert/ui";
import { MarkReadOnView } from "@/components/expert/mark-read-on-view";
import { EmptyState } from "@/components/layout/empty-state";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

import { getPublicTenantBrand } from "@/lib/branding/tenant-logo";

import { EngagementRespondButtons } from "./respond-buttons";
import { ExpertUrgentCancelButton } from "./urgent-cancel-button";

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
      `id, tenant_id, role_description, message, fee_amount, starts_on, ends_on, status,
       responded_at, response_note, created_at, token_expires_at,
       program_name, role_type, starts_time, ends_time,
       location_name, location_address, event_summary,
       tenants (name), projects (name)`
    )
    .eq("expert_id", expert.id)
    .order("created_at", { ascending: false });

  const rows = engagements ?? [];

  // 기업 로고 — 전문가에게 이 목록은 '여러 회사에서 온 요청'이다. 회사를
  // 구분하는 가장 빠른 단서는 이름보다 로고다 (CLAUDE.md §16)
  const brandByTenant = new Map<string, string | null>();
  for (const tenantId of Array.from(new Set(rows.map((e) => e.tenant_id)))) {
    const brand = await getPublicTenantBrand(tenantId);
    brandByTenant.set(tenantId, brand.logoSrc);
  }

  // 취소 사유 — 회수·긴급취소된 건은 '왜'가 함께 보여야 한다. 알림함이 탭
  // 뱃지로 대체된 뒤 사유를 볼 화면이 없었다 (검수 C3)
  const canceledIds = rows.filter((e) => e.status === "canceled").map((e) => e.id);
  const { data: cancellations } = canceledIds.length
    ? await supabase
        .from("engagement_cancellations")
        .select("engagement_id, reason, is_urgent")
        .in("engagement_id", canceledIds)
    : { data: [] };
  const cancellationByEngagement = new Map(
    (cancellations ?? []).map((c) => [
      c.engagement_id,
      { reason: c.reason, isUrgent: c.is_urgent },
    ])
  );

  // 수락서 상태 — '수락'과 '참여 확정'은 다르다. 수락서를 승인해야 확정이다.
  const acceptedIds = rows.filter((e) => e.status === "accepted").map((e) => e.id);
  const { data: acceptances } = acceptedIds.length
    ? await supabase
        .from("engagement_acceptances")
        .select("engagement_id, status")
        .in("engagement_id", acceptedIds)
    : { data: [] };
  const acceptanceStatus = new Map(
    (acceptances ?? []).map((a) => [a.engagement_id, a.status])
  );

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
                    {brandByTenant.get(engagement.tenant_id) ? (
                      <span className="flex h-6 w-6 items-center justify-center rounded border bg-white">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={brandByTenant.get(engagement.tenant_id) ?? ""}
                          alt={engagement.tenants?.name ?? "기업 로고"}
                          className="max-h-5 max-w-5 object-contain"
                        />
                      </span>
                    ) : (
                      <Inbox className="h-4 w-4 text-brand" aria-hidden />
                    )}
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
                    {engagement.program_name && (
                      <MetaRow label="사업명">{engagement.program_name}</MetaRow>
                    )}
                    <MetaRow label="역할">
                      {[
                        roleTypeLabel(engagement.role_type),
                        engagement.role_description,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </MetaRow>
                    {formatEventSchedule(
                      engagement.starts_on,
                      engagement.ends_on,
                      engagement.starts_time,
                      engagement.ends_time
                    ) ? (
                      <MetaRow label="일정">
                        {formatEventSchedule(
                          engagement.starts_on,
                          engagement.ends_on,
                          engagement.starts_time,
                          engagement.ends_time
                        )}
                      </MetaRow>
                    ) : (
                      (engagement.starts_on || engagement.ends_on) && (
                        <MetaRow label="일정">
                          {engagement.starts_on ?? "?"} ~ {engagement.ends_on ?? "?"}
                        </MetaRow>
                      )
                    )}
                    {engagement.location_name && (
                      <MetaRow label="장소">
                        {engagement.location_name}
                        {engagement.location_address
                          ? ` (${engagement.location_address})`
                          : ""}
                      </MetaRow>
                    )}
                    {engagement.event_summary && (
                      <MetaRow label="주제">{engagement.event_summary}</MetaRow>
                    )}
                    {engagement.fee_amount !== null && (
                      <MetaRow label="의뢰비용">
                        {formatKrw(engagement.fee_amount)}
                      </MetaRow>
                    )}
                    <MetaRow label="요청 일시">
                      {new Date(engagement.created_at).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}
                    </MetaRow>
                    {/* 취소된 건의 사유 — 알림이 아니라 카드에서 바로 본다 (검수 C3) */}
                    {engagement.status === "canceled" &&
                      (() => {
                        const c = cancellationByEngagement.get(engagement.id);
                        if (!c) return null;
                        return (
                          <p className="rounded-md border border-destructive/30 bg-destructive/5 p-2 text-sm text-destructive">
                            {c.isUrgent
                              ? "확정 후 취소된 건입니다."
                              : "기업이 요청을 회수했습니다."}
                            {c.reason ? ` 사유: ${c.reason}` : ""}
                          </p>
                        );
                      })()}
                    {answerable && (
                      <p className="text-sm">
                        <span className="mr-2 text-muted-foreground">회신 마감</span>
                        <span className="font-semibold text-[#8A6A00]">
                          {new Date(engagement.token_expires_at).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}
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
                  {engagement.status === "accepted" &&
                    (() => {
                      const letter = acceptanceStatus.get(engagement.id) ?? null;
                      const confirmed = letter === "confirmed";
                      // 아직 승인하지 않은 수락서 — 여기가 지금 할 일이다
                      // 'issued'(작성중 — 아직 송부 전)는 전문가가 할 일이
                      // 아니다. 히어로 집계(sent만)와 정의를 맞춘다 (리뷰 11)
                      const needsApproval = letter === "sent";
                      return (
                        <div className="mt-3 space-y-2">
                          {confirmed && (
                            <div className="rounded-lg border-l-4 border-green-600 bg-green-50 p-2.5">
                              <p className="text-sm font-bold text-green-900">
                                참여 확정
                              </p>
                              <p className="mt-0.5 text-xs text-green-900">
                                수락서 승인이 완료되어 참여가 확정되었습니다.
                              </p>
                            </div>
                          )}
                          {needsApproval && (
                            <div className="rounded-lg border-l-4 border-brand-amber bg-[#FFF7E6] p-2.5">
                              <p className="text-sm font-bold text-[#8A6A00]">
                                수락서 확인·승인이 필요합니다
                              </p>
                              <p className="mt-0.5 text-xs text-[#8A6A00]">
                                수락서를 열어 내용을 확인하고 승인(서명)하시면
                                참여가 확정됩니다.
                              </p>
                            </div>
                          )}
                          <div className="flex flex-wrap items-center gap-2">
                            <Button
                              asChild
                              variant={needsApproval ? "default" : "outline"}
                              size="sm"
                            >
                              <Link
                                href={`/expert/engagements/${engagement.id}/acceptance`}
                              >
                                <FileSignature
                                  className="mr-1.5 h-4 w-4"
                                  aria-hidden
                                />
                                {needsApproval
                                  ? "수락서 확인 및 승인"
                                  : "섭외수락서 보기"}
                              </Link>
                            </Button>
                            {confirmed && (
                              <ExpertUrgentCancelButton
                                engagementId={engagement.id}
                                programName={
                                  engagement.program_name ??
                                  engagement.projects?.name ??
                                  "섭외 건"
                                }
                              />
                            )}
                          </div>
                        </div>
                      );
                    })()}
                </CardContent>
              </Card>
            );
          })
        )}
      </main>
    </div>
  );
}
