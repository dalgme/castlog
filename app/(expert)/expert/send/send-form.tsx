"use client";

import { useRef, useState, useTransition } from "react";
import {
  Copy,
  Check,
  Send,
  Paperclip,
  FileText,
  X,
  Clock,
  Save,
} from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tag } from "@/components/expert/ui";
import {
  SEND_STANDARD_TYPES,
  DEFAULT_BODY_PRESETS,
} from "@/lib/experts/send-body-presets";

import {
  sendExternalDocuments,
  uploadSendFile,
  saveBodyPreset,
  deleteBodyPreset,
  updateSendMemo,
  revokeSend,
  type ExternalDoc,
  type SendHistoryRow,
  type BodyPresetRow,
} from "./actions";

function StatusTag({ row }: { row: SendHistoryRow }) {
  const expired = new Date(row.expiresAt).getTime() < Date.now();
  if (row.status === "revoked") return <Tag tone="red">회수됨</Tag>;
  if (expired) return <Tag tone="gray">만료</Tag>;
  if (row.openedAt) return <Tag tone="green">열람함</Tag>;
  return <Tag tone="blue">전송됨</Tag>;
}

function formatDeadline(hours: number): string {
  const d = new Date(Date.now() + hours * 3600 * 1000);
  return d.toLocaleString("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function SendForm({
  standardDocs,
  history,
  senderName: initialSenderName,
  senderEmail: initialSenderEmail,
  userPresets: initialUserPresets,
  expiresHours,
}: {
  standardDocs: ExternalDoc[];
  history: SendHistoryRow[];
  senderName: string;
  senderEmail: string;
  userPresets: BodyPresetRow[];
  expiresHours: number;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [sentInfo, setSentInfo] = useState<
    { link: string | null; emailed: boolean; attachmentsSent: number } | null
  >(null);
  const [copied, setCopied] = useState(false);

  const [docsByType, setDocsByType] = useState<Record<string, ExternalDoc>>(() => {
    const map: Record<string, ExternalDoc> = {};
    for (const d of standardDocs) map[d.type] = d;
    return map;
  });
  const [attachments, setAttachments] = useState<ExternalDoc[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const [senderName, setSenderName] = useState(initialSenderName);
  const [senderEmail, setSenderEmail] = useState(initialSenderEmail);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [eventName, setEventName] = useState("");
  const [orgName, setOrgName] = useState("");
  const [body, setBody] = useState("");
  const [userPresets, setUserPresets] = useState<BodyPresetRow[]>(initialUserPresets);

  const attachInputRef = useRef<HTMLInputElement>(null);
  const [uploadingType, setUploadingType] = useState<string | null>(null);

  const selectedDocCount = selected.size;
  const hasSelection = selectedDocCount > 0 || attachments.length > 0;

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
    });
  };

  const removeAttachment = (id: string) =>
    setAttachments((prev) => prev.filter((a) => a.id !== id));

  const applyPreset = (presetBody: string) => setBody(presetBody);

  const saveCurrentAsPreset = () => {
    setError(null);
    if (!body.trim()) {
      setError("저장할 본문 내용을 입력하세요.");
      return;
    }
    const label = `사용자 옵션 ${userPresets.length + 1}`;
    startTransition(async () => {
      const result = await saveBodyPreset(label, body);
      if (!result.ok) setError(result.error);
      else setUserPresets((prev) => [result.preset, ...prev]);
    });
  };

  const removePreset = (id: string) => {
    setUserPresets((prev) => prev.filter((p) => p.id !== id));
    startTransition(async () => {
      await deleteBodyPreset(id);
    });
  };

  const onSend = () => {
    setError(null);
    setSentInfo(null);
    startTransition(async () => {
      const result = await sendExternalDocuments({
        recipientEmail: email,
        recipientName: name,
        senderName,
        senderEmail,
        documentIds: Array.from(selected),
        attachmentIds: attachments.map((a) => a.id),
        body,
        eventName,
        orgName,
      });
      if (!result.ok) setError(result.error);
      else {
        setSentInfo({
          link: result.link,
          emailed: result.emailed,
          attachmentsSent: result.attachmentsSent,
        });
        setEmail("");
        setName("");
        setEventName("");
        setOrgName("");
        setBody("");
        setSelected(new Set());
        setAttachments([]);
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
      <div className="space-y-4 rounded-xl border bg-background p-4 shadow-sm">
        <p className="text-sm font-bold text-brand-navy">새 외부 송신</p>

        {/* 표준 5종 — 모두 동일한 '임시 URL 송신' 버튼(미등록이면 클릭 시 업로드가 먼저 열림) */}
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-muted-foreground">
            보낼 서류 선택 <span className="text-[11px] font-normal">(임시 다운로드 링크로 전달)</span>
          </p>
          <div className="flex flex-wrap gap-2">
            {SEND_STANDARD_TYPES.map(({ type, label }) => (
              <DocButton
                key={type}
                type={type}
                label={label}
                doc={docsByType[type]}
                selected={docsByType[type] ? selected.has(docsByType[type]!.id) : false}
                busy={pending && uploadingType === type}
                onToggle={toggleSelect}
                onFile={onStandardFile}
              />
            ))}
          </div>
          <p className="text-[11px] text-muted-foreground">
            아직 올리지 않은 서류는 버튼을 누르면 먼저 파일을 올린 뒤 자동으로 선택됩니다.
          </p>
        </div>

        {/* 일반 첨부 — 실제 메일 첨부(만료 없음) */}
        <div className="space-y-1.5">
          <input
            ref={attachInputRef}
            type="file"
            accept="image/*,.pdf"
            className="hidden"
            onChange={onAttachFile}
          />
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => attachInputRef.current?.click()}
              disabled={pending && uploadingType === "attachment"}
              className="inline-flex items-center gap-1.5 rounded-md border border-dashed px-3 py-1.5 text-sm text-muted-foreground hover:border-brand hover:text-brand"
            >
              <Paperclip className="h-3.5 w-3.5" aria-hidden />
              {pending && uploadingType === "attachment" ? "업로드 중..." : "파일 첨부"}
            </button>
            <span className="text-[11px] text-muted-foreground">
              첨부파일은 만료 없이 메일에 그대로 첨부됩니다.
            </span>
          </div>
          {attachments.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {attachments.map((a) => (
                <span
                  key={a.id}
                  className="inline-flex max-w-[220px] items-center gap-1.5 rounded-md border border-brand bg-brand/10 px-2.5 py-1 text-xs font-medium text-brand"
                >
                  <Paperclip className="h-3 w-3 shrink-0" />
                  <span className="truncate">{a.fileName}</span>
                  <button type="button" onClick={() => removeAttachment(a.id)} aria-label="첨부 제거">
                    <X className="h-3 w-3 shrink-0 hover:text-brand-navy" />
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>

        {/* 예상 접속마감일시 — 링크 서류 선택 시 */}
        {selectedDocCount > 0 && (
          <div className="flex items-center gap-2 rounded-lg border border-brand-amber/40 bg-brand-amber/10 px-3 py-2">
            <Clock className="h-4 w-4 shrink-0 text-brand-amber" aria-hidden />
            <p className="text-xs text-brand-navy">
              예상 접속 마감: <b>{formatDeadline(expiresHours)}</b>{" "}
              <span className="text-muted-foreground">
                (링크 서류 {selectedDocCount}건 · 발송 시각 기준 {expiresHours}시간)
              </span>
            </p>
          </div>
        )}

        {/* 보내는 사람 — 박스 */}
        <fieldset className="space-y-2 rounded-lg border bg-secondary/30 p-3">
          <legend className="px-1 text-xs font-bold text-brand-navy">
            보내는 사람 <span className="font-normal text-muted-foreground">(자동 입력 · 수정 가능)</span>
          </legend>
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
          <p className="px-1 text-[11px] text-muted-foreground">
            메일은 캐스트로그 인증 도메인에서 발송되며, 받는 분이 회신하면 위 이메일로 전달됩니다.
          </p>
        </fieldset>

        {/* 받는 사람 — 박스 */}
        <fieldset className="space-y-2 rounded-lg border bg-secondary/30 p-3">
          <legend className="px-1 text-xs font-bold text-brand-navy">받는 사람</legend>
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
        </fieldset>

        {/* 이메일 본문 */}
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground">이메일 본문</p>
          <div className="flex flex-wrap items-center gap-1.5">
            {DEFAULT_BODY_PRESETS.map((p) => (
              <button
                key={p.key}
                type="button"
                onClick={() => applyPreset(p.body)}
                className="rounded-md border px-2.5 py-1 text-xs font-medium text-muted-foreground hover:border-brand hover:text-brand"
              >
                {p.label}
              </button>
            ))}
            {userPresets.map((p) => (
              <span
                key={p.id}
                className="inline-flex items-center gap-1 rounded-md border border-brand/40 bg-brand/5 px-2.5 py-1 text-xs font-medium text-brand"
              >
                <button type="button" onClick={() => applyPreset(p.body)}>
                  {p.label}
                </button>
                <button type="button" onClick={() => removePreset(p.id)} aria-label="삭제">
                  <X className="h-3 w-3 hover:text-brand-navy" />
                </button>
              </span>
            ))}
            <button
              type="button"
              onClick={saveCurrentAsPreset}
              disabled={pending}
              className="inline-flex items-center gap-1 rounded-md border border-dashed px-2.5 py-1 text-xs text-muted-foreground hover:border-brand hover:text-brand"
            >
              <Save className="h-3 w-3" aria-hidden /> 사용자 옵션으로 저장
            </button>
          </div>
          <Textarea
            rows={7}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="본문 1·2·3을 눌러 추천 문안을 불러오거나 직접 작성하세요. 실제 다운로드 링크는 발송 시 자동으로 덧붙습니다."
          />
          <p className="text-[11px] text-muted-foreground">
            추천 본문에는 링크의 {expiresHours}시간 만료 안내, 직접 첨부파일은 기한 제한이 없다는 안내,
            수신 메일 서비스 정책(예: 다음 대용량 첨부 다운로드 기한)에 따른 제한 안내가 포함되어 있습니다.
          </p>
        </div>

        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        {sentInfo && (
          <Alert>
            <AlertDescription>
              <p className="mb-2">
                발송이 준비되었습니다.{" "}
                {sentInfo.emailed
                  ? `이메일을 전송했습니다${sentInfo.attachmentsSent > 0 ? ` (첨부 ${sentInfo.attachmentsSent}건 포함)` : ""}.`
                  : "이메일 발송은 설정되지 않아 아래 링크를 직접 전달해 주세요."}
              </p>
              {sentInfo.link && (
                <div className="flex items-center gap-2">
                  <code className="flex-1 truncate rounded bg-secondary/70 px-2 py-1 text-xs">
                    {sentInfo.link}
                  </code>
                  <Button size="sm" variant="outline" onClick={() => copy(sentInfo.link!)}>
                    {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                  </Button>
                </div>
              )}
            </AlertDescription>
          </Alert>
        )}

        <Button onClick={onSend} disabled={pending || !hasSelection}>
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

/**
 * 표준 서류 버튼(5종 공통) — 모두 '임시 URL 송신' 버튼으로 동작을 일치시킨다.
 * 이미 올려둔 서류면 클릭 = 선택 토글. 아직 없으면 클릭 = 파일 업로드 후 자동 선택.
 * 겉모습은 5개 모두 동일(라벨은 서류명). 선택 시 브랜드 강조.
 */
function DocButton({
  type,
  label,
  doc,
  selected,
  busy,
  onToggle,
  onFile,
}: {
  type: string;
  label: string;
  doc: ExternalDoc | undefined;
  selected: boolean;
  busy: boolean;
  onToggle: (id: string) => void;
  onFile: (type: string, e: React.ChangeEvent<HTMLInputElement>) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const onClick = () => {
    if (doc) onToggle(doc.id);
    else inputRef.current?.click();
  };
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
        onClick={onClick}
        disabled={busy}
        title={doc ? "클릭해서 임시 링크로 보낼 서류를 선택/해제합니다" : "클릭하면 파일을 올린 뒤 임시 링크로 보냅니다"}
        className={
          selected
            ? "inline-flex items-center gap-1.5 rounded-md border border-brand bg-brand/10 px-3 py-1.5 text-sm font-semibold text-brand"
            : "inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm text-muted-foreground hover:border-brand hover:text-brand-navy"
        }
      >
        {selected ? (
          <Check className="h-3.5 w-3.5" aria-hidden />
        ) : (
          <FileText className="h-3.5 w-3.5" aria-hidden />
        )}
        {busy ? "업로드 중..." : label}
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
        <span>{row.documentTypes.length}개 서류</span>
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
