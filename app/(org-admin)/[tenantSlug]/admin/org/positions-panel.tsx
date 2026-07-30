"use client";

import { useState, useTransition } from "react";
import { X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";

import { createPosition, deletePosition } from "./actions";

/** 직급 관리 패널 — 기업별 자유 관리 (하드코딩 금지) */
export function PositionsPanel({
  positions,
}: {
  positions: { id: string; name: string }[];
}) {
  const [name, setName] = useState("");
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();

  function onAdd(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    startTransition(async () => {
      const result = await createPosition({ name: trimmed });
      if (result.ok) {
        setName("");
      } else {
        toast({ variant: "destructive", description: result.error });
      }
    });
  }

  function onDelete(positionId: string) {
    startTransition(async () => {
      const result = await deletePosition(positionId);
      if (!result.ok) {
        toast({ variant: "destructive", description: result.error });
      }
    });
  }

  return (
    <div className="space-y-3">
      <form onSubmit={onAdd} className="flex items-center gap-2">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="직급명 (예: 책임컨설턴트)"
          maxLength={30}
        />
        <Button type="submit" size="sm" disabled={pending || !name.trim()}>
          추가
        </Button>
      </form>
      {positions.length === 0 ? (
        <p className="text-sm text-muted-foreground">등록된 직급이 없습니다.</p>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {positions.map((position) => (
            <li
              key={position.id}
              className="flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-sm"
            >
              {position.name}
              <button
                type="button"
                aria-label={`${position.name} 삭제`}
                className="text-muted-foreground hover:text-destructive"
                disabled={pending}
                onClick={() => onDelete(position.id)}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-muted-foreground">
        직급을 삭제하면 해당 직급이 지정된 직원은 ‘미지정’으로 변경됩니다.
      </p>
    </div>
  );
}
