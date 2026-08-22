/**
 * 발송 문구 템플릿 (기획 확정 2026-08-22 — CLAUDE.md §14-2 운영 설정화)
 *
 * 문구는 tenant_message_templates에 저장하고, 없으면 아래 기본 문구를 쓴다.
 * 치환 토큰: {URL} 등록 링크(필수) / {회사명} / {이름}(요청 대상자명).
 */

export const EXPERT_INVITE_SMS_KEY = "expert_invite_sms";

export const EXPERT_INVITE_SMS_DEFAULT = `[{회사명}] 전문가 등록 요청
안녕하세요{이름}. {회사명}입니다.
아래 링크에서 전문가 등록을 진행해 주시기 바랍니다.
{URL}

{회사명} 드림`;

/** 토큰 치환 — 이름이 없으면 "안녕하세요." 처럼 자연스럽게 접는다 */
export function renderInviteSms(
  template: string,
  vars: { url: string; tenantName: string; inviteeName: string | null }
): string {
  return template
    .replaceAll("{URL}", vars.url)
    .replaceAll("{회사명}", vars.tenantName)
    .replaceAll("{이름}", vars.inviteeName ? `, ${vars.inviteeName}님` : "");
}

/** 템플릿에 {URL}이 빠지면 링크 없는 문자가 나간다 — 저장 시 검사 */
export function inviteTemplateHasUrl(template: string): boolean {
  return template.includes("{URL}");
}
