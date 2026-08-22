import { requireRole, getSessionUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { isPersonalMobileSender, normalizeSenderDigits } from "@/lib/sms/send";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { formatKrMobile } from "@/lib/auth/phone";
import { PageHeader } from "@/components/layout/header";
import { EmptyState } from "@/components/layout/empty-state";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

import { ComposeForm, type RecipientOption } from "./compose-form";

export const metadata = { title: "발송" };

const LOG_STATUS_LABELS: Record<string, string> = {
  sent: "발송",
  failed: "실패",
  blocked: "차단",
  test: "테스트 모드 — 실발송 안 됨",
};

const TYPE_LABELS: Record<string, string> = {
  transactional: "업무",
  advertising: "광고",
  auth_otp: "인증",
};

/**
 * 발송 (공통 기반 — CLAUDE.md 5-1·5-2)
 * 자사 공급자(BYO)로 연결 전문가에게 문자·이메일을 발송하고 전 건 기록한다.
 */
export default async function MessagesPage() {
  await requireRole(["platform_admin", "org_admin", "manager", "staff"]);

  if (!hasSupabaseEnv()) {
    return (
      <div>
        <PageHeader title="발송" />
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

  const [{ data: links }, { data: consents }, { data: smsLogs }, { data: emailLogs }] =
    await Promise.all([
      supabase
        .from("expert_tenant_links")
        .select("status, experts (id, name, phone, email)")
        .eq("status", "active"),
      supabase
        .from("ad_consents")
        .select("expert_id, granted, created_at")
        .eq("channel", "sms")
        .order("created_at", { ascending: true }),
      supabase
        .from("sms_logs")
        .select("id, message_type, recipient_phone, status, error_message, created_at, experts (name)")
        .order("created_at", { ascending: false })
        .limit(15),
      supabase
        .from("email_logs")
        .select("id, message_type, recipient_email, status, created_at")
        .order("created_at", { ascending: false })
        .limit(10),
    ]);

  const latestConsent = new Map<string, boolean>();
  for (const consent of consents ?? []) {
    if (consent.expert_id) latestConsent.set(consent.expert_id, consent.granted);
  }

  const recipients: RecipientOption[] = (links ?? [])
    .map((link) => link.experts)
    .filter((e): e is NonNullable<typeof e> => e !== null)
    .map((expert) => ({
      expertId: expert.id,
      name: expert.name,
      phone: formatKrMobile(expert.phone),
      email: expert.email,
      smsAdConsented: latestConsent.get(expert.id) === true,
    }));

  const smsRows = smsLogs ?? [];
  const emailRows = emailLogs ?? [];

  // 발신번호 선택지 (기획 개정 2026-08-22): 기본값은 항상 **회사 대표번호**.
  // 개인 휴대폰(01x)으로 등록된 번호는 그 번호의 본인(휴대폰 일치 직원)에게만
  // 보이고, 본인만 대표번호와 선택적으로 쓸 수 있다. 유선·대표급 번호는 전원 노출.
  const sessionUser = await getSessionUser();
  const [{ data: smsConfig }, sendersResult, { data: me }, { data: tenant }] =
    await Promise.all([
      supabase.from("tenant_sms_configs").select("sender_number").maybeSingle(),
      supabase
        .from("tenant_sms_senders")
        .select("phone, label")
        .order("created_at", { ascending: true }),
      sessionUser
        ? supabase.from("users").select("phone").eq("id", sessionUser.id).maybeSingle()
        : Promise.resolve({ data: null as { phone: string | null } | null }),
      supabase.from("tenants").select("name").maybeSingle(),
    ]);

  const senderOptions: {
    value: string;
    label: string;
    signatureName: string | null;
  }[] = [];
  const seenSenders = new Set<string>();
  if (smsConfig?.sender_number) {
    const digits = normalizeSenderDigits(smsConfig.sender_number);
    seenSenders.add(digits);
    senderOptions.push({
      value: digits,
      label: `${formatKrMobile(digits)} (대표번호)`,
      signatureName: null,
    });
  }
  const myDigits = me?.phone ? normalizeSenderDigits(me.phone) : null;
  // 테이블 미생성(마이그레이션 미적용)이면 error — 대표번호만 노출
  for (const s of sendersResult.error ? [] : (sendersResult.data ?? [])) {
    const digits = normalizeSenderDigits(s.phone);
    if (seenSenders.has(digits)) continue;
    // 개인 휴대폰 번호는 본인에게만 — 타인의 개인 번호는 선택지에서 숨긴다
    if (isPersonalMobileSender(digits) && digits !== myDigits) continue;
    seenSenders.add(digits);
    senderOptions.push({
      value: digits,
      label: s.label ? `${formatKrMobile(digits)} (${s.label})` : formatKrMobile(digits),
      signatureName: s.label ?? null,
    });
  }
  // 기본값은 항상 회사 대표번호 (목록 첫 항목)
  const defaultSender = senderOptions[0]?.value ?? null;

  return (
    <div>
      <PageHeader title="발송" />
      <main className="space-y-5 p-5">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">새 발송</CardTitle>
          </CardHeader>
          <CardContent>
            <ComposeForm
              recipients={recipients}
              senderOptions={senderOptions}
              defaultSender={defaultSender}
              tenantName={tenant?.name ?? ""}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">최근 발송 기록</CardTitle>
          </CardHeader>
          <CardContent>
            {smsRows.length === 0 && emailRows.length === 0 ? (
              <p className="text-sm text-muted-foreground">발송 기록이 없습니다.</p>
            ) : (
              <ul className="divide-y">
                {smsRows.map((log) => (
                  <li
                    key={log.id}
                    className="flex flex-wrap items-center gap-2 py-2 text-sm"
                  >
                    <Badge variant="outline" className="text-[10px]">
                      SMS·{TYPE_LABELS[log.message_type] ?? log.message_type}
                    </Badge>
                    <span className="font-medium">
                      {log.experts?.name ?? formatKrMobile(log.recipient_phone)}
                    </span>
                    <Badge
                      className="ml-auto"
                      variant={log.status === "failed" ? "destructive" : "secondary"}
                    >
                      {LOG_STATUS_LABELS[log.status] ?? log.status}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      {new Date(log.created_at).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}
                    </span>
                    {log.status === "failed" && log.error_message && (
                      <span className="w-full text-xs text-destructive">
                        사유: {log.error_message}
                      </span>
                    )}
                  </li>
                ))}
                {emailRows.map((log) => (
                  <li
                    key={log.id}
                    className="flex flex-wrap items-center gap-2 py-2 text-sm"
                  >
                    <Badge variant="outline" className="text-[10px]">
                      메일·{TYPE_LABELS[log.message_type] ?? log.message_type}
                    </Badge>
                    <span className="font-medium">{log.recipient_email}</span>
                    <Badge
                      className="ml-auto"
                      variant={log.status === "failed" ? "destructive" : "secondary"}
                    >
                      {LOG_STATUS_LABELS[log.status] ?? log.status}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      {new Date(log.created_at).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
