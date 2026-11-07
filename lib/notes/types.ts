/**
 * 임직원 쪽지 (기획 지시 2026-11-07) — 화면·액션이 함께 쓰는 타입과 순수 함수.
 * 보기 세 가지: 날짜/시간순(time) · 프로젝트별(project) · 사람별(person).
 */

export const NOTE_VIEWS = ["time", "person", "project"] as const;
export type NoteView = (typeof NOTE_VIEWS)[number];
export const NOTE_VIEW_LABELS: Record<NoteView, string> = {
  time: "날짜·시간순",
  person: "사람별",
  project: "프로젝트별",
};
export function isNoteView(v: unknown): v is NoteView {
  return typeof v === "string" && (NOTE_VIEWS as readonly string[]).includes(v);
}

/** 기타사항 — 프로젝트가 없는 쪽지의 묶음 키 */
export const OTHER_TOPIC_KEY = "other";

export type NoteUser = {
  id: string;
  name: string;
  department: string | null;
  positionName: string | null;
  isActive: boolean;
};

export type NoteProject = {
  id: string;
  name: string;
  status: string;
  businessYear: number;
};

export type NoteRow = {
  id: string;
  batchId: string;
  senderId: string;
  recipientId: string;
  topicKind: "project" | "other";
  projectId: string | null;
  topicLabel: string | null;
  body: string;
  readAt: string | null;
  createdAt: string;
};

/** 한 쪽지의 상대 — 내가 보낸 것이면 받는 사람, 받은 것이면 보낸 사람 */
export function counterpartId(note: NoteRow, myId: string): string {
  return note.senderId === myId ? note.recipientId : note.senderId;
}

export function topicKey(note: NoteRow): string {
  return note.topicKind === "project" && note.projectId ? note.projectId : OTHER_TOPIC_KEY;
}

/** KST 기준 날짜 키 (yyyy-mm-dd) */
export function kstDateKey(iso: string): string {
  const d = new Date(new Date(iso).getTime() + 9 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"] as const;

/** "2026-11-07" → "2026년 11월 07일(토)" */
export function formatDateHeading(dateKey: string): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  if (!y || !m || !d) return dateKey;
  const w = WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${y}년 ${String(m).padStart(2, "0")}월 ${String(d).padStart(2, "0")}일(${w})`;
}

/** KST 시:분 ("오후 3:07") */
export function formatKstTime(iso: string): string {
  const d = new Date(new Date(iso).getTime() + 9 * 60 * 60 * 1000);
  const h = d.getUTCHours();
  const m = String(d.getUTCMinutes()).padStart(2, "0");
  const ampm = h < 12 ? "오전" : "오후";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${ampm} ${h12}:${m}`;
}

/** 목록 행의 짧은 시각 — 오늘이면 시:분, 올해면 월/일, 아니면 연.월.일 */
export function formatListTime(iso: string, todayKey: string): string {
  const key = kstDateKey(iso);
  if (key === todayKey) return formatKstTime(iso);
  const [y, m, d] = key.split("-");
  if (y === todayKey.slice(0, 4)) return `${Number(m)}/${Number(d)}`;
  return `${y}.${m}.${d}`;
}

export function snippet(body: string, max = 60): string {
  const one = body.replace(/\s+/g, " ").trim();
  return one.length > max ? `${one.slice(0, max)}…` : one;
}

export function initialOf(name: string): string {
  const t = name.trim();
  return t ? t.slice(0, 1) : "?";
}
