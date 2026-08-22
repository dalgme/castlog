"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { saveExpertExpertise } from "./expertise-actions";

export type ExpertiseOption = { id: string; name: string };

/**
 * 강의(멘토링) 분야 — 선택형 중복 선택 + 기타 텍스트 (기획 확정 2026-08-22).
 * 선택지는 캐스트로그가 관리하는 전역 목록이다.
 */
export function ExpertiseForm({
  options,
  selectedIds,
  otherText,
}: {
  options: ExpertiseOption[];
  selectedIds: string[];
  otherText: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set(selectedIds));
  const [other, setOther] = useState(otherText);

  function toggle(id: string) {
    setSaved(false);
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function save() {
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const r = await saveExpertExpertise({
        fieldIds: Array.from(picked),
        otherText: other,
      });
      if (!r.ok) setError(r.error);
      else {
        setSaved(true);
        router.refresh();
      }
    });
  }

  return (
    <div className="space-y-3">
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {options.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          아직 선택할 수 있는 분야 목록이 없습니다. 아래 기타 칸에 자유롭게
          적어 주세요.
        </p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {options.map((o) => {
            const on = picked.has(o.id);
            return (
              <button
                key={o.id}
                type="button"
                onClick={() => toggle(o.id)}
                className={
                  "rounded-full border px-3 py-1 text-sm transition-colors " +
                  (on
                    ? "border-brand bg-brand/10 font-medium text-brand"
                    : "text-muted-foreground hover:border-brand/40")
                }
              >
                {o.name}
              </button>
            );
          })}
        </div>
      )}

      <div className="space-y-1">
        <label className="text-sm font-medium">기타 (직접 입력)</label>
        <Input
          value={other}
          onChange={(e) => {
            setSaved(false);
            setOther(e.target.value);
          }}
          placeholder="목록에 없는 분야를 쉼표로 구분해 입력"
        />
      </div>

      <Button onClick={save} disabled={pending} className="w-full sm:w-auto">
        {pending ? "저장 중..." : saved ? (
          <>
            <Check className="mr-1 h-4 w-4" aria-hidden />
            저장됨
          </>
        ) : (
          "분야 저장"
        )}
      </Button>
    </div>
  );
}
