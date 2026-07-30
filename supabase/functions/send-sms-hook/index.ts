/**
 * Supabase Auth — Send SMS Hook (인증 OTP 전용)
 *
 * 구조 (CLAUDE.md 5-2):
 *  - 인증 OTP는 테넌트 귀속이 불가능한 전역 발송 → 플랫폼 운영사(넥스트랩)의
 *    솔라피 계정으로 발송한다. 실연동은 단계 14에서 이 스텁을 교체.
 *  - 업무·광고 SMS는 이 Hook과 무관 — 테넌트별 BYO 공급자(단계 14).
 *
 * 현재 상태: 개발용 스텁.
 *  - 실발송 없이 명시적 오류를 반환한다 (실번호로 시도 시 즉시 "발송 실패"로 표시).
 *  - 대시보드의 Test Phone Numbers는 이 Hook을 거치지 않으므로 개발·테스트에 지장 없음.
 *  - 단계 14 교체 시: 표준 웹훅 서명 검증(SEND_SMS_HOOK_SECRET) + 솔라피 API 호출 +
 *    sms_logs 기록을 추가한다. OTP 값은 어떤 경우에도 로그에 남기지 않는다.
 */

Deno.serve(() => {
  return new Response(
    JSON.stringify({
      error: {
        http_code: 400,
        message:
          "SMS 발송이 아직 구성되지 않았습니다 (개발 모드). 테스트 번호를 사용하세요.",
      },
    }),
    { status: 400, headers: { "Content-Type": "application/json" } }
  );
});
