"use client";

import { useState, useTransition } from "react";
import { Plus, Settings2, X } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  addSessionField,
  deactivateSessionField,
} from "@/app/(dashboard)/[tenantSlug]/settings/me/field-actions";

export type SessionFieldOption = { id: string; name: string };

/**
 * 서버에서 받은 선택지 + 팝업에서 방금 추가한 것 − 방금 숨긴 것.
 * router.refresh()가 오기 전에도 선택지가 맞아야 입력 흐름이 끊기지 않는다.
 */
export function mergeFieldOptions(
  base: SessionFieldOption[],
  added: SessionFieldOption[],
  hiddenIds: string[]
): SessionFieldOption[] {
  const seen = new Set(base.map((f) => f.id));
  const merged = [...base, ...added.filter((f) => !seen.has(f.id))];
  return merged.filter((f) => !hiddenIds.includes(f.id));
}

/**
 * 세션분야 설정 팝업 (기획 지시 2026-09-20).
 *
 * 세션을 넣다가 분야가 없으면 설정 메뉴로 갔다 와야 했다 — 입력하던 내용이
 * 날아간다. 그래서 세션 입력 화면 안에서 **화면 전환 없이** 분야를 추가한다.
 * 같은 마스터(tenant_session_fields)라 설정 > 내 설정 > 분야에 자동 반영된다.
 *
 * 추가한 분야는 곧바로 선택지에 들어가고 그 세션의 분야로 선택된다(onAdded).
 * 비활성화는 설정 스코프 — 권한이 없으면 서버가 규칙 문구로 답한다(§12-9).
 */
export function SessionFieldDialog({
  fields,
  onAdded,
  onRemoved,
  label = "분야 설정",
  compact,
}: {
  fields: SessionFieldOption[];
  /** 새 분야가 만들어졌다 — 부모가 선택지에 넣고 곧바로 선택한다 */
  onAdded: (field: SessionFieldOption) => void;
  /** 분야가 숨겨졌다 — 부모가 선택지에서 뺀다 */
  onRemoved?: (id: string) => void;
  label?: string;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function add() {
    setError(null);
    const trimmed = name.trim();
    if (!trimmed) {
      setError("분야 이름을 입력하세요.");
      return;
    }
    startTransition(async () => {
      const res = await addSessionField(trimmed);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      onAdded(res.field);
      setName("");
    });
  }

  function remove(id: string) {
    setError(null);
    startTransition(async () => {
      const res = await deactivateSessionField(id);
      if (!res.ok) setError(res.error);
      else onRemoved?.(id);
    });
  }

  return (
    <>
      <Button
        type="button"
        size={compact ? "icon" : "sm"}
        variant="outline"
        className={compact ? "h-9 w-9 shrink-0" : "h-9 shrink-0"}
        onClick={() => setOpen(true)}
        title="세션분야를 여기서 바로 추가합니다 — 설정 > 내 설정 > 분야에 자동 반영"
        aria-label={label}
      >
        <Settings2 className={compact ? "h-4 w-4" : "mr-1 h-3.5 w-3.5"} aria-hidden />
        {!compact && label}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>세션분야 설정</DialogTitle>
            <DialogDescription>
              여기서 추가한 분야는 회사 전체가 공통으로 쓰며, 설정 &gt; 내 설정 &gt; 분야에 그대로 반영됩니다.
              추가하면 지금 입력 중인 세션의 분야로 바로 선택됩니다.
            </DialogDescription>
          </DialogHeader>

          {error && (
            <Alert variant="destructive">
              <AlertDescription className="text-xs">{error}</AlertDescription>
            </Alert>
          )}

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
              autoFocus
            />
            <Button type="button" size="sm" className="h-9" onClick={add} disabled={pending}>
              <Plus className="mr-1 h-3.5 w-3.5" aria-hidden />
              추가
            </Button>
          </div>

          {fields.length === 0 ? (
            <p className="rounded-md bg-secondary/50 p-3 text-sm text-muted-foreground">
              아직 등록된 분야가 없습니다. 첫 분야를 추가해 보세요.
            </p>
          ) : (
            <ul className="flex max-h-56 flex-wrap gap-1.5 overflow-y-auto">
              {fields.map((f) => (
                <li
                  key={f.id}
                  className="inline-flex items-center gap-1 rounded-full border bg-secondary/40 px-2.5 py-1 text-sm"
                >
                  {f.name}
                  <button
                    type="button"
                    aria-label={`${f.name} 숨기기`}
                    title="목록에서 숨깁니다 (기존 세션의 연결은 유지) — 대표·회사 설정 위임자만"
                    disabled={pending}
                    onClick={() => remove(f.id)}
                    className="rounded-full p-0.5 text-muted-foreground hover:text-destructive"
                  >
                    <X className="h-3 w-3" aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="flex justify-end">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              닫기
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
