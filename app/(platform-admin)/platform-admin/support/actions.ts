"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { hasSupabaseEnv } from "@/lib/supabase/env";

export type AdminTicketMessage = {
  id: string;
  authorType: "expert" | "platform";
  body: string;
  createdAt: string;
};
export type AdminTicket = {
  id: string;
  expertName: string;
  subject: string;
  status: "open" | "in_progress" | "resolved";
  createdAt: string;
  updatedAt: string;
  messages: AdminTicketMessage[];
};

/** 플랫폼 관리자 — 전 전문가 문의 조회(RLS: is_platform_admin). */
export async function getAllTickets(): Promise<AdminTicket[]> {
  if (!hasSupabaseEnv()) return [];
  const supabase = createClient();

  const { data: tickets } = await supabase
    .from("expert_support_tickets")
    .select("id, expert_id, subject, status, created_at, updated_at")
    .order("updated_at", { ascending: false });
  if (!tickets || tickets.length === 0) return [];

  const { data: messages } = await supabase
    .from("expert_support_ticket_messages")
    .select("id, ticket_id, author_type, body, created_at")
    .in(
      "ticket_id",
      tickets.map((t) => t.id)
    )
    .order("created_at", { ascending: true });

  // 전문가 이름은 admin으로 조회(표시용).
  const admin = createAdminClient();
  const { data: experts } = await admin
    .from("experts")
    .select("id, name")
    .in(
      "id",
      Array.from(new Set(tickets.map((t) => t.expert_id)))
    );
  const nameById = new Map((experts ?? []).map((e) => [e.id, e.name]));

  const byTicket = new Map<string, AdminTicketMessage[]>();
  for (const m of messages ?? []) {
    const arr = byTicket.get(m.ticket_id) ?? [];
    arr.push({
      id: m.id,
      authorType: m.author_type === "platform" ? "platform" : "expert",
      body: m.body,
      createdAt: m.created_at,
    });
    byTicket.set(m.ticket_id, arr);
  }

  return tickets.map((t) => ({
    id: t.id,
    expertName: nameById.get(t.expert_id) ?? "전문가",
    subject: t.subject,
    status: t.status as AdminTicket["status"],
    createdAt: t.created_at,
    updatedAt: t.updated_at,
    messages: byTicket.get(t.id) ?? [],
  }));
}

export type AdminTicketResult = { ok: true } | { ok: false; error: string };

/** 플랫폼 답변 — 작성 시 상태를 처리중으로 전환. */
export async function replyAsPlatform(
  ticketId: string,
  body: string
): Promise<AdminTicketResult> {
  if (!hasSupabaseEnv()) return { ok: false, error: "서버 설정이 완료되지 않았습니다." };
  const trimmed = (body ?? "").trim();
  if (!trimmed) return { ok: false, error: "답변 내용을 입력하세요." };
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "로그인이 필요합니다." };

  const { error } = await supabase.from("expert_support_ticket_messages").insert({
    ticket_id: ticketId,
    author_type: "platform",
    author_auth_user_id: user.id,
    body: trimmed,
  });
  if (error) return { ok: false, error: "답변 저장에 실패했습니다." };

  await supabase
    .from("expert_support_tickets")
    .update({ status: "in_progress" })
    .eq("id", ticketId)
    .eq("status", "open");

  revalidatePath("/platform-admin/support");
  return { ok: true };
}

export async function setTicketStatus(
  ticketId: string,
  status: "open" | "in_progress" | "resolved"
): Promise<AdminTicketResult> {
  if (!hasSupabaseEnv()) return { ok: false, error: "서버 설정이 완료되지 않았습니다." };
  const supabase = createClient();
  const { error } = await supabase
    .from("expert_support_tickets")
    .update({ status })
    .eq("id", ticketId);
  if (error) return { ok: false, error: "상태 변경에 실패했습니다." };
  revalidatePath("/platform-admin/support");
  return { ok: true };
}
