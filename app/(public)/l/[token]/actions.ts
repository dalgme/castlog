"use server";

import { cookies, headers } from "next/headers";
import { createHash } from "node:crypto";
import { z } from "zod";

import { createAdminClient } from "@/lib/supabase/admin";
import { hashLinkToken } from "@/lib/auth/tokens";
import {
  CLIENT_SESSION_HOURS,
  checkClientPassword,
  clientCookieName,
  lookupClientLinkByToken,
  signClientSession,
  verifyClientSession,
} from "@/lib/integrations/client-review";
import { isClientOpinion } from "@/lib/integrations/client-review-shared";

/**
 * 발주처 검토 공개 액션 (/l/{token}) — 로그인 없음, 토큰 + 비밀번호.
 *  - 비밀번호 확인 → 링크 범위 쿠키(2시간)
 *  - '요청/회신 하기' → 회신 저장 + **링크 자동 회수** + 담당자 쪽지·감사로그
 */

type Result = { ok: true } | { ok: false; error: string };

export async function verifyClientReviewPassword(token: string, password: string): Promise<Result> {
  if (!password || password.length > 64) return { ok: false, error: "비밀번호를 입력하세요." };
  const lookup = await lookupClientLinkByToken(hashLinkToken(token));
  if (!lookup.ok) return { ok: false, error: "이 링크는 더 이상 열 수 없습니다. 요청 기업 담당자에게 문의하세요." };
  const check = await checkClientPassword(lookup.link, password);
  if (!check.ok) return check;
  const expMs = Date.now() + CLIENT_SESSION_HOURS * 3600_000;
  cookies().set(clientCookieName(lookup.link.id), signClientSession(lookup.link.id, lookup.link.password_hash, expMs), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: `/l/${token}`,
    expires: new Date(expMs),
  });
  return { ok: true };
}

const responseSchema = z.object({
  respondentName: z.string().trim().max(60, "이름·직함은 60자 이내로 적어 주세요.").optional(),
  generalComment: z.string().trim().max(4000, "요청사항은 4,000자 이내로 적어 주세요.").optional(),
  items: z
    .array(
      z.object({
        entryId: z.string().uuid(),
        opinion: z.string(),
        comment: z.string().trim().max(1000, "후보별 의견은 1,000자 이내로 적어 주세요.").optional(),
      })
    )
    .max(200),
});

export async function submitClientReviewResponse(token: string, input: z.infer<typeof responseSchema>): Promise<Result> {
  const parsed = responseSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "입력값을 확인하세요." };
  const lookup = await lookupClientLinkByToken(hashLinkToken(token));
  if (!lookup.ok) return { ok: false, error: "이 링크는 더 이상 열 수 없습니다 (회수·만료). 요청 기업 담당자에게 문의하세요." };
  const { link, doc } = lookup;
  const cookie = cookies().get(clientCookieName(link.id))?.value;
  if (!verifyClientSession(link.id, link.password_hash, cookie)) {
    return { ok: false, error: "접속이 만료되었습니다. 비밀번호를 다시 입력한 뒤 회신해 주세요." };
  }
  const validEntryIds = new Set(doc.slots.flatMap((s) => s.candidates.map((c) => c.entryId)));
  const items = parsed.data.items.filter((i) => validEntryIds.has(i.entryId) && isClientOpinion(i.opinion));
  const general = parsed.data.generalComment?.trim() || null;
  if (items.length === 0 && !general) {
    return { ok: false, error: "후보별 의견이나 요청사항을 하나 이상 적어 주세요." };
  }

  const admin = createAdminClient();
  const ip = headers().get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  const ipHash = ip ? createHash("sha256").update(ip).digest("hex").slice(0, 32) : null;
  const { data: response, error } = await admin
    .from("client_review_responses")
    .insert({
      tenant_id: link.tenant_id,
      project_id: link.project_id,
      list_id: link.list_id,
      link_id: link.id,
      round: link.round,
      respondent_name: parsed.data.respondentName?.trim() || null,
      general_comment: general,
      ip_hash: ipHash,
    })
    .select("id")
    .single();
  if (error || !response) return { ok: false, error: "회신을 저장하지 못했습니다 (시스템 오류). 잠시 후 다시 시도해 주세요." };
  if (items.length > 0) {
    const { error: itemsError } = await admin.from("client_review_response_items").insert(
      items.map((i) => ({
        tenant_id: link.tenant_id,
        response_id: response.id,
        entry_id: i.entryId,
        opinion: i.opinion,
        comment: i.comment?.trim() || null,
      }))
    );
    if (itemsError) return { ok: false, error: "후보별 의견을 저장하지 못했습니다 (시스템 오류). 잠시 후 다시 시도해 주세요." };
  }

  // 회신 1회로 링크 자동 회수 (기획 보정 2026-11-07) — 재접속 불가
  const now = new Date().toISOString();
  await admin.from("client_review_links").update({ revoked_at: now, revoke_reason: "replied" }).eq("id", link.id);
  await admin.from("candidate_lists").update({ status: "client_replied" }).eq("id", link.list_id).in("status", ["client_sent", "internal_done"]);
  await admin.from("audit_logs").insert({
    tenant_id: link.tenant_id,
    actor_auth_user_id: null,
    actor_role: "client",
    action: "client_review.replied",
    resource_type: "client_review_response",
    resource_id: response.id,
    after_data: { list_id: link.list_id, link_id: link.id, round: link.round, items: items.length },
  });
  // 담당자 알림은 '내 업무'(발주처 회신 받음)와 발주처 검토 탭이 맡는다 — 쪽지는 사람 사이의 것이라 시스템 발신이 없다
  cookies().delete(clientCookieName(link.id));
  return { ok: true };
}
