"use client";

import Link from "next/link";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ExpertLoginForm } from "@/app/(expert)/expert/login/login-form";

import { StaffLoginForm } from "./login-form";

/**
 * 통합 로그인 화면 — 기업회원(이메일·비밀번호) / 전문가(휴대폰 인증) 탭.
 * 각 탭에 가입·계정 찾기 진입점을 제공한다.
 * 모바일 완전 대응 (전문가 로그인이 최우선 대상 — 설계문서 8.1).
 */
export function LoginTabs({
  next,
  defaultTab,
}: {
  next: string | null;
  defaultTab: "org" | "expert";
}) {
  return (
    <Tabs defaultValue={defaultTab} className="w-full">
      <TabsList className="grid w-full grid-cols-2">
        <TabsTrigger value="org">기업회원</TabsTrigger>
        <TabsTrigger value="expert">전문가</TabsTrigger>
      </TabsList>

      {/* ── 기업회원: 이메일 + 비밀번호 ── */}
      <TabsContent value="org" className="mt-5 space-y-5">
        <StaffLoginForm next={next} />
        <div className="space-y-2 border-t pt-4 text-center text-sm text-muted-foreground">
          <p>
            아직 계정이 없으신가요?{" "}
            <Link
              href="/contact?type=trial&source=login"
              className="font-medium text-brand underline-offset-4 hover:underline"
            >
              도입 신청하기
            </Link>
          </p>
          {/* 계정을 받은 대표가 비밀번호를 못 찾는 일이 실제로 생긴다 —
              계정은 캐스트로그가 발급하고 비밀번호는 메일 링크로 정하는
              구조라, 메일을 놓치면 들어올 길이 안 보인다 */}
          <p className="text-xs">
            계정을 발급받았는데 비밀번호를 정하지 않으셨다면 아래 ‘비밀번호
            찾기’로 설정하실 수 있습니다.
          </p>
          <p>
            <Link
              href="/forgot-password"
              className="text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            >
              비밀번호를 잊으셨나요?
            </Link>
          </p>
          <p className="text-xs">
            아이디는 가입 시 등록한 <span className="font-medium">이메일 주소</span>입니다.
          </p>
        </div>
      </TabsContent>

      {/* ── 전문가: 휴대폰 OTP (비밀번호 없음) ── */}
      <TabsContent value="expert" className="mt-5 space-y-5">
        <ExpertLoginForm next={next} />
        <div className="space-y-2 border-t pt-4 text-center text-sm text-muted-foreground">
          <p>
            전문가로 활동하고 싶으신가요?{" "}
            <Link
              href="/contact?type=consult&source=expert-signup"
              className="font-medium text-brand underline-offset-4 hover:underline"
            >
              전문가 회원가입
            </Link>
          </p>
          <p className="text-xs leading-relaxed">
            전문가는 휴대폰 인증으로 로그인하며 별도 비밀번호가 없습니다.
            <br />
            번호가 바뀌었다면 소속 기업 담당자에게 문의해 주세요.
          </p>
        </div>
      </TabsContent>
    </Tabs>
  );
}
