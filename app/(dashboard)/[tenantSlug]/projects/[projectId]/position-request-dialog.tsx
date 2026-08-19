"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  ArrowLeft,
  CircleCheck,
  Search,
  UserCheck,
} from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import {
  describeOwnConflict,
  hasOtherProjectConflict,
} from "@/lib/integrations/own-conflicts";
import type { SlotCandidate, SlotContext } from "@/lib/integrations/slot-candidates";

import { loadPositionRequestData } from "./position-request-actions";
import { assignExpertToPosition } from "./position-assign-actions";

/**
 * 코드넘버 한 자리에 전문가를 **임의 배정**한다 — 탐색 → 확인 → 배정.
 *
 * 배정은 아직 아무에게도 나가지 않는 내부 결정이다. 전문가는 이 사실을 모른다.
 * 알리는 것은 자리를 전부 채우고 → 섭외 품의를 올려 결재를 받은 뒤 →
 * '섭외 진행'으로 전원에게 한 번에 한다. 그래서 여기서 섭외 요청을 보내지 않는다.
 *
 * 1단계 탐색 — 후보 목록. 해당 일정 가능 여부는 **임시 판단**이다. 시스템이 아는
 *   일정(자사 섭외·배정, 타사 섭외, 전문가가 공개한 개인일정)만 보고 말하는
 *   것이라, 최종 가능 여부는 전문가 본인의 수락으로 정해진다.
 * 2단계 확인 — 프로젝트·세션 정보를 자동으로 채워 읽기 전용으로 보여 주고,
 *   그 자리에 이 분을 넣을지만 확인받는다.
 */
export function PositionRequestDialog({
  positionId,
  code,
  currentExpertName,
  variant = "button",
}: {
  positionId: string;
  code: string;
  /** 이미 배정된 전문가가 있으면 이름 (바꿔 넣는 경우) */
  currentExpertName?: string | null;
  /** chip = 세션 표의 코드 조각 자리에 그대로 놓는 형태 */
  variant?: "button" | "chip";
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [context, setContext] = useState<SlotContext | null>(null);
  const [candidates, setCandidates] = useState<SlotCandidate[] | null>(null);

  const [step, setStep] = useState<1 | 2>(1);
  // 같은 날 다른 사업에 이미 물려 있는 후보를 고른 경우 한 번 되묻는다
  const [confirmOverlap, setConfirmOverlap] = useState(false);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<SlotCandidate | null>(null);
  const [done, setDone] = useState(false);

  function reset() {
    setStep(1);
    setSearch("");
    setSelected(null);
    setError(null);
    setConfirmOverlap(false);
    setDone(false);
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
    });
  }

  const visible = (candidates ?? []).filter((c) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return [c.name, c.specialty, c.region]
      .filter(Boolean)
      .some((v) => v!.toLowerCase().includes(q));
  });

  function assign() {
    if (!selected) return;
    setError(null);
    startTransition(async () => {
      const res = await assignExpertToPosition({
        positionId,
        expertId: selected.expertId,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setDone(true);
      router.refresh();
    });
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
            <span>{currentExpertName ?? "배정하기 →"}</span>
          </button>
        ) : (
          <Button size="sm" variant={currentExpertName ? "outline" : "default"}>
            <Search className="mr-1.5 h-3.5 w-3.5" />
            {currentExpertName ? "배정 변경" : "전문가 탐색 · 배정"}
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>
            전문가 배정 · <span className="font-mono">{code}</span>
          </DialogTitle>
          <DialogDescription>
            {done
              ? "배정했습니다."
              : step === 1
                ? "1단계 — 후보를 고릅니다. 해당 일정 가능 여부는 시스템이 아는 일정만 보고 내린 임시 판단입니다."
                : "2단계 — 이 자리에 배정합니다. 아직 전문가에게 알려지지 않습니다."}
          </DialogDescription>
        </DialogHeader>

        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {done ? (
          <div className="space-y-3">
            <Alert>
              <AlertDescription>
                <strong>{selected?.name}</strong> 님을{" "}
                <span className="font-mono">{code}</span> 자리에 배정했습니다.
                아직 전문가에게 알려지지 않았습니다 — 자리를 전부 채운 뒤{" "}
                <strong>섭외 품의서 자동 작성 및 송신</strong>으로 결재를 올리고,
                승인되면 <strong>섭외 진행</strong>에서 전원에게 한 번에 요청합니다.
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

            {selected && <SelectedDetail candidate={selected} />}

            {/* 같은 날 다른 사업에 이미 물려 있으면 한 번 되묻는다.
                막지는 않는다 — 오전·오후로 나뉘거나 장소가 가까워 실제로 가능한
                경우가 있고, 그 판단은 담당자가 한다 */}
            {confirmOverlap ? (
              <div className="rounded-lg border-l-4 border-amber-500 bg-amber-50 p-3">
                <p className="text-sm font-bold text-amber-900">
                  같은 날짜에 배정/섭외된 프로젝트가 존재합니다. 그래도 섭외
                  진행하시겠습니까?
                </p>
                <ul className="mt-1.5 space-y-0.5">
                  {(selected?.conflict.own ?? []).map((o, i) => (
                    <li key={i} className="text-xs text-amber-900">
                      · {describeOwnConflict(o)}
                    </li>
                  ))}
                </ul>
                <div className="mt-3 flex gap-2">
                  <Button
                    size="sm"
                    onClick={() => {
                      setConfirmOverlap(false);
                      setStep(2);
                    }}
                  >
                    예, 진행합니다
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setConfirmOverlap(false)}
                  >
                    아니오, 다시 고르겠습니다
                  </Button>
                </div>
              </div>
            ) : (
              <Button
                className="w-full"
                disabled={!selected}
                onClick={() => {
                  if (selected && selected.conflict.own.length > 0) {
                    setConfirmOverlap(true);
                    return;
                  }
                  setStep(2);
                }}
              >
                다음
              </Button>
            )}
          </div>
        ) : (
          /* ---- 2단계: 배정 확인 -------------------------------------------- */
          <div className="space-y-3">
            <div className="rounded-lg border">
              <p className="border-b bg-secondary/40 px-3 py-2 text-xs font-semibold">
                이 자리에 배정합니다 (세션에서 자동 승계)
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
                    context?.roleDescription ?? roleTypeLabel(context?.roleType) ?? "-"
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
                          context.locationAddress ? ` (${context.locationAddress})` : ""
                        }`
                      : "미지정"
                  }
                />
              </dl>
            </div>

            <p className="rounded-md bg-secondary/40 p-2.5 text-xs leading-relaxed text-muted-foreground">
              배정은 <strong>내부 결정</strong>입니다. 전문가에게는 아직 아무것도
              나가지 않습니다. 사업명·주제·추가 메모·회신 마감은 결재 승인 후
              ‘섭외 진행’ 단계에서 한 번에 작성해 발송합니다.
            </p>

            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setStep(1)} disabled={pending}>
                <ArrowLeft className="mr-1.5 h-4 w-4" />
                이전
              </Button>
              <Button className="flex-1" onClick={assign} disabled={pending}>
                <UserCheck className="mr-1.5 h-4 w-4" />
                {pending ? "배정 중…" : "이 자리에 배정"}
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
  // 자사 다른 사업에 이미 물려 있는 경우가 가장 흔한 실수라 따로 이름을 붙인다.
  // '일정 겹침'이라고만 하면 어디서 겹치는지 몰라 그냥 넘긴다.
  const otherProject = hasOtherProjectConflict(candidate.conflict.own);
  const hard =
    candidate.conflict.own.length > 0 ||
    candidate.conflict.blind.accepted > 0 ||
    candidate.conflict.blind.personal > 0;
  const soft = !hard && blindTotal > 0;

  if (otherProject) {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-bold text-amber-700">
        <AlertTriangle className="h-3.5 w-3.5" /> 타사업 배정 중
      </span>
    );
  }
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
  // 자사에서 매긴 평가의 평균만 — 타사 평가는 조회되지 않는다 (§4)
  if (h.avgScore !== null) parts.push(`자사 평균 ${h.avgScore.toFixed(1)}`);
  if (candidate.careerYears) parts.push(`경력 ${candidate.careerYears}년`);
  if (candidate.region) parts.push(candidate.region);
  return <p className="mt-1 text-xs text-muted-foreground">{parts.join(" · ")}</p>;
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
          {candidate.conflict.own.length > 0 && (
            <>
              <p className="text-xs font-bold text-amber-900">
                우리 회사에서 같은 날 이미 잡혀 있는 일정
              </p>
              {candidate.conflict.own.map((o, i) => (
                <p key={i} className="pl-2 text-xs text-amber-800">
                  · {describeOwnConflict(o)}
                </p>
              ))}
            </>
          )}
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
