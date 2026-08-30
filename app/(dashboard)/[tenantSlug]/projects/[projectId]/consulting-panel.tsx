"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus, Trash2, UserSearch, Users } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";

import { createConsultingSlot } from "./slot-actions";
import { addSlotMentee, removeSlotMentee } from "./mentee-actions";

export type ConsultingSession = {
  id: string;
  startsOn: string;
  endsOn: string | null;
  name: string | null;
  fieldName: string | null;
  requiredCount: number;
  candidateCount: number;
  mentees: {
    id: string;
    orgName: string;
    positionTitle: string | null;
    name: string;
    itemName: string | null;
    menteeType: string | null;
  }[];
};

const EMPTY_MENTEE = {
  orgName: "",
  positionTitle: "",
  name: "",
  itemName: "",
  menteeType: "",
};

/**
 * 컨설팅 유형 세션 (기획 확정 2026-08-30 — 34번, 기본설정 탭).
 * 수행기간·분야·필요인원·후보인원으로 세션을 만들고, 세션마다 멘티 정보
 * (소속/직위/이름/아이템명/유형)를 기입한다. 멘티 정보는 섭외계획 품의
 * 본문에 함께 실려 결재자에게 전달된다.
 */
export function ConsultingPanel({
  tenantSlug,
  projectId,
  sessions,
  fieldOptions,
  canManage,
  expertsEnabled,
}: {
  tenantSlug: string;
  projectId: string;
  sessions: ConsultingSession[];
  fieldOptions: { id: string; name: string }[];
  canManage: boolean;
  expertsEnabled: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [draft, setDraft] = useState({
    startsOn: "",
    endsOn: "",
    fieldId: "",
    requiredCount: "1",
    candidateCount: "3",
  });
  // 멘티 입력 폼 — 세션별로 하나만 연다
  const [menteeSlot, setMenteeSlot] = useState<string | null>(null);
  const [mentee, setMentee] = useState(EMPTY_MENTEE);

  function run(fn: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) {
        setError(res.error ?? "처리에 실패했습니다.");
        toast({ variant: "destructive", description: res.error });
      } else {
        router.refresh();
      }
    });
  }

  function createSession() {
    if (!draft.startsOn || !draft.endsOn || !draft.fieldId) {
      const msg = "수행기간(시작·종료)과 분야를 선택하세요.";
      setError(msg);
      toast({ variant: "destructive", description: msg });
      return;
    }
    run(async () => {
      const res = await createConsultingSlot(projectId, {
        startsOn: draft.startsOn,
        endsOn: draft.endsOn,
        fieldId: draft.fieldId,
        requiredCount: parseInt(draft.requiredCount, 10) || 1,
        candidateCount: parseInt(draft.candidateCount, 10) || 1,
      });
      if (res.ok) {
        setDraft({ startsOn: "", endsOn: "", fieldId: "", requiredCount: "1", candidateCount: "3" });
      }
      return res;
    });
  }

  function submitMentee(slotId: string) {
    if (!mentee.orgName.trim() || !mentee.name.trim()) {
      const msg = "멘티 소속명과 이름은 필수입니다.";
      setError(msg);
      toast({ variant: "destructive", description: msg });
      return;
    }
    run(async () => {
      const res = await addSlotMentee({
        slotId,
        orgName: mentee.orgName,
        positionTitle: mentee.positionTitle,
        name: mentee.name,
        itemName: mentee.itemName,
        menteeType: mentee.menteeType,
      });
      if (res.ok) setMentee(EMPTY_MENTEE);
      return res;
    });
  }

  return (
    <div className="space-y-3">
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {canManage && (
        <div className="flex flex-wrap items-end gap-x-3 gap-y-2 rounded-md border p-3">
          <div>
            <label className="text-[11px] text-muted-foreground">수행 시작</label>
            <Input
              type="date"
              value={draft.startsOn}
              onChange={(e) => setDraft((p) => ({ ...p, startsOn: e.target.value }))}
              className="h-8 w-36"
            />
          </div>
          <div>
            <label className="text-[11px] text-muted-foreground">수행 종료</label>
            <Input
              type="date"
              value={draft.endsOn}
              onChange={(e) => setDraft((p) => ({ ...p, endsOn: e.target.value }))}
              className="h-8 w-36"
            />
          </div>
          <div>
            <label className="text-[11px] text-muted-foreground">분야 (컨설팅 분야)</label>
            <select
              value={draft.fieldId}
              onChange={(e) => setDraft((p) => ({ ...p, fieldId: e.target.value }))}
              className="block h-8 w-44 rounded-md border bg-background px-2 text-sm"
              aria-label="컨설팅 분야"
            >
              <option value="">분야 선택</option>
              {fieldOptions.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-[11px] text-muted-foreground">필요인원</label>
            <Input
              type="number"
              min={1}
              max={100}
              value={draft.requiredCount}
              onChange={(e) => setDraft((p) => ({ ...p, requiredCount: e.target.value }))}
              className="h-8 w-20"
              aria-label="필요 인원"
            />
          </div>
          <div>
            <label className="text-[11px] text-muted-foreground">후보인원 (TO)</label>
            <Input
              type="number"
              min={1}
              max={100}
              value={draft.candidateCount}
              onChange={(e) => setDraft((p) => ({ ...p, candidateCount: e.target.value }))}
              className="h-8 w-20"
              aria-label="후보 인원"
            />
          </div>
          <Button size="sm" className="h-8" onClick={createSession} disabled={pending}>
            <Plus className="mr-1 h-3.5 w-3.5" aria-hidden />
            컨설팅 세션 만들기
          </Button>
          {fieldOptions.length === 0 && (
            <p className="w-full text-xs text-muted-foreground">
              분야가 아직 없습니다 —{" "}
              <Link
                href={`/${tenantSlug}/settings/me`}
                className="text-brand underline underline-offset-2"
              >
                설정 &gt; 내 설정 &gt; 분야
              </Link>
              에서 누구나 추가할 수 있습니다.
            </p>
          )}
        </div>
      )}

      {sessions.length === 0 ? (
        <p className="rounded-md bg-secondary/50 p-3 text-sm text-muted-foreground">
          아직 컨설팅 세션이 없습니다. 수행기간·분야·인원을 입력해 만들어 보세요.
        </p>
      ) : (
        <ul className="space-y-3">
          {sessions.map((s) => (
            <li key={s.id} className="rounded-lg border p-3">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-semibold">{s.name ?? "컨설팅"}</span>
                {s.fieldName && <Badge variant="secondary">{s.fieldName}</Badge>}
                <span className="text-xs text-muted-foreground">
                  {s.startsOn} ~ {s.endsOn ?? "?"}
                </span>
                <span className="text-xs font-semibold text-[#FF6F61]">
                  필요 {s.requiredCount}명
                </span>
                <span className="text-xs text-muted-foreground">
                  · 후보 TO {s.candidateCount}
                </span>
                {expertsEnabled && (
                  <Link
                    href={`/${tenantSlug}/projects/${projectId}?tab=experts#slot-${s.id}`}
                    className="ml-auto inline-flex items-center gap-0.5 rounded border border-brand/40 px-1.5 py-0.5 text-[11px] font-semibold text-brand hover:bg-brand/10"
                  >
                    <UserSearch className="h-3 w-3" aria-hidden />
                    섭외계획
                  </Link>
                )}
              </div>

              {/* 멘티 정보 — 세션 작성 후 기입 (품의에 동봉) */}
              <div className="mt-2 rounded-md bg-secondary/30 p-2">
                <p className="mb-1 flex items-center gap-1 text-[11px] font-semibold text-muted-foreground">
                  <Users className="h-3 w-3" aria-hidden />
                  멘티 정보 ({s.mentees.length}명) — 섭외계획 품의에 함께 전송됩니다
                </p>
                {s.mentees.length > 0 && (
                  <ul className="mb-1.5 space-y-0.5">
                    {s.mentees.map((m) => (
                      <li
                        key={m.id}
                        className="flex items-center gap-1.5 text-xs"
                      >
                        <span>
                          {[m.orgName, m.positionTitle, m.name]
                            .filter(Boolean)
                            .join(" · ")}
                          {m.itemName ? ` — ${m.itemName}` : ""}
                          {m.menteeType ? ` (${m.menteeType})` : ""}
                        </span>
                        {canManage && (
                          <button
                            type="button"
                            aria-label={`${m.name} 멘티 삭제`}
                            disabled={pending}
                            onClick={() => run(() => removeSlotMentee(m.id))}
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
                  (menteeSlot === s.id ? (
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Input
                        value={mentee.orgName}
                        onChange={(e) =>
                          setMentee((p) => ({ ...p, orgName: e.target.value }))
                        }
                        placeholder="멘티 소속명 (필수)"
                        className="h-7 w-36 text-xs"
                        maxLength={100}
                      />
                      <Input
                        value={mentee.positionTitle}
                        onChange={(e) =>
                          setMentee((p) => ({ ...p, positionTitle: e.target.value }))
                        }
                        placeholder="직위"
                        className="h-7 w-24 text-xs"
                        maxLength={50}
                      />
                      <Input
                        value={mentee.name}
                        onChange={(e) =>
                          setMentee((p) => ({ ...p, name: e.target.value }))
                        }
                        placeholder="이름 (필수)"
                        className="h-7 w-24 text-xs"
                        maxLength={50}
                      />
                      <Input
                        value={mentee.itemName}
                        onChange={(e) =>
                          setMentee((p) => ({ ...p, itemName: e.target.value }))
                        }
                        placeholder="아이템명"
                        className="h-7 w-36 text-xs"
                        maxLength={120}
                      />
                      <Input
                        value={mentee.menteeType}
                        onChange={(e) =>
                          setMentee((p) => ({ ...p, menteeType: e.target.value }))
                        }
                        placeholder="유형 (예: 예비창업)"
                        className="h-7 w-28 text-xs"
                        maxLength={50}
                      />
                      <Button
                        size="sm"
                        className="h-7 text-xs"
                        disabled={pending}
                        onClick={() => submitMentee(s.id)}
                      >
                        추가
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs"
                        disabled={pending}
                        onClick={() => setMenteeSlot(null)}
                      >
                        닫기
                      </Button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => {
                        setMenteeSlot(s.id);
                        setMentee(EMPTY_MENTEE);
                      }}
                      className="rounded-md border border-dashed px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:border-brand hover:text-brand"
                    >
                      + 멘티 추가
                    </button>
                  ))}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
