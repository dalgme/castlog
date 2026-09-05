"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Paperclip, Send, Check, MapPin, Link2, X } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { ACCEPTANCE_STATUS_LABELS } from "@/lib/integrations/acceptance-workflow";
import { DOCUMENT_ACCEPT_ATTR } from "@/lib/experts/documents";

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
  mapUrl: initialMapUrl = "",
  hasMap,
  attachments,
  expertsLite = false,
  signedAt = null,
}: {
  acceptanceId: string;
  status: string;
  guideNote: string;
  paymentDueNote: string;
  submissionDocs: string;
  /** 찾아오시는 길 지도 URL — 전문가 화면에서 팝업으로 열린다 */
  mapUrl?: string;
  hasMap: boolean;
  attachments: { id: string; fileName: string }[];
  /** 라이트 모드 — 송부 대신 기업 담당자의 확인으로 마감한다 */
  expertsLite?: boolean;
  /** 전자서명 시각 — 확정 경로(서명/기업 확인)를 레코드 기준으로 구분 (검수 B11) */
  signedAt?: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [note, setNote] = useState(guideNote);
  const [dueNote, setDueNote] = useState(paymentDueNote);
  const [docs, setDocs] = useState(submissionDocs);
  const [mapUrl, setMapUrl] = useState(initialMapUrl);
  const guideInput = () => ({
    guideNote: note,
    paymentDueNote: dueNote,
    submissionDocs: docs,
    mapUrl,
  });

  // 안내 사항 자동 저장 (기획 지시 2026-09-05) — 별도 저장 버튼 없이 입력이
  // 멈추면(1.2초) 또는 칸을 벗어나면 저장한다. 송부 때도 현재 값을 한 번 더
  // 저장하므로 마지막 타이핑이 빠질 일은 없다. 자동 저장은 화면을 새로고침하지
  // 않는다 — 타이핑 중 리렌더로 커서가 튀면 안 된다.
  const [autoSave, setAutoSave] = useState<
    { state: "idle" } | { state: "saving" } | { state: "saved"; at: Date } | { state: "error"; message: string }
  >({ state: "idle" });
  const lastSavedRef = useRef(
    JSON.stringify({
      guideNote: guideNote,
      paymentDueNote: paymentDueNote,
      submissionDocs: submissionDocs,
      mapUrl: initialMapUrl,
    })
  );
  const savingRef = useRef(false);
  const editable = status !== "confirmed";
  const canAutoSave = editable && !expertsLite;

  const flushGuide = async () => {
    if (!canAutoSave) return;
    const input = guideInput();
    const key = JSON.stringify(input);
    if (key === lastSavedRef.current || savingRef.current) return;
    savingRef.current = true;
    setAutoSave({ state: "saving" });
    const r = await updateAcceptanceGuide(acceptanceId, input);
    savingRef.current = false;
    if (r.ok) {
      lastSavedRef.current = key;
      setAutoSave({ state: "saved", at: new Date() });
    } else {
      setAutoSave({ state: "error", message: r.error });
    }
  };

  useEffect(() => {
    if (!canAutoSave) return;
    const key = JSON.stringify(guideInput());
    if (key === lastSavedRef.current) return;
    const timer = window.setTimeout(() => {
      void flushGuide();
    }, 1200);
    return () => window.clearTimeout(timer);
    // 입력값이 바뀔 때마다 타이머를 다시 건다 — flushGuide는 최신 상태를 읽는다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [note, dueNote, docs, mapUrl, canAutoSave]);

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
    fd.append("fileName", file.name); // 한글 파일명 보전
    run(() => action(fd), okMsg);
  };

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

      {/* 보완 편집(안내문·지급안내·제출서류·약도·첨부)은 전문가에게 송부할
          문서를 다듬는 기능이다. 라이트 모드는 송부가 없어 독자가 없으므로
          숨긴다 — 조건 스냅샷 확인과 [확인 완료]만 남긴다 (기획 확정 2026-08-25) */}
      {editable && expertsLite && (
        <p className="text-xs leading-relaxed text-muted-foreground">
          아래 수락서의 조건(역할·일시·비용·장소)이 합의한 내용과 맞는지
          확인한 뒤 <b>확인 완료 처리</b>로 마감하세요. 안내문 편집·송부는
          라이트 모드에서 사용하지 않습니다.
        </p>
      )}
      {editable && !expertsLite && (
        <>
          <div className="space-y-2">
            <p className="text-sm font-medium">상세 설명 (안내 사항)</p>
            <Textarea
              rows={4}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              onBlur={() => void flushGuide()}
              placeholder="준비물, 진행 순서, 주차 안내 등 전문가에게 전달할 안내를 작성하세요."
            />
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <div>
                <label className="text-[11px] text-muted-foreground">입금예정 안내</label>
                <Input
                  value={dueNote}
                  onChange={(e) => setDueNote(e.target.value)}
                  onBlur={() => void flushGuide()}
                  placeholder="프로그램 종료 후 30일 이내"
                />
              </div>
              <div>
                <label className="text-[11px] text-muted-foreground">제출서류</label>
                <Input
                  value={docs}
                  onChange={(e) => setDocs(e.target.value)}
                  onBlur={() => void flushGuide()}
                  placeholder="예: 통장사본, 신분증사본"
                />
              </div>
            </div>
            <div>
              <label className="text-[11px] text-muted-foreground">
                찾아오시는 길 URL (네이버·카카오 지도 등)
              </label>
              <div className="flex items-center gap-2">
                <Link2 className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                <Input
                  value={mapUrl}
                  onChange={(e) => setMapUrl(e.target.value)}
                  onBlur={() => void flushGuide()}
                  placeholder="https://map.naver.com/..."
                  inputMode="url"
                />
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground">
                전문가 화면의 ‘찾아오시는 길’ 버튼을 누르면 이 주소가 팝업으로 열립니다.
              </p>
            </div>
            <p className="text-[11px] text-muted-foreground">
              소득구분·입금계좌는 전문가 프로필에서 자동 반영됩니다. 주민등록번호와 전체
              계좌번호는 수락서에 기재되지 않습니다.
            </p>
            <p
              className={cn(
                "text-[11px]",
                autoSave.state === "error" ? "text-red-700" : "text-muted-foreground"
              )}
              aria-live="polite"
            >
              {autoSave.state === "saving"
                ? "자동 저장 중…"
                : autoSave.state === "saved"
                  ? `자동 저장됨 · ${autoSave.at.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })}`
                  : autoSave.state === "error"
                    ? `자동 저장 실패 — ${autoSave.message}`
                    : "입력하면 자동으로 저장됩니다. 송부할 때도 현재 내용이 그대로 나갑니다."}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={mapRef}
              type="file"
              accept=".jpg,.jpeg,.png,.gif,.pdf"
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
              {hasMap ? "찾아오시는 길 약도 교체" : "찾아오시는 길 약도 등록"}
            </Button>

            {/* 첨부는 xls/xlsx/hwp/hwpx/pdf/jpg/jpeg/gif/png/ppt/pptx 등 —
                lib/experts/documents.ts 허용 목록과 서버 검증이 같다 (기획 지시 2026-09-05) */}
            <input
              ref={attRef}
              type="file"
              accept={DOCUMENT_ACCEPT_ATTR}
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
              title="PDF·이미지(JPG/PNG/GIF)·오피스(doc/docx/xls/xlsx/ppt/pptx)·한글(hwp/hwpx), 10MB 이하"
            >
              <Paperclip className="mr-1 h-4 w-4" /> 첨부파일 추가
            </Button>
            <span className="text-[11px] text-muted-foreground">
              PDF · 이미지 · 엑셀 · 한글 · 파워포인트 (10MB 이하)
            </span>
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
              run(
                () => sendAcceptance(acceptanceId, guideInput()),
                "안내 사항을 저장하고 전문가에게 송부했습니다."
              )
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
        {/* 확정 문구는 현재 모드가 아니라 그 레코드의 확정 경로로 말한다 (검수 B11) —
            라이트 시절 수기 확정 건이 모드를 끈 뒤 "전문가가 서명했다"로 보이면 안 된다 */}
        {status === "confirmed" && (
          <p className="text-sm text-muted-foreground">
            {signedAt
              ? "전문가가 확인·승인(서명)을 완료했습니다 — 참여 확정."
              : "기업 담당자 확인으로 마감되었습니다(전자서명 없음) — 참여 확정."}
          </p>
        )}
      </div>
    </div>
  );
}
