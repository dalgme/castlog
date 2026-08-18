"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { roleFromUser } from "@/lib/auth/tenant";
import {
  INQUIRY_TYPE_LABELS,
  type InquiryType,
} from "@/lib/inquiries/schemas";
import { isInquiryStatus, type InquiryStatus } from "@/lib/inquiries/status";

export type AdminInquiry = {
  id: string;
  inquiryType: InquiryType;
  typeLabel: string;
  companyName: string;
  contactName: string;
  email: string;
  phone: string | null;
  message: string | null;
  source: string | null;
  status: InquiryStatus;
  handledByName: string | null;
  createdAt: string;
  updatedAt: string;
};

/** 현재 세션이 플랫폼관리자인지 확인 (JWT app_metadata 기준) */
async function requirePlatformAdminSession(): Promise<
  { ok: true; userId: string } | { ok: false; error: string }
> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || roleFromUser(user) !== "platform_admin") {
    return { ok: false, error: "플랫폼관리자 권한이 필요합니다." };
  }
  return { ok: true, userId: user.id };
}

/**
 * 도입 문의·무료 체험 신청 목록 (플랫폼 전역).
 * RLS(platform_inquiries_select)가 플랫폼관리자만 통과시킨다.
 */
export async function getInquiries(): Promise<AdminInquiry[]> {
  if (!hasSupabaseEnv()) return [];

  const supabase = createClient();
  const { data } = await supabase
    .from("platform_inquiries")
    .select(
      "id, inquiry_type, company_name, contact_name, email, phone, message, source, status, handled_by, created_at, updated_at"
    )
    .order("created_at", { ascending: false });

  const rows = data ?? [];
  if (rows.length === 0) return [];

  // 처리자 이름 — 넥스트랩 내부 계정이므로 users에서 조회한다(없으면 생략).
  const handlerIds = Array.from(
    new Set(rows.map((r) => r.handled_by).filter((v): v is string => !!v))
  );
  const nameById = new Map<string, string>();
  if (handlerIds.length > 0) {
    const { data: handlers } = await supabase
      .from("users")
      .select("id, name")
      .in("id", handlerIds);
    for (const h of handlers ?? []) nameById.set(h.id, h.name);
  }

  return rows.map((r) => {
    const type: InquiryType = r.inquiry_type === "consult" ? "consult" : "trial";
    return {
      id: r.id,
      inquiryType: type,
      typeLabel: INQUIRY_TYPE_LABELS[type],
      companyName: r.company_name,
      contactName: r.contact_name,
      email: r.email,
      phone: r.phone,
      message: r.message,
      source: r.source,
      status: isInquiryStatus(r.status) ? r.status : "new",
      handledByName: r.handled_by ? nameById.get(r.handled_by) ?? null : null,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  });
}

export type InquiryActionResult = { ok: true } | { ok: false; error: string };

/**
 * 신청 처리 상태 변경. 처리자를 함께 기록해 "누가 잡고 있는 건인지" 남긴다.
 * 삭제는 없다 — 도입하지 않기로 한 건도 'closed'로 남긴다 (CLAUDE.md §14-4).
 */
export async function setInquiryStatus(
  inquiryId: string,
  status: string
): Promise<InquiryActionResult> {
  if (!hasSupabaseEnv()) {
    return { ok: false, error: "서버 설정이 완료되지 않았습니다." };
  }
  const session = await requirePlatformAdminSession();
  if (!session.ok) return session;

  if (!isInquiryStatus(status)) {
    return { ok: false, error: "상태 값을 확인하세요." };
  }

  const supabase = createClient();
  const { error } = await supabase
    .from("platform_inquiries")
    .update({ status, handled_by: session.userId })
    .eq("id", inquiryId);
  if (error) return { ok: false, error: "상태 변경에 실패했습니다." };

  await supabase.from("audit_logs").insert({
    tenant_id: null, // 플랫폼 전역 리드 — 테넌트에 귀속되지 않는다
    actor_auth_user_id: session.userId,
    actor_role: "platform_admin",
    action: "platform_inquiry.set_status",
    resource_type: "platform_inquiry",
    resource_id: inquiryId,
    after_data: { status },
  });

  revalidatePath("/platform-admin/inquiries");
  revalidatePath("/platform-admin");
  return { ok: true };
}
