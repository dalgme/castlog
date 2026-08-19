"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { GraduationCap, LogOut } from "lucide-react";

import { Button } from "@/components/ui/button";

import { enterPractice, exitPractice } from "@/lib/practice/actions";

/**
 * 연습모드 전환 버튼 — 상단 바에 상주한다.
 *
 * 계정·로그아웃과 같은 줄에 두는 이유: 연습모드는 '지금 내가 어떤 자리에 있는가'
 * 를 정하는 것이라, 로그인 계정과 같은 성격이다. 화면마다 다른 자리에 있으면
 * 급할 때 못 찾는다.
 *
 * 켜져 있을 때의 경고 띠(PracticeBar)는 따로 유지한다 — 버튼 하나로는
 * "지금 연습 중"이 충분히 눈에 띄지 않는다.
 */
export function PracticeToggle({ practice }: { practice: boolean }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function toggle(next: boolean) {
    if (
      next &&
      !window.confirm(
        "연습모드로 들어갑니다.\n\n연습모드에서는 실제 프로젝트·전문가·결재가 보이지 않고, 가상 전문가로 구성된 연습 환경만 표시됩니다. 문자·이메일은 실제로 발송되지 않습니다."
      )
    ) {
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = next ? await enterPractice() : await exitPractice();
      if (res.ok) router.refresh();
      else setError(res.error);
    });
  }

  return (
    <span className="flex items-center gap-1.5">
      {error && (
        <span className="hidden text-xs text-destructive sm:inline">{error}</span>
      )}
      <Button
        size="sm"
        variant="outline"
        className={
          practice
            ? "h-8 gap-1.5 border-amber-500 bg-amber-50 text-xs font-semibold text-amber-900 hover:bg-amber-100"
            : "h-8 gap-1.5 text-xs"
        }
        disabled={pending}
        onClick={() => toggle(!practice)}
      >
        {practice ? (
          <LogOut className="h-3.5 w-3.5" />
        ) : (
          <GraduationCap className="h-3.5 w-3.5" />
        )}
        {pending ? "전환 중…" : practice ? "연습모드 종료" : "연습모드"}
      </Button>
    </span>
  );
}
