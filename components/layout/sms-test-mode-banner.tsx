import Link from "next/link";

import { isSmsTestMode } from "@/lib/sms/providers";

/**
 * 서버가 SMS 테스트 모드(SMS_TEST_MODE=true)면 모든 문자가 발송 이력에만
 * 기록되고 실제로는 나가지 않는다. 설정 화면에만 적어 두면 섭외 문자를 보내는
 * 담당자는 "보냈다"고 믿는다 — 켜져 있는 동안 셸 상단에 상시 표시한다
 * (E2E 검수 전문가 P2-6).
 */
export function SmsTestModeBanner({ tenantSlug }: { tenantSlug: string }) {
  if (!isSmsTestMode()) return null;
  return (
    <div
      role="status"
      className="border-b border-amber-300 bg-amber-50 px-4 py-2 text-xs leading-relaxed text-amber-900"
    >
      <b>SMS 테스트 모드</b> — 지금 보내는 문자는 발송 이력에만 기록되고
      전문가에게 실제로 가지 않습니다. 실발송 전환은 캐스트로그 운영에 요청해
      주세요.{" "}
      <Link
        href={`/${tenantSlug}/settings`}
        className="font-semibold underline underline-offset-4"
      >
        설정에서 확인
      </Link>
    </div>
  );
}
