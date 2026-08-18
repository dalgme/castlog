"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Send, Copy, Check, AlertTriangle, CircleCheck } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { SlotCandidate } from "@/lib/integrations/slot-candidates";
import { expertTagLabel } from "@/lib/integrations/expert-tags";
import {
  blindConflictTotal,
  describeBlindConflicts,
} from "@/lib/integrations/schedule-conflicts";

import { requestEngagementForPosition } from "./position-actions";

/**
 * 넘버링코드별 섭외 후보군 — 일정 중복이 자동 검증되어 표시된다.
 * 후보 선택 → 섭외요청 생성(슬롯의 일정·역할·비용·장소 승계) → 동의 링크 발급.
 */
export function CandidatePicker({
  positionId,
  candidates,
  defaultProgramName,
}: {
  positionId: string;
  candidates: SlotCandidate[];
  defaultProgramName: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const [selected, setSelected] = useState<string | null>(null);
  const [programName, setProgramName] = useState(defaultProgramName);
  const [eventSummary, setEventSummary] = useState("");
  const [specialNotes, setSpecialNotes] = useState("");
  const [deadline, setDeadline] = useState("");

  const send = () => {
    if (!selected) return;
    setError(null);
    startTransition(async () => {
      const r = await requestEngagementForPosition({
        positionId,
        expertId: selected,
        programName,
        eventSummary,
        specialNotes,
        responseDeadline: deadline || undefined,
      });
      if (!r.ok) setError(r.error);
      else {
        setUrl(r.url);
        router.refresh();
      }
    });
  };

  const copy = () => {
    if (!url) return;
    navigator.clipboard?.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  if (url) {
    return (
      <Alert>
        <AlertDescription>
          <p className="mb-2">
            섭외 요청을 생성했습니다. 아래 동의 링크를 전문가에게 전달하세요.
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 truncate rounded bg-secondary/70 px-2 py-1 text-xs">
              {url}
            </code>
            <Button size="sm" variant="outline" onClick={copy}>
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            </Button>
          </div>
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-3">
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <p className="text-xs text-muted-foreground">
        이 일정과 겹치는 후보는 자동으로 표시됩니다. 타사 섭외·전문가 개인 일정은
        어느 기업의 무슨 일인지는 공개되지 않고, ‘아직 수락 전(진행 중)’인지
        ‘이미 확정’인지와 건수만 보여집니다.
      </p>

      {candidates.length === 0 ? (
        <p className="rounded-md bg-secondary/50 p-3 text-sm text-muted-foreground">
          연결된 전문가가 없습니다. 전문가 목록에서 먼저 연결해 주세요.
        </p>
      ) : (
        <ul className="max-h-80 space-y-1.5 overflow-y-auto">
          {candidates.map((c) => {
            const blindLines = describeBlindConflicts(c.conflict.blind);
            const blindTotal = blindConflictTotal(c.conflict.blind);
            const hasConflict = c.conflict.own.length > 0 || blindTotal > 0;
            // 미수락 경합만 있는 경우는 '불가'가 아니라 '경합' — 색을 구분한다.
            const hardConflict =
              c.conflict.own.length > 0 ||
              c.conflict.blind.accepted > 0 ||
              c.conflict.blind.personal > 0;
            const on = selected === c.expertId;
            return (
              <li key={c.expertId}>
                <button
                  type="button"
                  onClick={() => setSelected(c.expertId)}
                  className={
                    "w-full rounded-md border p-2.5 text-left transition-colors " +
                    (on ? "border-brand bg-brand/5" : "hover:border-brand/40")
                  }
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold">{c.name}</span>
                    {expertTagLabel(c.tag) && (
                      <Badge
                        variant={c.tag === "caution" ? "destructive" : "secondary"}
                        className="px-1.5 py-0 text-[10px]"
                      >
                        {expertTagLabel(c.tag)}
                      </Badge>
                    )}
                    {[c.specialty, c.region, c.careerYears ? `경력 ${c.careerYears}년` : null]
                      .filter(Boolean)
                      .map((t, i) => (
                        <span key={i} className="text-xs text-muted-foreground">
                          {t}
                        </span>
                      ))}
                    <span className="ml-auto">
                      {hardConflict ? (
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-700">
                          <AlertTriangle className="h-3.5 w-3.5" /> 일정 겹침
                        </span>
                      ) : hasConflict ? (
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-600">
                          <AlertTriangle className="h-3.5 w-3.5" /> 섭외 경합
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-green-700">
                          <CircleCheck className="h-3.5 w-3.5" /> 가능
                        </span>
                      )}
                    </span>
                  </div>
                  {hasConflict && (
                    <div className="mt-1 space-y-0.5">
                      {c.conflict.own.map((o, i) => (
                        <p key={i} className="text-xs text-amber-800">
                          {o.startsOn} · {o.label}
                        </p>
                      ))}
                      {c.tag === "caution" && c.tagNote && (
                        <p className="text-xs text-destructive">
                          주의: {c.tagNote}
                        </p>
                      )}
                      {blindLines.map((line, i) => (
                        <p key={i} className="text-xs text-muted-foreground">
                          {line}
                        </p>
                      ))}
                    </div>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <div className="space-y-2 border-t pt-3">
        <Input
          value={programName}
          onChange={(e) => setProgramName(e.target.value)}
          placeholder="사업명 / 프로그램명"
        />
        <Textarea
          rows={2}
          value={eventSummary}
          onChange={(e) => setEventSummary(e.target.value)}
          placeholder="주제 / 행사 내용 (선택)"
        />
        <Textarea
          rows={2}
          value={specialNotes}
          onChange={(e) => setSpecialNotes(e.target.value)}
          placeholder="특기사항 (선택)"
        />
        <div>
          <label className="text-[11px] text-muted-foreground">회신 마감일시 (선택)</label>
          <Input
            type="datetime-local"
            value={deadline}
            onChange={(e) => setDeadline(e.target.value)}
          />
        </div>
        <Button onClick={send} disabled={pending || !selected}>
          <Send className="mr-1.5 h-4 w-4" />
          {pending ? "생성 중..." : "섭외 요청 보내기"}
        </Button>
      </div>
    </div>
  );
}
