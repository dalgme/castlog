import { PublicTokenShell } from "@/components/public/token-shell";

export const metadata = {
  title: "서류 제출",
  robots: { index: false, follow: false },
};

/** 서류 제출·갱신(기존 전문가 대상) — 단계 7에서 구현 */
export default function DocumentSubmitPage({
  params,
}: {
  params: { token: string };
}) {
  return (
    <PublicTokenShell
      title="서류 제출"
      description="이력서·통장사본 등 서류를 제출하거나 갱신하는 페이지입니다."
      token={params.token}
    />
  );
}
