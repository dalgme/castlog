"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Paperclip, Send, Check, MapPin, X } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ACCEPTANCE_STATUS_LABELS } from "@/lib/integrations/acceptance-workflow";

import {
  updateAcceptanceGuide,
  uploadAcceptanceMap,
  uploadAcceptanceAttachment,
  deleteAcceptanceAttachment,
  sendAcceptance,
  confirmAcceptance,
} from "./acceptance-actions";

/**
 * 수락서 보완 편집 + 송부 + 확인 (기업 관리자 이상).
 * 수락 조건 스냅샷(역할·비용·일정)은 편집하지 않는다 — 안내 정보만 보완한다.
 */
export function AcceptanceEditor({
  acceptanceId,
  status,
  guideNote,
  paymentDueNote,
  submissionDocs,
  hasMap,
  attachments,
  expertsLite = false,
}: {
  acceptanceId: string;
  status: string;
  guideNote: string;
  paymentDueNote: string;
  submissionDocs: string;
  hasMap: boolean;
  attachments: { id: string; fileName: string }[];
  /** 라이트 모드 — 송부 대신 기업 담당자의 확인으로 마감한다 */
  expertsLite?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [note, setNote] = useState(guideNote);
  const [dueNote, setDueNote] = useState(paymentDueNote);
  const [docs, setDocs] = useState(submissionDocs);

  const mapRef = useRef<HTMLInputElement>(null);
  const attRef = useRef<HTMLInputElement>(null);

  const run = (fn: () => Promise<{ ok: true } | { ok: false; error: string }>, ok?: string) => {
    setError(null);
    setInfo(null);
    startTransition(async () => {
      const r = await fn();
      if (!r.ok) setError(r.error);
      else {
        if (ok) setInfo(ok);
        router.refresh();
      }
    });
  };

  const onFile = (
    e: React.ChangeEvent<HTMLInputElement>,
    action: (fd: FormData) => Promise<{ ok: true } | { ok: false; error: string }>,
    okMsg: string
  ) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const fd = new FormData();
    fd.append("acceptanceId", acceptanceId);
    fd.append("file", file);
    run(() => action(fd), okMsg);
  };

  const editable = status !== "confirmed";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-muted-foreground">진행 상태</span>
        <Badge variant={status === "confirmed" ? "default" : "secondary"}>
          {ACCEPTANCE_STATUS_LABELS[status] ?? status}
        </Badge>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {info && (
        <Alert>
          <AlertDescription>{info}</AlertDescription>
        </Alert>
      )}

      {editable && (
        <>
          <div className="space-y-2">
            <p className="text-sm font-medium">상세 설명 (안내 사항)</p>
            <Textarea
              rows={4}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="준비물, 진행 순서, 주차 안내 등 전문가에게 전달할 안내를 작성하세요."
            />
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <div>
                <label className="text-[11px] text-muted-foreground">입금예정 안내</label>
                <Input
                  value={dueNote}
                  onChange={(e) => setDueNote(e.target.value)}
                  placeholder="프로그램 종료 후 30일 이내"
                />
              </div>
              <div>
                <label className="text-[11px] text-muted-foreground">제출서류</label>
                <Input
                  value={docs}
                  onChange={(e) => setDocs(e.target.value)}
                  placeholder="예: 통장사본, 신분증사본"
                />
              </div>
            </div>
            <p className="text-[11px] text-muted-foreground">
              소득구분·입금계좌는 전문가 프로필에서 자동 반영됩니다. 주민등록번호와 전체
              계좌번호는 수락서에 기재되지 않습니다.
            </p>
            <Button
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() =>
                run(
                  () => updateAcceptanceGuide(acceptanceId, note, dueNote, docs),
                  "저장했습니다."
                )
              }
            >
              안내 사항 저장
            </Button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={mapRef}
              type="file"
              accept="image/*,.pdf"
              className="hidden"
              onChange={(e) => onFile(e, uploadAcceptanceMap, "약도를 등록했습니다.")}
            />
            <Button
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() => mapRef.current?.click()}
            >
              <MapPin className="mr-1 h-4 w-4" />
              {hasMap ? "찾아오는 길 교체" : "찾아오는 길 등록"}
            </Button>

            <input
              ref={attRef}
              type="file"
              accept="image/*,.pdf"
              className="hidden"
              onChange={(e) =>
                onFile(e, uploadAcceptanceAttachment, "첨부파일을 등록했습니다.")
              }
            />
            <Button
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() => attRef.current?.click()}
            >
              <Paperclip className="mr-1 h-4 w-4" /> 첨부파일 추가
            </Button>
          </div>

          {attachments.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {attachments.map((f) => (
                <span
                  key={f.id}
                  className="inline-flex max-w-[240px] items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs"
                >
                  <span className="truncate">{f.fileName}</span>
                  <button
                    type="button"
                    aria-label="첨부 삭제"
                    disabled={pending}
                    onClick={() =>
                      run(() => deleteAcceptanceAttachment(f.id), "삭제했습니다.")
                    }
                    className="text-muted-foreground hover:text-red-600"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
            </div>
          )}
        </>
      )}

      <div className="flex flex-wrap gap-2 border-t pt-3">
        {editable && !expertsLite && (
          <Button
            size="sm"
            disabled={pending}
            onClick={() =>
              run(() => sendAcceptance(acceptanceId), "전문가에게 송부했습니다.")
            }
          >
            <Send className="mr-1 h-4 w-4" />
            {status === "issued" ? "수락서 송부" : "다시 송부"}
          </Button>
        )}
        {/* 라이트 모드 — 포털 서명이 없으므로 기업 담당자의 확인으로 마감한다.
            이 확정이 없으면 프로젝트가 '전원 수락'에서 멈춰 종료에 못 간다 */}
        {(status === "signed" || (expertsLite && editable)) && (
          <Button
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() => {
              if (
                expertsLite &&
                status !== "signed" &&
                !window.confirm(
                  "전문가 서명 없이 기업 확인으로 마감합니다 (라이트 모드).\n수락서 내용이 합의된 조건과 일치하는지 확인했습니까?"
                )
              ) {
                return;
              }
              run(() => confirmAcceptance(acceptanceId), "확인 처리했습니다.");
            }}
          >
            <Check className="mr-1 h-4 w-4" /> 확인 완료 처리
          </Button>
        )}
        {status === "confirmed" && (
          <p className="text-sm text-muted-foreground">
            {expertsLite
              ? "확인이 완료되었습니다 — 참여 확정."
              : "전문가가 확인·승인(서명)을 완료했습니다 — 참여 확정."}
          </p>
        )}
      </div>
    </div>
  );
}
