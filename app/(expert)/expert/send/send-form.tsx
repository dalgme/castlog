"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { Copy, Check, Send, Paperclip, FileText, X, Clock } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tag } from "@/components/expert/ui";
import { SEND_EXPIRES_HOURS } from "@/lib/experts/external-send-constants";

import {
  sendExternalDocuments,
  uploadSendFile,
  updateSendMemo,
  revokeSend,
  type ExternalDoc,
  type SendHistoryRow,
} from "./actions";

/** 클릭 한 번으로 이미 올려둔 임시 URL을 전달하는 표준 3종 */
const STANDARD: { type: string; label: string }[] = [
  { type: "resume", label: "이력서" },
  { type: "bank_account_copy", label: "통장 사본" },
  { type: "id_card_copy", label: "신분증 사본" },
];

function StatusTag({ row }: { row: SendHistoryRow }) {
  const expired = new Date(row.expiresAt).getTime() < Date.now();
  if (row.status === "revoked") return <Tag tone="red">회수됨</Tag>;
  if (expired) return <Tag tone="gray">만료</Tag>;
  if (row.openedAt) return <Tag tone="green">열람함</Tag>;
  return <Tag tone="blue">전송됨</Tag>;
}

export function SendForm({
  standardDocs,
  history,
  senderName: initialSenderName,
  senderEmail: initialSenderEmail,
}: {
  standardDocs: ExternalDoc[];
  history: SendHistoryRow[];
  senderName: string;
  senderEmail: string;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [sentLink, setSentLink] = useState<string | null>(null);
  const [emailed, setEmailed] = useState(false);
  const [copied, setCopied] = useState(false);

  // 표준 3종의 최신 문서(업로드하면 갱신). 없으면 undefined.
  const [docsByType, setDocsByType] = useState<Record<string, ExternalDoc>>(() => {
    const map: Record<string, ExternalDoc> = {};
    for (const d of standardDocs) map[d.type] = d;
    return map;
  });
  // 이번 발송에 추가한 일반 첨부들.
  const [attachments, setAttachments] = useState<ExternalDoc[]>([]);
  // 선택된 문서 id 집합.
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [senderName, setSenderName] = useState(initialSenderName);
  const [senderEmail, setSenderEmail] = useState(initialSenderEmail);
  const [eventName, setEventName] = useState("");
  const [orgName, setOrgName] = useState("");
  const [memo, setMemo] = useState("");

  const attachInputRef = useRef<HTMLInputElement>(null);
  const [uploadingType, setUploadingType] = useState<string | null>(null);

  const selectedCount = selected.size;

  const toggleSelect = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const upload = (documentType: string, file: File, onDone?: (doc: ExternalDoc) => void) => {
    setError(null);
    setUploadingType(documentType);
    const fd = new FormData();
    fd.append("documentType", documentType);
    fd.append("file", file);
    startTransition(async () => {
      const result = await uploadSendFile(fd);
      setUploadingType(null);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      onDone?.(result.doc);
    });
  };

  const onStandardFile = (type: string, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    upload(type, file, (doc) => {
      setDocsByType((prev) => ({ ...prev, [type]: doc }));
      setSelected((prev) => new Set(prev).add(doc.id));
    });
  };

  const onAttachFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    upload("attachment", file, (doc) => {
      setAttachments((prev) => [...prev, doc]);
      setSelected((prev) => new Set(prev).add(doc.id));
    });
  };

  const removeAttachment = (id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
    setSelected((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  };

  const onSend = () => {
    setError(null);
    setSentLink(null);
    startTransition(async () => {
      const result = await sendExternalDocuments({
        recipientEmail: email,
        recipientName: name,
        senderName,
        senderEmail,
        documentIds: Array.from(selected),
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
        setEventName("");
        setOrgName("");
        setMemo("");
        setSelected(new Set());
        setAttachments([]);
        // 보내는 사람은 자동 채움값으로 되돌린다(연속 발송 편의).
        setSenderName(initialSenderName);
        setSenderEmail(initialSenderEmail);
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
      <div className="space-y-4 rounded-xl border bg-background p-4 shadow-sm">
        <p className="text-sm font-bold text-brand-navy">새 외부 송신</p>

        {/* 표준 3종 — 이미 올려둔 서류면 클릭 선택, 없으면 클릭 시 업로드 후 선택 */}
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-muted-foreground">보낼 서류 선택</p>
          <div className="flex flex-wrap gap-2">
            {STANDARD.map(({ type, label }) => {
              const doc = docsByType[type];
              const on = doc ? selected.has(doc.id) : false;
              const busy = pending && uploadingType === type;
              if (doc) {
                return (
                  <button
                    key={type}
                    type="button"
                    onClick={() => toggleSelect(doc.id)}
                    className={
                      on
                        ? "inline-flex items-center gap-1.5 rounded-md border border-brand bg-brand/10 px-3 py-1.5 text-sm font-semibold text-brand"
                        : "inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm text-muted-foreground hover:text-brand-navy"
                    }
                  >
                    {on ? <Check className="h-3.5 w-3.5" /> : <FileText className="h-3.5 w-3.5" />}
                    {label}
                  </button>
                );
              }
              return <StandardUploadButton key={type} type={type} label={label} busy={busy} onFile={onStandardFile} />;
            })}
          </div>
          <p className="text-[11px] text-muted-foreground">
            서류함에 올려둔 파일이면 클릭만으로 선택됩니다. 없으면 클릭해서 바로 올릴 수 있어요.
          </p>
        </div>

        {/* 일반 첨부 */}
        <div className="space-y-1.5">
          <input
            ref={attachInputRef}
            type="file"
            accept="image/*,.pdf"
            className="hidden"
            onChange={onAttachFile}
          />
          <button
            type="button"
            onClick={() => attachInputRef.current?.click()}
            disabled={pending && uploadingType === "attachment"}
            className="inline-flex items-center gap-1.5 rounded-md border border-dashed px-3 py-1.5 text-sm text-muted-foreground hover:border-brand hover:text-brand"
          >
            <Paperclip className="h-3.5 w-3.5" aria-hidden />
            {pending && uploadingType === "attachment" ? "업로드 중..." : "파일 첨부"}
          </button>
          {attachments.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {attachments.map((a) => (
                <span
                  key={a.id}
                  className="inline-flex max-w-[220px] items-center gap-1.5 rounded-md border border-brand bg-brand/10 px-2.5 py-1 text-xs font-medium text-brand"
                >
                  <FileText className="h-3 w-3 shrink-0" />
                  <span className="truncate">{a.fileName}</span>
                  <button type="button" onClick={() => removeAttachment(a.id)} aria-label="첨부 제거">
                    <X className="h-3 w-3 shrink-0 hover:text-brand-navy" />
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>

        {/* 보내는 사람 — 자동 채움, 수정 가능 */}
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-muted-foreground">
            보내는 사람 <span className="text-[11px] font-normal">(자동 입력 · 수정 가능)</span>
          </p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Input
              value={senderName}
              onChange={(e) => setSenderName(e.target.value)}
              placeholder="보내는 사람 이름"
            />
            <Input
              type="email"
              value={senderEmail}
              onChange={(e) => setSenderEmail(e.target.value)}
              placeholder="보내는 사람 이메일 (회신 받을 주소)"
            />
          </div>
          <p className="text-[11px] text-muted-foreground">
            메일은 캐스트로그 인증 도메인에서 발송되며, 받는 분이 회신하면 위 이메일로
            전달됩니다.
          </p>
        </div>

        {/* 받는 사람 */}
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-muted-foreground">받는 사람</p>
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
        </div>
        <Textarea
          rows={2}
          value={memo}
          onChange={(e) => setMemo(e.target.value)}
          placeholder="메모 (선택)"
        />

        {/* 72시간 임시 URL 안내 — 눈에 띄게 */}
        <div className="flex items-start gap-2 rounded-lg border border-brand-amber/40 bg-brand-amber/10 p-3">
          <Clock className="mt-0.5 h-4 w-4 shrink-0 text-brand-amber" aria-hidden />
          <p className="text-xs leading-relaxed text-brand-navy">
            받는 분에게는 <b>파일 첨부가 아니라 다운로드 링크</b>가 전달됩니다. 이 링크는
            발송 시각부터 <b>{SEND_EXPIRES_HOURS}시간 동안만 유효한 임시 URL</b>로,
            시간이 지나면 자동 만료됩니다. 필요하면 발송 내역에서 언제든 회수할 수 있습니다.
          </p>
        </div>

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

        <Button onClick={onSend} disabled={pending || selectedCount === 0}>
          <Send className="mr-1.5 h-4 w-4" aria-hidden />
          {pending
            ? "발송 중..."
            : selectedCount > 0
              ? `${selectedCount}개 서류 보내기`
              : "서류 보내기"}
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

function StandardUploadButton({
  type,
  label,
  busy,
  onFile,
}: {
  type: string;
  label: string;
  busy: boolean;
  onFile: (type: string, e: React.ChangeEvent<HTMLInputElement>) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept="image/*,.pdf"
        className="hidden"
        onChange={(e) => onFile(type, e)}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={busy}
        className="inline-flex items-center gap-1.5 rounded-md border border-dashed px-3 py-1.5 text-sm text-muted-foreground hover:border-brand hover:text-brand"
      >
        <Paperclip className="h-3.5 w-3.5" aria-hidden />
        {busy ? "업로드 중..." : `${label} 올리기`}
      </button>
    </>
  );
}

function HistoryItem({ row }: { row: SendHistoryRow }) {
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);
  const [eventName, setEventName] = useState(row.eventName ?? "");
  const [orgName, setOrgName] = useState(row.orgName ?? "");
  const [memo, setMemo] = useState(row.memo ?? "");

  const docCount = useMemo(() => row.documentTypes.length, [row.documentTypes]);

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
        <span>{docCount}개 서류</span>
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
