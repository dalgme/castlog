"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ListChecks } from "lucide-react";

import { Button } from "@/components/ui/button";

import { createDefaultSteps } from "../actions";

/**
 * 기본 21스텝 만들기 — operations 모듈을 나중에 켠 회사의 기존 프로젝트용.
 * 스텝은 생성 시에만 복사되므로, 후행 활성 프로젝트에는 이 버튼이 잇는
 * 경로다(§1-2-8). 스텝이 이미 있으면 화면에서 아예 그리지 않는다.
 */
export function CreateStepsButton({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function run() {
    setError(null);
    startTransition(async () => {
      const res = await createDefaultSteps(projectId);
      if (res.ok) router.refresh();
      else setError(res.error);
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button size="sm" variant="outline" onClick={run} disabled={pending}>
        <ListChecks className="mr-1.5 h-3.5 w-3.5" />
        {pending ? "만드는 중…" : "기본 스텝 만들기"}
      </Button>
      {error && <span className="text-xs text-destructive">{error}</span>}
    </div>
  );
}
