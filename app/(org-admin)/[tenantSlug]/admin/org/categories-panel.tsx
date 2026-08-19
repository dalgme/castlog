"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Pencil, Check, X } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import {
  createProjectCategory,
  renameProjectCategory,
  setProjectCategoryActive,
} from "./category-actions";

export type CategoryRow = {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
  projectCount: number;
};

/** 예시로 보여줄 뿐 자동 등록하지 않는다 — 회사가 쓰는 분류는 회사가 정한다. */
const EXAMPLES = ["창업", "교육행사", "엑셀러레이터", "농업교육", "로컬창업"];

/**
 * 프로젝트 분야 카테고리 관리 (대표 또는 settings 위임자).
 * 삭제 버튼을 두지 않는다 — 비활성화만 한다(과거 프로젝트의 분류 보존).
 */
export function CategoriesPanel({ categories }: { categories: CategoryRow[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editDesc, setEditDesc] = useState("");

  const add = () => {
    setError(null);
    startTransition(async () => {
      const r = await createProjectCategory(newName, newDesc);
      if (!r.ok) setError(r.error);
      else {
        setNewName("");
        setNewDesc("");
        router.refresh();
      }
    });
  };

  const toggle = (id: string, active: boolean) => {
    setError(null);
    startTransition(async () => {
      const r = await setProjectCategoryActive(id, active);
      if (!r.ok) setError(r.error);
      else router.refresh();
    });
  };

  const saveEdit = (id: string) => {
    setError(null);
    startTransition(async () => {
      const r = await renameProjectCategory(id, editName, editDesc);
      if (!r.ok) setError(r.error);
      else {
        setEditingId(null);
        router.refresh();
      }
    });
  };

  return (
    <div className="space-y-3">
      <p className="text-xs leading-relaxed text-muted-foreground">
        프로젝트 개설 시 고를 분야를 등록합니다. 등록한 카테고리는 이후 카테고리별
        현황·통계의 기준 축이 됩니다. 예: {EXAMPLES.join(" · ")}
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
          placeholder="카테고리명 (예: 창업)"
          className="h-9 max-w-[180px]"
        />
        <Input
          value={newDesc}
          onChange={(e) => setNewDesc(e.target.value)}
          placeholder="설명 (선택)"
          className="h-9 max-w-[260px]"
        />
        <Button size="sm" onClick={add} disabled={pending || !newName.trim()}>
          <Plus className="mr-1 h-4 w-4" aria-hidden />
          추가
        </Button>
      </div>

      {categories.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          아직 등록된 카테고리가 없습니다. 회사가 실제로 쓰는 분야명을 등록하세요.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {categories.map((c) => (
            <li
              key={c.id}
              className={
                "flex flex-wrap items-center gap-2 rounded-md border p-2.5 " +
                (c.isActive ? "" : "bg-secondary/40")
              }
            >
              {editingId === c.id ? (
                <>
                  <Input
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    className="h-8 max-w-[180px]"
                  />
                  <Input
                    value={editDesc}
                    onChange={(e) => setEditDesc(e.target.value)}
                    placeholder="설명 (선택)"
                    className="h-8 max-w-[240px]"
                  />
                  <Button size="sm" disabled={pending} onClick={() => saveEdit(c.id)}>
                    <Check className="h-4 w-4" aria-hidden />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setEditingId(null)}
                  >
                    <X className="h-4 w-4" aria-hidden />
                  </Button>
                </>
              ) : (
                <>
                  <span className="text-sm font-medium">{c.name}</span>
                  {!c.isActive && <Badge variant="secondary">비활성</Badge>}
                  {c.description && (
                    <span className="text-xs text-muted-foreground">
                      {c.description}
                    </span>
                  )}
                  <span className="text-xs text-muted-foreground">
                    프로젝트 {c.projectCount}건
                  </span>
                  <div className="ml-auto flex items-center gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setEditingId(c.id);
                        setEditName(c.name);
                        setEditDesc(c.description ?? "");
                      }}
                    >
                      <Pencil className="h-3.5 w-3.5" aria-hidden />
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={pending}
                      onClick={() => toggle(c.id, !c.isActive)}
                    >
                      {c.isActive ? "비활성화" : "다시 사용"}
                    </Button>
                  </div>
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      <p className="text-xs text-muted-foreground">
        삭제 대신 비활성화만 제공합니다. 카테고리를 지우면 그 분야로 분류해 둔 과거
        프로젝트의 이력이 끊깁니다. 비활성 카테고리는 새 프로젝트에서 선택지에
        나타나지 않습니다.
      </p>
    </div>
  );
}
