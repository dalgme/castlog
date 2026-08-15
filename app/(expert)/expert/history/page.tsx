import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { PortalHeader } from "@/components/expert/portal-header";
import { PageIntro, Tag, type TagTone } from "@/components/expert/ui";
import { EmptyState } from "@/components/layout/empty-state";
import { Card, CardContent } from "@/components/ui/card";

export const metadata = { title: "히스토리" };

const won = (value: number | null | undefined) =>
  `${(value ?? 0).toLocaleString("ko-KR")}원`;

const DOT_COLOR: Record<TagTone, string> = {
  blue: "bg-brand",
  amber: "bg-brand-amber",
  green: "bg-[#1E7E45]",
  red: "bg-[#C0392B]",
  gray: "bg-[#9AA6B8]",
  wait: "bg-[#C5CDD9]",
};

type TimelineEvent = {
  key: string;
  at: number;
  dateLabel: string;
  title: string;
  detail: string;
  tenantName: string;
  badge: string;
  tone: TagTone;
};

/**
 * 전문가 포털 — 히스토리 (설계문서 3.2 전 기업 통합 이력).
 * 섭외 응답 이력과 지급 이력을 하나의 시간순 타임라인으로 통합해 보여준다.
 * 각 이벤트에 소속 기업을 명시(테넌트 격리). 수익 합산 등 교차 집계는 하지 않는다.
 */
export default async function ExpertHistoryPage() {
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
            description="등록 링크로 등록을 완료하면 활동 이력이 표시됩니다."
          />
        </main>
      </div>
    );
  }

  const [{ data: engagements }, { data: payments }] = await Promise.all([
    supabase
      .from("expert_engagements")
      .select(
        `id, role_description, status, created_at, responded_at,
         tenants (name), projects (name)`
      )
      .eq("expert_id", expert.id)
      .order("created_at", { ascending: false }),
    supabase
      .from("expert_portal_payments")
      .select(
        "id, net_amount, withholding_amount, status, paid_at, confirmed_at, tenant_name"
      )
      .order("created_at", { ascending: false })
      .limit(200),
  ]);

  const fmt = (iso: string) => new Date(iso).toLocaleDateString("ko-KR");
  const events: TimelineEvent[] = [];

  for (const e of engagements ?? []) {
    const tenantName = e.tenants?.name ?? "(기업)";
    const context = e.projects?.name
      ? `${e.projects.name} · ${e.role_description}`
      : e.role_description;
    events.push({
      key: `eng-req-${e.id}`,
      at: new Date(e.created_at).getTime(),
      dateLabel: fmt(e.created_at),
      title: "섭외 요청 접수",
      detail: context,
      tenantName,
      badge: "요청",
      tone: "blue",
    });
    if (e.responded_at && e.status !== "requested") {
      const accepted = e.status === "accepted";
      events.push({
        key: `eng-res-${e.id}`,
        at: new Date(e.responded_at).getTime(),
        dateLabel: fmt(e.responded_at),
        title: accepted ? "섭외 수락(계약 성립)" : "섭외 응답",
        detail: context,
        tenantName,
        badge: accepted
          ? "수락"
          : e.status === "declined"
            ? "반려"
            : e.status === "canceled"
              ? "취소"
              : e.status,
        tone: accepted ? "green" : e.status === "declined" ? "red" : "gray",
      });
    }
  }

  for (const p of payments ?? []) {
    const paid = p.status === "paid";
    const when = paid ? p.paid_at : p.confirmed_at;
    if (!when) continue;
    events.push({
      key: `pay-${p.id}`,
      at: new Date(when).getTime(),
      dateLabel: fmt(when),
      title: paid ? "지급 완료" : "지급 확정",
      detail: `실지급 ${won(p.net_amount)} · 원천징수 ${won(p.withholding_amount)}`,
      tenantName: p.tenant_name ?? "(기업)",
      badge: paid ? "지급완료" : "지급확정",
      tone: paid ? "green" : "blue",
    });
  }

  events.sort((a, b) => b.at - a.at);

  return (
    <div className="min-h-screen bg-muted">
      <PortalHeader />
      <main className="mx-auto max-w-4xl space-y-4 p-4 sm:p-6">
        <PageIntro
          eyebrow="HISTORY"
          title="히스토리"
          description="섭외 응답과 지급 내역을 시간순 타임라인으로 모아 봅니다. 전 기업 통합 이력입니다."
        />

        {events.length === 0 ? (
          <EmptyState
            title="활동 이력이 없습니다"
            description="섭외 응답과 지급이 발생하면 시간순으로 기록됩니다."
          />
        ) : (
          <Card className="shadow-sm">
            <CardContent className="pt-5">
              <ol className="relative space-y-5 border-l border-dashed border-[#D9DFE9] pl-5">
                {events.map((ev) => (
                  <li key={ev.key} className="relative">
                    <span
                      className={`absolute -left-[26px] top-1 h-3 w-3 rounded-full ring-4 ring-background ${DOT_COLOR[ev.tone]}`}
                      aria-hidden
                    />
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-bold text-brand-navy">
                        {ev.title}
                      </span>
                      <Tag tone={ev.tone}>{ev.badge}</Tag>
                      <span className="ml-auto text-xs text-muted-foreground">
                        {ev.dateLabel}
                      </span>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                      <span className="font-medium text-[#46536A]">
                        {ev.tenantName}
                      </span>
                      <span>·</span>
                      <span>{ev.detail}</span>
                    </div>
                  </li>
                ))}
              </ol>
              <p className="mt-4 border-t pt-3 text-xs text-muted-foreground">
                원천징수액은 참고 계산이며 실제 세액은 지급 기업의 신고 기준을
                따릅니다.
              </p>
            </CardContent>
          </Card>
        )}
      </main>
    </div>
  );
}
