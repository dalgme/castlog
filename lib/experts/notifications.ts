import "server-only";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import type { NotificationCategory } from "@/lib/experts/notification-meta";

export type ExpertNotification = {
  id: string;
  category: string;
  title: string;
  body: string | null;
  link: string | null;
  tenantName: string | null;
  readAt: string | null;
  createdAt: string;
};

export type NotifyInput = {
  expertId: string;
  category: NotificationCategory;
  title: string;
  body?: string | null;
  link?: string | null;
  /** tenantName 미지정 시 tenantId로 이름을 조회해 스냅샷한다. */
  tenantId?: string | null;
  tenantName?: string | null;
  metadata?: Record<string, unknown>;
};

/**
 * 전문가 알림 생성 — 이벤트 발생 지점에서 호출(service_role).
 * 알림 실패가 본 작업(섭외·서류요청 등)을 깨뜨리지 않도록 best-effort(예외 삼킴).
 */
export async function notifyExpert(input: NotifyInput): Promise<void> {
  if (!hasSupabaseEnv()) return;
  try {
    const admin = createAdminClient();

    let tenantName = input.tenantName ?? null;
    if (!tenantName && input.tenantId) {
      const { data: tenant } = await admin
        .from("tenants")
        .select("name")
        .eq("id", input.tenantId)
        .maybeSingle();
      tenantName = tenant?.name ?? null;
    }

    await admin.from("expert_notifications").insert({
      expert_id: input.expertId,
      category: input.category,
      title: input.title,
      body: input.body ?? null,
      link: input.link ?? null,
      tenant_name: tenantName,
      metadata: (input.metadata ?? {}) as never,
    });
  } catch {
    // 알림 실패는 무시 — 본 작업 흐름을 보호한다.
  }
}

/** 현재 로그인 전문가의 id (없으면 null). */
export async function currentExpertId(): Promise<string | null> {
  if (!hasSupabaseEnv()) return null;
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

/** 본인 알림 목록(RLS). 최신순. */
export async function getExpertNotifications(
  limit = 100
): Promise<ExpertNotification[]> {
  if (!hasSupabaseEnv()) return [];
  const supabase = createClient();
  const { data } = await supabase
    .from("expert_notifications")
    .select("id, category, title, body, link, tenant_name, read_at, created_at")
    .order("created_at", { ascending: false })
    .limit(limit);
  return (data ?? []).map((n) => ({
    id: n.id,
    category: n.category,
    title: n.title,
    body: n.body,
    link: n.link,
    tenantName: n.tenant_name,
    readAt: n.read_at,
    createdAt: n.created_at,
  }));
}

/** 본인 안 읽은 알림 수(RLS). 뱃지용. */
export async function getExpertUnreadCount(): Promise<number> {
  if (!hasSupabaseEnv()) return 0;
  const supabase = createClient();
  const { count } = await supabase
    .from("expert_notifications")
    .select("id", { count: "exact", head: true })
    .is("read_at", null);
  return count ?? 0;
}

/**
 * 카테고리 → 해당 탭 경로 매핑.
 * 알림함을 없애고, 각 이벤트는 원래 다루는 메뉴에서 뱃지로 표시·소진한다.
 */
export const NOTIFICATION_TAB_HREF: Record<string, string> = {
  engagement_request: "/expert/engagements",
  engagement_cancelled: "/expert/engagements",
  document_request: "/expert/documents",
  external_send_opened: "/expert/send",
  rrn_access: "/expert/tax-access",
};

/** 탭 경로별 안 읽은 알림 수(RLS). 탭 뱃지용. */
export async function getExpertUnreadByTab(): Promise<Record<string, number>> {
  const byTab: Record<string, number> = {};
  if (!hasSupabaseEnv()) return byTab;
  const supabase = createClient();
  const { data } = await supabase
    .from("expert_notifications")
    .select("category")
    .is("read_at", null);
  for (const row of data ?? []) {
    const href = NOTIFICATION_TAB_HREF[row.category];
    if (href) byTab[href] = (byTab[href] ?? 0) + 1;
  }
  return byTab;
}
