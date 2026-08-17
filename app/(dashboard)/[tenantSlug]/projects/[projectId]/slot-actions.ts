"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { roleFromUser, tenantIdFromUser } from "@/lib/auth/tenant";
import { buildSlotCode } from "@/lib/integrations/slot-codes";

export type SlotResult = { ok: true } | { ok: false; error: string };

const MANAGER_ROLES = ["org_admin", "manager"];

async function requireManager(): Promise<
  { ok: true; userId: string; tenantId: string } | { ok: false; error: string }
> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const tenantId = tenantIdFromUser(user);
  const role = roleFromUser(user);
  if (!user || !tenantId || !role || !MANAGER_ROLES.includes(role)) {
    return { ok: false, error: "섭외 테이블 편집 권한이 없습니다(관리자 이상)." };
  }
  return { ok: true, userId: user.id, tenantId };
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
    roleDescription: z.string().trim().max(100).optional(),
    requiredCount: z.number().int().min(1, "필요 인원은 1명 이상").max(100),
    feeAmount: z.string().regex(/^\d*$/, "비용은 숫자만 입력하세요.").optional(),
    locationName: z.string().trim().max(150).optional(),
    locationAddress: z.string().trim().max(200).optional(),
    notes: z.string().trim().max(500).optional(),
  })
  .refine(
    (v) => !v.startsTime || !v.endsTime || v.startsTime < v.endsTime,
    { message: "종료 시각은 시작 시각 이후여야 합니다.", path: ["endsTime"] }
  );

/**
 * 타임테이블 슬롯 생성 + 필요인원만큼 넘버링코드 자동 부여.
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
      role_description: d.roleDescription || null,
      required_count: d.requiredCount,
      fee_amount: d.feeAmount ? parseInt(d.feeAmount, 10) : null,
      location_name: d.locationName || null,
      location_address: d.locationAddress || null,
      notes: d.notes || null,
      created_by: auth.userId,
    })
    .select("id")
    .single();
  if (error || !slot) return { ok: false, error: "슬롯 생성에 실패했습니다." };

  const positionError = await createPositions(
    supabase,
    auth.tenantId,
    slot.id,
    d.slotDate,
    d.roleType,
    1,
    d.requiredCount
  );
  if (positionError) {
    await supabase.from("engagement_slots").delete().eq("id", slot.id);
    return { ok: false, error: positionError };
  }

  revalidatePath("/[tenantSlug]/projects/[projectId]", "page");
  return { ok: true };
}

/** 넘버링코드 부여 — 충돌 시 짧은 접미사로 재시도(테넌트 내 유일). */
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
        code,
      });
      if (!error) inserted = true;
      else if (error.code !== "23505") return "넘버링코드 생성에 실패했습니다.";
    }
    if (!inserted) return "넘버링코드가 중복되어 생성하지 못했습니다.";
  }
  return null;
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
  if (error) return { ok: false, error: "삭제에 실패했습니다." };

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
    .select("id, slot_date, role_type, required_count")
    .eq("id", slotId)
    .maybeSingle();
  if (!slot) return { ok: false, error: "슬롯을 찾을 수 없습니다." };

  const current = slot.required_count;
  if (nextCount > current) {
    const err = await createPositions(
      supabase,
      auth.tenantId,
      slotId,
      slot.slot_date,
      slot.role_type,
      current + 1,
      nextCount
    );
    if (err) return { ok: false, error: err };
  } else if (nextCount < current) {
    // 미섭외(open) 인원만 제거 — 요청·확정 인원은 보존
    const { data: removable } = await supabase
      .from("engagement_slot_positions")
      .select("id, position_no")
      .eq("slot_id", slotId)
      .eq("status", "open")
      .gt("position_no", nextCount)
      .order("position_no", { ascending: false });
    const ids = (removable ?? []).map((r) => r.id);
    if (ids.length < current - nextCount) {
      return {
        ok: false,
        error: "섭외가 진행된 인원이 있어 그만큼 줄일 수 없습니다.",
      };
    }
    if (ids.length > 0) {
      await supabase.from("engagement_slot_positions").delete().in("id", ids);
    }
  }

  const { error } = await supabase
    .from("engagement_slots")
    .update({ required_count: nextCount })
    .eq("id", slotId);
  if (error) return { ok: false, error: "인원 변경에 실패했습니다." };

  revalidatePath("/[tenantSlug]/projects/[projectId]", "page");
  return { ok: true };
}
