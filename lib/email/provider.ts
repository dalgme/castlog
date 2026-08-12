import "server-only";

/**
 * 이메일 발송 제공자 어댑터 (BYO SMS 패턴을 이메일에 적용 — CLAUDE.md 5-2·14-2)
 *
 * 발송 로직(수신거부 삽입·광고 필터·로그·계측)은 lib/email/send.ts 한 곳에 두고,
 * "실제 전송 수단"만 이 어댑터 뒤로 격리한다. 제공자 교체가 send.ts 수정 없이
 * 환경변수(EMAIL_PROVIDER) 설정으로만 가능해진다.
 *
 * 데이터레지던시 배경·벤더 매트릭스·교체 절차: docs/decisions/email-residency.md
 *
 * ⚠️ 더미 어댑터 금지 (CLAUDE.md 14-7): 자격증명·발신도메인 인증(SPF/DKIM)이
 * 확보되지 않은 제공자는 여기에 "연결된 척"으로 추가하지 않는다. 미구현 제공자를
 * 지정하면 resolveEmailProvider가 null(테스트 모드 — 기록만)을 반환한다.
 */

export type EmailMessage = {
  from: string;
  to: string;
  subject: string;
  text: string;
};

export type EmailProviderResult = { ok: true } | { ok: false; error: string };

export interface EmailProvider {
  readonly id: string;
  send(message: EmailMessage): Promise<EmailProviderResult>;
}

/**
 * Resend 어댑터 (현행 기본 — 기술 스택 확정값 CLAUDE.md 2).
 * 미국 인프라(SES 계열)라 국외이전 이슈가 있어 국내 제공자 교체 대상이다
 * (email-residency.md). 국내 어댑터 확정 전까지 기본값으로 유지한다.
 */
class ResendProvider implements EmailProvider {
  readonly id = "resend";
  constructor(private readonly apiKey: string) {}

  async send(message: EmailMessage): Promise<EmailProviderResult> {
    try {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          from: message.from,
          to: [message.to],
          subject: message.subject,
          text: message.text,
        }),
      });
      if (!response.ok) {
        return {
          ok: false,
          error: `resend ${response.status}: ${(await response.text()).slice(0, 200)}`,
        };
      }
      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : "network",
      };
    }
  }
}

/**
 * 발송 제공자 해석 — 환경변수 EMAIL_PROVIDER 로 선택 (운영 설정화, CLAUDE.md 14-2).
 *
 * - 기본값 'resend': RESEND_API_KEY 있으면 Resend 어댑터, 없으면 null(테스트 모드).
 * - 국내 제공자(예: 'nhncloud'): 자격증명·발신도메인 인증·API 계약이 확정되면
 *   전용 어댑터 클래스를 추가하고 여기서 분기한다. 그 전에는 null을 반환해
 *   무연결 전송을 원천 차단한다(더미 금지). 교체 시 send.ts는 수정하지 않는다.
 *
 * @returns 제공자 인스턴스, 또는 미설정·미구현 시 null(테스트 모드 — 기록만)
 */
export function resolveEmailProvider(): EmailProvider | null {
  const selected = (process.env.EMAIL_PROVIDER ?? "resend").toLowerCase();

  if (selected === "resend") {
    const apiKey = process.env.RESEND_API_KEY;
    return apiKey ? new ResendProvider(apiKey) : null;
  }

  // 국내 데이터레지던시 어댑터는 email-residency.md 결정 후 자격증명 확보 시 추가.
  // 미구현 제공자 지정은 테스트 모드로 강등한다(기록만) — 실제 전송 없음.
  return null;
}
