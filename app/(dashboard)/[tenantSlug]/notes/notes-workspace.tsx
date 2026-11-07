"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowDownLeft, ArrowLeft, ArrowUpRight, Check, CheckCheck, FolderKanban, MessageSquare, SendHorizontal, Tag, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  NOTE_VIEWS,
  NOTE_VIEW_LABELS,
  OTHER_TOPIC_KEY,
  counterpartId,
  formatDateHeading,
  formatKstTime,
  formatListTime,
  initialOf,
  kstDateKey,
  snippet,
  topicKey,
  type NoteProject,
  type NoteRow,
  type NoteUser,
  type NoteView,
} from "@/lib/notes/types";

import { hideNote, markNotesReadForTopic, markNotesReadFrom, sendNote } from "./actions";
import { ComposeNoteDialog } from "./compose-dialog";

/**
 * 쪽지함 (기획 지시 2026-11-07) — 네이버웍스 채팅과 비슷한 두 칸.
 * 왼쪽: 날짜·시간순 / 사람별 / 프로젝트별 목록. 오른쪽: 말풍선 대화 + 바로 답장.
 * 선택은 URL(view·with·topic)로 들고 다닌다 — 새로 고쳐도 자리를 잃지 않는다.
 * 모바일: 목록 또는 대화 한 칸만 (선택이 있으면 대화, '목록' 단추로 돌아간다).
 */
export function NotesWorkspace({
  tenantSlug,
  myUserId,
  view,
  withUserId,
  topicKey: selectedTopic,
  notes,
  users,
  projects,
  todayKey,
}: {
  tenantSlug: string;
  myUserId: string;
  view: NoteView;
  withUserId: string | null;
  topicKey: string | null;
  notes: NoteRow[];
  users: NoteUser[];
  projects: NoteProject[];
  todayKey: string;
}) {
  const router = useRouter();
  const usersById = useMemo(() => new Map(users.map((u) => [u.id, u])), [users]);
  const projectsById = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects]);
  const others = useMemo(() => users.filter((u) => u.id !== myUserId && u.isActive), [users, myUserId]);
  const openProjects = useMemo(() => projects.filter((p) => p.status === "planned" || p.status === "active"), [projects]);

  // 20초마다 새로 고침 — 채팅처럼 상대의 답이 자동으로 보이게 (보고 있는 탭에서만)
  useEffect(() => {
    const t = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, 20000);
    return () => clearInterval(t);
  }, [router]);

  const base = `/${tenantSlug}/notes`;
  const href = (next: { view?: NoteView; with?: string | null; topic?: string | null }) => {
    const p = new URLSearchParams();
    p.set("view", next.view ?? view);
    if (next.with) p.set("with", next.with);
    if (next.topic) p.set("topic", next.topic);
    return `${base}?${p.toString()}`;
  };

  // ── 선택된 대화 ──────────────────────────────────────────────────────────
  const isProjectView = view === "project";
  const selectedPerson = !isProjectView && withUserId ? usersById.get(withUserId) ?? null : null;
  const selectedTopicKey = isProjectView ? selectedTopic : null;
  const hasSelection = isProjectView ? Boolean(selectedTopicKey) : Boolean(selectedPerson);

  const thread = useMemo(() => {
    let rows: NoteRow[] = [];
    if (isProjectView && selectedTopicKey) rows = notes.filter((n) => topicKey(n) === selectedTopicKey);
    else if (selectedPerson) rows = notes.filter((n) => counterpartId(n, myUserId) === selectedPerson.id);
    return [...rows].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }, [notes, isProjectView, selectedTopicKey, selectedPerson, myUserId]);

  const unreadInThread = thread.filter((n) => n.recipientId === myUserId && !n.readAt).length;

  // 대화를 열면 상대가 보낸 안 읽은 쪽지를 읽음 처리 (마운트·선택 변경 시 1회)
  const markedKey = useRef<string | null>(null);
  useEffect(() => {
    const key = isProjectView ? `topic:${selectedTopicKey ?? ""}` : `person:${selectedPerson?.id ?? ""}`;
    if (unreadInThread === 0 || markedKey.current === key) return;
    markedKey.current = key;
    const run = isProjectView
      ? markNotesReadForTopic(selectedTopicKey === OTHER_TOPIC_KEY ? null : selectedTopicKey)
      : markNotesReadFrom(selectedPerson?.id ?? "");
    void run.then((r) => {
      if (r.ok) router.refresh();
    });
  }, [isProjectView, selectedTopicKey, selectedPerson, unreadInThread, router]);

  return (
    <div className="flex min-h-[70vh] flex-1 flex-col gap-3">
      {/* 보기 탭 + 새 쪽지 */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="inline-flex h-9 items-center rounded-lg bg-muted p-1 text-muted-foreground">
          {NOTE_VIEWS.map((v) => (
            <Link
              key={v}
              href={href({ view: v, with: v === "project" ? null : withUserId, topic: v === "project" ? selectedTopic : null })}
              className={cn(
                "rounded-md px-3 py-1 text-sm font-medium transition-colors",
                view === v ? "bg-background text-foreground shadow-sm" : "hover:text-foreground"
              )}
            >
              {NOTE_VIEW_LABELS[v]}
            </Link>
          ))}
        </div>
        <ComposeNoteDialog tenantSlug={tenantSlug} users={others} projects={openProjects} />
      </div>

      <div className="grid flex-1 gap-3 md:grid-cols-[18rem_1fr]">
        {/* ── 왼쪽 목록 ─────────────────────────────────────────────────── */}
        <aside className={cn("flex min-h-0 flex-col overflow-hidden rounded-xl border bg-background", hasSelection && "hidden md:flex")}>
          {view === "time" && (
            <TimeList notes={notes} myUserId={myUserId} usersById={usersById} projectsById={projectsById} todayKey={todayKey} selectedId={selectedPerson?.id ?? null} href={href} />
          )}
          {view === "person" && (
            <PersonList notes={notes} myUserId={myUserId} users={users} todayKey={todayKey} selectedId={selectedPerson?.id ?? null} href={href} />
          )}
          {view === "project" && (
            <ProjectList notes={notes} myUserId={myUserId} projects={projects} todayKey={todayKey} selectedKey={selectedTopicKey} href={href} />
          )}
        </aside>

        {/* ── 오른쪽 대화 ───────────────────────────────────────────────── */}
        <section className={cn("flex min-h-[60vh] flex-col overflow-hidden rounded-xl border bg-background", !hasSelection && "hidden md:flex")}>
          {!hasSelection ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center text-sm text-muted-foreground">
              <MessageSquare className="h-8 w-8" aria-hidden />
              {isProjectView ? "왼쪽에서 프로젝트(또는 기타사항)를 고르면 그 주제의 쪽지가 모두 보입니다." : "왼쪽에서 사람이나 쪽지를 고르면 대화가 열립니다."}
            </div>
          ) : (
            <Thread
              tenantSlug={tenantSlug}
              myUserId={myUserId}
              view={view}
              person={selectedPerson}
              topicKeyValue={selectedTopicKey}
              thread={thread}
              usersById={usersById}
              projectsById={projectsById}
              others={others}
              openProjects={openProjects}
              backHref={href({ with: null, topic: null })}
            />
          )}
        </section>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 왼쪽 목록 세 가지
// ─────────────────────────────────────────────────────────────────────────────

type HrefFn = (next: { view?: NoteView; with?: string | null; topic?: string | null }) => string;

function TopicChip({ note, projectsById, className }: { note: NoteRow; projectsById: Map<string, NoteProject>; className?: string }) {
  if (note.topicKind === "project") {
    const p = note.projectId ? projectsById.get(note.projectId) : null;
    return (
      <span className={cn("inline-flex max-w-full items-center gap-1 truncate rounded bg-indigo-50 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-700", className)}>
        <FolderKanban className="h-3 w-3 shrink-0" aria-hidden />
        <span className="truncate">{p ? p.name : note.projectId ? "열람 범위 밖 프로젝트" : "삭제된 프로젝트"}</span>
      </span>
    );
  }
  return (
    <span className={cn("inline-flex max-w-full items-center gap-1 truncate rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800", className)}>
      <Tag className="h-3 w-3 shrink-0" aria-hidden />
      <span className="truncate">기타사항{note.topicLabel ? ` · ${note.topicLabel}` : ""}</span>
    </span>
  );
}

function Avatar({ name, className }: { name: string; className?: string }) {
  return (
    <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-navy text-sm font-bold text-white", className)}>
      {initialOf(name)}
    </span>
  );
}

function UnreadBadge({ n }: { n: number }) {
  if (n <= 0) return null;
  return <span className="ml-auto shrink-0 rounded-full bg-brand px-1.5 py-0.5 text-[10px] font-bold leading-none text-white">{n}</span>;
}

function ListEmpty({ text }: { text: string }) {
  return <p className="p-6 text-center text-xs text-muted-foreground">{text}</p>;
}

/** 날짜·시간순 — 모든 쪽지를 최신부터, 날짜 머리글로 묶어서 */
function TimeList({
  notes, myUserId, usersById, projectsById, todayKey, selectedId, href,
}: {
  notes: NoteRow[]; myUserId: string; usersById: Map<string, NoteUser>; projectsById: Map<string, NoteProject>;
  todayKey: string; selectedId: string | null; href: HrefFn;
}) {
  if (notes.length === 0) return <ListEmpty text="아직 주고받은 쪽지가 없습니다. '쪽지 보내기'로 시작하세요." />;
  const groups: { key: string; rows: NoteRow[] }[] = [];
  for (const n of notes) {
    const key = kstDateKey(n.createdAt);
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.rows.push(n);
    else groups.push({ key, rows: [n] });
  }
  return (
    <div className="flex-1 overflow-y-auto">
      {groups.map((g) => (
        <div key={g.key}>
          <div className="sticky top-0 border-b bg-secondary/80 px-3 py-1 text-[11px] font-semibold text-muted-foreground backdrop-blur">
            {g.key === todayKey ? "오늘" : formatDateHeading(g.key)}
          </div>
          <ul className="divide-y">
            {g.rows.map((n) => {
              const mine = n.senderId === myUserId;
              const other = usersById.get(counterpartId(n, myUserId));
              const unread = !mine && !n.readAt;
              const active = selectedId === other?.id;
              return (
                <li key={n.id}>
                  <Link href={href({ view: "time", with: other?.id ?? null })} className={cn("flex gap-2.5 px-3 py-2 hover:bg-secondary/60", active && "bg-brand/5")}>
                    <Avatar name={other?.name ?? "?"} className="h-8 w-8 text-xs" />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5">
                        {mine ? <ArrowUpRight className="h-3 w-3 text-muted-foreground" aria-hidden /> : <ArrowDownLeft className="h-3 w-3 text-brand" aria-hidden />}
                        <span className={cn("truncate text-sm", unread ? "font-bold" : "font-medium")}>{other?.name ?? "(알 수 없음)"}</span>
                        <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">{formatKstTime(n.createdAt)}</span>
                      </span>
                      <TopicChip note={n} projectsById={projectsById} className="mt-0.5" />
                      <span className={cn("mt-0.5 block truncate text-xs", unread ? "font-semibold text-foreground" : "text-muted-foreground")}>{snippet(n.body)}</span>
                    </span>
                    {unread && <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-brand" aria-label="안 읽음" />}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}

/** 사람별 — 대화 상대마다 한 줄 (마지막 쪽지·안 읽은 수). 쪽지가 없는 구성원도 아래에 */
function PersonList({
  notes, myUserId, users, todayKey, selectedId, href,
}: {
  notes: NoteRow[]; myUserId: string; users: NoteUser[]; todayKey: string; selectedId: string | null; href: HrefFn;
}) {
  const byPerson = new Map<string, { last: NoteRow; unread: number; count: number }>();
  for (const n of notes) {
    const id = counterpartId(n, myUserId);
    const cur = byPerson.get(id);
    const unread = n.recipientId === myUserId && !n.readAt ? 1 : 0;
    if (!cur) byPerson.set(id, { last: n, unread, count: 1 });
    else {
      cur.unread += unread;
      cur.count += 1;
      if (n.createdAt > cur.last.createdAt) cur.last = n;
    }
  }
  const talked = users
    .filter((u) => u.id !== myUserId && byPerson.has(u.id))
    .sort((a, b) => (byPerson.get(b.id)?.last.createdAt ?? "").localeCompare(byPerson.get(a.id)?.last.createdAt ?? ""));
  const silent = users.filter((u) => u.id !== myUserId && u.isActive && !byPerson.has(u.id));
  return (
    <div className="flex-1 overflow-y-auto">
      {talked.length === 0 && <ListEmpty text="아직 대화한 사람이 없습니다. 아래 구성원을 눌러 첫 쪽지를 보내세요." />}
      <ul className="divide-y">
        {talked.map((u) => {
          const s = byPerson.get(u.id);
          if (!s) return null;
          const mine = s.last.senderId === myUserId;
          return (
            <li key={u.id}>
              <Link href={href({ view: "person", with: u.id })} className={cn("flex items-center gap-2.5 px-3 py-2.5 hover:bg-secondary/60", selectedId === u.id && "bg-brand/5")}>
                <Avatar name={u.name} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className={cn("truncate text-sm", s.unread > 0 ? "font-bold" : "font-medium")}>{u.name}</span>
                    {!u.isActive && <span className="text-[10px] text-muted-foreground">(비활성)</span>}
                    <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">{formatListTime(s.last.createdAt, todayKey)}</span>
                  </span>
                  <span className={cn("block truncate text-xs", s.unread > 0 ? "font-semibold text-foreground" : "text-muted-foreground")}>
                    {mine ? "나: " : ""}{snippet(s.last.body, 40)}
                  </span>
                </span>
                <UnreadBadge n={s.unread} />
              </Link>
            </li>
          );
        })}
      </ul>
      {silent.length > 0 && (
        <>
          <div className="border-y bg-secondary/80 px-3 py-1 text-[11px] font-semibold text-muted-foreground">구성원</div>
          <ul className="divide-y">
            {silent.map((u) => (
              <li key={u.id}>
                <Link href={href({ view: "person", with: u.id })} className={cn("flex items-center gap-2.5 px-3 py-2 hover:bg-secondary/60", selectedId === u.id && "bg-brand/5")}>
                  <Avatar name={u.name} className="h-8 w-8 bg-neutral-400 text-xs" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{u.name}</span>
                    <span className="block truncate text-[11px] text-muted-foreground">{[u.positionName, u.department].filter(Boolean).join(" · ") || " "}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

/** 프로젝트별 — 쪽지가 있는 프로젝트(+기타사항) 먼저, 그 아래 쪽지 없는 개설 프로젝트 */
function ProjectList({
  notes, myUserId, projects, todayKey, selectedKey, href,
}: {
  notes: NoteRow[]; myUserId: string; projects: NoteProject[]; todayKey: string; selectedKey: string | null; href: HrefFn;
}) {
  const byTopic = new Map<string, { last: string; unread: number; count: number }>();
  for (const n of notes) {
    const key = topicKey(n);
    const cur = byTopic.get(key);
    const unread = n.recipientId === myUserId && !n.readAt ? 1 : 0;
    if (!cur) byTopic.set(key, { last: n.createdAt, unread, count: 1 });
    else {
      cur.unread += unread;
      cur.count += 1;
      if (n.createdAt > cur.last) cur.last = n.createdAt;
    }
  }
  const projectsById = new Map(projects.map((p) => [p.id, p]));
  const activeKeys = Array.from(byTopic.keys()).sort((a, b) => (byTopic.get(b)?.last ?? "").localeCompare(byTopic.get(a)?.last ?? ""));
  const silent = projects.filter((p) => (p.status === "planned" || p.status === "active") && !byTopic.has(p.id));
  const row = (key: string, label: string, sub: string | null, stat: { last: string; unread: number; count: number } | null, icon: "project" | "other") => (
    <li key={key}>
      <Link href={href({ view: "project", topic: key })} className={cn("flex items-center gap-2.5 px-3 py-2.5 hover:bg-secondary/60", selectedKey === key && "bg-brand/5")}>
        <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-lg", icon === "project" ? "bg-indigo-50 text-indigo-700" : "bg-amber-50 text-amber-800")}>
          {icon === "project" ? <FolderKanban className="h-4 w-4" aria-hidden /> : <Tag className="h-4 w-4" aria-hidden />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className={cn("truncate text-sm", stat && stat.unread > 0 ? "font-bold" : "font-medium")}>{label}</span>
            {stat && <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">{formatListTime(stat.last, todayKey)}</span>}
          </span>
          <span className="block truncate text-[11px] text-muted-foreground">{sub ?? (stat ? `쪽지 ${stat.count}개` : "아직 쪽지 없음")}</span>
        </span>
        {stat && <UnreadBadge n={stat.unread} />}
      </Link>
    </li>
  );
  return (
    <div className="flex-1 overflow-y-auto">
      <ul className="divide-y">
        {activeKeys.map((key) => {
          const stat = byTopic.get(key) ?? null;
          if (key === OTHER_TOPIC_KEY) return row(key, "기타사항", stat ? `쪽지 ${stat.count}개` : null, stat, "other");
          const p = projectsById.get(key);
          return row(key, p ? p.name : "열람 범위 밖·삭제된 프로젝트", p ? `[${p.businessYear}] 쪽지 ${stat?.count ?? 0}개` : null, stat, "project");
        })}
        {!byTopic.has(OTHER_TOPIC_KEY) && row(OTHER_TOPIC_KEY, "기타사항", "프로젝트와 무관한 쪽지", null, "other")}
      </ul>
      {silent.length > 0 && (
        <>
          <div className="border-y bg-secondary/80 px-3 py-1 text-[11px] font-semibold text-muted-foreground">개설된 프로젝트</div>
          <ul className="divide-y">{silent.map((p) => row(p.id, p.name, `[${p.businessYear}] 아직 쪽지 없음`, null, "project"))}</ul>
        </>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 오른쪽 대화(말풍선) + 바로 답장
// ─────────────────────────────────────────────────────────────────────────────

function Thread({
  myUserId, view, person, topicKeyValue, thread, usersById, projectsById, others, openProjects, backHref,
}: {
  tenantSlug: string;
  myUserId: string;
  view: NoteView;
  person: NoteUser | null;
  topicKeyValue: string | null;
  thread: NoteRow[];
  usersById: Map<string, NoteUser>;
  projectsById: Map<string, NoteProject>;
  others: NoteUser[];
  openProjects: NoteProject[];
  backHref: string;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [body, setBody] = useState("");
  const isProjectView = view === "project";
  const topicProject = isProjectView && topicKeyValue && topicKeyValue !== OTHER_TOPIC_KEY ? projectsById.get(topicKeyValue) ?? null : null;

  // 답장 기본값 — 사람별: 마지막 쪽지의 주제 / 프로젝트별: 마지막 쪽지의 상대
  const last = thread[thread.length - 1] ?? null;
  const [replyTopic, setReplyTopic] = useState<string>(() => (last ? topicKey(last) : OTHER_TOPIC_KEY));
  const [replyTo, setReplyTo] = useState<string>(() => (last ? counterpartId(last, myUserId) : others[0]?.id ?? ""));
  const [topicLabel, setTopicLabel] = useState("");

  // 선택이 바뀌면 기본값도 따라간다
  const selectionKey = isProjectView ? `topic:${topicKeyValue ?? ""}` : `person:${person?.id ?? ""}`;
  const lastSelection = useRef(selectionKey);
  if (lastSelection.current !== selectionKey) {
    lastSelection.current = selectionKey;
    setBody("");
    setReplyTopic(last ? topicKey(last) : OTHER_TOPIC_KEY);
    setReplyTo(last ? counterpartId(last, myUserId) : others[0]?.id ?? "");
  }

  const bottomRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [thread.length, selectionKey]);

  function send() {
    const text = body.trim();
    if (!text || pending) return;
    const recipientId = isProjectView ? replyTo : person?.id ?? "";
    if (!recipientId) {
      toast({ variant: "destructive", description: "받는 사람을 고르세요." });
      return;
    }
    const topic = isProjectView ? (topicKeyValue ?? OTHER_TOPIC_KEY) : replyTopic;
    startTransition(async () => {
      const r = await sendNote({
        recipientIds: [recipientId],
        topicKind: topic === OTHER_TOPIC_KEY ? "other" : "project",
        projectId: topic === OTHER_TOPIC_KEY ? "" : topic,
        topicLabel: topic === OTHER_TOPIC_KEY ? topicLabel : undefined,
        body: text,
      });
      if (!r.ok) {
        toast({ variant: "destructive", description: r.error });
        return;
      }
      setBody("");
      setTopicLabel("");
      router.refresh();
    });
  }

  function hide(noteId: string) {
    startTransition(async () => {
      const r = await hideNote(noteId);
      if (!r.ok) toast({ variant: "destructive", description: r.error });
      else router.refresh();
    });
  }

  const headerTitle = isProjectView
    ? topicKeyValue === OTHER_TOPIC_KEY ? "기타사항" : topicProject?.name ?? "열람 범위 밖·삭제된 프로젝트"
    : person?.name ?? "";
  const headerSub = isProjectView
    ? topicProject ? `[${topicProject.businessYear}] 이 프로젝트에 관한 내 쪽지 전부` : "프로젝트와 무관한 쪽지"
    : [person?.positionName, person?.department].filter(Boolean).join(" · ");

  return (
    <>
      {/* 머리 */}
      <div className="flex items-center gap-2.5 border-b px-3 py-2.5">
        <Link href={backHref} className="rounded-md p-1 hover:bg-secondary md:hidden" aria-label="목록으로">
          <ArrowLeft className="h-4 w-4" aria-hidden />
        </Link>
        {isProjectView ? (
          <span className={cn("flex h-9 w-9 items-center justify-center rounded-lg", topicKeyValue === OTHER_TOPIC_KEY ? "bg-amber-50 text-amber-800" : "bg-indigo-50 text-indigo-700")}>
            {topicKeyValue === OTHER_TOPIC_KEY ? <Tag className="h-4 w-4" aria-hidden /> : <FolderKanban className="h-4 w-4" aria-hidden />}
          </span>
        ) : (
          <Avatar name={headerTitle} />
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-bold">{headerTitle}</p>
          <p className="truncate text-[11px] text-muted-foreground">{headerSub || " "}</p>
        </div>
        <span className="text-[11px] text-muted-foreground">쪽지 {thread.length}개</span>
      </div>

      {/* 말풍선 */}
      <div className="flex-1 space-y-1 overflow-y-auto bg-secondary/40 px-3 py-3">
        {thread.length === 0 && (
          <p className="py-10 text-center text-xs text-muted-foreground">아직 쪽지가 없습니다. 아래에서 첫 쪽지를 보내세요.</p>
        )}
        {thread.map((n, i) => {
          const mine = n.senderId === myUserId;
          const prev = thread[i - 1];
          const dayKey = kstDateKey(n.createdAt);
          const newDay = !prev || kstDateKey(prev.createdAt) !== dayKey;
          const other = usersById.get(counterpartId(n, myUserId));
          return (
            <div key={n.id}>
              {newDay && (
                <div className="my-3 flex items-center gap-2 text-[11px] text-muted-foreground">
                  <span className="h-px flex-1 bg-border" />
                  {formatDateHeading(dayKey)}
                  <span className="h-px flex-1 bg-border" />
                </div>
              )}
              <div className={cn("group flex items-end gap-1.5", mine ? "justify-end" : "justify-start")}>
                {!mine && <Avatar name={other?.name ?? "?"} className="h-7 w-7 text-[11px]" />}
                <div className={cn("flex max-w-[78%] flex-col gap-0.5", mine ? "items-end" : "items-start")}>
                  {(isProjectView || !mine) && (
                    <span className="px-1 text-[11px] text-muted-foreground">
                      {isProjectView ? (mine ? `나 → ${other?.name ?? "?"}` : other?.name ?? "?") : other?.name}
                    </span>
                  )}
                  <div className={cn("relative rounded-2xl px-3 py-2 text-sm shadow-sm", mine ? "rounded-br-sm bg-brand text-white" : "rounded-bl-sm border bg-background")}>
                    <p className="whitespace-pre-wrap break-words">{n.body}</p>
                    <button
                      type="button"
                      onClick={() => hide(n.id)}
                      disabled={pending}
                      className={cn("absolute -top-2 rounded-full border bg-background p-0.5 text-muted-foreground opacity-0 shadow transition-opacity hover:text-foreground group-hover:opacity-100", mine ? "-left-2" : "-right-2")}
                      aria-label="내 쪽지함에서 숨기기"
                      title="내 쪽지함에서만 숨깁니다 (상대에게는 남습니다)"
                    >
                      <X className="h-3 w-3" aria-hidden />
                    </button>
                  </div>
                  <span className="flex items-center gap-1 px-1 text-[10px] text-muted-foreground">
                    {!isProjectView && <TopicChip note={n} projectsById={projectsById} />}
                    {formatKstTime(n.createdAt)}
                    {mine && (n.readAt ? <CheckCheck className="h-3 w-3 text-brand" aria-label="읽음" /> : <Check className="h-3 w-3" aria-label="안 읽음" />)}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {/* 바로 답장 */}
      <div className="space-y-1.5 border-t p-2.5">
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          {isProjectView ? (
            <>
              <span className="text-muted-foreground">받는 사람</span>
              <select value={replyTo} onChange={(e) => setReplyTo(e.target.value)} className="h-7 max-w-[14rem] rounded-md border bg-background px-1.5 text-xs" aria-label="받는 사람">
                {others.map((u) => (
                  <option key={u.id} value={u.id}>{u.name}{u.positionName ? ` ${u.positionName}` : ""}</option>
                ))}
              </select>
              {topicKeyValue === OTHER_TOPIC_KEY && (
                <input value={topicLabel} onChange={(e) => setTopicLabel(e.target.value)} maxLength={60} placeholder="기타사항 제목 (선택)" className="h-7 flex-1 min-w-[8rem] rounded-md border bg-background px-2 text-xs" />
              )}
            </>
          ) : (
            <>
              <span className="text-muted-foreground">주제</span>
              <select value={replyTopic} onChange={(e) => setReplyTopic(e.target.value)} className="h-7 max-w-[16rem] rounded-md border bg-background px-1.5 text-xs" aria-label="주제">
                <option value={OTHER_TOPIC_KEY}>기타사항</option>
                {openProjects.map((p) => (
                  <option key={p.id} value={p.id}>[{p.businessYear}] {p.name}</option>
                ))}
                {/* 종결된 프로젝트의 대화에 이어 답할 수 있게 — 마지막 쪽지 주제가 개설 목록 밖이면 그것도 보인다 */}
                {replyTopic !== OTHER_TOPIC_KEY && !openProjects.some((p) => p.id === replyTopic) && (
                  <option value={replyTopic}>{projectsById.get(replyTopic)?.name ?? "열람 범위 밖 프로젝트"}</option>
                )}
              </select>
              {replyTopic === OTHER_TOPIC_KEY && (
                <input value={topicLabel} onChange={(e) => setTopicLabel(e.target.value)} maxLength={60} placeholder="기타사항 제목 (선택)" className="h-7 flex-1 min-w-[8rem] rounded-md border bg-background px-2 text-xs" />
              )}
            </>
          )}
        </div>
        <div className="flex items-end gap-2">
          <Textarea
            rows={2}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                send();
              }
            }}
            maxLength={4000}
            placeholder={isProjectView ? "이 프로젝트에 관한 쪽지 — Enter로 보내기, Shift+Enter 줄바꿈" : `${person?.name ?? ""}에게 — Enter로 보내기, Shift+Enter 줄바꿈`}
            className="min-h-[2.5rem] resize-none text-sm"
          />
          <Button type="button" size="sm" onClick={send} disabled={pending || !body.trim()} className="h-10 shrink-0">
            <SendHorizontal className="h-4 w-4" aria-hidden />
            <span className="ml-1 hidden sm:inline">보내기</span>
          </Button>
        </div>
      </div>
    </>
  );
}
