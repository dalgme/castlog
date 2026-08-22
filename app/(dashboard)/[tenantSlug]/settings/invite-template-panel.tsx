"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

import { saveInviteSmsTemplate } from "./actions";

/**
 * 등록 요청 문자 문구 (기획 확정 2026-08-22).
 * 평소에는 잠금 상태로 문구를 보여 주고, '수정' 버튼으로 열어 고친다.
 * {URL}=등록 링크(필수), {회사명}, {이름} 토큰이 발송 시 치환된다.
 */
export function InviteTemplatePanel({ body }: { body: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(body);
  const [error, setError] = useState<string | null>(null);

  function save() {
    setError(null);
    startTransition(async () => {
      const r = await saveInviteSmsTemplate(draft);
      if (!r.ok) setError(r.error);
      else {
        setEditing(false);
        router.refresh();
      }
    });
  }

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">
        전문가 목록의 ‘문자 발송’ 버튼이 이 문구로 발송합니다.{" "}
        <code className="rounded bg-secondary px-1">{"{URL}"}</code> 자리에 등록
        링크,{" "}
        <code className="rounded bg-secondary px-1">{"{회사명}"}</code>·
        <code className="rounded bg-secondary px-1">{"{이름}"}</code>은 발송
        시점에 자동으로 채워집니다.
      </p>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {editing ? (
        <>
          <Textarea
            rows={7}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            className="text-sm"
          />
          <div className="flex gap-2">
            <Button size="sm" onClick={save} disabled={pending}>
              {pending ? "저장 중..." : "저장"}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setDraft(body);
                setEditing(false);
                setError(null);
              }}
            >
              취소
            </Button>
          </div>
        </>
      ) : (
        <>
          <pre className="whitespace-pre-wrap rounded-md border bg-secondary/40 p-3 text-sm">
            {body}
          </pre>
          <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
            수정
          </Button>
        </>
      )}
    </div>
  );
}
