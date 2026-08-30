import { requireRole } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { parseMonitorUntil } from "@/lib/monitoring/flags";
import { maskRrnInText } from "@/lib/crypto/rrn-mask";
import { auditActionLabel, auditRoleLabel } from "@/lib/audit/labels";
import { PageHeader } from "@/components/layout/header";
import { EmptyState } from "@/components/layout/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

import { AutoRefresh } from "../auto-refresh";
import { InterpretButton } from "../interpret-button";
import { MonitorToggle } from "../monitor-toggle";

export const metadata = { title: "활동 피드 — 실시간 모니터링" };
// 실시간 화면 — 빌드 시점 프리렌더(정적 스냅샷) 금지
export const dynamic = "force-dynamic";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type FeedItem = {
  key: string;
  at: string;
  kind: "error" | "denial" | "audit" | "event" | "sms" | "email" | "feedback";
  title: string;
  detail: string | null;
  practice: boolean;
  errorId?: string;
};

const KIND_META: Record<
  FeedItem["kind"],
  { label: string; className: string }
> = {
  error: { label: "에러", className: "bg-red-100 text-red-800" },
  denial: { label: "규칙 거부", className: "bg-orange-100 text-orange-800" },
  audit: { label: "행위", className: "bg-slate-100 text-slate-700" },
  event: { label: "섭외", className: "bg-blue-100 text-blue-800" },
  sms: { label: "문자", className: "bg-amber-100 text-amber-800" },
  email: { label: "메일", className: "bg-amber-100 text-amber-800" },
  feedback: { label: "챗봇 신고", className: "bg-purple-100 text-purple-800" },
};

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("ko-KR", {
    timeZone: "Asia/Seoul",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

/**
 * 테넌트 활동 피드 — 모니터링 창 동안의 행위·에러·발송·챗봇 신고를 한 줄로.
 *
 * service_role 조회다: 이 화면은 requireRole(platform_admin)이 지키고,
 * 여러 로그 테이블(전문가 이벤트·발송 로그)은 테넌트 세션 기준 RLS라
 * 플랫폼관리자 세션으로는 애초에 읽히지 않는다. 민감값 노출을 줄이기 위해
 * 발송 본문·에러 메시지 전문은 싣지 않고 요약만 표시한다.
 */
export default async function MonitorFeedPage({
  params,
}: {
  params: { tenantId: string };
}) {
  await requireRole(["platform_admin"]);

  const backButton = (
    <Button asChild variant="outline" size="sm">
      <a href="/platform-admin/monitoring">← 모니터링 목록</a>
    </Button>
  );

  if (!hasSupabaseEnv() || !UUID.test(params.tenantId)) {
    return (
      <main className="p-6">
        <PageHeader title="활동 피드" actions={backButton} />
        <EmptyState title="테넌트를 확인할 수 없습니다" />
      </main>
    );
  }

  const admin = createAdminClient();
  const { data: tenant } = await admin
    .from("tenants")
    .select("id, name, slug, feature_flags")
    .eq("id", params.tenantId)
    .maybeSingle();
  if (!tenant) {
    return (
      <main className="p-6">
        <PageHeader title="활동 피드" actions={backButton} />
        <EmptyState title="테넌트를 확인할 수 없습니다" />
      </main>
    );
  }

  const until = parseMonitorUntil(tenant.feature_flags);
  const active = until !== null && Date.parse(until) > Date.now();
  // 창이 열려 있으면 창 시작을 짐작할 수 없으므로 최근 24시간을 본다
  const sinceIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const PER_SOURCE = 60;

  const [errors, audits, denials, events, sms, emails, feedback] =
    await Promise.all([
    admin
      .from("client_error_logs")
      .select("id, path, message, error_digest, source, is_practice, created_at")
      .eq("tenant_id", tenant.id)
      .gte("created_at", sinceIso)
      .order("created_at", { ascending: false })
      .limit(PER_SOURCE),
    admin
      .from("audit_logs")
      .select("id, action, actor_role, resource_type, created_at")
      .eq("tenant_id", tenant.id)
      .neq("action", "action.denied")
      .gte("created_at", sinceIso)
      .order("created_at", { ascending: false })
      .limit(PER_SOURCE),
    // 규칙 거부는 별도 쿼리 — 일반 행위 로그와 60행 예산을 나눠 쓰면
    // 활발한 테넌트에서 거부가 밀려나 타일이 0으로 왜곡된다 (리뷰 4).
    // after_data도 이 쿼리에서만 끌어온다.
    admin
      .from("audit_logs")
      .select("id, actor_role, after_data, created_at")
      .eq("tenant_id", tenant.id)
      .eq("action", "action.denied")
      .gte("created_at", sinceIso)
      .order("created_at", { ascending: false })
      .limit(PER_SOURCE),
    admin
      .from("engagement_events")
      .select("id, event_type, actor_label, actor_kind, note, is_practice, created_at")
      .eq("tenant_id", tenant.id)
      .gte("created_at", sinceIso)
      .order("created_at", { ascending: false })
      .limit(PER_SOURCE),
    admin
      .from("sms_logs")
      .select("id, message_type, status, error_message, created_at")
      .eq("tenant_id", tenant.id)
      .gte("created_at", sinceIso)
      .order("created_at", { ascending: false })
      .limit(PER_SOURCE),
    admin
      .from("email_logs")
      .select("id, message_type, status, error_message, created_at")
      .eq("tenant_id", tenant.id)
      .gte("created_at", sinceIso)
      .order("created_at", { ascending: false })
      .limit(PER_SOURCE),
    admin
      .from("help_feedback")
      .select("id, kind, title, path, is_practice, created_at")
      .eq("tenant_id", tenant.id)
      .gte("created_at", sinceIso)
      .order("created_at", { ascending: false })
      .limit(PER_SOURCE),
  ]);

  const items: FeedItem[] = [
    ...(errors.data ?? []).map(
      (r): FeedItem => ({
        key: `err-${r.id}`,
        at: r.created_at,
        kind: "error",
        title: r.message.slice(0, 160),
        detail: [r.path, r.error_digest ? `digest ${r.error_digest}` : null]
          .filter(Boolean)
          .join(" · "),
        practice: r.is_practice,
        errorId: r.id,
      })
    ),
    ...(audits.data ?? []).map(
      (r): FeedItem => ({
        key: `aud-${r.id}`,
        at: r.created_at,
        kind: "audit",
        title: auditActionLabel(r.action),
        detail: `${auditRoleLabel(r.actor_role)} · ${r.resource_type}`,
        practice: false,
      })
    ),
    // 규칙 거부 — 테스트 중 "안 돼요"의 대부분이 여기다
    ...(denials.data ?? []).map((r): FeedItem => {
      const extra =
        r.after_data !== null &&
        typeof r.after_data === "object" &&
        !Array.isArray(r.after_data)
          ? (r.after_data as {
              kind?: unknown;
              message?: unknown;
              path?: unknown;
              practice?: unknown;
            })
          : {};
      return {
        key: `den-${r.id}`,
        at: r.created_at,
        kind: "denial",
        title:
          typeof extra.message === "string"
            ? extra.message.slice(0, 160)
            : "실행이 규칙에 따라 거부되었습니다",
        detail: [
          auditRoleLabel(r.actor_role),
          typeof extra.kind === "string" ? extra.kind : null,
          typeof extra.path === "string" ? extra.path : null,
        ]
          .filter(Boolean)
          .join(" · "),
        practice: extra.practice === true,
      };
    }),
    ...(events.data ?? []).map(
      (r): FeedItem => ({
        key: `evt-${r.id}`,
        at: r.created_at,
        kind: "event",
        title: `${r.event_type} — ${r.actor_label}`,
        // 담당자가 쓴 자유 텍스트 — 마스킹 + 길이 제한 (원문 미노출 원칙, 리뷰 4)
        detail: r.note ? maskRrnInText(r.note).slice(0, 120) : null,
        practice: r.is_practice,
      })
    ),
    ...(sms.data ?? []).map(
      (r): FeedItem => ({
        key: `sms-${r.id}`,
        at: r.created_at,
        kind: "sms",
        title: `문자 ${r.status}`,
        detail: [r.message_type, r.error_message].filter(Boolean).join(" · "),
        practice: false,
      })
    ),
    ...(emails.data ?? []).map(
      (r): FeedItem => ({
        key: `eml-${r.id}`,
        at: r.created_at,
        kind: "email",
        title: `이메일 ${r.status}`,
        detail: [r.message_type, r.error_message].filter(Boolean).join(" · "),
        practice: false,
      })
    ),
    ...(feedback.data ?? []).map(
      (r): FeedItem => ({
        key: `fb-${r.id}`,
        at: r.created_at,
        kind: "feedback",
        title: `[${r.kind}] ${r.title}`,
        detail: r.path,
        practice: r.is_practice,
      })
    ),
  ]
    .sort((a, b) => (a.at < b.at ? 1 : -1))
    .slice(0, 200);

  const errorCount = (errors.data ?? []).length;
  const denialCount = (denials.data ?? []).length;
  const failedSends =
    (sms.data ?? []).filter((r) => r.status === "failed").length +
    (emails.data ?? []).filter((r) => r.status === "failed").length;
  const feedbackCount = (feedback.data ?? []).length;

  return (
    <main className="space-y-5 p-6">
      <PageHeader
        title={`활동 피드 — ${tenant.name}`}
        actions={
          <div className="flex items-center gap-2">
            <MonitorToggle tenantId={tenant.id} active={active} />
            {backButton}
          </div>
        }
      />

      <div className="flex flex-wrap items-center gap-4">
        {active && until ? (
          <Badge className="bg-emerald-600 hover:bg-emerald-600">
            모니터링 켜짐 ·{" "}
            {new Date(until).toLocaleTimeString("ko-KR", {
              timeZone: "Asia/Seoul",
              hour: "2-digit",
              minute: "2-digit",
            })}
            까지
          </Badge>
        ) : (
          <Badge variant="outline">모니터링 꺼짐 — 최근 24시간 기록만 표시</Badge>
        )}
        <AutoRefresh />
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <div className="rounded-xl border bg-card p-3">
          <p className="text-2xl font-bold tabular-nums">{items.length}</p>
          <p className="text-xs text-muted-foreground">최근 24시간 활동</p>
        </div>
        <div className="rounded-xl border bg-card p-3">
          <p className="text-2xl font-bold tabular-nums text-red-600">
            {errorCount}
          </p>
          <p className="text-xs text-muted-foreground">런타임 에러</p>
        </div>
        <div className="rounded-xl border bg-card p-3">
          <p className="text-2xl font-bold tabular-nums text-orange-600">
            {denialCount}
          </p>
          <p className="text-xs text-muted-foreground">규칙 거부</p>
        </div>
        <div className="rounded-xl border bg-card p-3">
          <p className="text-2xl font-bold tabular-nums">{failedSends}</p>
          <p className="text-xs text-muted-foreground">발송 실패</p>
        </div>
        <div className="rounded-xl border bg-card p-3">
          <p className="text-2xl font-bold tabular-nums">{feedbackCount}</p>
          <p className="text-xs text-muted-foreground">챗봇 신고·의견</p>
        </div>
      </div>

      <div className="rounded-xl border bg-card">
        {items.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-muted-foreground">
            최근 24시간 활동이 없습니다.
          </p>
        ) : (
          <ul className="divide-y">
            {items.map((item) => {
              const meta = KIND_META[item.kind];
              return (
                <li key={item.key} className="px-4 py-2.5">
                  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                    <span className="font-mono text-xs tabular-nums text-muted-foreground">
                      {fmtTime(item.at)}
                    </span>
                    <span
                      className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${meta.className}`}
                    >
                      {meta.label}
                    </span>
                    {item.practice && (
                      <span className="rounded bg-secondary px-1.5 py-0.5 text-[11px] text-muted-foreground">
                        연습
                      </span>
                    )}
                    <span className="text-sm">{item.title}</span>
                  </div>
                  {item.detail && (
                    <p className="mt-0.5 pl-1 text-xs text-muted-foreground">
                      {item.detail}
                    </p>
                  )}
                  {item.errorId && <InterpretButton errorId={item.errorId} />}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        발송 본문·에러 전문은 이 화면에 싣지 않습니다. 챗봇 신고의 처리 상태는{" "}
        <a href="/platform-admin/help-board" className="underline">
          챗봇 상담게시판
        </a>
        에서 관리하세요.
      </p>
    </main>
  );
}
