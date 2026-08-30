"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, X } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { addSessionField, deactivateSessionField } from "./field-actions";

/**
 * 세션 분야 관리 (기획 확정 2026-08-30 — 35번, 설정 > 내 설정 > 분야).
 * 누구나 추가 → 회사 전체가 공통 사용 (행사·컨설팅 세션의 분야 선택지).
 */
export function SessionFieldsPanel({
  fields,
  canDeactivate,
}: {
  fields: { id: string; name: string }[];
  /** 정리(비활성) 권한 — 대표·'회사 설정' 위임자 */
  canDeactivate: boolean;
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function add() {
    setError(null);
    startTransition(async () => {
      const res = await addSessionField(name);
      if (!res.ok) setError(res.error);
      else {
        setName("");
        router.refresh();
      }
    });
  }

  function remove(id: string) {
    setError(null);
    startTransition(async () => {
      const res = await deactivateSessionField(id);
      if (!res.ok) setError(res.error);
      else router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <p className="text-xs leading-relaxed text-muted-foreground">
        행사·컨설팅 세션에서 고르는 <b>분야</b> 목록입니다. 누구나 추가할 수
        있고, 추가하면 회사 전체가 공통으로 사용합니다.
      </p>
      <div className="flex gap-1.5">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
          placeholder="새 분야 (예: IT·플랫폼, 마케팅, 투자유치)"
          maxLength={50}
          className="h-9"
        />
        <Button size="sm" className="h-9" onClick={add} disabled={pending}>
          <Plus className="mr-1 h-3.5 w-3.5" aria-hidden />
          추가
        </Button>
      </div>
      {fields.length === 0 ? (
        <p className="rounded-md bg-secondary/50 p-3 text-sm text-muted-foreground">
          아직 등록된 분야가 없습니다. 첫 분야를 추가해 보세요.
        </p>
      ) : (
        <ul className="flex flex-wrap gap-1.5">
          {fields.map((f) => (
            <li
              key={f.id}
              className="inline-flex items-center gap-1 rounded-full border bg-secondary/40 px-2.5 py-1 text-sm"
            >
              {f.name}
              {canDeactivate && (
                <button
                  type="button"
                  aria-label={`${f.name} 비활성화`}
                  title="목록에서 숨깁니다 (기존 세션의 연결은 유지)"
                  disabled={pending}
                  onClick={() => remove(f.id)}
                  className="rounded-full p-0.5 text-muted-foreground hover:text-destructive"
                >
                  <X className="h-3 w-3" aria-hidden />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
