"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Send, Copy, Check, AlertTriangle, CircleCheck } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DateTime24Input } from "@/components/ui/datetime24";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { SlotCandidate } from "@/lib/integrations/slot-candidates";
import { CANDIDATE_LIMIT } from "@/lib/integrations/candidate-limits";
import { expertTagLabel } from "@/lib/integrations/expert-tags";
import {
  blindConflictTotal,
  describeBlindConflicts,
} from "@/lib/integrations/schedule-conflicts";
import { describeOwnConflict } from "@/lib/integrations/own-conflicts";

import { requestEngagementForPosition } from "./position-actions";
import { submitActionRequest } from "../../action-request-actions";

/**
 * 넘버링코드별 섭외 후보군 — 일정 중복이 자동 검증되어 표시된다.
 * 후보 선택 → 섭외요청 생성(슬롯의 일정·역할·비용·장소 승계) → 동의 링크 발급.
 */
export function CandidatePicker({
  positionId,
  candidates,
  defaultProgramName,
  defaultSummary = null,
  tenantSlug,
  projectId,
  expertsLite = false,
}: {
  positionId: string;
  candidates: SlotCandidate[];
  defaultProgramName: string;
  /** 프로젝트 설명에서 자동 채움 — 발송 전 수정 가능 (기획 확정 2026-08-23) */
  defaultSummary?: string | null;
  tenantSlug: string;
  projectId: string;
  /** 라이트 모드 — 발송 없이 기록만 되므로 문구·마감 입력을 그에 맞춘다 (검수 A7) */
  expertsLite?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const [selected, setSelected] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [programName, setProgramName] = useState(defaultProgramName);
  const [eventSummary, setEventSummary] = useState(defaultSummary ?? "");
  const [specialNotes, setSpecialNotes] = useState("");
  const [deadline, setDeadline] = useState("");
  // 부PM이 PM 승인 없이 실행을 시도한 경우 — 그 자리에서 승인을 요청한다.
  const [needsPmApproval, setNeedsPmApproval] = useState(false);
  const [approvalNote, setApprovalNote] = useState("");
  const [requested, setRequested] = useState(false);

  // 후보가 수십 명만 돼도 스크롤로 찾기 어렵다. 서버에서 이미 정렬(충돌 없는 순
  // → 등급 → 이름)해 두었으므로 여기서는 순서를 건드리지 않고 걸러내기만 한다.
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return candidates;
    return candidates.filter((c) =>
      [c.name, c.specialty, c.region]
        .filter(Boolean)
        .some((v) => v!.toLowerCase().includes(q))
    );
  }, [candidates, search]);

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
      if (!r.ok) {
        setError(r.error);
        setNeedsPmApproval(r.needsPmApproval === true);
      } else {
        setUrl(r.url);
        router.refresh();
      }
    });
  };

  const askPm = () => {
    setError(null);
    startTransition(async () => {
      const r = await submitActionRequest({
        tenantSlug,
        projectId,
        actionType: "engagement.request",
        targetId: positionId,
        note: approvalNote,
      });
      if (!r.ok) setError(r.error);
      else {
        setNeedsPmApproval(false);
        setRequested(true);
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
          {expertsLite ? (
            <p className="mb-2">
              섭외 요청을 발송 없이 기록했습니다 (라이트 모드). 전화 확인 후
              프로젝트 섭외 탭의 ‘섭외 완료(수락서 생성)’ 버튼으로 확정하세요.
            </p>
          ) : (
            <p className="mb-2">
              문자·이메일로 섭외 요청을 보냈습니다. 필요하면 아래 동의 링크를
              직접 전달할 수도 있습니다.
            </p>
          )}
          {!expertsLite && (
            <div className="flex items-center gap-2">
              <code className="flex-1 truncate rounded bg-secondary/70 px-2 py-1 text-xs">
                {url}
              </code>
              <Button size="sm" variant="outline" onClick={copy}>
                {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              </Button>
            </div>
          )}
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

      {needsPmApproval && (
        <div className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-3">
          <p className="text-xs leading-relaxed text-amber-900">
            부PM은 PM과 같은 일을 하지만, 전문가에게 직접 나가는 요청은 PM 승인을
            먼저 받습니다. 승인되면 이 화면에서 직접 발송하시면 됩니다.
          </p>
          <Textarea
            rows={2}
            value={approvalNote}
            onChange={(e) => setApprovalNote(e.target.value)}
            placeholder="PM에게 전할 메모 (선택)"
          />
          <Button size="sm" onClick={askPm} disabled={pending}>
            PM 승인 요청
          </Button>
        </div>
      )}

      {requested && (
        <Alert>
          <AlertDescription>
            PM에게 승인 요청을 보냈습니다. 승인되면 이 화면에서 바로 발송할 수 있습니다.
          </AlertDescription>
        </Alert>
      )}

      <p className="text-xs text-muted-foreground">
        이 일정과 겹치는 후보는 자동으로 표시됩니다. 타사 섭외·전문가 개인 일정은
        어느 기업의 무슨 일인지는 공개되지 않고, ‘아직 수락 전(진행 중)’인지
        ‘이미 확정’인지와 건수만 보여집니다.
      </p>

      {candidates.length >= CANDIDATE_LIMIT && (
        <p className="rounded-md bg-amber-50 p-2.5 text-xs text-amber-900">
          연결 전문가가 많아 최근 {CANDIDATE_LIMIT}명만 불러왔습니다. 찾는 분이
          없으면 전문가 목록에서 확인해 주세요.
        </p>
      )}

      {candidates.length > 0 && (
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="이름 · 전문분야 · 지역으로 좁히기"
          className="h-9"
        />
      )}

      {candidates.length === 0 ? (
        <p className="rounded-md bg-secondary/50 p-3 text-sm text-muted-foreground">
          연결된 전문가가 없습니다. 전문가 목록에서 먼저 연결해 주세요.
        </p>
      ) : visible.length === 0 ? (
        <p className="rounded-md bg-secondary/50 p-3 text-sm text-muted-foreground">
          ‘{search}’와 일치하는 후보가 없습니다.
        </p>
      ) : (
        <ul className="max-h-80 space-y-1.5 overflow-y-auto">
          {visible.map((c) => {
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
                          {describeOwnConflict(o)}
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
        {/* 라이트 모드는 발송·링크 만료가 없다 — 마감 입력을 묻지 않는다 (검수 A7) */}
        {!expertsLite && (
          <div>
            <label className="text-[11px] text-muted-foreground">회신 마감일시 (선택)</label>
            <DateTime24Input value={deadline} onChange={setDeadline} />
          </div>
        )}
        <Button onClick={send} disabled={pending || !selected}>
          <Send className="mr-1.5 h-4 w-4" />
          {pending
            ? expertsLite
              ? "기록 중..."
              : "생성 중..."
            : expertsLite
              ? "섭외 요청 기록"
              : "섭외 요청 보내기"}
        </Button>
      </div>
    </div>
  );
}
