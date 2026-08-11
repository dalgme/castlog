import type { Metadata } from "next";
import Link from "next/link";

import { type InquiryType } from "@/lib/inquiries/schemas";
import { InquiryForm } from "./inquiry-form";

export const metadata: Metadata = {
  title: "도입 문의 · 무료 체험 신청 — CASTLOG 캐스트로그",
  description:
    "캐스트로그 도입 상담과 30일 무료 체험을 신청하세요. 담당자가 직접 안내해 드립니다.",
};

function resolveType(value: string | undefined): InquiryType {
  return value === "consult" ? "consult" : "trial";
}

export default function ContactPage({
  searchParams,
}: {
  searchParams?: { type?: string; source?: string };
}) {
  const initialType = resolveType(searchParams?.type);
  const source =
    typeof searchParams?.source === "string" ? searchParams.source : undefined;
  const isExpert = source === "expert-signup";

  const heading = isExpert ? "전문가 관심 등록" : "도입 문의 · 무료 체험 신청";
  const intro = isExpert
    ? "전문가로 활동하고 싶으신가요? 관심 등록을 남겨주시면 담당자가 연락드립니다. 실제 등록은 소속 기업이 보내는 초대 링크로 진행됩니다."
    : "신청서를 남겨주시면 담당자가 직접 연락드려 30일 무료 체험 계정을 안내해 드립니다. 카드 등록·결제 없이 시작할 수 있습니다.";

  return (
    <main className="min-h-screen bg-muted/30 px-4 py-12 sm:py-16">
      <div className="mx-auto w-full max-w-lg">
        <Link
          href="/"
          className="mb-6 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M15 18l-6-6 6-6" />
          </svg>
          캐스트로그 홈으로
        </Link>

        <div className="rounded-2xl border bg-card p-6 shadow-sm sm:p-8">
          <div className="mb-6 space-y-2">
            <h1 className="text-2xl font-bold tracking-tight text-foreground">
              {heading}
            </h1>
            <p className="text-sm text-muted-foreground">{intro}</p>
          </div>

          <InquiryForm initialType={initialType} source={source} />
        </div>

        <p className="mt-6 text-center text-sm text-muted-foreground">
          이미 계정이 있으신가요?{" "}
          <Link
            href="/login"
            className="font-medium text-brand underline-offset-4 hover:underline"
          >
            로그인
          </Link>
        </p>
      </div>
    </main>
  );
}
