"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Pencil, Check, X, Trash2 } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import {
  createRecruitField,
  deleteRecruitField,
  renameRecruitField,
} from "./recruit-field-actions";

export type RecruitFieldRow = {
  id: string;
  name: string;
  /** 이 분야가 붙어 있는 전문가 수 — 삭제 전 영향 파악용 */
  expertCount: number;
};

const EXAMPLES = ["창업 멘토링", "IR 심사", "마케팅 강의", "세무·회계 자문"];

/**
 * 섭외분야 관리 (대표 또는 settings 위임자 — 기획 확정 2026-08-22).
 * 전문가 관리 탭에서 전문가에게 붙이는 자사 전용 분류. 요청에 따라 삭제를
 * 제공하되, 배정이 있는 분야는 삭제 전에 영향(전문가 수)을 보여 준다.
 */
export function RecruitFieldsPanel({ fields }: { fields: RecruitFieldRow[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [newName, setNewName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, after?: () => void) => {
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
      <p className="text-xs leading-relaxed text-muted-foreground">
        전문가 메뉴의 <b>전문가 관리</b> 탭에서 전문가에게 붙일 섭외분야를
        등록합니다. 우리 회사에만 보이는 분류입니다. 예: {EXAMPLES.join(" · ")}
      </p>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="flex flex-wrap items-center gap-2 rounded-lg border p-3">
        <Input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="섭외분야명 (예: 창업 멘토링)"
          className="h-9 max-w-[220px]"
        />
        <Button
          size="sm"
          onClick={() => run(() => createRecruitField(newName), () => setNewName(""))}
          disabled={pending || !newName.trim()}
        >
          <Plus className="mr-1 h-4 w-4" aria-hidden />
          추가
        </Button>
      </div>

      {fields.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          아직 등록된 섭외분야가 없습니다.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {fields.map((f) => (
            <li
              key={f.id}
              className="flex flex-wrap items-center gap-2 rounded-md border p-2.5"
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
                      run(() => renameRecruitField(f.id, editName), () => setEditingId(null))
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
                      onClick={() => {
                        if (
                          f.expertCount > 0 &&
                          !window.confirm(
                            `이 분야가 붙어 있는 전문가 ${f.expertCount}명에게서도 함께 제거됩니다. 삭제할까요?`
                          )
                        ) {
                          return;
                        }
                        run(() => deleteRecruitField(f.id));
                      }}
                    >
                      <Trash2 className="mr-1 h-3.5 w-3.5" aria-hidden />
                      삭제
                    </Button>
                  </div>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
