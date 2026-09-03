"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { requireExecGrade } from "@/lib/auth/exec-gate";
import { explainActionError } from "@/lib/ux/action-errors";
import { buildSlotCode } from "@/lib/integrations/slot-codes";
import { refreshProjectEngagementStage } from "@/lib/integrations/project-engagement";

export type SlotResult = { ok: true } | { ok: false; error: string };

/** 세션 계획·후보 입력 = 레벨 5까지 (기획 확정 2026-08-23 — 차등화) */
async function requireManager(): Promise<
  | { ok: true; userId: string; tenantId: string; role: string }
  | { ok: false; error: string }
> {
  return requireExecGrade("planInput");
}

const slotSchema = z
  .object({
    slotDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "날짜를 입력하세요."),
    startsTime: z.string().regex(/^\d{2}:\d{2}$/).optional().or(z.literal("")),
    endsTime: z.string().regex(/^\d{2}:\d{2}$/).optional().or(z.literal("")),
    roleType: z.enum([
      "host",
      "lecturer",
      "mentor",
      "judge",
      "announcer",
      "assistant",
      "other",
    ]),
    // 세션명·장소 필수 (기획 확정 2026-08-30 — 안내문자·수락서에 그대로 실린다)
    sessionName: z.string().trim().min(1, "세션명을 입력하세요.").max(120),
    roleDescription: z.string().trim().max(100).optional(),
    requiredCount: z.number().int().min(1, "필요 인원은 1명 이상").max(100),
    feeAmount: z.string().regex(/^\d*$/, "비용은 숫자만 입력하세요.").optional(),
    locationName: z.string().trim().min(1, "장소를 입력하세요.").max(150),
    locationAddress: z.string().trim().max(200).optional(),
    notes: z.string().trim().max(500).optional(),
    // 세션 분야 (기획 2026-08-30 — 35번, tenant_session_fields)
    fieldId: z.string().uuid().optional().or(z.literal("")),
  })
  .refine(
    (v) => !v.startsTime || !v.endsTime || v.startsTime < v.endsTime,
    { message: "종료 시각은 시작 시각 이후여야 합니다.", path: ["endsTime"] }
  );

/**
 * 컨설팅 세션(34번)의 세션 계획 탭 수정용 — 장소는 구조적으로 없다(멘토·멘티가
 * 별도 협의). 행사 스키마의 장소 필수를 그대로 적용하면 수정 자체가 거부된다
 * (감사 P2-2a).
 */
const consultingEditSchema = slotSchema.innerType()
  .extend({
    locationName: z.string().trim().max(150).optional().or(z.literal("")),
  })
  .refine(
    (v) => !v.startsTime || !v.endsTime || v.startsTime < v.endsTime,
    { message: "종료 시각은 시작 시각 이후여야 합니다.", path: ["endsTime"] }
  );

/**
 * 타임테이블 슬롯 생성 + 필요인원만큼 코드넘버 자동 부여.
 * 코드는 테넌트 내 유일해야 하므로 충돌 시 접미사를 붙여 재시도한다.
 */
export async function createSlot(
  projectId: string,
  input: z.input<typeof slotSchema>
): Promise<SlotResult> {
  if (!hasSupabaseEnv()) return { ok: false, error: "서버 설정이 완료되지 않았습니다." };
  const auth = await requireManager();
  if (!auth.ok) return auth;

  const parsed = slotSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "입력값을 확인하세요." };
  }
  const d = parsed.data;

  const supabase = createClient();
  const { data: slot, error } = await supabase
    .from("engagement_slots")
    .insert({
      tenant_id: auth.tenantId,
      project_id: projectId,
      slot_date: d.slotDate,
      starts_time: d.startsTime || null,
      ends_time: d.endsTime || null,
      role_type: d.roleType,
      session_name: d.sessionName,
      role_description: d.roleDescription || null,
      required_count: d.requiredCount,
      fee_amount: d.feeAmount ? parseInt(d.feeAmount, 10) : null,
      location_name: d.locationName,
      location_address: d.locationAddress || null,
      notes: d.notes || null,
      field_id: d.fieldId || null,
      created_by: auth.userId,
    })
    .select("id")
    .single();
  if (error || !slot) {
    return {
      ok: false,
      error: error
        ? await explainActionError(error.message, "세션 등록에 실패했습니다.")
        : "세션 등록에 실패했습니다 (시스템 오류). 잠시 후 다시 시도해 주세요.",
    };
  }

  // 후보 순위 모델 (개정 2026-08-30): 후보 TO를 **필요인원의 3배수**로
  // 발급한다 — 거절·미회신을 감안한 예비 폭 (기획 확정). 이후 추가·삭제 가능.
  const candidateCount = Math.min(100, d.requiredCount * 3);
  const positionError = await createPositions(
    supabase,
    auth.tenantId,
    slot.id,
    d.slotDate,
    d.roleType,
    1,
    candidateCount
  );
  if (positionError) {
    await supabase.from("engagement_slots").delete().eq("id", slot.id);
    return { ok: false, error: positionError };
  }

  revalidatePath("/[tenantSlug]/projects/[projectId]", "page");
  return { ok: true };
}

/** 코드넘버 부여 — 충돌 시 짧은 접미사로 재시도(테넌트 내 유일). */
async function createPositions(
  supabase: ReturnType<typeof createClient>,
  tenantId: string,
  slotId: string,
  slotDate: string,
  roleType: string,
  fromNo: number,
  toNo: number
): Promise<string | null> {
  for (let no = fromNo; no <= toNo; no++) {
    let inserted = false;
    for (let attempt = 0; attempt < 5 && !inserted; attempt++) {
      const suffix =
        attempt === 0
          ? undefined
          : crypto.randomUUID().replace(/-/g, "").slice(0, 3).toUpperCase();
      const code = buildSlotCode(slotDate, roleType, no, suffix);
      const { error } = await supabase.from("engagement_slot_positions").insert({
        tenant_id: tenantId,
        slot_id: slotId,
        position_no: no,
        rank: no, // 초기 순위 = 발급 순번 (드래그로 조정)
        code,
      });
      if (!error) inserted = true;
      else if (error.code !== "23505") return "코드넘버 생성에 실패했습니다 (시스템 오류). 잠시 후 다시 시도해 주세요.";
    }
    if (!inserted) return "코드넘버가 중복되어 생성하지 못했습니다.";
  }
  return null;
}

/**
 * 세션 수정 (기획 확정 2026-08-23) — 일정·세션명·역할·장소.
 * 필요인원은 코드 발급이 얽혀 adjustSlotCount 경로로만 바꾼다.
 * feeAmount·locationAddress는 스키마 재사용 관계로 받지만 쓰지 않는다
 * — 비용은 후보별 예정가로 관리(개정 2026-08-22). notes(비고)는 저장한다.
 * 승인된 계획 이후의 수정은 계획 서명(signature) 불일치로 잡혀
 * '변경 상신(재승인)'이 활성화된다 — 변경은 감사로그에 남긴다.
 */
export async function updateSlot(
  slotId: string,
  input: Omit<z.input<typeof slotSchema>, "requiredCount">
): Promise<SlotResult> {
  if (!hasSupabaseEnv()) return { ok: false, error: "서버 설정이 완료되지 않았습니다." };
  const auth = await requireExecGrade("planInput");
  if (!auth.ok) return auth;

  const supabase = createClient();
  const { data: before } = await supabase
    .from("engagement_slots")
    .select(
      "id, project_id, slot_date, period_end_date, starts_time, ends_time, role_type, session_name, role_description, location_name, notes"
    )
    .eq("id", slotId)
    .maybeSingle();
  if (!before) return { ok: false, error: "세션을 찾을 수 없습니다." };

  // 컨설팅 세션(수행기간 있음)은 장소 없이 저장할 수 있다 (감사 P2-2a)
  const isConsulting = before.period_end_date !== null;
  const parsed = (isConsulting ? consultingEditSchema : slotSchema).safeParse({
    ...input,
    requiredCount: 1,
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "입력값을 확인하세요." };
  }
  const d = parsed.data;
  if (isConsulting && before.period_end_date && d.slotDate > before.period_end_date) {
    return {
      ok: false,
      error: `수행 시작일이 종료일(${before.period_end_date}) 뒤일 수 없습니다 (규칙). 기간은 기본설정 탭의 컨설팅 세션에서 함께 수정해 주세요.`,
    };
  }

  const { error } = await supabase
    .from("engagement_slots")
    .update({
      slot_date: d.slotDate,
      starts_time: d.startsTime || null,
      ends_time: d.endsTime || null,
      role_type: d.roleType,
      session_name: d.sessionName || null,
      role_description: d.roleDescription || null,
      location_name: d.locationName || null,
      // 비고 — 화면 입력 신설 (기획 2026-08-30). 생성과 수정이 같은 컬럼을 쓴다
      notes: d.notes || null,
      field_id: d.fieldId || null,
    })
    .eq("id", slotId);
  if (error) {
    return {
      ok: false,
      error: await explainActionError(error.message, "세션 수정에 실패했습니다."),
    };
  }

  await supabase.from("audit_logs").insert({
    tenant_id: auth.tenantId,
    actor_auth_user_id: auth.userId,
    actor_role: auth.role,
    action: "engagement_slot.update",
    resource_type: "engagement_slot",
    resource_id: slotId,
    before_data: {
      slot_date: before.slot_date,
      starts_time: before.starts_time,
      ends_time: before.ends_time,
      session_name: before.session_name,
      role_type: before.role_type,
      role_description: before.role_description,
      location_name: before.location_name,
      notes: before.notes,
    },
    after_data: {
      slot_date: d.slotDate,
      starts_time: d.startsTime || null,
      ends_time: d.endsTime || null,
      session_name: d.sessionName || null,
      role_type: d.roleType,
      role_description: d.roleDescription || null,
      location_name: d.locationName || null,
      notes: d.notes || null,
    },
  });

  revalidatePath("/[tenantSlug]/projects/[projectId]", "page");
  return { ok: true };
}

const consultingSlotSchema = z
  .object({
    startsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "수행 시작일을 입력하세요."),
    endsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "수행 종료일을 입력하세요."),
    fieldId: z.string().uuid("분야를 선택하세요."),
    requiredCount: z.number().int().min(1, "필요 인원은 1명 이상").max(100),
    candidateCount: z.number().int().min(1, "후보 인원은 1명 이상").max(100),
    sessionName: z.string().trim().max(120).optional(),
  })
  .refine((v) => v.startsOn <= v.endsOn, {
    message: "수행 종료일은 시작일 이후여야 합니다.",
    path: ["endsOn"],
  })
  .refine((v) => v.candidateCount >= v.requiredCount, {
    message: "후보 인원은 필요 인원 이상이어야 합니다.",
    path: ["candidateCount"],
  });

/**
 * 컨설팅 유형 세션 생성 (기획 확정 2026-08-30 — 34번).
 * 수행기간(시작~종료)·분야·필요인원·후보인원으로 만든다. 행사 세션과 같은
 * engagement_slots가 원본이고, 후보 TO는 3배수 대신 **입력한 후보 인원**만큼
 * 발급한다. 세션명이 비면 '컨설팅 · {분야명}'으로 자동.
 */
export async function createConsultingSlot(
  projectId: string,
  input: z.input<typeof consultingSlotSchema>
): Promise<SlotResult> {
  if (!hasSupabaseEnv()) return { ok: false, error: "서버 설정이 완료되지 않았습니다." };
  const auth = await requireManager();
  if (!auth.ok) return auth;

  const parsed = consultingSlotSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "입력값을 확인하세요." };
  }
  const d = parsed.data;

  const supabase = createClient();
  const { data: field } = await supabase
    .from("tenant_session_fields")
    .select("id, name")
    .eq("id", d.fieldId)
    .maybeSingle();
  if (!field) {
    return { ok: false, error: "선택한 분야를 찾을 수 없습니다. 설정 > 내 설정 > 분야에서 추가하세요." };
  }

  const { data: slot, error } = await supabase
    .from("engagement_slots")
    .insert({
      tenant_id: auth.tenantId,
      project_id: projectId,
      slot_date: d.startsOn,
      period_end_date: d.endsOn,
      role_type: "mentor",
      session_name: d.sessionName?.trim() || `컨설팅 · ${field.name}`,
      field_id: field.id,
      required_count: d.requiredCount,
      location_name: null,
      created_by: auth.userId,
    })
    .select("id")
    .single();
  if (error || !slot) {
    return {
      ok: false,
      error: error
        ? await explainActionError(error.message, "컨설팅 세션 생성에 실패했습니다.")
        : "컨설팅 세션 생성에 실패했습니다 (시스템 오류). 잠시 후 다시 시도해 주세요.",
    };
  }

  const positionError = await createPositions(
    supabase,
    auth.tenantId,
    slot.id,
    d.startsOn,
    "mentor",
    1,
    d.candidateCount
  );
  if (positionError) {
    await supabase.from("engagement_slots").delete().eq("id", slot.id);
    return { ok: false, error: positionError };
  }

  revalidatePath("/[tenantSlug]/projects/[projectId]", "page");
  return { ok: true };
}

const consultingUpdateSchema = z
  .object({
    startsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "수행 시작일을 입력하세요."),
    endsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "수행 종료일을 입력하세요."),
    fieldId: z.string().uuid("분야를 선택하세요."),
  })
  .refine((v) => v.startsOn <= v.endsOn, {
    message: "수행 종료일은 시작일 이후여야 합니다.",
    path: ["endsOn"],
  });

/**
 * 컨설팅 세션 수정 (리뷰 P3-2 — 만든 뒤 기간·분야를 고칠 수 없던 막다른 길).
 * 필요인원은 adjustSlotCount, 삭제는 deleteSlot을 그대로 쓴다.
 */
export async function updateConsultingSlot(
  slotId: string,
  input: z.input<typeof consultingUpdateSchema>
): Promise<SlotResult> {
  if (!hasSupabaseEnv()) return { ok: false, error: "서버 설정이 완료되지 않았습니다." };
  const auth = await requireManager();
  if (!auth.ok) return auth;

  const parsed = consultingUpdateSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "입력값을 확인하세요." };
  }
  const d = parsed.data;

  const supabase = createClient();
  const { data: field } = await supabase
    .from("tenant_session_fields")
    .select("id, name")
    .eq("id", d.fieldId)
    .maybeSingle();
  if (!field) {
    return { ok: false, error: "선택한 분야를 찾을 수 없습니다." };
  }

  // 사용자가 직접 지은 세션명은 지키고, 자동 생성명("컨설팅 · 분야")만 새
  // 분야로 따라 바꾼다 (감사 P3-4 — 이전에는 무조건 덮어써 이름이 사라졌다)
  const { data: before } = await supabase
    .from("engagement_slots")
    .select("session_name")
    .eq("id", slotId)
    .maybeSingle();
  const autoNamed =
    !before?.session_name || before.session_name.startsWith("컨설팅 · ");

  const { data: updated, error } = await supabase
    .from("engagement_slots")
    .update({
      slot_date: d.startsOn,
      period_end_date: d.endsOn,
      field_id: field.id,
      ...(autoNamed ? { session_name: `컨설팅 · ${field.name}` } : {}),
    })
    .eq("id", slotId)
    .select("id")
    .maybeSingle();
  if (error || !updated) {
    return {
      ok: false,
      error: error
        ? await explainActionError(error.message, "컨설팅 세션 수정에 실패했습니다.")
        : "세션을 찾을 수 없거나 수정 권한이 없습니다 (권한 규칙).",
    };
  }

  revalidatePath("/[tenantSlug]/projects/[projectId]", "page");
  return { ok: true };
}

/** 슬롯 삭제 — 섭외 요청이 연결된 인원이 있으면 막는다(§14-4 되돌리기 보호). */
export async function deleteSlot(slotId: string): Promise<SlotResult> {
  if (!hasSupabaseEnv()) return { ok: false, error: "서버 설정이 완료되지 않았습니다." };
  const auth = await requireManager();
  if (!auth.ok) return auth;

  const supabase = createClient();
  const { data: linked } = await supabase
    .from("engagement_slot_positions")
    .select("id")
    .eq("slot_id", slotId)
    .not("engagement_id", "is", null)
    .limit(1);
  if (linked && linked.length > 0) {
    return {
      ok: false,
      error: "이미 섭외를 요청한 인원이 있어 삭제할 수 없습니다. 개별 취소 후 진행하세요.",
    };
  }

  const { error } = await supabase.from("engagement_slots").delete().eq("id", slotId);
  if (error) return { ok: false, error: "삭제에 실패했습니다 (시스템 오류). 잠시 후 다시 시도해 주세요." };

  revalidatePath("/[tenantSlug]/projects/[projectId]", "page");
  return { ok: true };
}

/** 필요 인원 증감 — 증가 시 코드 추가 부여, 감소는 미섭외 인원만 제거. */
export async function adjustSlotCount(
  slotId: string,
  nextCount: number
): Promise<SlotResult> {
  if (!hasSupabaseEnv()) return { ok: false, error: "서버 설정이 완료되지 않았습니다." };
  const auth = await requireManager();
  if (!auth.ok) return auth;
  if (!Number.isInteger(nextCount) || nextCount < 1 || nextCount > 100) {
    return { ok: false, error: "필요 인원은 1~100명으로 입력하세요." };
  }

  const supabase = createClient();
  const { data: slot } = await supabase
    .from("engagement_slots")
    .select("id, slot_date, period_end_date, role_type, required_count")
    .eq("id", slotId)
    .maybeSingle();
  if (!slot) return { ok: false, error: "세션을 찾을 수 없습니다." };

  // 후보 순위 모델: 필요인원은 '실제 섭외 인원 수'일 뿐, 후보 수와 분리다.
  // 늘릴 때 후보 TO가 3배수에 못 미치면 그만큼 추가 발급하고(기획 2026-08-30),
  // 줄일 때는 후보를 지우지 않는다(초과 후보는 예비 후보로 남는다).
  // 컨설팅 세션(34번)은 후보인원을 직접 입력하므로 3배수 보충을 하지 않는다
  // (감사 P2-2c) — 필요하면 후보 TO 추가 버튼으로 늘린다.
  const { count: candidateCount } = await supabase
    .from("engagement_slot_positions")
    .select("id", { count: "exact", head: true })
    .eq("slot_id", slotId)
    .neq("status", "canceled");
  const existing = candidateCount ?? 0;
  const isConsulting = slot.period_end_date !== null;
  const targetCandidates = isConsulting
    ? Math.min(100, Math.max(existing, nextCount))
    : Math.min(100, nextCount * 3);
  if (targetCandidates > existing) {
    const { data: maxRow } = await supabase
      .from("engagement_slot_positions")
      .select("position_no")
      .eq("slot_id", slotId)
      .order("position_no", { ascending: false })
      .limit(1)
      .maybeSingle();
    const from = (maxRow?.position_no ?? 0) + 1;
    const err = await createPositions(
      supabase,
      auth.tenantId,
      slotId,
      slot.slot_date,
      slot.role_type,
      from,
      from + (targetCandidates - existing) - 1
    );
    if (err) return { ok: false, error: err };
  }

  const { error } = await supabase
    .from("engagement_slots")
    .update({ required_count: nextCount })
    .eq("id", slotId);
  if (error) return { ok: false, error: "인원 변경에 실패했습니다 (시스템 오류). 잠시 후 다시 시도해 주세요." };

  revalidatePath("/[tenantSlug]/projects/[projectId]", "page");
  return { ok: true };
}

/** 프로젝트 총 예산 설정 (권한자만). */
export async function updateProjectBudget(
  projectId: string,
  budgetAmount: string
): Promise<SlotResult> {
  if (!hasSupabaseEnv()) return { ok: false, error: "서버 설정이 완료되지 않았습니다." };
  // 예산은 금액 축 — 레벨 3까지 유지 (세션 입력과 구분, 기획 확정 2026-08-23)
  const auth = await requireExecGrade("projectBudget");
  if (!auth.ok) return auth;
  if (!/^\d*$/.test(budgetAmount)) {
    return { ok: false, error: "예산은 숫자만 입력하세요 (원 단위)." };
  }

  const supabase = createClient();
  const { error } = await supabase
    .from("projects")
    .update({
      budget_amount: budgetAmount ? parseInt(budgetAmount, 10) : null,
    })
    .eq("id", projectId);
  if (error) return { ok: false, error: "예산 저장에 실패했습니다 (시스템 오류). 잠시 후 다시 시도해 주세요." };

  revalidatePath("/[tenantSlug]/projects/[projectId]", "page");
  return { ok: true };
}

/**
 * 후보 추가 (기획 확정 2026-08-22) — 임시후보 코드를 1개 더 발급한다.
 * 순위는 맨 뒤로 붙는다(드래그로 조정).
 */
export async function addCandidate(slotId: string): Promise<SlotResult> {
  if (!hasSupabaseEnv()) return { ok: false, error: "서버 설정이 완료되지 않았습니다." };
  const auth = await requireManager();
  if (!auth.ok) return auth;

  const supabase = createClient();
  const { data: slot } = await supabase
    .from("engagement_slots")
    .select("id, slot_date, role_type")
    .eq("id", slotId)
    .maybeSingle();
  if (!slot) return { ok: false, error: "세션을 찾을 수 없습니다." };

  const { data: maxRow } = await supabase
    .from("engagement_slot_positions")
    .select("position_no")
    .eq("slot_id", slotId)
    .order("position_no", { ascending: false })
    .limit(1)
    .maybeSingle();
  const no = (maxRow?.position_no ?? 0) + 1;
  if (no > 100) return { ok: false, error: "후보는 세션당 최대 100명입니다." };

  const err = await createPositions(
    supabase,
    auth.tenantId,
    slotId,
    slot.slot_date,
    slot.role_type,
    no,
    no
  );
  if (err) return { ok: false, error: err };

  revalidatePath("/[tenantSlug]/projects/[projectId]", "page");
  return { ok: true };
}

/**
 * 세션 복사 (기획 확정 2026-08-30) — 구성(날짜·시간·역할·세션명·장소)만 복제하고
 * 실적(후보 배정·섭외건)은 복제하지 않는다. 후보 TO는 3배수 규칙으로 새로 발급.
 * 복사본은 세션명에 "(복사)"를 붙여 바로 구분·수정할 수 있게 한다.
 */
export async function duplicateSlot(slotId: string): Promise<SlotResult> {
  if (!hasSupabaseEnv()) return { ok: false, error: "서버 설정이 완료되지 않았습니다." };
  const auth = await requireManager();
  if (!auth.ok) return auth;

  const supabase = createClient();
  const { data: source } = await supabase
    .from("engagement_slots")
    .select(
      "id, project_id, slot_date, period_end_date, field_id, starts_time, ends_time, role_type, session_name, role_description, required_count, fee_amount, location_name, location_address, notes, sort_order"
    )
    .eq("id", slotId)
    .maybeSingle();
  if (!source) return { ok: false, error: "복사할 세션을 찾을 수 없습니다." };
  // 컨설팅 세션(34번)은 장소가 구조적으로 없다 — 세션명만 확인하고, 기간·분야를
  // 함께 복제하며 후보 TO는 원본과 같은 수로 발급한다 (감사 P2-2b)
  const isConsulting = source.period_end_date !== null;
  // 세션명·장소 필수화 이후의 우회 방지 — 필수값 없는 구세션은 복사 대신
  // 원본을 먼저 채우게 한다 (리뷰 A-2)
  if (!source.session_name || (!isConsulting && !source.location_name)) {
    return {
      ok: false,
      error: isConsulting
        ? "원본 세션에 세션명이 없어 복사할 수 없습니다 (필수 규칙). 원본을 수정해 채운 뒤 복사해 주세요."
        : "원본 세션에 세션명·장소가 없어 복사할 수 없습니다 (필수 규칙). 원본을 수정해 채운 뒤 복사해 주세요.",
    };
  }

  let copyCandidates = Math.min(100, source.required_count * 3);
  if (isConsulting) {
    const { count } = await supabase
      .from("engagement_slot_positions")
      .select("id", { count: "exact", head: true })
      .eq("slot_id", slotId)
      .neq("status", "canceled");
    copyCandidates = Math.min(100, Math.max(1, count ?? source.required_count));
  }

  const copyName = source.session_name
    ? `${source.session_name} (복사)`.slice(0, 120)
    : "(복사)";
  const { data: created, error } = await supabase
    .from("engagement_slots")
    .insert({
      tenant_id: auth.tenantId,
      project_id: source.project_id,
      slot_date: source.slot_date,
      period_end_date: source.period_end_date,
      field_id: source.field_id,
      starts_time: source.starts_time,
      ends_time: source.ends_time,
      role_type: source.role_type,
      session_name: copyName,
      role_description: source.role_description,
      required_count: source.required_count,
      fee_amount: source.fee_amount,
      location_name: source.location_name,
      location_address: source.location_address,
      notes: source.notes,
      created_by: auth.userId,
    })
    .select("id")
    .single();
  if (error || !created) {
    return {
      ok: false,
      error: error
        ? await explainActionError(error.message, "세션 복사에 실패했습니다.")
        : "세션 복사에 실패했습니다 (시스템 오류). 잠시 후 다시 시도해 주세요.",
    };
  }

  const positionError = await createPositions(
    supabase,
    auth.tenantId,
    created.id,
    source.slot_date,
    source.role_type,
    1,
    copyCandidates
  );
  if (positionError) {
    await supabase.from("engagement_slots").delete().eq("id", created.id);
    return { ok: false, error: positionError };
  }

  // 복사본이 원본 바로 아래 오도록 전체 순서를 다시 매긴다 — sort_order+1
  // 단순 삽입은 다음 세션과 동률이 되어 정렬이 흔들린다 (리뷰 4).
  // 실패해도 복사 자체는 유효하므로 삼킨다(다음 드래그가 재번호를 부여한다).
  {
    const { data: ordered } = await supabase
      .from("engagement_slots")
      .select("id")
      .eq("project_id", source.project_id)
      .order("sort_order", { ascending: true, nullsFirst: false })
      .order("slot_date", { ascending: true })
      .order("starts_time", { ascending: true });
    const ids = (ordered ?? []).map((r) => r.id).filter((id) => id !== created.id);
    const at = ids.indexOf(slotId);
    ids.splice(at >= 0 ? at + 1 : ids.length, 0, created.id);
    for (let i = 0; i < ids.length; i++) {
      await supabase
        .from("engagement_slots")
        .update({ sort_order: i + 1 })
        .eq("id", ids[i]!);
    }
  }

  await supabase.from("audit_logs").insert({
    tenant_id: auth.tenantId,
    actor_auth_user_id: auth.userId,
    actor_role: auth.role,
    action: "slot.duplicate",
    resource_type: "engagement_slot",
    resource_id: created.id,
    after_data: { source_slot_id: slotId },
  });

  revalidatePath("/[tenantSlug]/projects/[projectId]", "page");
  return { ok: true };
}

/**
 * 세션 순서 변경 (드래그·위아래 버튼 — 기획 확정 2026-08-30).
 * 프로젝트의 전 세션에 sort_order를 1부터 다시 매긴다. sort_order가 없는
 * 환경(마이그레이션 전)에서는 컬럼 부재 오류를 사유와 함께 돌려준다.
 */
export async function reorderSlots(
  projectId: string,
  orderedSlotIds: string[]
): Promise<SlotResult> {
  if (!hasSupabaseEnv()) return { ok: false, error: "서버 설정이 완료되지 않았습니다." };
  const auth = await requireManager();
  if (!auth.ok) return auth;
  if (!Array.isArray(orderedSlotIds) || orderedSlotIds.length === 0) {
    return { ok: false, error: "순서가 비어 있습니다." };
  }

  const supabase = createClient();
  // 대상 검증 — 이 프로젝트의 세션만 (타 프로젝트 id 섞임 방지)
  const { data: rows } = await supabase
    .from("engagement_slots")
    .select("id")
    .eq("project_id", projectId);
  const valid = new Set((rows ?? []).map((r) => r.id));
  const ids = orderedSlotIds.filter((id) => valid.has(id));
  if (ids.length !== valid.size || new Set(ids).size !== ids.length) {
    return { ok: false, error: "세션 목록이 갱신되었습니다. 새로고침 후 다시 시도하세요." };
  }

  for (let i = 0; i < ids.length; i++) {
    const id = ids[i];
    if (!id) continue;
    const { error } = await supabase
      .from("engagement_slots")
      .update({ sort_order: i + 1 })
      .eq("id", id);
    if (error) {
      return {
        ok: false,
        error:
          error.code === "42703"
            ? "세션 순서 저장 기능이 아직 준비되지 않았습니다 (마이그레이션 미적용) — 캐스트로그에 알려 주세요."
            : "순서 저장에 실패했습니다 (시스템 오류). 잠시 후 다시 시도해 주세요.",
      };
    }
  }

  revalidatePath("/[tenantSlug]/projects/[projectId]", "page");
  return { ok: true };
}

/** 후보 삭제 — 섭외 요청이 나가기 전(open/assigned)의 후보만 지울 수 있다. */
export async function removeCandidate(positionId: string): Promise<SlotResult> {
  if (!hasSupabaseEnv()) return { ok: false, error: "서버 설정이 완료되지 않았습니다." };
  const auth = await requireManager();
  if (!auth.ok) return auth;

  const supabase = createClient();
  const { data: removed, error } = await supabase
    .from("engagement_slot_positions")
    .delete()
    .eq("id", positionId)
    .in("status", ["open", "assigned"])
    .is("engagement_id", null)
    .select("id, slot_id")
    .maybeSingle();
  if (error || !removed) {
    return {
      ok: false,
      error: "이미 섭외가 진행된 후보는 삭제할 수 없습니다. 개별 취소 후 진행하세요.",
    };
  }

  // 예비 후보를 정리한 직후 단계를 재판정한다 — 판정 기준 변경 전에 이미
  // '요청 중'으로 고착된 프로젝트가 여기서라도 풀리게 (시뮬레이션 P1)
  const { data: slot } = await supabase
    .from("engagement_slots")
    .select("project_id")
    .eq("id", removed.slot_id)
    .maybeSingle();
  if (slot?.project_id) {
    await refreshProjectEngagementStage(slot.project_id);
  }

  revalidatePath("/[tenantSlug]/projects/[projectId]", "page");
  return { ok: true };
}

/** 후보 순위 저장 — 드래그로 정한 순서(위→아래 = 1순위→후순위)를 기록한다. */
export async function reorderCandidates(
  slotId: string,
  orderedPositionIds: string[]
): Promise<SlotResult> {
  if (!hasSupabaseEnv()) return { ok: false, error: "서버 설정이 완료되지 않았습니다." };
  const auth = await requireManager();
  if (!auth.ok) return auth;
  if (!Array.isArray(orderedPositionIds) || orderedPositionIds.length === 0) {
    return { ok: false, error: "순서가 비어 있습니다." };
  }

  const supabase = createClient();
  // 대상 검증 — 이 세션의 후보만 (다른 세션·타 프로젝트 id 섞임 방지)
  const { data: rows } = await supabase
    .from("engagement_slot_positions")
    .select("id")
    .eq("slot_id", slotId);
  const valid = new Set((rows ?? []).map((r) => r.id));
  const ids = orderedPositionIds.filter((id) => valid.has(id));
  if (ids.length !== valid.size) {
    return { ok: false, error: "후보 목록이 갱신되었습니다. 새로고침 후 다시 시도하세요." };
  }

  for (let i = 0; i < ids.length; i++) {
    const id = ids[i];
    if (!id) continue;
    const { error } = await supabase
      .from("engagement_slot_positions")
      .update({ rank: i + 1 })
      .eq("id", id);
    if (error) return { ok: false, error: "순위 저장에 실패했습니다 (시스템 오류). 잠시 후 다시 시도해 주세요." };
  }

  // 순위는 발송 대상(상위 N)과 품의 금액에 영향을 준다 — 누가 언제 바꿨는지
  // 남긴다 (검수 B8: 무기록이었다)
  await supabase.from("audit_logs").insert({
    tenant_id: auth.tenantId,
    actor_auth_user_id: auth.userId,
    actor_role: auth.role,
    action: "candidate.reorder",
    resource_type: "engagement_slot",
    resource_id: slotId,
    after_data: { order: ids },
  });

  revalidatePath("/[tenantSlug]/projects/[projectId]", "page");
  return { ok: true };
}

/** 후보별 예정가 저장 — 예정가이며 결재·정산 전까지 수정할 수 있다. */
export async function setCandidateFee(
  positionId: string,
  fee: string
): Promise<SlotResult> {
  if (!hasSupabaseEnv()) return { ok: false, error: "서버 설정이 완료되지 않았습니다." };
  const auth = await requireManager();
  if (!auth.ok) return auth;
  if (!/^\d*$/.test(fee)) {
    return { ok: false, error: "예정가는 숫자만 입력하세요 (원 단위)." };
  }

  const supabase = createClient();
  const { error } = await supabase
    .from("engagement_slot_positions")
    .update({ expected_fee: fee ? parseInt(fee, 10) : null })
    .eq("id", positionId);
  if (error) return { ok: false, error: "예정가 저장에 실패했습니다 (시스템 오류). 잠시 후 다시 시도해 주세요." };

  revalidatePath("/[tenantSlug]/projects/[projectId]", "page");
  return { ok: true };
}
