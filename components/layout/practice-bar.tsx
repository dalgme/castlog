"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { GraduationCap, LogOut } from "lucide-react";

import { Button } from "@/components/ui/button";

import { enterPractice, exitPractice } from "@/lib/practice/actions";

/**
 * 연습모드 진입/종료 바.
 *
 * 연습 중에는 화면 최상단에 항상 띠가 보인다 — 연습인 줄 모르고 실제 업무를
 * 입력하는 사고를 막는 게 이 띠의 존재 이유다. 색·문구를 은근하게 두지 않는다.
 */
export function PracticeBar({ practice }: { practice: boolean }) {
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
      if (res.ok) {
        router.refresh();
      } else {
        setError(res.error);
      }
    });
  }

  if (!practice) {
    return (
      <div className="flex items-center justify-end gap-2 border-b bg-card px-4 py-1.5">
        {error && <span className="text-xs text-destructive">{error}</span>}
        <Button
          size="sm"
          variant="outline"
          className="h-7 gap-1.5 text-xs"
          disabled={pending}
          onClick={() => toggle(true)}
        >
          <GraduationCap className="h-3.5 w-3.5" />
          {pending ? "전환 중..." : "연습모드"}
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b-2 border-amber-400 bg-amber-100 px-4 py-2 text-amber-950">
      <span className="inline-flex items-center gap-1.5 text-sm font-bold">
        <GraduationCap className="h-4 w-4" />
        연습모드
      </span>
      <span className="text-xs">
        지금 보이는 프로젝트·전문가·결재는 모두 가상입니다. 실제 데이터는 표시되지
        않고, 문자·이메일도 발송되지 않습니다.
      </span>
      {error && <span className="text-xs font-medium text-destructive">{error}</span>}
      <Button
        size="sm"
        variant="outline"
        className="ml-auto h-7 gap-1.5 border-amber-500 bg-white text-xs hover:bg-amber-50"
        disabled={pending}
        onClick={() => toggle(false)}
      >
        <LogOut className="h-3.5 w-3.5" />
        {pending ? "전환 중..." : "연습모드 종료"}
      </Button>
    </div>
  );
}
