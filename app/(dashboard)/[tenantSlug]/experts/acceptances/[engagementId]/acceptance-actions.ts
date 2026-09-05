"use server";

import { revalidatePath } from "next/cache";
import { readUploadFileName } from "@/lib/files/upload-name";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import { getTenantModules, isExpertsLite } from "@/lib/modules/server";
import { isPracticeMode } from "@/lib/practice/server";
import {
  logEngagementEvent,
  staffActorLabel,
} from "@/lib/integrations/engagement-events";
import { refreshProjectEngagementStage } from "@/lib/integrations/project-engagement";
import { createAdminClient } from "@/lib/supabase/admin";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { isMissingColumnError } from "@/lib/supabase/errors";
import type { TablesUpdate } from "@/lib/supabase/database.types";
import { deniedExec } from "@/lib/monitoring/action-denials";
import { canExecTenant } from "@/lib/auth/exec-policy";
import { roleFromUser, tenantIdFromUser } from "@/lib/auth/tenant";
import {
  EXPERT_DOCUMENT_BUCKET,
  validateDocumentFile,
} from "@/lib/experts/documents";
import { notifyExpert } from "@/lib/experts/notifications";
import {
  sendEngagementEmail,
  portalUrl,
} from "@/lib/integrations/engagement-email";
import { sendEngagementSms } from "@/lib/integrations/engagement-sms";

export type AcceptanceActionResult = { ok: true } | { ok: false; error: string };


async function requireManager(): Promise<
  { ok: true; userId: string; tenantId: string } | { ok: false; error: string }
> {
  // 수락서는 experts 모듈 소속 — 화면만 게이트하면 POST 직접 호출이 뚫린다(§1-2-3)
  const modules = await getTenantModules();
  if (!modules.experts) {
    return { ok: false, error: "전문가 섭외 기능을 사용하지 않는 회사입니다." };
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
  if (!(await canExecTenant("acceptanceSend", user))) {
    return { ok: false, error: await deniedExec("acceptanceSend") };
  }
  return { ok: true, userId: user.id, tenantId };
}

/** 수락서 안내 정보 — 상세 설명·입금예정·제출서류·찾아오시는 길 URL */
export type AcceptanceGuideInput = {
  guideNote: string;
  paymentDueNote: string;
  submissionDocs: string;
  mapUrl: string;
};

const guideSchema = z.object({
  guideNote: z.string().max(3000, "상세 설명은 3000자 이내로 입력하세요."),
  paymentDueNote: z.string().max(200, "입금예정 안내는 200자 이내로 입력하세요."),
  submissionDocs: z.string().max(500, "제출서류는 500자 이내로 입력하세요."),
  mapUrl: z
    .string()
    .trim()
    .max(2000, "지도 URL이 너무 깁니다.")
    .refine(
      (v) => v === "" || /^https?:\/\/\S+$/i.test(v),
      "찾아오시는 길 URL은 http:// 또는 https:// 로 시작하는 주소여야 합니다."
    ),
});

/**
 * 안내 정보 저장 (내부) — 조건 스냅샷(역할·비용·일정)과 지급 계좌·소득구분
 * 스냅샷은 변경하지 않는다. 검증 실패는 규칙 문구로 돌려준다 (§12-9).
 */
async function saveGuide(
  acceptanceId: string,
  input: AcceptanceGuideInput
): Promise<
  | { ok: true }
  | { ok: false; error: string; kind: "validation" | "rule" | "system" }
> {
  const parsed = guideSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "안내 정보 입력이 올바르지 않습니다.",
      kind: "validation",
    };
  }
  const g = parsed.data;
  const supabase = createClient();
  const base = {
    guide_note: g.guideNote.trim() || null,
    payment_due_note: g.paymentDueNote.trim() || null,
    submission_docs: g.submissionDocs.trim() || null,
  };
  // 확정된 수락서는 편집하지 않는다 — 화면은 폼을 숨기지만 액션 직접 호출을
  // 막는 건 서버다 (리뷰 5). 0행이면 상태가 바뀐 것.
  const run = (patch: TablesUpdate<"engagement_acceptances">) =>
    supabase
      .from("engagement_acceptances")
      .update(patch)
      .eq("id", acceptanceId)
      .neq("status", "confirmed")
      .select("id")
      .maybeSingle();

  let { data: row, error } = await run({ ...base, map_url: g.mapUrl || null });
  if (error && isMissingColumnError(error)) {
    // SQL 먼저(§14-10): map_url 컬럼이 아직 없는 환경 — URL 없이 저장은 계속된다
    if (g.mapUrl) {
      return {
        ok: false,
        error:
          "지도 URL 저장은 서버 업데이트(마이그레이션) 후 가능합니다. URL을 비우고 저장하거나 캐스트로그에 알려 주세요.",
        kind: "system",
      };
    }
    ({ data: row, error } = await run(base));
  }
  if (error) {
    return {
      ok: false,
      error: "저장에 실패했습니다 (시스템 오류). 잠시 후 다시 시도해 주세요.",
      kind: "system",
    };
  }
  if (!row) {
    return {
      ok: false,
      error: "이미 확정된 수락서라 안내 사항을 수정할 수 없습니다 (규칙).",
      kind: "rule",
    };
  }
  return { ok: true };
}

/**
 * 수락서 보완 편집 — 안내문 + 지급 안내(입금예정·제출서류) + 찾아오시는 길 URL.
 * 송부(sendAcceptance)에도 같은 저장이 자동으로 들어간다 — 이 버튼은 송부 전에
 * 중간 저장하고 싶을 때만 누르면 된다 (기획 지시 2026-09-05).
 */
export async function updateAcceptanceGuide(
  acceptanceId: string,
  input: AcceptanceGuideInput
): Promise<AcceptanceActionResult> {
  if (!hasSupabaseEnv()) return { ok: false, error: "서버 설정이 완료되지 않았습니다." };
  const auth = await requireManager();
  if (!auth.ok) return auth;

  const saved = await saveGuide(acceptanceId, input);
  if (!saved.ok) return { ok: false, error: saved.error };

  revalidatePath("/[tenantSlug]/experts/acceptances/[engagementId]", "page");
  return { ok: true };
}

/** 찾아오시는 길(약도) 이미지 등록 — 암호화 버킷, 서명 URL로만 열람. */
export async function uploadAcceptanceMap(
  formData: FormData
): Promise<AcceptanceActionResult> {
  if (!hasSupabaseEnv()) return { ok: false, error: "서버 설정이 완료되지 않았습니다." };
  const auth = await requireManager();
  if (!auth.ok) return auth;

  const acceptanceId = String(formData.get("acceptanceId") ?? "");
  const file = formData.get("file");
  if (!acceptanceId) return { ok: false, error: "대상을 확인할 수 없습니다." };
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "이미지를 선택해 주세요." };
  }
  const fileName = readUploadFileName(formData, file);
  const validation = validateDocumentFile(file.type, fileName, file.size);
  if (!validation.ok) return { ok: false, error: validation.error };
  // 약도는 화면에 그대로 그린다 — 이미지·PDF만. 오피스·한글 자료는 첨부파일로
  if (!["jpg", "jpeg", "png", "gif", "pdf"].includes(validation.extension)) {
    return {
      ok: false,
      error:
        "찾아오시는 길 약도는 이미지(JPG/PNG/GIF) 또는 PDF만 등록할 수 있습니다. 다른 형식은 '첨부파일 추가'로 올려 주세요.",
    };
  }

  const admin = createAdminClient();
  const path = `acceptances/${auth.tenantId}/${acceptanceId}-map-${crypto.randomUUID()}.${validation.extension}`;
  const { error: uploadError } = await admin.storage
    .from(EXPERT_DOCUMENT_BUCKET)
    .upload(path, await file.arrayBuffer(), {
      contentType: validation.contentType,
      upsert: false,
    });
  if (uploadError) return { ok: false, error: "업로드에 실패했습니다 (시스템 오류). 잠시 후 다시 시도해 주세요." };

  const supabase = createClient();
  const { error } = await supabase
    .from("engagement_acceptances")
    .update({ map_image_path: path })
    .eq("id", acceptanceId);
  if (error) {
    await admin.storage.from(EXPERT_DOCUMENT_BUCKET).remove([path]);
    return { ok: false, error: "저장에 실패했습니다 (시스템 오류). 잠시 후 다시 시도해 주세요." };
  }

  revalidatePath("/[tenantSlug]/experts/acceptances/[engagementId]", "page");
  return { ok: true };
}

/** 수락서 첨부파일 등록 (동봉 자료). */
export async function uploadAcceptanceAttachment(
  formData: FormData
): Promise<AcceptanceActionResult> {
  if (!hasSupabaseEnv()) return { ok: false, error: "서버 설정이 완료되지 않았습니다." };
  const auth = await requireManager();
  if (!auth.ok) return auth;

  const acceptanceId = String(formData.get("acceptanceId") ?? "");
  const file = formData.get("file");
  if (!acceptanceId) return { ok: false, error: "대상을 확인할 수 없습니다." };
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "파일을 선택해 주세요." };
  }
  const fileName = readUploadFileName(formData, file);
  const validation = validateDocumentFile(file.type, fileName, file.size);
  if (!validation.ok) return { ok: false, error: validation.error };

  const admin = createAdminClient();
  const path = `acceptances/${auth.tenantId}/${acceptanceId}-att-${crypto.randomUUID()}.${validation.extension}`;
  const { error: uploadError } = await admin.storage
    .from(EXPERT_DOCUMENT_BUCKET)
    .upload(path, await file.arrayBuffer(), {
      contentType: validation.contentType,
      upsert: false,
    });
  if (uploadError) return { ok: false, error: "업로드에 실패했습니다 (시스템 오류). 잠시 후 다시 시도해 주세요." };

  const supabase = createClient();
  const { error } = await supabase.from("engagement_acceptance_attachments").insert({
    tenant_id: auth.tenantId,
    acceptance_id: acceptanceId,
    file_name: fileName,
    storage_path: path,
    // 브라우저가 hwp 등에서 빈 MIME·octet-stream을 보내므로 정규 MIME으로 저장 —
    // 열람 화면이 형식을 판정하는 근거다
    mime_type: validation.contentType,
    file_size_bytes: file.size,
    uploaded_by: auth.userId,
  });
  if (error) {
    await admin.storage.from(EXPERT_DOCUMENT_BUCKET).remove([path]);
    return { ok: false, error: "저장에 실패했습니다 (시스템 오류). 잠시 후 다시 시도해 주세요." };
  }

  revalidatePath("/[tenantSlug]/experts/acceptances/[engagementId]", "page");
  return { ok: true };
}

/** 첨부 삭제 */
export async function deleteAcceptanceAttachment(
  attachmentId: string
): Promise<AcceptanceActionResult> {
  if (!hasSupabaseEnv()) return { ok: false, error: "서버 설정이 완료되지 않았습니다." };
  const auth = await requireManager();
  if (!auth.ok) return auth;

  const supabase = createClient();
  const { data: row } = await supabase
    .from("engagement_acceptance_attachments")
    .select("storage_path")
    .eq("id", attachmentId)
    .maybeSingle();

  const { error } = await supabase
    .from("engagement_acceptance_attachments")
    .delete()
    .eq("id", attachmentId);
  if (error) return { ok: false, error: "삭제에 실패했습니다 (시스템 오류). 잠시 후 다시 시도해 주세요." };

  if (row?.storage_path) {
    const admin = createAdminClient();
    await admin.storage.from(EXPERT_DOCUMENT_BUCKET).remove([row.storage_path]);
  }

  revalidatePath("/[tenantSlug]/experts/acceptances/[engagementId]", "page");
  return { ok: true };
}

/**
 * 수락서 송부 — 전문가에게 확인·서명 요청 알림.
 * guide를 주면 상세설명·입금예정·제출서류·지도 URL의 **현재 입력값을 먼저
 * 저장**한 뒤 송부한다 — '안내 사항 저장'을 따로 누르지 않아도 화면에 적은
 * 그대로 나간다 (기획 지시 2026-09-05). 저장이 규칙에 걸리면 송부하지 않는다.
 */
export async function sendAcceptance(
  acceptanceId: string,
  guide?: AcceptanceGuideInput
): Promise<AcceptanceActionResult> {
  if (!hasSupabaseEnv()) return { ok: false, error: "서버 설정이 완료되지 않았습니다." };
  const auth = await requireManager();
  if (!auth.ok) return auth;
  // 라이트 모드 — 송부는 포털 서명 흐름의 시작이다. 상태만 'sent'로 바꾸면
  // 어디에도 도착하지 않은 문서를 기다리게 된다 (규칙 거부, §12-9).
  if (await isExpertsLite()) {
    return {
      ok: false,
      error:
        "라이트 모드에서는 수락서를 송부하지 않습니다. 아래 '확인 완료' 처리로 마감하세요. 송부가 필요하면 설정 > 기업관리에서 라이트 모드를 끌 수 있습니다.",
    };
  }

  const supabase = createClient();
  const { data: acceptance } = await supabase
    .from("engagement_acceptances")
    .select("id, engagement_id, expert_id, status, tenant_name, program_name, project_name")
    .eq("id", acceptanceId)
    .maybeSingle();
  if (!acceptance) return { ok: false, error: "수락서를 찾을 수 없습니다." };
  if (acceptance.status === "confirmed") {
    return { ok: false, error: "이미 확인이 완료된 수락서입니다." };
  }
  if (guide) {
    const saved = await saveGuide(acceptanceId, guide);
    if (!saved.ok) {
      return {
        ok: false,
        error:
          saved.kind === "validation"
            ? `${saved.error} 안내 사항을 고친 뒤 다시 송부해 주세요.`
            : saved.error,
      };
    }
  }

  // 상태 CAS — 읽기와 쓰기 사이에 전문가가 승인하면 confirmed→sent로 확정이
  // 역행하던 결함 (검수 B6). 읽은 상태 그대로일 때만 송부 처리한다.
  const { data: sentRow, error } = await supabase
    .from("engagement_acceptances")
    .update({ status: "sent", sent_at: new Date().toISOString() })
    .eq("id", acceptanceId)
    .eq("status", acceptance.status)
    .select("id")
    .maybeSingle();
  if (error) {
    return {
      ok: false,
      error: "송부 처리에 실패했습니다 (시스템 오류). 잠시 후 다시 시도해 주세요.",
    };
  }
  if (!sentRow) {
    return {
      ok: false,
      error: "그 사이 전문가가 승인했거나 상태가 바뀌었습니다. 새로고침 후 확인해 주세요.",
    };
  }

  // 섭외 이력 — 단건 송부도 일괄 송신과 같이 기록한다 (검수 B7)
  await logEngagementEvent({
    tenantId: auth.tenantId,
    engagementId: acceptance.engagement_id,
    type: "acceptance_sent",
    actorKind: "staff",
    actorLabel: await staffActorLabel(auth.userId),
    isPractice: await isPracticeMode(),
  });

  const letterPath = `/expert/engagements/${acceptance.engagement_id}/acceptance`;

  await notifyExpert({
    expertId: acceptance.expert_id,
    category: "engagement_request",
    title: "수락서가 도착했습니다 — 확인 및 서명이 필요합니다",
    body: acceptance.program_name ?? acceptance.project_name ?? undefined,
    link: letterPath,
    tenantId: auth.tenantId,
  });

  // 업무연락 메일 — 수락서 확인·서명 요청
  const title = acceptance.program_name ?? acceptance.project_name ?? "섭외";
  await sendEngagementEmail({
    tenantId: auth.tenantId,
    senderUserId: auth.userId,
    expertId: acceptance.expert_id,
    subject: `[수락서] ${title} — 확인 및 서명 요청`,
    body:
      `${acceptance.tenant_name}에서 수락서를 보내드립니다.\n\n` +
      `아래 링크에서 내용을 확인하시고 전자서명을 완료해 주세요.\n` +
      `${portalUrl(letterPath)}\n\n` +
      `※ 포털 로그인 후 확인하실 수 있습니다.\n`,
  });

  // 문자 — 전문가의 필수 식별자는 휴대폰이고 이메일은 선택이다. 이메일 없는
  // 전문가는 수락서가 온 줄 모른 채 확정이 멈춘다 (검수 C8: 일괄 송부는
  // 문자를 보내는데 단건만 빠져 있었다)
  await sendEngagementSms({
    tenantId: auth.tenantId,
    senderUserId: auth.userId,
    expertId: acceptance.expert_id,
    engagementIds: [acceptance.engagement_id],
    body: [
      `[${acceptance.tenant_name}] 수락서 도착`,
      title,
      // 회사 명의 문자에 플랫폼 이름이 나오면 스미싱으로 오해된다 (§16)
      "※ 아래 링크(전문가 포털)에서 수락서를 확인·승인해 주세요.",
      portalUrl(letterPath),
    ]
      .filter(Boolean)
      .join("\n"),
  });

  revalidatePath("/[tenantSlug]/experts/acceptances/[engagementId]", "page");
  return { ok: true };
}

/** 기업담당자 최종 확인 — 전문가 서명본 접수 확인. */
export async function confirmAcceptance(
  acceptanceId: string
): Promise<AcceptanceActionResult> {
  if (!hasSupabaseEnv()) return { ok: false, error: "서버 설정이 완료되지 않았습니다." };
  const auth = await requireManager();
  if (!auth.ok) return auth;

  const supabase = createClient();
  const { data: acceptance } = await supabase
    .from("engagement_acceptances")
    .select("id, engagement_id, status")
    .eq("id", acceptanceId)
    .maybeSingle();
  if (!acceptance) return { ok: false, error: "수락서를 찾을 수 없습니다." };

  // 라이트 모드 — 전문가 포털 서명이 없으므로 기업 담당자의 확인으로 마감한다.
  // 이 확정이 없으면 프로젝트가 '전원 수락'에서 영영 멈춰 종료(공통 기반)에
  // 도달할 수 없다 (docs/decisions/experts-lite.md).
  const lite = await isExpertsLite();
  if (!lite && acceptance.status !== "signed") {
    return { ok: false, error: "전문가 서명이 완료된 후 확인할 수 있습니다." };
  }
  if (lite && !["issued", "sent", "signed"].includes(acceptance.status)) {
    return { ok: false, error: "이미 확인이 완료됐거나 확인할 수 없는 상태입니다." };
  }

  // 행수 확인(CAS) — 0행 갱신을 성공으로 보고하면 경합 시 감사로그만 남는
  // 거짓 성공이 된다 (검수 B6).
  const { data: confirmedRow, error } = await supabase
    .from("engagement_acceptances")
    .update({
      status: "confirmed",
      confirmed_at: new Date().toISOString(),
      confirmed_by: auth.userId,
    })
    .eq("id", acceptanceId)
    .eq("status", acceptance.status)
    .select("id")
    .maybeSingle();
  if (error) {
    return {
      ok: false,
      error: "확인 처리에 실패했습니다 (시스템 오류). 잠시 후 다시 시도해 주세요.",
    };
  }
  if (!confirmedRow) {
    return {
      ok: false,
      error: "이미 다른 담당자(또는 전문가)가 처리했습니다. 새로고침 후 확인해 주세요.",
    };
  }

  // 라이트 수기 확정은 서명 없는 확정이라 감사 근거를 남긴다
  if (lite && acceptance.status !== "signed") {
    await supabase.from("audit_logs").insert({
      tenant_id: auth.tenantId,
      actor_auth_user_id: auth.userId,
      actor_role: "manager",
      action: "acceptance.confirm_manual",
      resource_type: "engagement_acceptance",
      resource_id: acceptanceId,
      after_data: { prior_status: acceptance.status, experts_lite: true },
    });
  }

  // 섭외 이력 — 기업 확인 마감도 타임라인에 남는다 (검수 B7)
  await logEngagementEvent({
    tenantId: auth.tenantId,
    engagementId: acceptance.engagement_id,
    type: "acceptance_confirmed",
    actorKind: "staff",
    actorLabel: await staffActorLabel(auth.userId),
    note: lite && acceptance.status !== "signed" ? "기업 확인 마감 — 라이트 모드" : undefined,
    isPractice: await isPracticeMode(),
  });

  // 전원 확인이면 프로젝트가 '확정' 단계로 올라간다 (라이트 종료 경로)
  const { data: engagement } = await supabase
    .from("expert_engagements")
    .select("project_id")
    .eq("id", acceptance.engagement_id)
    .maybeSingle();
  if (engagement?.project_id) {
    await refreshProjectEngagementStage(engagement.project_id);
  }

  revalidatePath("/[tenantSlug]/experts/acceptances/[engagementId]", "page");
  return { ok: true };
}
