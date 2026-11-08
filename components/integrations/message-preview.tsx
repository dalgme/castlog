"use client";

import { useMemo, useState } from "react";
import { Mail, MessageSquareText } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { formatKrMobile } from "@/lib/auth/phone";

import type { MessagePreviewSample } from "@/app/(dashboard)/[tenantSlug]/projects/[projectId]/mail-preview-actions";

/**
 * 발송 전 미리보기 (기획 지시 2026-11-08) — 실제로 나갈 메일(HTML 강조)과 문자를 전문가별로 보여 준다.
 * 메일은 iframe(srcDoc, 스크립트 차단)으로 메일 클라이언트와 가장 가깝게 그린다.
 */
export function MessagePreview({
  samples,
  total,
  note,
  channel,
  className,
}: {
  samples: MessagePreviewSample[];
  total: number;
  note: string | null;
  /** 발송 방식 — 선택되지 않은 매체는 '발송 안 함'으로 표시 */
  channel: "sms" | "email" | "both";
  className?: string;
}) {
  const [index, setIndex] = useState(0);
  const sample = samples[Math.min(index, Math.max(0, samples.length - 1))] ?? null;
  const defaultTab = channel === "sms" ? "sms" : "email";
  const emailOff = channel === "sms";
  const smsOff = channel === "email";
  const srcDoc = useMemo(() => sample?.html ?? "", [sample]);

  if (samples.length === 0) {
    return (
      <Alert className={className}>
        <AlertDescription className="text-xs">{note ?? "미리 볼 대상이 없습니다."}</AlertDescription>
      </Alert>
    );
  }

  return (
    <div className={cn("space-y-2 rounded-lg border p-3", className)}>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="font-semibold">수신자 미리보기</span>
        <select
          value={index}
          onChange={(e) => setIndex(Number(e.target.value))}
          className="h-7 rounded-md border bg-background px-2 text-xs"
          aria-label="미리 볼 전문가"
        >
          {samples.map((s, i) => (
            <option key={i} value={i}>
              {s.expertName}
              {s.itemCount > 1 ? ` (${s.itemCount}건 묶음)` : ""}
              {!s.email ? " · 이메일 없음" : ""}
            </option>
          ))}
        </select>
        <span className="text-muted-foreground">총 {total}명</span>
        {note && <span className="text-muted-foreground">· {note}</span>}
      </div>
      {sample && (
        <Tabs defaultValue={defaultTab}>
          <TabsList className="h-8">
            <TabsTrigger value="email" className="h-7 text-xs">
              <Mail className="mr-1 h-3.5 w-3.5" aria-hidden /> 이메일{emailOff ? " (발송 안 함)" : ""}
            </TabsTrigger>
            <TabsTrigger value="sms" className="h-7 text-xs">
              <MessageSquareText className="mr-1 h-3.5 w-3.5" aria-hidden /> 문자{smsOff ? " (발송 안 함)" : ""}
            </TabsTrigger>
          </TabsList>
          <TabsContent value="email" className="space-y-1.5">
            <p className="text-xs">
              <span className="text-muted-foreground">받는 사람</span>{" "}
              {sample.email ? <span className="font-medium">{sample.email}</span> : <span className="font-semibold text-amber-800">이메일 미등록 — 이 전문가에게는 메일이 가지 않습니다</span>}
              <span className="ml-3 text-muted-foreground">제목</span> <span className="font-medium">{sample.subject}</span>
            </p>
            <iframe
              title="이메일 미리보기"
              srcDoc={srcDoc}
              sandbox=""
              className="h-[520px] w-full rounded-md border bg-[#f3f4f6]"
            />
            <details className="text-xs">
              <summary className="cursor-pointer text-muted-foreground">평문 버전 보기 (HTML을 표시하지 못하는 메일 앱용)</summary>
              <pre className="mt-1 max-h-64 overflow-y-auto whitespace-pre-wrap rounded bg-secondary/50 p-2 text-[11px] leading-relaxed">{sample.text}</pre>
            </details>
            <p className="text-[11px] text-muted-foreground">전문가별 수락/거절 링크는 발송 시점에 생성됩니다 — 미리보기의 링크는 자리표시입니다. 회신 마감·금액이 붉게/굵게 강조됩니다.</p>
          </TabsContent>
          <TabsContent value="sms" className="space-y-1.5">
            <p className="text-xs">
              <span className="text-muted-foreground">받는 번호</span>{" "}
              {sample.phone ? <span className="font-medium">{formatKrMobile(sample.phone)}</span> : <span className="font-semibold text-amber-800">휴대폰 없음</span>}
            </p>
            {sample.sms ? (
              <div className="mx-auto max-w-sm rounded-2xl border bg-white p-3 shadow-sm">
                <pre className="whitespace-pre-wrap text-[13px] leading-relaxed">{sample.sms}</pre>
                <p className="mt-2 text-right text-[10px] text-muted-foreground">{sample.sms.length}자 · {sample.sms.length > 90 ? "LMS(장문)" : "SMS"}</p>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">문자 본문 없음</p>
            )}
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
