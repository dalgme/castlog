import "server-only";

import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/supabase/database.types";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isMissingTableError } from "@/lib/supabase/errors";
import {
  CLIENT_LINK_LOCK_MINUTES,
  CLIENT_LINK_MAX_FAILS,
  isClientOpinion,
  type ClientDoc,
  type ClientDocSlot,
  type ClientLinkView,
  type ClientResponseView,
  type ClientReviewTabData,
} from "./client-review-shared";

type Db = SupabaseClient<Database>;

/**
 * 발주처 검토 (기획 승인 2026-11-07 — 3단계).
 *  - 비밀번호는 scrypt 해시만 저장(원문 미보관). 틀림 5회 → 15분 잠금.
 *  - 비밀번호를 맞추면 그 링크에 한정된 서명 쿠키(2시간)를 주고, 이후 화면·회신은 쿠키로 판정한다.
 *  - 발주처가 '요청/회신 하기'를 누르면 링크는 **자동 회수**된다(재접속 불가).
 */

// ---- 비밀번호 ------------------------------------------------------------------
export function hashClientPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password.normalize("NFKC"), salt, 32);
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}

export function verifyClientPassword(password: string, stored: string): boolean {
  const [scheme, saltHex, hashHex] = stored.split("$");
  if (scheme !== "scrypt" || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, "hex");
  const actual = scryptSync(password.normalize("NFKC"), Buffer.from(saltHex, "hex"), expected.length);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

/** 자동 생성 비밀번호 — 헷갈리는 글자(0/O, 1/l/I) 제외, 8자 */
export function generateClientPassword(): string {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789abcdefghjkmnpqrstuvwxyz";
  const bytes = randomBytes(8);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

// ---- 접속 쿠키 (링크 범위) ----------------------------------------------------------
export const CLIENT_SESSION_HOURS = 2;

export function clientCookieName(linkId: string): string {
  return `cl_${linkId.replace(/-/g, "")}`;
}

/** 쿠키 값 = exp.sig — 키는 그 링크의 비밀번호 해시(서버만 안다) */
export function signClientSession(linkId: string, passwordHash: string, expMs: number): string {
  const sig = createHmac("sha256", passwordHash).update(`${linkId}:${expMs}`).digest("hex");
  return `${expMs}.${sig}`;
}

export function verifyClientSession(linkId: string, passwordHash: string, cookieValue: string | undefined): boolean {
  if (!cookieValue) return false;
  const [expStr, sig] = cookieValue.split(".");
  const expMs = Number(expStr);
  if (!Number.isFinite(expMs) || expMs < Date.now() || !sig) return false;
  const expected = createHmac("sha256", passwordHash).update(`${linkId}:${expMs}`).digest("hex");
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(sig, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

// ---- 문서 --------------------------------------------------------------------------
/** 발주처가 볼 문서 — 후보의 공개 프로필만 (연락처·단가·이력서 없음, 설계안 §6-2) */
export async function buildClientDoc(db: Db, listId: string): Promise<ClientDoc | null> {
  const { data: list } = await db
    .from("candidate_lists")
    .select("id, revision, project_id, tenant_id")
    .eq("id", listId)
    .maybeSingle();
  if (!list) return null;
  const [{ data: project }, { data: tenant }, { data: entries }] = await Promise.all([
    db.from("projects").select("name, client_name").eq("id", list.project_id).maybeSingle(),
    db.from("tenants").select("name").eq("id", list.tenant_id).maybeSingle(),
    db.from("candidate_list_entries").select("id, slot_id, expert_id, rank, code, session_label, role_label").eq("list_id", listId).order("rank"),
  ]);
  const rows = entries ?? [];
  const expertIds = Array.from(new Set(rows.map((e) => e.expert_id)));
  const [{ data: experts }, { data: assign }, { data: fields }] = await Promise.all([
    expertIds.length > 0
      ? db.from("experts").select("id, name, specialty, organization, job_title, career_years, region").in("id", expertIds)
      : Promise.resolve({ data: [] as { id: string; name: string; specialty: string | null; organization: string | null; job_title: string | null; career_years: number | null; region: string | null }[] }),
    expertIds.length > 0
      ? db.from("expert_expertise_fields").select("expert_id, field_id").in("expert_id", expertIds)
      : Promise.resolve({ data: [] as { expert_id: string; field_id: string }[] }),
    db.from("expertise_fields").select("id, name"),
  ]);
  const fieldName = new Map((fields ?? []).map((f) => [f.id, f.name]));
  const expertiseByExpert = new Map<string, string[]>();
  for (const a of assign ?? []) {
    const n = fieldName.get(a.field_id);
    if (!n) continue;
    const list = expertiseByExpert.get(a.expert_id) ?? [];
    list.push(n);
    expertiseByExpert.set(a.expert_id, list);
  }
  const expertById = new Map((experts ?? []).map((e) => [e.id, e]));
  const bySlot = new Map<string, ClientDocSlot>();
  for (const e of rows) {
    const key = e.slot_id ?? e.session_label;
    const slot = bySlot.get(key) ?? { slotId: key, sessionLabel: e.session_label, roleLabel: e.role_label, candidates: [] };
    const ex = expertById.get(e.expert_id);
    slot.candidates.push({
      entryId: e.id,
      rank: e.rank,
      code: e.code,
      name: ex?.name ?? "(이름 없음)",
      specialty: ex?.specialty ?? null,
      organization: ex?.organization ?? null,
      jobTitle: ex?.job_title ?? null,
      careerYears: ex?.career_years ?? null,
      region: ex?.region ?? null,
      expertise: expertiseByExpert.get(e.expert_id) ?? [],
    });
    bySlot.set(key, slot);
  }
  return {
    listId: list.id,
    revision: list.revision,
    projectName: project?.name ?? "프로젝트",
    tenantName: tenant?.name ?? null,
    clientName: project?.client_name ?? null,
    slots: Array.from(bySlot.values()),
  };
}

// ---- 탭 데이터 -------------------------------------------------------------------
const CLIENT_STAGE_STATUSES = ["internal_done", "client_sent", "client_replied", "adjusting"];

export async function loadClientReviewTab(projectId: string): Promise<ClientReviewTabData> {
  const supabase = createClient();
  const { data: lists, error } = await supabase
    .from("candidate_lists")
    .select("id, revision, status, title, internal_done_at")
    .eq("project_id", projectId)
    .in("status", CLIENT_STAGE_STATUSES)
    .order("revision", { ascending: false })
    .limit(1);
  if (error) {
    if (isMissingTableError(error)) return { ready: false, list: null, doc: null, links: [], responses: [] };
    return { ready: true, list: null, doc: null, links: [], responses: [] };
  }
  const row = (lists ?? [])[0];
  if (!row) return { ready: true, list: null, doc: null, links: [], responses: [] };

  const [doc, linksRes, responsesRes] = await Promise.all([
    buildClientDoc(supabase, row.id),
    supabase.from("client_review_links").select("*").eq("list_id", row.id).order("round", { ascending: false }),
    supabase.from("client_review_responses").select("*").eq("list_id", row.id).order("submitted_at", { ascending: false }),
  ]);
  if (linksRes.error && isMissingTableError(linksRes.error)) {
    return { ready: false, list: { id: row.id, revision: row.revision, status: row.status, title: row.title, internalDoneAt: row.internal_done_at }, doc, links: [], responses: [] };
  }
  const linkRows = linksRes.data ?? [];
  const responseRows = responsesRes.data ?? [];
  const creatorIds = Array.from(new Set(linkRows.map((l) => l.created_by).filter((v): v is string => Boolean(v))));
  const [{ data: creators }, { data: items }] = await Promise.all([
    creatorIds.length > 0 ? supabase.from("users").select("id, name").in("id", creatorIds) : Promise.resolve({ data: [] as { id: string; name: string }[] }),
    responseRows.length > 0
      ? supabase.from("client_review_response_items").select("response_id, entry_id, opinion, comment").in("response_id", responseRows.map((r) => r.id))
      : Promise.resolve({ data: [] as { response_id: string; entry_id: string; opinion: string; comment: string | null }[] }),
  ]);
  const creatorName = new Map((creators ?? []).map((u) => [u.id, u.name]));
  const now = Date.now();
  const links: ClientLinkView[] = linkRows.map((l) => ({
    id: l.id,
    round: l.round,
    expiresAt: l.expires_at,
    revokedAt: l.revoked_at,
    revokeReason: l.revoke_reason,
    openCount: l.open_count,
    lastOpenedAt: l.last_opened_at,
    createdAt: l.created_at,
    createdByName: l.created_by ? creatorName.get(l.created_by) ?? null : null,
    live: !l.revoked_at && new Date(l.expires_at).getTime() > now,
  }));
  const responses: ClientResponseView[] = responseRows.map((r) => ({
    id: r.id,
    round: r.round,
    respondentName: r.respondent_name,
    generalComment: r.general_comment,
    submittedAt: r.submitted_at,
    items: (items ?? [])
      .filter((i) => i.response_id === r.id)
      .map((i) => ({ entryId: i.entry_id, opinion: isClientOpinion(i.opinion) ? i.opinion : "hold", comment: i.comment })),
  }));
  return {
    ready: true,
    list: { id: row.id, revision: row.revision, status: row.status, title: row.title, internalDoneAt: row.internal_done_at },
    doc,
    links,
    responses,
  };
}

// ---- 공개 링크 조회 (service_role) ------------------------------------------------
export type ClientLinkLookup =
  | {
      ok: true;
      link: Database["public"]["Tables"]["client_review_links"]["Row"];
      doc: ClientDoc;
    }
  | { ok: false; reason: "not_found" | "replied" | "revoked" | "expired"; tenantId: string | null };

export async function lookupClientLinkByToken(tokenHash: string): Promise<ClientLinkLookup> {
  const admin = createAdminClient();
  const { data: link, error } = await admin.from("client_review_links").select("*").eq("token_hash", tokenHash).maybeSingle();
  if (error || !link) return { ok: false, reason: "not_found", tenantId: null };
  if (link.revoked_at) return { ok: false, reason: link.revoke_reason === "replied" ? "replied" : "revoked", tenantId: link.tenant_id };
  if (new Date(link.expires_at).getTime() < Date.now()) return { ok: false, reason: "expired", tenantId: link.tenant_id };
  const doc = await buildClientDoc(admin, link.list_id);
  if (!doc) return { ok: false, reason: "not_found", tenantId: link.tenant_id };
  return { ok: true, link, doc };
}

/** 비밀번호 확인 — 틀리면 실패 횟수 증가, 5회면 15분 잠금 */
export async function checkClientPassword(
  link: Database["public"]["Tables"]["client_review_links"]["Row"],
  password: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const admin = createAdminClient();
  if (link.locked_until && new Date(link.locked_until).getTime() > Date.now()) {
    const until = new Date(link.locked_until).toLocaleTimeString("ko-KR", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", hour12: false });
    return { ok: false, error: `비밀번호를 여러 번 틀려 잠겼습니다. ${until} 이후 다시 시도하거나 요청 기업 담당자에게 문의하세요.` };
  }
  if (verifyClientPassword(password, link.password_hash)) {
    await admin
      .from("client_review_links")
      .update({ failed_attempts: 0, locked_until: null, open_count: link.open_count + 1, last_opened_at: new Date().toISOString() })
      .eq("id", link.id);
    return { ok: true };
  }
  const fails = link.failed_attempts + 1;
  const lock = fails >= CLIENT_LINK_MAX_FAILS;
  await admin
    .from("client_review_links")
    .update({
      failed_attempts: lock ? 0 : fails,
      locked_until: lock ? new Date(Date.now() + CLIENT_LINK_LOCK_MINUTES * 60_000).toISOString() : null,
    })
    .eq("id", link.id);
  return {
    ok: false,
    error: lock
      ? `비밀번호를 ${CLIENT_LINK_MAX_FAILS}회 틀려 ${CLIENT_LINK_LOCK_MINUTES}분간 잠겼습니다. 요청 기업 담당자에게 비밀번호를 다시 확인해 주세요.`
      : `비밀번호가 맞지 않습니다 (${fails}/${CLIENT_LINK_MAX_FAILS}). 요청 기업 담당자가 알려 준 비밀번호를 입력하세요.`,
  };
}
