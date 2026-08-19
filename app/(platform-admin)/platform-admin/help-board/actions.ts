"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { roleFromUser } from "@/lib/auth/tenant";

import {
  isFeedbackStatus,
  type BoardRow,
  type FeedbackStatus,
} from "./constants";

/**
 * 상담게시판 목록 (플랫폼관리자 전용).
 *
 * RLS가 플랫폼관리자에게 전 테넌트를 열어 준다. 어느 회사에서 나온 소리인지는
 * 보여 준다 — 한 회사만 겪는 문제와 모두가 겪는 문제는 대응이 다르다.
 */
export async function getHelpBoard(): Promise<BoardRow[]> {
  if (!hasSupabaseEnv()) return [];
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || roleFromUser(user) !== "platform_admin") return [];

  const { data } = await supabase
    .from("help_feedback")
    .select(
      "id, tenant_id, kind, title, summary, path, status, admin_note, created_at"
    )
    .order("created_at", { ascending: false })
    .limit(300);
  const rows = data ?? [];

  // 회사 이름은 따로 읽어 붙인다 — 타입 파일에 관계 메타데이터가 없어
  // 중첩 조인이 동작하지 않는다
  const tenantIds = Array.from(new Set(rows.map((r) => r.tenant_id)));
  const { data: tenants } = tenantIds.length
    ? await supabase.from("tenants").select("id, name").in("id", tenantIds)
    : { data: [] };
  const nameById = new Map((tenants ?? []).map((t) => [t.id, t.name]));

  return rows.map((row) => ({
    id: row.id,
    kind:
      row.kind === "bug" || row.kind === "confusion" ? row.kind : "suggestion",
    title: row.title,
    summary: row.summary,
    path: row.path,
    status: isFeedbackStatus(row.status) ? row.status : "new",
    adminNote: row.admin_note,
    tenantName: nameById.get(row.tenant_id) ?? null,
    createdAt: row.created_at,
  }));
}

export type BoardUpdateResult = { ok: true } | { ok: false; error: string };

/** 처리 상태·메모 갱신 (플랫폼관리자 전용 — RLS에서도 막힌다) */
export async function updateHelpFeedback(input: {
  id: string;
  status?: FeedbackStatus;
  adminNote?: string;
}): Promise<BoardUpdateResult> {
  if (!hasSupabaseEnv()) {
    return { ok: false, error: "서버 설정이 완료되지 않았습니다." };
  }
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || roleFromUser(user) !== "platform_admin") {
    return { ok: false, error: "권한이 없습니다." };
  }
  if (input.status && !isFeedbackStatus(input.status)) {
    return { ok: false, error: "상태 값을 확인하세요." };
  }
  if ((input.adminNote ?? "").length > 2000) {
    return { ok: false, error: "메모는 2000자 이내로 입력하세요." };
  }

  const patch: { status?: string; admin_note?: string | null } = {};
  if (input.status) patch.status = input.status;
  if (input.adminNote !== undefined) {
    patch.admin_note = input.adminNote.trim() || null;
  }
  if (Object.keys(patch).length === 0) return { ok: true };

  const { error } = await supabase
    .from("help_feedback")
    .update(patch)
    .eq("id", input.id);
  if (error) return { ok: false, error: "저장에 실패했습니다." };

  revalidatePath("/platform-admin/help-board");
  return { ok: true };
}
