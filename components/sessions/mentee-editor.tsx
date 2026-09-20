"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2, Users } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";

import {
  addSlotMentee,
  removeSlotMentee,
  type MenteeInput,
} from "@/app/(dashboard)/[tenantSlug]/projects/[projectId]/mentee-actions";

export type MenteeView = {
  id: string;
  orgName: string;
  positionTitle: string | null;
  name: string;
  itemName: string | null;
  menteeType: string | null;
};

export type MenteeDraft = Omit<MenteeInput, "slotId">;

const EMPTY: MenteeDraft = { orgName: "", positionTitle: "", name: "", itemName: "", menteeType: "" };

export function menteeLabel(m: { orgName: string; positionTitle?: string | null; name: string; itemName?: string | null; menteeType?: string | null }): string {
  return (
    [m.orgName, m.positionTitle, m.name].filter(Boolean).join(" · ") +
    (m.itemName ? ` — ${m.itemName}` : "") +
    (m.menteeType ? ` (${m.menteeType})` : "")
  );
}

/**
 * 멘티 정보 (기획 34번 — 소속/직위/이름/아이템명/유형, 섭외계획 품의에 동봉).
 * 세션 추가 팝업(아직 세션 id 없음)에서는 임시 목록으로 모았다가 세션이 만들어진 뒤
 * 한 번에 저장하고, 세션 수정·섭외후보 등록에서는 바로 서버에 저장한다
 * (기획 지시 2026-09-21 — 두 자리 모두에서 입력 가능).
 */
export function MenteeEditor({
  slotId,
  mentees,
  drafts,
  onDraftsChange,
  canManage,
  compact,
}: {
  /** 있으면 서버 저장, 없으면 drafts/onDraftsChange로 임시 목록 */
  slotId?: string;
  mentees?: MenteeView[];
  drafts?: MenteeDraft[];
  onDraftsChange?: (next: MenteeDraft[]) => void;
  canManage: boolean;
  compact?: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<MenteeDraft>(EMPTY);

  const list: { key: string; label: string; onRemove: () => void }[] = slotId
    ? (mentees ?? []).map((m) => ({
        key: m.id,
        label: menteeLabel(m),
        onRemove: () =>
          startTransition(async () => {
            const r = await removeSlotMentee(m.id);
            if (!r.ok) toast({ variant: "destructive", description: r.error });
            else router.refresh();
          }),
      }))
    : (drafts ?? []).map((m, i) => ({
        key: String(i),
        label: menteeLabel(m),
        onRemove: () => onDraftsChange?.((drafts ?? []).filter((_, j) => j !== i)),
      }));

  function submit() {
    if (!draft.orgName.trim() || !draft.name.trim()) {
      toast({ variant: "destructive", description: "멘티 소속명과 이름은 필수입니다." });
      return;
    }
    if (slotId) {
      startTransition(async () => {
        const r = await addSlotMentee({ slotId, ...draft });
        if (!r.ok) toast({ variant: "destructive", description: r.error });
        else {
          setDraft(EMPTY);
          router.refresh();
        }
      });
      return;
    }
    onDraftsChange?.([...(drafts ?? []), draft]);
    setDraft(EMPTY);
  }

  return (
    <div className={compact ? "rounded-md bg-secondary/30 p-2" : "rounded-md border bg-secondary/20 p-2.5"}>
      <p className="mb-1 flex items-center gap-1 text-[11px] font-semibold text-muted-foreground">
        <Users className="h-3 w-3" aria-hidden />
        멘티 정보 ({list.length}명) — 섭외계획 품의에 함께 전송됩니다
      </p>
      {list.length > 0 && (
        <ul className="mb-1.5 space-y-0.5">
          {list.map((m) => (
            <li key={m.key} className="flex items-center gap-1.5 text-xs">
              <span>{m.label}</span>
              {canManage && (
                <button
                  type="button"
                  aria-label="멘티 삭제"
                  disabled={pending}
                  onClick={m.onRemove}
                  className="rounded p-0.5 text-muted-foreground hover:text-destructive"
                >
                  <Trash2 className="h-3 w-3" aria-hidden />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {canManage &&
        (open ? (
          <div className="flex flex-wrap items-center gap-1.5">
            <Input value={draft.orgName} onChange={(e) => setDraft((p) => ({ ...p, orgName: e.target.value }))} placeholder="멘티 소속명 (필수)" className="h-7 w-36 text-xs" maxLength={100} />
            <Input value={draft.positionTitle ?? ""} onChange={(e) => setDraft((p) => ({ ...p, positionTitle: e.target.value }))} placeholder="직위" className="h-7 w-20 text-xs" maxLength={50} />
            <Input value={draft.name} onChange={(e) => setDraft((p) => ({ ...p, name: e.target.value }))} placeholder="이름 (필수)" className="h-7 w-24 text-xs" maxLength={50} />
            <Input value={draft.itemName ?? ""} onChange={(e) => setDraft((p) => ({ ...p, itemName: e.target.value }))} placeholder="아이템명" className="h-7 w-32 text-xs" maxLength={120} />
            <Input value={draft.menteeType ?? ""} onChange={(e) => setDraft((p) => ({ ...p, menteeType: e.target.value }))} placeholder="유형 (예: 예비창업)" className="h-7 w-28 text-xs" maxLength={50} />
            <Button type="button" size="sm" className="h-7 text-xs" disabled={pending} onClick={submit}>
              추가
            </Button>
            <Button type="button" size="sm" variant="outline" className="h-7 text-xs" disabled={pending} onClick={() => setOpen(false)}>
              닫기
            </Button>
          </div>
        ) : (
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              setOpen(true);
              setDraft(EMPTY);
            }}
            className="rounded-md border border-dashed px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:border-brand hover:text-brand"
          >
            + 멘티 추가
          </button>
        ))}
    </div>
  );
}
