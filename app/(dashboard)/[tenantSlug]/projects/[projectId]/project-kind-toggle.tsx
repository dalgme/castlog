"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";

import { useToast } from "@/hooks/use-toast";

import { setProjectKind } from "./basic-info-actions";

/**
 * 프로젝트 유형 전환 (기획 확정 2026-08-30 — 34번).
 * 행사 = 캘린더 일정표 세션 / 컨설팅 = 수행기간·분야·멘티.
 * 전환해도 기존 세션 데이터는 지워지지 않는다.
 */
export function ProjectKindToggle({
  projectId,
  kind,
  canManage,
}: {
  projectId: string;
  kind: "event" | "consulting";
  canManage: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();

  function change(next: "event" | "consulting") {
    if (next === kind || pending || !canManage) return;
    startTransition(async () => {
      const res = await setProjectKind(projectId, next);
      if (!res.ok) toast({ variant: "destructive", description: res.error });
      else router.refresh();
    });
  }

  return (
    <div className="inline-flex rounded-md border p-0.5">
      {(
        [
          { key: "event", label: "행사 유형" },
          { key: "consulting", label: "컨설팅 유형" },
        ] as const
      ).map((o) => (
        <button
          key={o.key}
          type="button"
          disabled={pending || !canManage}
          onClick={() => change(o.key)}
          title={
            canManage
              ? o.key === "event"
                ? "캘린더 일정표로 세션을 등록합니다"
                : "수행기간·분야·인원으로 세션을 만들고 멘티 정보를 기입합니다"
              : "유형 변경은 대표·이사 또는 이 프로젝트 팀(PL·PM·부PM·담당)에 배정된 사람만 할 수 있습니다. 개요 탭의 팀 구성에서 배정을 받으세요."
          }
          className={`rounded px-2.5 py-1 text-xs font-semibold transition-colors ${
            kind === o.key
              ? "bg-brand text-white"
              : "text-muted-foreground hover:bg-secondary"
          } ${!canManage ? "cursor-default" : ""}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
