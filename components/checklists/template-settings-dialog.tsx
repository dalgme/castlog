"use client";

import { useState, useTransition } from "react";
import { Settings } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { CHECKLIST_KIND_DESCRIPTIONS, CHECKLIST_KIND_LABELS, type ChecklistKind } from "@/lib/checklists/kinds";
import type { TemplateView } from "@/lib/checklists/template-view";
import { TemplateEditor } from "@/app/(dashboard)/[tenantSlug]/settings/checklists/template-editor";
import { getTemplatesForKind } from "@/app/(dashboard)/[tenantSlug]/settings/checklists/actions";

/**
 * 프로젝트 체크리스트 탭의 '설정' 단추 — 그 종류의 회사 표준시트를 팝업에서
 * 바로 고친다 (기획 지시 2026-09-06). 설정 > 체크리스트 표준시트와 같은 편집기·
 * 같은 데이터라, 여기서 고치면 전 임직원의 표준시트가 바뀐다.
 */
export function TemplateSettingsDialog({
  kind,
  disabled = false,
}: {
  kind: ChecklistKind;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [templates, setTemplates] = useState<TemplateView[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  function load() {
    startTransition(async () => {
      const r = await getTemplatesForKind(kind);
      if (r.ok) {
        setTemplates(r.templates);
        setError(null);
      } else setError(r.error);
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setTemplates(null);
          load();
        }
      }}
    >
      <DialogTrigger asChild>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={disabled}
          className="h-8 w-8 px-0 text-muted-foreground"
          title={`${CHECKLIST_KIND_LABELS[kind]} 표준시트 설정`}
          aria-label={`${CHECKLIST_KIND_LABELS[kind]} 표준시트 설정`}
        >
          <Settings className="h-4 w-4" aria-hidden />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>{CHECKLIST_KIND_LABELS[kind]} — 표준시트 설정</DialogTitle>
          <DialogDescription>
            {CHECKLIST_KIND_DESCRIPTIONS[kind]} 회사 임직원 전체가 공유하는 표준입니다 — 여기서
            고치면 모두에게 반영되고, 이미 프로젝트에 불러온 시트에는 영향이 없습니다.
          </DialogDescription>
        </DialogHeader>
        {error && <p className="text-sm text-red-700">{error}</p>}
        {!templates && !error && <p className="text-sm text-muted-foreground">불러오는 중…</p>}
        {templates && (
          <div className={pending ? "opacity-70" : undefined}>
            <TemplateEditor kind={kind} templates={templates} onChanged={load} />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
