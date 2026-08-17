"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { MessageSquare, Save } from "lucide-react";

import { NOTICE_VARIABLES } from "@/lib/integrations/notice-constants";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

import {
  cancelSessionNotice,
  createSessionNotice,
  saveNoticeTemplate,
} from "./notice-actions";

export type NoticeTemplateOption = { id: string; name: string; body: string };

export type SessionNoticeRow = {
  id: string;
  status: string;
  scheduledAt: string | null;
  sentAt: string | null;
  recipientCount: number;
  sentCount: number;
  failedCount: number;
  lastError: string | null;
};

export type NoticeTargetPreview = {
  name: string;
  code: string;
  /** 미리보기 — 이 수신자 기준으로 치환된 결과 */
  preview: string;
};

const STATUS_LABELS: Record<string, string> = {
  scheduled: "예약 대기",
  sent: "발송 완료",
  failed: "실패",
  canceled: "중지됨",
};

/**
 * 세션별 안내문자 — 수동 즉시 발송 / 예약 발송 / 예약 중지.
 * 안내문자는 업무연락 고정이므로 발송 유형 선택이 없다 (§5-1).
 */
export function SessionNoticeDialog({
  slotId,
  slotLabel,
  templates,
  defaultBody,
  targets,
  notices,
}: {
  slotId: string;
  slotLabel: string;
  templates: NoticeTemplateOption[];
  defaultBody: string;
  targets: { name: string; code: string }[];
  notices: SessionNoticeRow[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState(defaultBody);
  const [templateId, setTemplateId] = useState("");
  const [scheduledAt, setScheduledAt] = useState("");
  const [templateName, setTemplateName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function pickTemplate(id: string) {
    setTemplateId(id);
    const template = templates.find((t) => t.id === id);
    if (template) setBody(template.body);
  }

  function run(fn: () => Promise<{ ok: boolean; error?: string }>, done: string) {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const res = await fn();
      if (res.ok) {
        setNotice(done);
        router.refresh();
      } else {
        setError(res.error ?? "처리에 실패했습니다.");
      }
    });
  }

  const send = (schedule: boolean) =>
    run(
      () =>
        createSessionNotice({
          slotId,
          body,
          templateId: templateId || undefined,
          scheduledAt: schedule ? scheduledAt : undefined,
        }),
      schedule ? "예약했습니다." : "발송했습니다."
    );

  // 미리보기 — 실제 치환은 서버에서 수행하므로 여기서는 첫 수신자 기준 표시만 한다
  const firstTarget = targets[0];
  const previewBody = firstTarget
    ? body
        .split("{전문가명}")
        .join(firstTarget.name)
        .split("{코드}")
        .join(firstTarget.code)
    : body;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <MessageSquare className="mr-1 h-3.5 w-3.5" />
          안내문자
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>세션 안내문자</DialogTitle>
          <DialogDescription>
            {slotLabel} · 섭외가 확정된 전문가 {targets.length}명에게 보냅니다.
            업무연락으로 발송되며 광고성으로는 보낼 수 없습니다.
          </DialogDescription>
        </DialogHeader>

        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        {notice && (
          <Alert>
            <AlertDescription>{notice}</AlertDescription>
          </Alert>
        )}

        {targets.length === 0 ? (
          <Alert variant="destructive">
            <AlertDescription>
              발송 대상이 없습니다. 이 세션에 섭외가 확정된 전문가가 있어야 하고,
              전문가 프로필에 휴대폰 번호가 등록되어 있어야 합니다.
            </AlertDescription>
          </Alert>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {targets.map((t) => (
              <Badge key={t.code} variant="secondary" className="font-normal">
                {t.name}
                <span className="ml-1 font-mono text-[10px] text-muted-foreground">
                  {t.code}
                </span>
              </Badge>
            ))}
          </div>
        )}

        {templates.length > 0 && (
          <div className="space-y-1.5">
            <label className="text-sm font-medium">템플릿 불러오기</label>
            <Select value={templateId} onValueChange={pickTemplate}>
              <SelectTrigger>
                <SelectValue placeholder="저장된 템플릿 선택" />
              </SelectTrigger>
              <SelectContent>
                {templates.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        <div className="space-y-1.5">
          <label className="text-sm font-medium">안내 문구</label>
          <Textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={8}
            className="font-mono text-xs"
          />
          <div className="flex flex-wrap gap-1">
            {NOTICE_VARIABLES.map((v) => (
              <button
                key={v.key}
                type="button"
                title={v.desc}
                onClick={() => setBody((prev) => `${prev}${v.key}`)}
                className="rounded border px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground hover:bg-secondary"
              >
                {v.key}
              </button>
            ))}
          </div>
        </div>

        {firstTarget && (
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground">
              미리보기 ({firstTarget.name} 기준 · 나머지 변수는 발송 시 채워집니다)
            </p>
            <pre className="whitespace-pre-wrap rounded-md border bg-secondary/30 p-2.5 text-xs">
              {previewBody}
            </pre>
          </div>
        )}

        <div className="grid gap-2 sm:grid-cols-2">
          <div className="space-y-1.5">
            <label className="text-sm font-medium">예약 시각 (선택)</label>
            <Input
              type="datetime-local"
              value={scheduledAt}
              onChange={(e) => setScheduledAt(e.target.value)}
            />
            <p className="text-[11px] text-muted-foreground">
              비워두면 즉시 발송합니다. 예약분은 15분 간격으로 실행됩니다.
            </p>
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">템플릿으로 저장 (선택)</label>
            <div className="flex gap-1.5">
              <Input
                value={templateName}
                onChange={(e) => setTemplateName(e.target.value)}
                placeholder="예: 강의 전일 안내"
              />
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={pending || !templateName.trim()}
                onClick={() =>
                  run(
                    () => saveNoticeTemplate(templateName, body),
                    "템플릿을 저장했습니다."
                  )
                }
              >
                <Save className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 border-t pt-3">
          <Button
            size="sm"
            disabled={pending || targets.length === 0 || !body.trim()}
            onClick={() => send(false)}
          >
            {pending ? "처리 중..." : "지금 발송"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={pending || targets.length === 0 || !scheduledAt}
            onClick={() => send(true)}
          >
            예약 발송
          </Button>
        </div>

        {notices.length > 0 && (
          <div className="space-y-1.5 border-t pt-3">
            <p className="text-xs font-medium text-muted-foreground">발송 내역</p>
            {notices.map((n) => (
              <div
                key={n.id}
                className="flex flex-wrap items-center gap-2 rounded-md border p-2 text-xs"
              >
                <Badge
                  variant={
                    n.status === "sent"
                      ? "default"
                      : n.status === "failed"
                        ? "destructive"
                        : "secondary"
                  }
                >
                  {STATUS_LABELS[n.status] ?? n.status}
                </Badge>
                <span className="text-muted-foreground">
                  {n.sentAt
                    ? new Date(n.sentAt).toLocaleString("ko-KR")
                    : n.scheduledAt
                      ? `예약 ${new Date(n.scheduledAt).toLocaleString("ko-KR")}`
                      : "-"}
                </span>
                <span>
                  대상 {n.recipientCount} · 성공 {n.sentCount}
                  {n.failedCount > 0 && ` · 실패 ${n.failedCount}`}
                </span>
                {n.lastError && (
                  <span className="text-destructive">{n.lastError}</span>
                )}
                {n.status === "scheduled" && (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={pending}
                    onClick={() =>
                      run(() => cancelSessionNotice(n.id), "예약을 중지했습니다.")
                    }
                  >
                    중지
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
