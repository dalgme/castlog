import { PublicTokenShell } from "@/components/public/token-shell";

export const metadata = {
  title: "전문가 등록",
  robots: { index: false, follow: false },
};

/** 전문가 등록 요청(신규 가입 유도) — 단계 6에서 구현 */
export default function ExpertJoinPage({
  params,
}: {
  params: { token: string };
}) {
  return (
    <PublicTokenShell
      title="전문가 등록"
      description="기업의 전문가 풀 등록 요청을 수락하고 계정을 만드는 페이지입니다."
      token={params.token}
    />
  );
}
