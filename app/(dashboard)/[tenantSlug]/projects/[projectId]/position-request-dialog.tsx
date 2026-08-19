"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  ArrowLeft,
  CircleCheck,
  Copy,
  Check,
  Search,
  Send,
} from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { formatKrw } from "@/lib/approvals/constants";
import { expertTagLabel } from "@/lib/integrations/expert-tags";
import { roleTypeLabel } from "@/lib/integrations/engagement-roles";
import {
  blindConflictTotal,
  describeBlindConflicts,
} from "@/lib/integrations/schedule-conflicts";
import type { SlotCandidate, SlotContext } from "@/lib/integrations/slot-candidates";

import { loadPositionRequestData } from "./position-request-actions";
import { requestEngagementForPosition } from "./positions/[positionId]/position-actions";
import { submitActionRequest } from "./action-request-actions";

/**
 * 코드넘버 하나에 대한 섭외 요청 — 탐색 → 확인 → 발송을 팝업 안에서 끝낸다.
 *
 * 왜 팝업인가: 세션 목록에서 "이 자리를 채우자"고 마음먹은 순간과 실제로 요청을
 * 보내는 순간 사이에 페이지 이동이 끼면, 어느 자리를 채우던 중이었는지 맥락이
 * 끊긴다. 자리를 보면서 후보를 고르고 그 자리에서 보내는 것이 실제 일의 순서다.
 *
 * 1단계 탐색 — 후보 목록. 해당 일정 섭외 가능 여부는 **임시 판단**이다. 시스템이
 *   아는 일정(자사 섭외·타사 섭외·전문가가 공개한 개인일정)만 보고 말하는 것이라,
 *   최종 가능 여부는 전문가 본인의 수락으로 정해진다. 화면에도 그렇게 적는다.
 * 2단계 확인·발송 — 프로젝트·세션 정보는 자동으로 채워 읽기 전용으로 보여 주고,
 *   담당자가 손댈 것(사업명·주제·메모·회신 마감)만 입력받는다.
 */
export function PositionRequestDialog({
  positionId,
  code,
  tenantSlug,
  projectId,
  variant = "button",
}: {
  positionId: string;
  code: string;
  tenantSlug: string;
  projectId: string;
  /** chip = 세션 표의 코드 조각 자리에 그대로 놓는 형태 */
  variant?: "button" | "chip";
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [context, setContext] = useState<SlotContext | null>(null);
  const [candidates, setCandidates] = useState<SlotCandidate[] | null>(null);
  const [planBlocked, setPlanBlocked] = useState(false);
  const [planMessage, setPlanMessage] = useState("");

  const [step, setStep] = useState<1 | 2>(1);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<SlotCandidate | null>(null);

  const [programName, setProgramName] = useState("");
  const [eventSummary, setEventSummary] = useState("");
  const [memo, setMemo] = useState("");
  const [deadline, setDeadline] = useState("");

  const [url, setUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [needsPmApproval, setNeedsPmApproval] = useState(false);
  const [approvalNote, setApprovalNote] = useState("");
  const [approvalRequested, setApprovalRequested] = useState(false);

  function reset() {
    setStep(1);
    setSearch("");
    setSelected(null);
    setEventSummary("");
    setMemo("");
    setDeadline("");
    setUrl(null);
    setError(null);
    setNeedsPmApproval(false);
    setApprovalRequested(false);
  }

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      reset();
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await loadPositionRequestData(positionId);
      if (!res.ok) {
        setError(res.error);
        setCandidates([]);
        return;
      }
      setContext(res.context);
      setCandidates(res.candidates);
      setPlanBlocked(res.planBlocked);
      setPlanMessage(res.planMessage);
      // 사업명은 프로젝트명으로 시작한다 — 대부분 그대로 쓰고, 다르면 고친다
      setProgramName(res.context.projectName);
    });
  }

  const visible = (candidates ?? []).filter((c) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return [c.name, c.specialty, c.region]
      .filter(Boolean)
      .some((v) => v!.toLowerCase().includes(q));
  });

  function send() {
    if (!selected) return;
    setError(null);
    startTransition(async () => {
      const res = await requestEngagementForPosition({
        positionId,
        expertId: selected.expertId,
        programName,
        eventSummary,
        specialNotes: memo,
        responseDeadline: deadline || undefined,
      });
      if (!res.ok) {
        setError(res.error);
        setNeedsPmApproval(res.needsPmApproval === true);
      } else {
        setUrl(res.url);
        router.refresh();
      }
    });
  }

  function askPm() {
    setError(null);
    startTransition(async () => {
      const res = await submitActionRequest({
        tenantSlug,
        projectId,
        actionType: "engagement.request",
        targetId: positionId,
        note: approvalNote,
      });
      if (!res.ok) setError(res.error);
      else {
        setNeedsPmApproval(false);
        setApprovalRequested(true);
      }
    });
  }

  async function copyUrl() {
    if (!url) return;
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  const schedule = context
    ? `${context.slotDate}${
        context.startsTime && context.endsTime
          ? ` ${context.startsTime.slice(0, 5)}~${context.endsTime.slice(0, 5)}`
          : ""
      }`
    : "";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        {variant === "chip" ? (
          <button
            type="button"
            className="inline-flex items-center gap-1.5 rounded-md border bg-background px-2 py-1 text-xs text-muted-foreground transition-colors hover:border-brand hover:text-brand"
          >
            <span className="font-mono font-semibold">{code}</span>
            <span>섭외하기 →</span>
          </button>
        ) : (
          <Button size="sm">
            <Search className="mr-1.5 h-3.5 w-3.5" />
            전문가 탐색/요청
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>
            섭외 요청 · <span className="font-mono">{code}</span>
          </DialogTitle>
          <DialogDescription>
            {step === 1
              ? "1단계 — 후보를 고릅니다. 해당 일정 가능 여부는 시스템이 아는 일정만 보고 내린 임시 판단입니다."
              : "2단계 — 프로젝트·세션 정보는 자동으로 채워집니다. 확인 후 보내세요."}
          </DialogDescription>
        </DialogHeader>

        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {needsPmApproval && (
          <div className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-3">
            <p className="text-xs leading-relaxed text-amber-900">
              부PM은 PM과 같은 일을 하지만, 전문가에게 직접 나가는 요청은 PM 승인을
              먼저 받습니다. 승인되면 여기서 그대로 보내시면 됩니다.
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

        {approvalRequested && (
          <Alert>
            <AlertDescription>
              PM에게 승인 요청을 보냈습니다. 승인되면 이 화면에서 바로 발송할 수
              있습니다.
            </AlertDescription>
          </Alert>
        )}

        {planBlocked && (
          <Alert>
            <AlertDescription className="text-sm">
              섭외계획 승인 전입니다. {planMessage}
            </AlertDescription>
          </Alert>
        )}

        {/* ---- 발송 완료 ---------------------------------------------------- */}
        {url ? (
          <div className="space-y-3">
            <Alert>
              <AlertDescription>
                <p className="mb-2">
                  <strong>{selected?.name}</strong> 님에게 보낼 섭외 요청을
                  만들었습니다. 아래 동의 링크를 전달하세요.
                </p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 truncate rounded bg-secondary/70 px-2 py-1 text-xs">
                    {url}
                  </code>
                  <Button size="sm" variant="outline" onClick={copyUrl}>
                    {copied ? (
                      <Check className="h-4 w-4" />
                    ) : (
                      <Copy className="h-4 w-4" />
                    )}
                  </Button>
                </div>
              </AlertDescription>
            </Alert>
            <Button className="w-full" onClick={() => onOpenChange(false)}>
              닫기
            </Button>
          </div>
        ) : pending && !candidates ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            후보를 불러오는 중…
          </p>
        ) : step === 1 ? (
          /* ---- 1단계: 탐색 ------------------------------------------------ */
          <div className="space-y-3">
            {context && (
              <div className="rounded-md bg-secondary/50 p-2.5 text-xs">
                <span className="font-medium">{context.projectName}</span>
                {context.sessionName && <> · {context.sessionName}</>} · {schedule}
              </div>
            )}

            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="이름 · 전문분야 · 지역으로 좁히기"
              className="h-9"
            />

            {(candidates ?? []).length === 0 ? (
              <p className="rounded-md bg-secondary/50 p-3 text-sm text-muted-foreground">
                연결된 전문가가 없습니다. 전문가 목록에서 먼저 연결해 주세요.
              </p>
            ) : visible.length === 0 ? (
              <p className="rounded-md bg-secondary/50 p-3 text-sm text-muted-foreground">
                ‘{search}’와 일치하는 후보가 없습니다.
              </p>
            ) : (
              <ul className="max-h-72 space-y-1.5 overflow-y-auto">
                {visible.map((c) => (
                  <li key={c.expertId}>
                    <button
                      type="button"
                      onClick={() => setSelected(c)}
                      className={
                        "w-full rounded-md border p-2.5 text-left transition-colors " +
                        (selected?.expertId === c.expertId
                          ? "border-brand bg-brand/5"
                          : "hover:border-brand/40")
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
                        {c.specialty && (
                          <span className="text-xs text-muted-foreground">
                            {c.specialty}
                          </span>
                        )}
                        <span className="ml-auto">
                          <AvailabilityMark candidate={c} />
                        </span>
                      </div>
                      <HistoryLine candidate={c} />
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {selected && (
              <SelectedDetail candidate={selected} />
            )}

            <Button
              className="w-full"
              disabled={!selected || planBlocked}
              onClick={() => setStep(2)}
            >
              다음
            </Button>
          </div>
        ) : (
          /* ---- 2단계: 자동 기입 확인 + 메모 -------------------------------- */
          <div className="space-y-3">
            <div className="rounded-lg border">
              <p className="border-b bg-secondary/40 px-3 py-2 text-xs font-semibold">
                자동으로 채워지는 내용 (세션에서 승계)
              </p>
              <dl className="divide-y text-sm">
                <Field label="전문가" value={selected?.name ?? "-"} />
                <Field label="프로젝트" value={context?.projectName ?? "-"} />
                <Field
                  label="세션"
                  value={context?.sessionName ?? roleTypeLabel(context?.roleType) ?? "-"}
                />
                <Field label="코드넘버" value={code} />
                <Field label="일정" value={schedule || "-"} />
                <Field
                  label="역할"
                  value={
                    context?.roleDescription ??
                    roleTypeLabel(context?.roleType) ??
                    "-"
                  }
                />
                <Field
                  label="의뢰비용"
                  value={
                    context?.feeAmount !== null && context?.feeAmount !== undefined
                      ? formatKrw(context.feeAmount)
                      : "미지정"
                  }
                />
                <Field
                  label="장소"
                  value={
                    context?.locationName
                      ? `${context.locationName}${
                          context.locationAddress
                            ? ` (${context.locationAddress})`
                            : ""
                        }`
                      : "미지정"
                  }
                />
              </dl>
            </div>

            <div className="space-y-2">
              <div>
                <label className="text-[11px] text-muted-foreground">
                  사업명 / 프로그램명
                </label>
                <Input
                  value={programName}
                  onChange={(e) => setProgramName(e.target.value)}
                />
              </div>
              <div>
                <label className="text-[11px] text-muted-foreground">
                  주제 / 행사 내용 (선택)
                </label>
                <Textarea
                  rows={2}
                  value={eventSummary}
                  onChange={(e) => setEventSummary(e.target.value)}
                />
              </div>
              <div>
                <label className="text-[11px] text-muted-foreground">
                  추가 메모 · 특기사항 (선택)
                </label>
                <Textarea
                  rows={3}
                  value={memo}
                  onChange={(e) => setMemo(e.target.value)}
                  placeholder="주차 안내, 준비물, 사전 협의 내용 등 — 전문가에게 그대로 전달됩니다."
                />
              </div>
              <div>
                <label className="text-[11px] text-muted-foreground">
                  회신 마감일시 (선택)
                </label>
                <Input
                  type="datetime-local"
                  value={deadline}
                  onChange={(e) => setDeadline(e.target.value)}
                />
              </div>
            </div>

            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setStep(1)} disabled={pending}>
                <ArrowLeft className="mr-1.5 h-4 w-4" />
                이전
              </Button>
              <Button className="flex-1" onClick={send} disabled={pending}>
                <Send className="mr-1.5 h-4 w-4" />
                {pending ? "생성 중…" : "섭외 요청 보내기"}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-3 px-3 py-1.5">
      <dt className="w-20 shrink-0 text-xs text-muted-foreground">{label}</dt>
      <dd className="min-w-0 flex-1 break-words">{value}</dd>
    </div>
  );
}

/** 해당 일정 섭외 가능 여부 — 시스템이 아는 일정만 본 임시 판단 */
function AvailabilityMark({ candidate }: { candidate: SlotCandidate }) {
  const blindTotal = blindConflictTotal(candidate.conflict.blind);
  const hard =
    candidate.conflict.own.length > 0 ||
    candidate.conflict.blind.accepted > 0 ||
    candidate.conflict.blind.personal > 0;
  const soft = !hard && blindTotal > 0;

  if (hard) {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-700">
        <AlertTriangle className="h-3.5 w-3.5" /> 일정 겹침
      </span>
    );
  }
  if (soft) {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-600">
        <AlertTriangle className="h-3.5 w-3.5" /> 섭외 경합
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs font-medium text-green-700">
      <CircleCheck className="h-3.5 w-3.5" /> 가능(임시)
    </span>
  );
}

/** 간단 이력 한 줄 — 자사 기준 */
function HistoryLine({ candidate }: { candidate: SlotCandidate }) {
  const h = candidate.history;
  const parts: string[] = [];
  parts.push(h.acceptedCount > 0 ? `자사 ${h.acceptedCount}회` : "자사 첫 섭외");
  if (h.lastEngagedOn) parts.push(`최근 ${h.lastEngagedOn}`);
  if (h.avgScore !== null) parts.push(`평판 ${h.avgScore.toFixed(1)}/10`);
  if (candidate.careerYears) parts.push(`경력 ${candidate.careerYears}년`);
  if (candidate.region) parts.push(candidate.region);
  return (
    <p className="mt-1 text-xs text-muted-foreground">{parts.join(" · ")}</p>
  );
}

/** 고른 후보의 겹침 상세 — 왜 '겹침'인지 근거를 보여 준다 */
function SelectedDetail({ candidate }: { candidate: SlotCandidate }) {
  const blindLines = describeBlindConflicts(candidate.conflict.blind);
  const hasAny =
    candidate.conflict.own.length > 0 ||
    blindLines.length > 0 ||
    candidate.tag === "caution";

  return (
    <div className="rounded-lg border border-brand/40 bg-brand/[0.03] p-3">
      <p className="text-sm font-semibold">{candidate.name}</p>
      <HistoryLine candidate={candidate} />
      {hasAny ? (
        <div className="mt-2 space-y-0.5">
          {candidate.conflict.own.map((o, i) => (
            <p key={i} className="text-xs text-amber-800">
              {o.startsOn} · {o.label}
            </p>
          ))}
          {blindLines.map((line, i) => (
            <p key={i} className="text-xs text-muted-foreground">
              {line}
            </p>
          ))}
          {candidate.tag === "caution" && candidate.tagNote && (
            <p className="text-xs text-destructive">주의: {candidate.tagNote}</p>
          )}
        </div>
      ) : (
        <p className="mt-2 text-xs text-muted-foreground">
          시스템이 아는 일정과 겹치는 것이 없습니다. 최종 가능 여부는 전문가 본인의
          수락으로 정해집니다.
        </p>
      )}
    </div>
  );
}
