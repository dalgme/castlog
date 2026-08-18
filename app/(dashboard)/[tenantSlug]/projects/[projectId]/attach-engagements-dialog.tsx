"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Link2 } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

import {
  attachEngagementsToProject,
  listUnlinkedEngagements,
  type UnlinkedEngagement,
} from "./attach-actions";

/**
 * 프로젝트에 연결되지 않은 섭외 건을 이 프로젝트에 붙인다.
 *
 * 프로젝트 없이 섭외를 만들어 온 테넌트가 프로젝트를 쓰기 시작할 때, 과거
 * 이력을 제자리에 놓기 위한 정리 도구다. 미연결 건이 없으면 아무것도 그리지
 * 않는다 — 평상시에는 존재를 드러내지 않아야 할 기능이다.
 */
export function AttachEngagementsDialog({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<UnlinkedEngagement[] | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleOpenChange(next: boolean) {
    setOpen(next);
    setError(null);
    setDone(null);
    if (next && rows === null) {
      startTransition(async () => {
        setRows(await listUnlinkedEngagements());
      });
    }
    if (!next) setChecked(new Set());
  }

  function toggle(id: string) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function submit() {
    setError(null);
    setDone(null);
    startTransition(async () => {
      const res = await attachEngagementsToProject(
        projectId,
        Array.from(checked)
      );
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setDone(`${res.attached}건을 이 프로젝트에 연결했습니다.`);
      setChecked(new Set());
      setRows(await listUnlinkedEngagements());
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className="h-7 gap-1 text-xs">
          <Link2 className="h-3.5 w-3.5" />
          미연결 섭외 붙이기
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>프로젝트 미연결 섭외 건 연결</DialogTitle>
          <DialogDescription>
            프로젝트 없이 만들어진 섭외 건을 이 프로젝트에 붙입니다. 이미 다른
            프로젝트에 연결된 건은 목록에 없습니다 — 프로젝트 간 이동은 예산·정산
            집계를 소급해 흔들기 때문에 지원하지 않습니다.
          </DialogDescription>
        </DialogHeader>

        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        {done && (
          <Alert>
            <AlertDescription>{done}</AlertDescription>
          </Alert>
        )}

        {rows === null ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            불러오는 중...
          </p>
        ) : rows.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            프로젝트에 연결되지 않은 섭외 건이 없습니다.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {rows.map((row) => (
              <li key={row.id}>
                <label className="flex cursor-pointer items-start gap-2 rounded-md border p-2.5 hover:border-brand/40">
                  <Checkbox
                    checked={checked.has(row.id)}
                    onCheckedChange={() => toggle(row.id)}
                    className="mt-0.5"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-1.5">
                      <span className="text-sm font-semibold">
                        {row.expertName}
                      </span>
                      <Badge variant="secondary" className="text-[10px]">
                        {row.statusLabel}
                      </Badge>
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {row.roleDescription}
                      {row.startsOn && ` · ${row.startsOn}`}
                      {row.feeAmount !== null &&
                        ` · ${row.feeAmount.toLocaleString("ko-KR")}원`}
                    </span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        )}

        {rows !== null && rows.length > 0 && (
          <Button
            type="button"
            className="w-full"
            disabled={pending || checked.size === 0}
            onClick={submit}
          >
            {pending
              ? "연결 중..."
              : `선택한 ${checked.size}건을 이 프로젝트에 연결`}
          </Button>
        )}
      </DialogContent>
    </Dialog>
  );
}
