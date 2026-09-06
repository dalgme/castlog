"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { getTenantModules, isExpertsLite } from "@/lib/modules/server";
import { blockInPractice } from "@/lib/practice/server";

import {
  remindEngagement,
  type ReminderResult,
} from "../../experts/engagements/reminder-actions";

/**
 * '승인 목록 및 섭외 진행' 탭의 섭외 문자 재발송 (기획 지시 2026-09-05).
 *
 * 새 섭외 건을 만들지 않는다 — 회신 대기 중인 건의 동의 링크를 다시 발급해
 * 문자를 보내는 재안내(remindEngagement)를 그대로 쓴다. 권한·라이트 모드·
 * 부PM 게이트·이력 기록도 그 액션이 담당한다. 여기서는 프로젝트 화면을
 * 갱신하고, 세션 단위로 묶어 부르는 편의만 더한다.
 */

const uuid = z.string().uuid();

export async function resendEngagementSms(
  engagementId: string
): Promise<ReminderResult> {
  if (!uuid.safeParse(engagementId).success) {
    return { ok: false, error: "대상을 확인할 수 없습니다 (시스템 결함). 새로고침 후 다시 시도해 주세요." };
  }
  const result = await remindEngagement(engagementId);
  revalidatePath("/[tenantSlug]/projects/[projectId]", "page");
  return result;
}

export type SlotResendResult =
  | {
      ok: true;
      sent: number;
      failed: { code: string; reason: string }[];
      /** 같은 묶음(같은 전문가)이라 한 문자로 함께 재안내된 코드 */
      bundled: string[];
    }
  | { ok: false; error: string };

/** 세션(슬롯)의 회신 대기 전원에게 재발송 — 건별 결과를 모아 돌려준다 */
export async function resendSlotEngagementSms(
  projectId: string,
  slotId: string
): Promise<SlotResendResult> {
  if (!hasSupabaseEnv()) return { ok: false, error: "서버 설정이 완료되지 않았습니다." };
  if (!uuid.safeParse(projectId).success || !uuid.safeParse(slotId).success) {
    return { ok: false, error: "대상을 확인할 수 없습니다 (시스템 결함). 새로고침 후 다시 시도해 주세요." };
  }

  // 규칙 검사는 건별 루프 안이 아니라 앞에서 한 번 — N건이 같은 사유로
  // 실패한 목록보다 한 줄의 규칙 거부가 맞다 (§12-9, 리뷰 M2). 모듈 게이트도
  // 액션 자체에 건다 (CLAUDE.md §1-2-3)
  const modules = await getTenantModules();
  if (!modules.experts) {
    return { ok: false, error: "전문가 섭외 기능을 사용하지 않는 회사입니다." };
  }
  if (await isExpertsLite()) {
    return {
      ok: false,
      error:
        "라이트 모드에서는 문자 재안내를 보내지 않습니다. 전화로 확인한 뒤 '섭외 완료(수락서 생성)' 버튼으로 처리하세요.",
    };
  }
  const practice = await blockInPractice("sending");
  if (!practice.ok) return { ok: false, error: practice.error };

  const supabase = createClient();
  // 이 프로젝트의 세션인지 — RLS(열람 범위) + 명시 필터
  const { data: slot } = await supabase
    .from("engagement_slots")
    .select("id")
    .eq("id", slotId)
    .eq("project_id", projectId)
    .maybeSingle();
  if (!slot) return { ok: false, error: "세션을 찾을 수 없습니다." };

  const { data: positions } = await supabase
    .from("engagement_slot_positions")
    .select("code, engagement_id")
    .eq("slot_id", slotId)
    .eq("status", "requested")
    .not("engagement_id", "is", null)
    .order("position_no", { ascending: true });
  const requestedIds = (positions ?? [])
    .map((p) => p.engagement_id)
    .filter((v): v is string => Boolean(v));
  // 자리→섭외 건은 FK 관계가 아니라 따로 읽는다 (묶음·전문가 중복 제거용)
  const { data: engagementRows } = requestedIds.length
    ? await supabase
        .from("expert_engagements")
        .select("id, expert_id, bundle_id")
        .in("id", requestedIds)
    : { data: [] };
  const byEngagement = new Map(
    (engagementRows ?? []).map((e) => [e.id, e] as const)
  );
  const targets = (positions ?? []).flatMap((p) =>
    p.engagement_id
      ? [
          {
            code: p.code,
            engagementId: p.engagement_id,
            expertId: byEngagement.get(p.engagement_id)?.expert_id ?? null,
            bundleId: byEngagement.get(p.engagement_id)?.bundle_id ?? null,
          },
        ]
      : []
  );
  if (targets.length === 0) {
    return {
      ok: false,
      error: "이 세션에는 회신을 기다리는 섭외 요청이 없습니다 — 재발송할 대상이 없습니다.",
    };
  }

  // 같은 묶음(bundle) 또는 같은 전문가는 한 번만 — 재안내는 묶음 마감을 함께
  // 늘리므로 세션마다 따로 보내면 한 사람이 같은 안내 문자를 N통 받는다 (리뷰 H1)
  const seen = new Set<string>();
  let sent = 0;
  const failed: { code: string; reason: string }[] = [];
  const bundled: string[] = [];
  let deputyBlocked = 0;
  for (const t of targets) {
    const key = t.bundleId ?? t.expertId ?? t.engagementId;
    if (seen.has(key)) {
      bundled.push(t.code);
      continue;
    }
    seen.add(key);
    const r = await remindEngagement(t.engagementId);
    if (r.ok) sent += 1;
    else {
      if (r.needsPmApproval) deputyBlocked += 1;
      failed.push({ code: t.code, reason: r.error });
    }
  }
  if (sent === 0 && deputyBlocked > 0 && deputyBlocked === failed.length) {
    // 부PM 게이트는 건별 승인이다 — 세션 단위 버튼에서는 승인 요청 UI를 띄울 수
    // 없으니 멘토별 버튼으로 안내한다 (리뷰 M1)
    return {
      ok: false,
      error:
        "부PM은 세션 단위 재발송에 PM 승인이 필요합니다 (규칙). 멘토별 '문자 재발송' 버튼에서 건별로 승인을 요청해 주세요.",
    };
  }

  revalidatePath("/[tenantSlug]/projects/[projectId]", "page");
  return { ok: true, sent, failed, bundled };
}
