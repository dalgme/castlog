"use client";

import { useRef, useState, useTransition } from "react";
import { FileSpreadsheet, UploadCloud } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { CHECKLIST_KIND_LABELS, isChecklistKind } from "@/lib/checklists/kinds";
import { cn } from "@/lib/utils";

export type ExcelImportSummary = {
  sheets: { name: string; kind: string; items: number; target: "appended" | "created" }[];
  skipped: string[];
  warnings: string[];
};

/**
 * 체크리스트 엑셀 불러오기 팝업 (기획 지시 2026-11-03) — 파일을 끌어다 놓거나 골라 올리면
 * 서버가 머리글을 자동으로 해석해 항목으로 만든다. 결과(시트별 종류·항목 수·경고)를 보여 준다.
 * 프로젝트 탭과 설정 표준시트가 같은 팝업을 쓰고, 실제 저장은 각자의 액션(onImport)이 한다.
 */
export function ChecklistExcelImportDialog({
  onImport,
  disabled = false,
  description,
  triggerClassName,
}: {
  onImport: (formData: FormData) => Promise<({ ok: true } & ExcelImportSummary) | { ok: false; error: string }>;
  disabled?: boolean;
  description: string;
  triggerClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<ExcelImportSummary | null>(null);
  const [pending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement | null>(null);

  function pick(list: FileList | null) {
    const f = list?.[0] ?? null;
    if (!f) return;
    if (!/\.(xlsx|xlsm|xls|csv)$/i.test(f.name)) {
      setError("엑셀 파일(.xlsx/.xls/.csv)만 불러올 수 있습니다.");
      return;
    }
    setError(null);
    setSummary(null);
    setFile(f);
  }

  function submit() {
    if (!file) return;
    const fd = new FormData();
    fd.set("file", file);
    setError(null);
    startTransition(async () => {
      const r = await onImport(fd);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setSummary({ sheets: r.sheets, skipped: r.skipped, warnings: r.warnings });
      setFile(null);
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (pending) return;
        setOpen(v);
        if (v) {
          setFile(null);
          setError(null);
          setSummary(null);
        }
      }}
    >
      <DialogTrigger asChild>
        <Button type="button" size="sm" variant="outline" disabled={disabled} className={cn("border-emerald-300 text-emerald-800 hover:bg-emerald-50", triggerClassName)}>
          <FileSpreadsheet className="mr-1 h-4 w-4" aria-hidden /> 엑셀 불러오기
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>체크리스트 엑셀 불러오기</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <p className="text-xs text-muted-foreground">
          시트마다 첫 줄 머리글(시기·구분·세부 분류·업무 내용/항목/내용·권장(D±)·담당·마감일·완료일·참고사항 등)을
          자동으로 알아봅니다. 병합돼 비어 있는 시기·구분 칸은 위 값을 이어받습니다. 시트 이름에 착수·마감·숙소·준비물품이
          있으면 그 종류로, 나머지는 공통 체크리스트로 들어갑니다.
        </p>
        {error && (
          <Alert variant="destructive">
            <AlertDescription className="text-xs">{error}</AlertDescription>
          </Alert>
        )}
        {summary ? (
          <div className="space-y-2 text-sm">
            <p className="font-semibold text-emerald-700">불러오기 완료</p>
            <ul className="divide-y rounded border">
              {summary.sheets.map((s) => (
                <li key={s.name} className="flex items-center justify-between gap-2 px-2 py-1.5 text-xs">
                  <span className="truncate font-medium">{s.name}</span>
                  <span className="shrink-0 text-muted-foreground">
                    {isChecklistKind(s.kind) ? CHECKLIST_KIND_LABELS[s.kind] : s.kind} · {s.items}개 ·{" "}
                    {s.target === "appended" ? "기존 시트에 추가" : "새 시트"}
                  </span>
                </li>
              ))}
            </ul>
            {summary.skipped.length > 0 && (
              <p className="text-xs text-muted-foreground">건너뛴 시트: {summary.skipped.join(", ")} (체크리스트 표가 아님)</p>
            )}
            {summary.warnings.length > 0 && (
              <ul className="list-disc space-y-0.5 pl-4 text-xs text-amber-800">
                {summary.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            )}
            <Button type="button" size="sm" className="w-full" onClick={() => setOpen(false)}>
              닫기
            </Button>
          </div>
        ) : (
          <>
            <div
              role="button"
              tabIndex={0}
              onClick={() => inputRef.current?.click()}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") inputRef.current?.click();
              }}
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                pick(e.dataTransfer.files);
              }}
              className={cn(
                "flex cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed px-4 py-6 text-center text-sm transition-colors",
                dragging ? "border-brand bg-brand/10 text-brand" : "border-neutral-300 text-muted-foreground hover:border-brand hover:bg-brand/5"
              )}
            >
              <UploadCloud className="h-7 w-7" aria-hidden />
              <span className="font-semibold">{file ? file.name : "엑셀 파일을 끌어다 놓거나 클릭해서 고르세요"}</span>
              <span className="text-xs">.xlsx · .xls · .csv, 5MB 이하</span>
              <input
                ref={inputRef}
                type="file"
                accept=".xlsx,.xlsm,.xls,.csv"
                className="hidden"
                onChange={(e) => {
                  pick(e.target.files);
                  e.target.value = "";
                }}
              />
            </div>
            <Button type="button" size="sm" className="w-full" onClick={submit} disabled={!file || pending}>
              {pending ? "해석해서 넣는 중…" : "불러오기"}
            </Button>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
