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
            아직 도입 전이신가요?{" "}
            <Link
              href="/contact?type=trial&source=login"
              className="font-medium text-brand underline-offset-4 hover:underline"
            >
              기업회원 가입
            </Link>
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
