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

        {/* 이 화면에 비밀번호 입력이 없는 이유를 먼저 말해 준다.
            캐스트로그는 계약(사용 기능 조합)을 확인한 뒤 계정을 발급하는
            구조라 셀프 회원가입이 아니다. 그런데 화면에 그 말이 없으면
            "가입했는데 비밀번호를 못 정했다"로 읽힌다 — 실제로 그랬다. */}
        {!isExpert && (
          <section className="mt-6 rounded-2xl border bg-card p-5">
            <h2 className="text-sm font-bold text-foreground">
              계정은 이렇게 만들어집니다
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              이 화면은 회원가입이 아니라 <b>도입 신청</b>입니다. 그래서
              비밀번호를 여기서 정하지 않습니다.
            </p>
            <ol className="mt-3 space-y-2.5">
              {[
                {
                  t: "신청서 제출",
                  d: "지금 이 화면입니다. 결제·카드 등록은 없습니다.",
                },
                {
                  t: "캐스트로그 확인 · 계정 발급",
                  d: "담당자가 연락드려 사용할 기능 조합을 확인한 뒤 대표 계정을 만듭니다.",
                },
                {
                  t: "비밀번호 설정 메일 수신",
                  d: "계정이 만들어지면 신청하신 이메일로 링크가 갑니다. 그 링크에서 비밀번호를 직접 정하십니다.",
                },
                {
                  t: "로그인",
                  d: "정하신 비밀번호로 로그인합니다. 임직원은 대표가 초대하거나 승인합니다.",
                },
              ].map((step, i) => (
                <li key={step.t} className="flex gap-2.5">
                  <span className="mt-0.5 flex h-5 w-5 flex-none items-center justify-center rounded-full bg-brand text-[11px] font-bold text-white">
                    {i + 1}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-foreground">
                      {step.t}
                    </span>
                    <span className="block text-xs leading-relaxed text-muted-foreground">
                      {step.d}
                    </span>
                  </span>
                </li>
              ))}
            </ol>
            <p className="mt-3 text-xs text-muted-foreground">
              메일이 오지 않으면 로그인 화면의{" "}
              <Link
                href="/forgot-password"
                className="font-medium text-brand underline-offset-4 hover:underline"
              >
                비밀번호 찾기
              </Link>
              로도 받으실 수 있습니다.
            </p>
          </section>
        )}

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
