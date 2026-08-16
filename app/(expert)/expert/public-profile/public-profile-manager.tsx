"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  Copy,
  Check,
  ExternalLink,
  Globe,
  Lock,
  Plus,
  Pencil,
  Trash2,
} from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Tag } from "@/components/expert/ui";
import type { VisibleFields, PortfolioItem } from "@/lib/experts/public-profile";

import {
  savePublicProfile,
  upsertPortfolioItem,
  deletePortfolioItem,
  type ProfileContext,
} from "./actions";

const FIELD_LABELS: { key: keyof VisibleFields; label: string }[] = [
  { key: "specialty", label: "전문분야" },
  { key: "region", label: "활동지역" },
  { key: "career_years", label: "경력연차" },
  { key: "bio", label: "소개글" },
  { key: "portfolio", label: "경력·실적" },
];

export function PublicProfileManager({ context }: { context: ProfileContext }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const [handle, setHandle] = useState(context.handle || context.suggestedHandle);
  const [isPublic, setIsPublic] = useState(context.isPublic);
  const [headline, setHeadline] = useState(context.headline);
  const [intro, setIntro] = useState(context.intro);
  const [fields, setFields] = useState<VisibleFields>(context.visibleFields);

  const toggleField = (key: keyof VisibleFields) =>
    setFields((prev) => ({ ...prev, [key]: !prev[key] }));

  const save = () => {
    setError(null);
    startTransition(async () => {
      const result = await savePublicProfile({
        handle,
        isPublic,
        headline,
        intro,
        visibleFields: fields,
      });
      if (!result.ok) setError(result.error);
      else router.refresh();
    });
  };

  const copy = () => {
    if (!context.publicUrl) return;
    navigator.clipboard?.writeText(context.publicUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <div className="space-y-4">
      {/* 공개 여부 + 기본 정보 */}
      <div className="space-y-4 rounded-xl border bg-background p-4 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-bold text-brand-navy">프로필 공개</p>
            <p className="text-xs text-muted-foreground">
              공개하면 아래 링크·QR로 누구나 볼 수 있습니다. 비공개면 링크가 동작하지 않습니다.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setIsPublic((v) => !v)}
            className={
              "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-semibold transition-colors " +
              (isPublic
                ? "bg-brand/10 text-brand"
                : "bg-muted text-muted-foreground")
            }
          >
            {isPublic ? <Globe className="h-4 w-4" /> : <Lock className="h-4 w-4" />}
            {isPublic ? "공개" : "비공개"}
          </button>
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">
            공개 주소 (영문 소문자·숫자·하이픈)
          </label>
          <div className="flex items-center gap-1 rounded-md border px-3 py-2 text-sm">
            <span className="text-muted-foreground">/p/</span>
            <input
              value={handle}
              onChange={(e) => setHandle(e.target.value.toLowerCase())}
              className="min-w-0 flex-1 bg-transparent outline-none"
              placeholder="hong-gildong"
            />
          </div>
        </div>

        <Input
          value={headline}
          onChange={(e) => setHeadline(e.target.value)}
          placeholder="한 줄 소개 (예: 창업 IR·투자유치 멘토)"
          maxLength={60}
        />
        <Textarea
          rows={3}
          value={intro}
          onChange={(e) => setIntro(e.target.value)}
          placeholder="자기소개 (선택)"
        />

        <div className="space-y-1.5">
          <p className="text-xs font-medium text-muted-foreground">공개할 항목</p>
          <div className="flex flex-wrap gap-3">
            {FIELD_LABELS.map(({ key, label }) => (
              <label key={key} className="flex cursor-pointer items-center gap-1.5 text-sm">
                <Checkbox checked={fields[key]} onCheckedChange={() => toggleField(key)} />
                {label}
              </label>
            ))}
          </div>
          <p className="text-[11px] text-muted-foreground">
            주민번호·연락처·이메일·서류 등 민감정보는 어떤 경우에도 공개 프로필에 포함되지 않습니다.
          </p>
        </div>

        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <Button onClick={save} disabled={pending}>
          {pending ? "저장 중..." : "저장"}
        </Button>
      </div>

      {/* 공유 링크 + QR */}
      {context.hasProfile && context.publicUrl && (
        <div className="space-y-3 rounded-xl border bg-background p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <p className="text-sm font-bold text-brand-navy">공유 링크 · QR</p>
            <span className="text-xs text-muted-foreground">조회수 {context.viewCount}</span>
          </div>
          {!context.isPublic && (
            <Alert>
              <AlertDescription className="text-xs">
                현재 <b>비공개</b> 상태입니다. 위에서 &lsquo;공개&rsquo;로 바꾸고 저장하면 링크가 동작합니다.
              </AlertDescription>
            </Alert>
          )}
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
            {context.qrDataUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={context.qrDataUrl}
                alt="공개 프로필 QR"
                className="h-32 w-32 shrink-0 rounded-lg border bg-white p-1.5"
              />
            )}
            <div className="min-w-0 flex-1 space-y-2">
              <div className="flex items-center gap-2">
                <code className="flex-1 truncate rounded bg-secondary/70 px-2 py-1.5 text-xs">
                  {context.publicUrl}
                </code>
                <Button size="sm" variant="outline" onClick={copy}>
                  {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                </Button>
              </div>
              <a
                href={context.publicUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 text-sm font-medium text-brand hover:underline"
              >
                <ExternalLink className="h-4 w-4" /> 새 창에서 열기
              </a>
              <p className="text-[11px] text-muted-foreground">
                QR은 명함·행사 안내물에 넣어 오프라인에서도 프로필로 연결할 수 있습니다.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* 경력·실적 아카이브 */}
      <PortfolioSection items={context.portfolio} />
    </div>
  );
}

type ItemDraft = {
  title: string;
  role: string;
  orgName: string;
  period: string;
  summary: string;
  links: string;
  isPublic: boolean;
};

const emptyDraft: ItemDraft = {
  title: "",
  role: "",
  orgName: "",
  period: "",
  summary: "",
  links: "",
  isPublic: true,
};

function PortfolioSection({ items }: { items: PortfolioItem[] }) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  return (
    <div className="space-y-3 rounded-xl border bg-background p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-bold text-brand-navy">경력 · 실적 아카이브</p>
          <p className="text-xs text-muted-foreground">
            프로젝트·강의·수상 등을 정리하고, 공개 프로필에 노출할 항목을 고릅니다.
          </p>
        </div>
        {!adding && (
          <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
            <Plus className="mr-1 h-4 w-4" /> 추가
          </Button>
        )}
      </div>

      {adding && (
        <ItemForm
          initial={emptyDraft}
          onClose={() => setAdding(false)}
          id={null}
        />
      )}

      {items.length === 0 && !adding ? (
        <p className="rounded-lg bg-secondary/50 p-3 text-sm text-muted-foreground">
          아직 등록한 경력·실적이 없습니다. &lsquo;추가&rsquo;로 첫 항목을 등록해 보세요.
        </p>
      ) : (
        <ul className="space-y-2">
          {items.map((item) =>
            editingId === item.id ? (
              <li key={item.id}>
                <ItemForm
                  id={item.id}
                  initial={{
                    title: item.title,
                    role: item.role ?? "",
                    orgName: item.orgName ?? "",
                    period: item.period ?? "",
                    summary: item.summary ?? "",
                    links: item.links.join("\n"),
                    isPublic: item.isPublic,
                  }}
                  onClose={() => setEditingId(null)}
                />
              </li>
            ) : (
              <li
                key={item.id}
                className="rounded-lg border p-3"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold text-brand-navy">{item.title}</span>
                  {item.isPublic ? (
                    <Tag tone="green">공개</Tag>
                  ) : (
                    <Tag tone="gray">비공개</Tag>
                  )}
                  <div className="ml-auto flex gap-1">
                    <button
                      type="button"
                      onClick={() => setEditingId(item.id)}
                      className="rounded p-1 text-muted-foreground hover:text-brand"
                      aria-label="편집"
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                    <DeleteButton id={item.id} />
                  </div>
                </div>
                <div className="mt-1 flex flex-wrap gap-x-3 text-xs text-muted-foreground">
                  {[item.role, item.orgName, item.period].filter(Boolean).join(" · ")}
                </div>
                {item.summary && (
                  <p className="mt-1 text-sm text-brand-navy/90">{item.summary}</p>
                )}
                {item.links.length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
                    {item.links.map((l, i) => (
                      <a
                        key={i}
                        href={l}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-xs text-brand hover:underline"
                      >
                        <ExternalLink className="h-3 w-3" /> 링크 {i + 1}
                      </a>
                    ))}
                  </div>
                )}
              </li>
            )
          )}
        </ul>
      )}
    </div>
  );
}

function ItemForm({
  id,
  initial,
  onClose,
}: {
  id: string | null;
  initial: ItemDraft;
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [d, setD] = useState<ItemDraft>(initial);

  const set = (k: keyof ItemDraft, v: string | boolean) =>
    setD((prev) => ({ ...prev, [k]: v }));

  const save = () => {
    setError(null);
    const links = d.links
      .split(/\n|,/)
      .map((s) => s.trim())
      .filter(Boolean);
    startTransition(async () => {
      const result = await upsertPortfolioItem(id, {
        title: d.title,
        role: d.role,
        orgName: d.orgName,
        period: d.period,
        summary: d.summary,
        links,
        isPublic: d.isPublic,
      });
      if (!result.ok) setError(result.error);
      else {
        onClose();
        router.refresh();
      }
    });
  };

  return (
    <div className="space-y-2 rounded-lg border border-brand/30 bg-brand/[0.03] p-3">
      <Input value={d.title} onChange={(e) => set("title", e.target.value)} placeholder="제목 (예: 청년창업사관학교 IR 멘토링)" />
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <Input value={d.role} onChange={(e) => set("role", e.target.value)} placeholder="역할 (예: 멘토)" />
        <Input value={d.orgName} onChange={(e) => set("orgName", e.target.value)} placeholder="기관/기업" />
        <Input value={d.period} onChange={(e) => set("period", e.target.value)} placeholder="기간 (예: 2023.03–09)" />
      </div>
      <Textarea rows={2} value={d.summary} onChange={(e) => set("summary", e.target.value)} placeholder="요약 (선택)" />
      <Textarea
        rows={2}
        value={d.links}
        onChange={(e) => set("links", e.target.value)}
        placeholder="산출물 링크 (선택 · 한 줄에 하나, https://...)"
      />
      <label className="flex cursor-pointer items-center gap-1.5 text-sm">
        <Checkbox checked={d.isPublic} onCheckedChange={(v) => set("isPublic", Boolean(v))} />
        공개 프로필에 노출
      </label>
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <div className="flex gap-2">
        <Button size="sm" onClick={save} disabled={pending}>
          {pending ? "저장 중..." : "저장"}
        </Button>
        <Button size="sm" variant="ghost" onClick={onClose}>
          취소
        </Button>
      </div>
    </div>
  );
}

function DeleteButton({ id }: { id: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);

  const onDelete = () =>
    startTransition(async () => {
      await deletePortfolioItem(id);
      router.refresh();
    });

  if (confirming) {
    return (
      <span className="flex items-center gap-1">
        <button
          type="button"
          onClick={onDelete}
          disabled={pending}
          className="rounded px-1.5 py-0.5 text-xs font-semibold text-red-600 hover:bg-red-50"
        >
          삭제
        </button>
        <button
          type="button"
          onClick={() => setConfirming(false)}
          className="rounded px-1.5 py-0.5 text-xs text-muted-foreground"
        >
          취소
        </button>
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={() => setConfirming(true)}
      className="rounded p-1 text-muted-foreground hover:text-red-600"
      aria-label="삭제"
    >
      <Trash2 className="h-4 w-4" />
    </button>
  );
}
