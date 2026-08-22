"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Pencil, Check, X } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import {
  createExpertiseField,
  renameExpertiseField,
  setExpertiseFieldActive,
} from "./actions";

export type ExpertiseFieldAdminRow = {
  id: string;
  name: string;
  isActive: boolean;
  /** 이 분야를 선택한 전문가 수 */
  expertCount: number;
};

/** 강의(멘토링) 분야 마스터 — 삭제 없이 비활성화만 (전문가 선택 보존) */
export function ExpertiseFieldsPanel({
  fields,
}: {
  fields: ExpertiseFieldAdminRow[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");

  const run = (
    fn: () => Promise<{ ok: boolean; error?: string }>,
    after?: () => void
  ) => {
    setError(null);
    startTransition(async () => {
      const r = await fn();
      if (!r.ok) setError(r.error ?? "실패했습니다. 다시 시도해 주세요.");
      else {
        after?.();
        router.refresh();
      }
    });
  };

  return (
    <div className="space-y-3">
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-background p-3">
        <Input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="분야명 (예: 사업계획서)"
          className="h-9 max-w-[220px]"
        />
        <Button
          size="sm"
          onClick={() => run(() => createExpertiseField(newName), () => setNewName(""))}
          disabled={pending || !newName.trim()}
        >
          <Plus className="mr-1 h-4 w-4" aria-hidden />
          추가
        </Button>
      </div>

      <ul className="space-y-1.5">
        {fields.map((f) => (
          <li
            key={f.id}
            className={
              "flex flex-wrap items-center gap-2 rounded-md border bg-background p-2.5 " +
              (f.isActive ? "" : "opacity-70")
            }
          >
            {editingId === f.id ? (
              <>
                <Input
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="h-8 max-w-[220px]"
                />
                <Button
                  size="sm"
                  disabled={pending}
                  onClick={() =>
                    run(() => renameExpertiseField(f.id, editName), () => setEditingId(null))
                  }
                >
                  <Check className="h-4 w-4" aria-hidden />
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>
                  <X className="h-4 w-4" aria-hidden />
                </Button>
              </>
            ) : (
              <>
                <span className="text-sm font-medium">{f.name}</span>
                {!f.isActive && <Badge variant="secondary">비활성</Badge>}
                <span className="text-xs text-muted-foreground">
                  전문가 {f.expertCount}명
                </span>
                <div className="ml-auto flex items-center gap-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setEditingId(f.id);
                      setEditName(f.name);
                    }}
                  >
                    <Pencil className="h-3.5 w-3.5" aria-hidden />
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={pending}
                    onClick={() => run(() => setExpertiseFieldActive(f.id, !f.isActive))}
                  >
                    {f.isActive ? "비활성화" : "다시 사용"}
                  </Button>
                </div>
              </>
            )}
          </li>
        ))}
      </ul>

      <p className="text-xs text-muted-foreground">
        전문가가 프로필에서 중복 선택하는 전역 선택지입니다. 기업의 보유자료
        일괄등록에서 올라온 분야도 여기 자동 등록됩니다 — 오타·중복은 이름
        수정으로 정리하세요. 삭제 대신 비활성화만 제공합니다.
      </p>
    </div>
  );
}
