"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { deniedExec } from "@/lib/monitoring/action-denials";
import { canExecTenant } from "@/lib/auth/exec-policy";
import { roleFromUser, tenantIdFromUser } from "@/lib/auth/tenant";
import { getTenantModules } from "@/lib/modules/server";
import { generateLinkToken, hashLinkToken } from "@/lib/auth/tokens";
import { buildPublicLink } from "@/lib/routing/links";
import {
  isUploadableDocumentType,
  DOCUMENT_TYPE_LABELS,
} from "@/lib/experts/documents";
import { notifyExpert } from "@/lib/experts/notifications";

const REQUEST_EXPIRES_DAYS = 14;

export type CreateDocRequestResult =
  | { ok: true; url: string }
  | { ok: false; error: string };

/** 서류 제출·갱신 요청 생성 — /d 공개 링크 발급 (업무연락, SMS 발송은 발송 화면에서) */
export async function createDocumentRequest(
  expertId: string,
  requestedTypes: string[],
  message: string
): Promise<CreateDocRequestResult> {
  if (!hasSupabaseEnv()) {
    return { ok: false, error: "서버 설정이 완료되지 않았습니다." };
  }
  const modules = await getTenantModules();
  if (!modules.experts) {
    return { ok: false, error: "전문가 모듈이 비활성화된 테넌트입니다." };
  }

  const types = requestedTypes.filter(isUploadableDocumentType);
  if (types.length === 0) {
    return { ok: false, error: "요청할 서류 유형을 선택하세요." };
  }
  if (message.length > 500) {
    return { ok: false, error: "요청 메시지는 500자 이내로 입력하세요." };
  }

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const tenantId = tenantIdFromUser(user);
  const role = roleFromUser(user);
  if (!user || !tenantId || !role) {
    return { ok: false, error: "로그인이 필요합니다." };
  }
  if (!(await canExecTenant("expertInvite", user))) {
    return { ok: false, error: await deniedExec("expertInvite") };
  }

  // 활성 연결 확인
  const { data: link } = await supabase
    .from("expert_tenant_links")
    .select("id, status")
    .eq("expert_id", expertId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (!link || link.status !== "active") {
    return { ok: false, error: "활성 연결이 있는 전문가에게만 요청할 수 있습니다." };
  }

  const token = generateLinkToken();
  const { data: request, error } = await supabase
    .from("document_requests")
    .insert({
      tenant_id: tenantId,
      expert_id: expertId,
      requested_types: types,
      message: message || null,
      token_hash: hashLinkToken(token),
      token_expires_at: new Date(
        Date.now() + REQUEST_EXPIRES_DAYS * 24 * 60 * 60 * 1000
      ).toISOString(),
      requested_by: user.id,
    })
    .select("id")
    .single();

  if (error || !request) {
    return { ok: false, error: "서류 요청 생성에 실패했습니다." };
  }

  await supabase.from("audit_logs").insert({
    tenant_id: tenantId,
    actor_auth_user_id: user.id,
    actor_role: role,
    action: "document_request.create",
    resource_type: "document_request",
    resource_id: request.id,
    after_data: { expert_id: expertId, types },
  });

  // 통합 알림함 — 전문가에게 서류 제출 요청 알림
  await notifyExpert({
    expertId,
    category: "document_request",
    title: "서류 제출 요청이 도착했습니다",
    body: `요청 서류: ${types.map((t) => DOCUMENT_TYPE_LABELS[t] ?? t).join(", ")}`,
    link: "/expert/documents",
    tenantId,
  });

  let url: string;
  try {
    url = buildPublicLink("documentSubmit", token);
  } catch {
    url = `/d/${token}`;
  }

  revalidatePath("/[tenantSlug]/experts", "page");
  return { ok: true, url };
}

export type DocRequestActionResult = { ok: true } | { ok: false; error: string };

/** 서류 요청 회수 (pending만) */
export async function cancelDocumentRequest(
  requestId: string
): Promise<DocRequestActionResult> {
  if (!hasSupabaseEnv()) {
    return { ok: false, error: "서버 설정이 완료되지 않았습니다." };
  }

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const tenantId = tenantIdFromUser(user);
  const role = roleFromUser(user);
  if (!user || !tenantId || !role) {
    return { ok: false, error: "로그인이 필요합니다." };
  }
  if (!(await canExecTenant("expertInvite", user))) {
    return { ok: false, error: await deniedExec("expertInvite") };
  }

  const { data: updated, error } = await supabase
    .from("document_requests")
    .update({ status: "canceled" })
    .eq("id", requestId)
    .eq("status", "pending")
    .select("id")
    .maybeSingle();

  if (error || !updated) {
    return { ok: false, error: "회수할 수 없는 요청입니다." };
  }

  await supabase.from("audit_logs").insert({
    tenant_id: tenantId,
    actor_auth_user_id: user.id,
    actor_role: role,
    action: "document_request.cancel",
    resource_type: "document_request",
    resource_id: requestId,
  });

  revalidatePath("/[tenantSlug]/experts", "page");
  return { ok: true };
}
