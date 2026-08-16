"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import { hasSupabaseEnv } from "@/lib/supabase/env";

export type TicketMessage = {
  id: string;
  authorType: "expert" | "platform";
  body: string;
  createdAt: string;
};
export type SupportTicket = {
  id: string;
  subject: string;
  status: "open" | "in_progress" | "resolved";
  createdAt: string;
  updatedAt: string;
  messages: TicketMessage[];
};

async function currentExpertId(): Promise<string | null> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: expert } = await supabase
    .from("experts")
    .select("id")
    .eq("auth_user_id", user.id)
    .maybeSingle();
  return expert?.id ?? null;
}

export async function getSupportTickets(): Promise<SupportTicket[]> {
  if (!hasSupabaseEnv()) return [];
  const supabase = createClient();
  const expertId = await currentExpertId();
  if (!expertId) return [];

  const { data: tickets } = await supabase
    .from("expert_support_tickets")
    .select("id, subject, status, created_at, updated_at")
    .eq("expert_id", expertId)
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

  const byTicket = new Map<string, TicketMessage[]>();
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
    subject: t.subject,
    status: t.status as SupportTicket["status"],
    createdAt: t.created_at,
    updatedAt: t.updated_at,
    messages: byTicket.get(t.id) ?? [],
  }));
}

export type TicketResult = { ok: true } | { ok: false; error: string };

const createSchema = z.object({
  subject: z.string().trim().min(1, "제목을 입력하세요.").max(120),
  body: z.string().trim().min(1, "문의 내용을 입력하세요.").max(2000),
});

export async function createTicket(
  input: z.input<typeof createSchema>
): Promise<TicketResult> {
  if (!hasSupabaseEnv()) return { ok: false, error: "서버 설정이 완료되지 않았습니다." };
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "입력값을 확인하세요." };
  }
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const expertId = await currentExpertId();
  if (!user || !expertId) return { ok: false, error: "로그인이 필요합니다." };

  const { data: ticket, error } = await supabase
    .from("expert_support_tickets")
    .insert({ expert_id: expertId, subject: parsed.data.subject, target: "platform" })
    .select("id")
    .single();
  if (error || !ticket) return { ok: false, error: "문의 생성에 실패했습니다." };

  const { error: msgError } = await supabase
    .from("expert_support_ticket_messages")
    .insert({
      ticket_id: ticket.id,
      author_type: "expert",
      author_auth_user_id: user.id,
      body: parsed.data.body,
    });
  if (msgError) return { ok: false, error: "문의 내용 저장에 실패했습니다." };

  revalidatePath("/expert/support");
  return { ok: true };
}

export async function replyTicket(
  ticketId: string,
  body: string
): Promise<TicketResult> {
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
    author_type: "expert",
    author_auth_user_id: user.id,
    body: trimmed,
  });
  if (error) return { ok: false, error: "답변 저장에 실패했습니다." };

  // 추가 문의가 달리면 상태를 다시 접수로(완료였다면).
  await supabase
    .from("expert_support_tickets")
    .update({ status: "open" })
    .eq("id", ticketId)
    .eq("status", "resolved");

  revalidatePath("/expert/support");
  return { ok: true };
}

export async function closeTicket(ticketId: string): Promise<TicketResult> {
  if (!hasSupabaseEnv()) return { ok: false, error: "서버 설정이 완료되지 않았습니다." };
  const supabase = createClient();
  const { error } = await supabase
    .from("expert_support_tickets")
    .update({ status: "resolved" })
    .eq("id", ticketId);
  if (error) return { ok: false, error: "처리에 실패했습니다." };
  revalidatePath("/expert/support");
  return { ok: true };
}
