import { PublicTokenShell } from "@/components/public/token-shell";

export const metadata = {
  title: "수신거부",
  robots: { index: false, follow: false },
};

/**
 * 광고성 정보 수신거부 — 정보통신망법상 광고성 발송에 필수 (설계문서 6.5).
 * 즉시 철회 처리 + 결과 통지는 단계 14에서 구현.
 */
export default function UnsubscribePage({
  params,
}: {
  params: { token: string };
}) {
  return (
    <PublicTokenShell
      title="수신거부"
      description="광고성 정보 수신 동의를 철회하는 페이지입니다. 철회 즉시 광고성 발송 대상에서 제외됩니다."
      token={params.token}
    />
  );
}
