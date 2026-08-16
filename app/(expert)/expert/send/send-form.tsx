"use client";

import { useState, useTransition } from "react";
import { Copy, Check, Send } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tag } from "@/components/expert/ui";

import {
  sendExternalDocuments,
  updateSendMemo,
  revokeSend,
  type ExternalDoc,
  type SendHistoryRow,
} from "./actions";

function StatusTag({ row }: { row: SendHistoryRow }) {
  const expired = new Date(row.expiresAt).getTime() < Date.now();
  if (row.status === "revoked") return <Tag tone="red">회수됨</Tag>;
  if (expired) return <Tag tone="gray">만료</Tag>;
  if (row.openedAt) return <Tag tone="green">열람함</Tag>;
  return <Tag tone="blue">전송됨</Tag>;
}

export function SendForm({
  documents,
  history,
}: {
  documents: ExternalDoc[];
  history: SendHistoryRow[];
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [sentLink, setSentLink] = useState<string | null>(null);
  const [emailed, setEmailed] = useState(false);
  const [copied, setCopied] = useState(false);

  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [types, setTypes] = useState<string[]>([]);
  const [eventName, setEventName] = useState("");
  const [orgName, setOrgName] = useState("");
  const [memo, setMemo] = useState("");

  const toggle = (t: string) =>
    setTypes((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]));

  const onSend = () => {
    setError(null);
    setSentLink(null);
    startTransition(async () => {
      const result = await sendExternalDocuments({
        recipientEmail: email,
        recipientName: name,
        documentTypes: types,
        eventName,
        orgName,
        memo,
      });
      if (!result.ok) setError(result.error);
      else {
        setSentLink(result.link);
        setEmailed(result.emailed);
        setEmail("");
        setName("");
        setTypes([]);
        setEventName("");
        setOrgName("");
        setMemo("");
      }
    });
  };

  const copy = (link: string) => {
    navigator.clipboard?.writeText(link).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <div className="space-y-5">
      {/* 발송 폼 */}
      <div className="space-y-3 rounded-xl border bg-background p-4 shadow-sm">
        <p className="text-sm font-bold text-brand-navy">새 외부 송신</p>

        {documents.length === 0 ? (
          <p className="rounded-lg bg-secondary/60 p-3 text-sm text-muted-foreground">
            보낼 수 있는 서류가 없습니다. 먼저 서류함에서 이력서·신분증사본·통장사본을
            등록해 주세요.
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {documents.map((d) => {
              const on = types.includes(d.type);
              return (
                <button
                  key={d.type}
                  type="button"
                  onClick={() => toggle(d.type)}
                  className={
                    on
                      ? "rounded-md border border-brand bg-brand/10 px-3 py-1.5 text-sm font-semibold text-brand"
                      : "rounded-md border px-3 py-1.5 text-sm text-muted-foreground hover:text-brand-navy"
                  }
                >
                  {d.label}
                </button>
              );
            })}
          </div>
        )}

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <Input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="받는 사람 이메일"
          />
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="받는 사람 이름 (선택)"
          />
          <Input
            value={eventName}
            onChange={(e) => setEventName(e.target.value)}
            placeholder="행사명 (선택)"
          />
          <Input
            value={orgName}
            onChange={(e) => setOrgName(e.target.value)}
            placeholder="의뢰기관/기업 (선택)"
          />
        </div>
        <Textarea
          rows={2}
          value={memo}
          onChange={(e) => setMemo(e.target.value)}
          placeholder="메모 (선택)"
        />

        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        {sentLink && (
          <Alert>
            <AlertDescription>
              <p className="mb-2">
                발송 링크가 생성되었습니다.{" "}
                {emailed ? "이메일로도 전송했습니다." : "이메일 발송은 설정되지 않아 아래 링크를 직접 전달해 주세요."}
              </p>
              <div className="flex items-center gap-2">
                <code className="flex-1 truncate rounded bg-secondary/70 px-2 py-1 text-xs">
                  {sentLink}
                </code>
                <Button size="sm" variant="outline" onClick={() => copy(sentLink)}>
                  {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                </Button>
              </div>
            </AlertDescription>
          </Alert>
        )}

        <Button onClick={onSend} disabled={pending || documents.length === 0}>
          <Send className="mr-1.5 h-4 w-4" aria-hidden />
          {pending ? "발송 중..." : "서류 보내기"}
        </Button>
      </div>

      {/* 발송 내역 */}
      <div>
        <p className="mb-2 text-sm font-bold text-brand-navy">발송 내역</p>
        {history.length === 0 ? (
          <p className="rounded-lg border bg-background p-3 text-sm text-muted-foreground">
            아직 발송한 내역이 없습니다.
          </p>
        ) : (
          <ul className="space-y-2">
            {history.map((row) => (
              <HistoryItem key={row.id} row={row} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function HistoryItem({ row }: { row: SendHistoryRow }) {
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);
  const [eventName, setEventName] = useState(row.eventName ?? "");
  const [orgName, setOrgName] = useState(row.orgName ?? "");
  const [memo, setMemo] = useState(row.memo ?? "");

  const save = () =>
    startTransition(async () => {
      await updateSendMemo(row.id, { eventName, orgName, memo });
      setEditing(false);
    });
  const onRevoke = () => startTransition(async () => void (await revokeSend(row.id)));

  const revocable = row.status !== "revoked" && new Date(row.expiresAt).getTime() > Date.now();

  return (
    <li className="rounded-xl border bg-background p-3 shadow-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold text-brand-navy">
          {row.recipientName ? `${row.recipientName} · ` : ""}
          {row.recipientEmail}
        </span>
        <StatusTag row={row} />
        {revocable && (
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto h-7 px-2 text-xs"
            onClick={onRevoke}
            disabled={pending}
          >
            회수
          </Button>
        )}
      </div>
      <div className="mt-1 flex flex-wrap gap-x-3 text-xs text-muted-foreground">
        <span>{row.documentTypes.map((t) => t).length}개 서류</span>
        <span>{new Date(row.sentAt).toLocaleString("ko-KR")} 발송</span>
        {row.openedAt && <span>{new Date(row.openedAt).toLocaleString("ko-KR")} 열람</span>}
      </div>

      {editing ? (
        <div className="mt-2 space-y-2">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Input value={eventName} onChange={(e) => setEventName(e.target.value)} placeholder="행사명" />
            <Input value={orgName} onChange={(e) => setOrgName(e.target.value)} placeholder="의뢰기관/기업" />
          </div>
          <Textarea rows={2} value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="메모" />
          <div className="flex gap-2">
            <Button size="sm" onClick={save} disabled={pending}>저장</Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>취소</Button>
          </div>
        </div>
      ) : (
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 text-xs">
          {(row.eventName || row.orgName || row.memo) && (
            <span className="text-brand-navy">
              {[row.eventName, row.orgName, row.memo].filter(Boolean).join(" · ")}
            </span>
          )}
          <button
            type="button"
            className="text-brand underline"
            onClick={() => setEditing(true)}
          >
            메모 편집
          </button>
        </div>
      )}
    </li>
  );
}
