import { PublicTokenShell } from "@/components/public/token-shell";

export const metadata = {
  title: "섭외 확인",
  robots: { index: false, follow: false },
};

/** 섭외 동의 매직링크 — 실제 동의 플로우는 단계 13에서 구현 */
export default function EngagementConsentPage({
  params,
}: {
  params: { token: string };
}) {
  return (
    <PublicTokenShell
      title="섭외 확인"
      description="행사 정보와 의뢰 조건을 확인하고 동의 여부를 선택하는 페이지입니다."
      token={params.token}
    />
  );
}
