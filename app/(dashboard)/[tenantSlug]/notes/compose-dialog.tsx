"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { PenSquare, Search } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { initialOf, type NoteProject, type NoteUser } from "@/lib/notes/types";
import { PROJECT_STATUS_LABELS } from "@/lib/operations/steps";

import { sendNote } from "./actions";

/**
 * 새 쪽지 (기획 지시 2026-11-07) — 1) 구성원(여럿) 고르기 2) 주제: 개설된 프로젝트 하나 또는
 * 기타사항 체크 3) 내용. 보내면 첫 받는 사람과의 대화로 이동한다.
 */
export function ComposeNoteDialog({
  tenantSlug,
  users,
  projects,
  defaultRecipientId = null,
  defaultProjectId = null,
  triggerLabel = "쪽지 보내기",
  triggerVariant = "default",
}: {
  tenantSlug: string;
  /** 나를 뺀 활성 구성원 */
  users: NoteUser[];
  /** 주제로 고를 수 있는 개설 프로젝트(계획·진행중) */
  projects: NoteProject[];
  defaultRecipientId?: string | null;
  defaultProjectId?: string | null;
  triggerLabel?: string;
  triggerVariant?: "default" | "outline" | "ghost";
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [recipients, setRecipients] = useState<Set<string>>(new Set(defaultRecipientId ? [defaultRecipientId] : []));
  const [topicKind, setTopicKind] = useState<"project" | "other">(defaultProjectId ? "project" : projects.length > 0 ? "project" : "other");
  const [projectId, setProjectId] = useState<string>(defaultProjectId ?? "");
  const [topicLabel, setTopicLabel] = useState("");
  const [body, setBody] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return users;
    return users.filter(
      (u) =>
        u.name.toLowerCase().includes(q) ||
        (u.department ?? "").toLowerCase().includes(q) ||
        (u.positionName ?? "").toLowerCase().includes(q)
    );
  }, [users, query]);

  function reset() {
    setError(null);
    setQuery("");
    setRecipients(new Set(defaultRecipientId ? [defaultRecipientId] : []));
    setTopicKind(defaultProjectId ? "project" : projects.length > 0 ? "project" : "other");
    setProjectId(defaultProjectId ?? "");
    setTopicLabel("");
    setBody("");
  }

  function toggle(id: string) {
    setRecipients((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function submit() {
    setError(null);
    if (recipients.size === 0) {
      setError("받는 사람을 한 명 이상 고르세요.");
      return;
    }
    if (topicKind === "project" && !projectId) {
      setError("프로젝트를 고르거나 '기타사항'을 선택하세요.");
      return;
    }
    if (!body.trim()) {
      setError("내용을 입력하세요.");
      return;
    }
    const ids = Array.from(recipients);
    startTransition(async () => {
      const r = await sendNote({
        recipientIds: ids,
        topicKind,
        projectId: topicKind === "project" ? projectId : "",
        topicLabel: topicKind === "other" ? topicLabel : undefined,
        body,
      });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      toast({ description: `${r.sent}명에게 쪽지를 보냈습니다.` });
      setOpen(false);
      reset();
      router.push(`/${tenantSlug}/notes?view=person&with=${ids[0]}`);
      router.refresh();
    });
  }

  const selectedNames = users.filter((u) => recipients.has(u.id)).map((u) => u.name);

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (pending) return;
        setOpen(v);
        if (v) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button type="button" size="sm" variant={triggerVariant}>
          <PenSquare className="mr-1.5 h-4 w-4" aria-hidden /> {triggerLabel}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>새 쪽지</DialogTitle>
          <DialogDescription>받는 사람을 고르고, 어떤 프로젝트에 관한 쪽지인지(또는 기타사항) 체크한 뒤 보냅니다.</DialogDescription>
        </DialogHeader>
        {error && (
          <Alert variant="destructive">
            <AlertDescription className="text-xs">{error}</AlertDescription>
          </Alert>
        )}

        {/* 1) 받는 사람 */}
        <section className="space-y-1.5">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold">받는 사람 {recipients.size > 0 && <span className="text-brand">({recipients.size}명)</span>}</p>
            {recipients.size > 0 && (
              <button type="button" className="text-xs text-muted-foreground underline" onClick={() => setRecipients(new Set())}>
                모두 해제
              </button>
            )}
          </div>
          {selectedNames.length > 0 && (
            <p className="truncate text-xs text-muted-foreground">{selectedNames.join(", ")}</p>
          )}
          <div className="relative">
            <Search className="pointer-events-none absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" aria-hidden />
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="이름·부서·직급으로 찾기" className="pl-8" />
          </div>
          <ul className="max-h-44 divide-y overflow-y-auto rounded-md border bg-background">
            {filtered.length === 0 && <li className="px-3 py-3 text-xs text-muted-foreground">맞는 구성원이 없습니다.</li>}
            {filtered.map((u) => {
              const checked = recipients.has(u.id);
              return (
                <li key={u.id}>
                  <label className={cn("flex cursor-pointer items-center gap-2.5 px-3 py-2 text-sm hover:bg-secondary/60", checked && "bg-brand/5")}>
                    <Checkbox checked={checked} onCheckedChange={() => toggle(u.id)} aria-label={`${u.name} 선택`} />
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-navy text-xs font-bold text-white">
                      {initialOf(u.name)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="font-medium">{u.name}</span>
                      <span className="ml-1.5 text-xs text-muted-foreground">
                        {[u.positionName, u.department].filter(Boolean).join(" · ")}
                      </span>
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        </section>

        {/* 2) 주제 */}
        <section className="space-y-1.5">
          <p className="text-sm font-semibold">무엇에 관한 쪽지인가요?</p>
          <div className="grid gap-1.5">
            <label className={cn("flex items-start gap-2.5 rounded-md border px-3 py-2 text-sm", topicKind === "project" ? "border-brand bg-brand/5" : "hover:bg-secondary/60")}>
              <input
                type="radio"
                name="topic"
                className="mt-1"
                checked={topicKind === "project"}
                onChange={() => setTopicKind("project")}
                disabled={projects.length === 0}
              />
              <span className="min-w-0 flex-1 space-y-1.5">
                <span className="font-medium">개설되어 있는 프로젝트</span>
                {projects.length === 0 ? (
                  <span className="block text-xs text-muted-foreground">진행 중인 프로젝트가 없습니다.</span>
                ) : (
                  <select
                    value={projectId}
                    onChange={(e) => {
                      setProjectId(e.target.value);
                      setTopicKind("project");
                    }}
                    className="h-9 w-full rounded-md border bg-background px-2 text-sm"
                    aria-label="프로젝트 선택"
                  >
                    <option value="">프로젝트 선택</option>
                    {projects.map((p) => (
                      <option key={p.id} value={p.id}>
                        [{p.businessYear}] {p.name} · {PROJECT_STATUS_LABELS[p.status] ?? p.status}
                      </option>
                    ))}
                  </select>
                )}
              </span>
            </label>
            <label className={cn("flex items-start gap-2.5 rounded-md border px-3 py-2 text-sm", topicKind === "other" ? "border-brand bg-brand/5" : "hover:bg-secondary/60")}>
              <input type="radio" name="topic" className="mt-1" checked={topicKind === "other"} onChange={() => setTopicKind("other")} />
              <span className="min-w-0 flex-1 space-y-1.5">
                <span className="font-medium">기타사항</span>
                {topicKind === "other" && (
                  <Input
                    value={topicLabel}
                    onChange={(e) => setTopicLabel(e.target.value)}
                    maxLength={60}
                    placeholder="짧은 제목 (선택 — 예: 회식 일정, 비품 구매)"
                    className="h-8 text-sm"
                  />
                )}
              </span>
            </label>
          </div>
        </section>

        {/* 3) 내용 */}
        <section className="space-y-1.5">
          <p className="text-sm font-semibold">내용</p>
          <Textarea rows={5} value={body} onChange={(e) => setBody(e.target.value)} maxLength={4000} placeholder="쪽지 내용을 입력하세요" />
          <p className="text-right text-[11px] text-muted-foreground">{body.length.toLocaleString()} / 4,000</p>
        </section>

        <Button type="button" className="w-full" onClick={submit} disabled={pending}>
          {pending ? "보내는 중…" : recipients.size > 1 ? `${recipients.size}명에게 보내기` : "보내기"}
        </Button>
      </DialogContent>
    </Dialog>
  );
}
