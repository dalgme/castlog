"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pencil } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";

import { toggleExpertRecruitField } from "./manage/manage-actions";

export type RecruitFieldOption = { id: string; name: string };

/**
 * 섭외분야 셀 (기획 확정 2026-08-23) — 회사의 주관적 분류.
 * 선택지는 설정 > 기업관리 > 섭외분야에서 관리하고, 여기서 전문가별로
 * 중복 선택해 붙인다. 전문가 본인·타사에는 보이지 않는다 (테넌트 격리).
 */
export function ExpertRecruitFieldsCell({
  expertId,
  expertName,
  options,
  selectedIds,
  canManage,
}: {
  expertId: string;
  expertName: string;
  options: RecruitFieldOption[];
  selectedIds: string[];
  canManage: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [picked, setPicked] = useState<Set<string>>(new Set(selectedIds));

  const names = options
    .filter((o) => picked.has(o.id))
    .map((o) => o.name);

  function toggle(fieldId: string, on: boolean) {
    // 낙관적 갱신 — 체크 즉시 반영하고 서버 실패 시 되돌린다
    setPicked((prev) => {
      const next = new Set(prev);
      if (on) next.add(fieldId);
      else next.delete(fieldId);
      return next;
    });
    startTransition(async () => {
      const r = await toggleExpertRecruitField(expertId, fieldId, on);
      if (!r.ok) {
        toast({ variant: "destructive", description: r.error });
        setPicked((prev) => {
          const next = new Set(prev);
          if (on) next.delete(fieldId);
          else next.add(fieldId);
          return next;
        });
      }
    });
  }

  const chips =
    names.length > 0 ? (
      <span className="flex max-w-[180px] flex-wrap gap-1">
        {names.map((n) => (
          <Badge key={n} variant="secondary" className="text-[10px]">
            {n}
          </Badge>
        ))}
      </span>
    ) : (
      <span className="text-xs text-muted-foreground">-</span>
    );

  if (!canManage) return chips;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1 rounded px-1 py-0.5 text-left hover:bg-secondary"
        title="섭외분야 지정 (회사 내부 분류)"
      >
        {chips}
        <Pencil className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden />
      </button>

      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) router.refresh();
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>섭외분야 — {expertName}</DialogTitle>
          </DialogHeader>
          <p className="text-xs text-muted-foreground">
            우리 회사 내부 분류입니다 — 전문가 본인·다른 회사에는 보이지
            않습니다. 선택지는 설정 &gt; 기업관리 &gt; 섭외분야(전문가 관리)에서
            추가·수정합니다.
          </p>
          {options.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              등록된 섭외분야가 없습니다. 설정 &gt; 기업관리에서 먼저 등록하세요.
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-1.5">
              {options.map((o) => (
                <label
                  key={o.id}
                  className="flex cursor-pointer items-center gap-2 rounded-md border px-2.5 py-1.5 text-sm hover:bg-secondary/60"
                >
                  <Checkbox
                    checked={picked.has(o.id)}
                    disabled={pending}
                    onCheckedChange={(v) => toggle(o.id, v === true)}
                  />
                  {o.name}
                </label>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
