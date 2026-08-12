"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { roleFromUser, tenantIdFromUser } from "@/lib/auth/tenant";
import { getTenantModules } from "@/lib/modules/server";
import {
  createApprovalWithSteps,
  matchApprovalRule,
} from "@/lib/approvals/engine";
import { formatKrw } from "@/lib/approvals/constants";
import {
  FUEL_TYPE_LABELS,
  computeFuelCost,
  fetchDrivingDistanceKm,
  fetchFuelPrice,
  isFuelType,
} from "@/lib/integrations/travel";

type Session = { userId: string; tenantId: string; role: string };

async function requireTravelSession(): Promise<
  { ok: true; session: Session } | { ok: false; error: string }
> {
  if (!hasSupabaseEnv()) {
    return { ok: false, error: "서버 설정이 완료되지 않았습니다." };
  }
  const modules = await getTenantModules();
  if (!modules.approvals) {
    return { ok: false, error: "전자결재 모듈이 비활성화된 테넌트입니다." };
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
  return { ok: true, session: { userId: user.id, tenantId, role } };
}

export type EstimateResult =
  | {
      ok: true;
      distanceKm: number | null;
      fuelPrice: number | null;
      source: string | null;
    }
  | { ok: false; error: string };

/** 자동 계산: 네이버 거리 + 오피넷 유가. 미설정 항목은 null(수동 입력). */
export async function estimateTravel(input: {
  origin?: string;
  destination?: string;
  fuelType: string;
}): Promise<EstimateResult> {
  const auth = await requireTravelSession();
  if (!auth.ok) return auth;

  const fuelType = isFuelType(input.fuelType) ? input.fuelType : "gasoline";

  const [distanceKm, fuelPrice] = await Promise.all([
    input.origin?.trim() && input.destination?.trim()
      ? fetchDrivingDistanceKm(input.origin.trim(), input.destination.trim())
      : Promise.resolve(null),
    fetchFuelPrice(fuelType),
  ]);

  const parts: string[] = [];
  if (distanceKm !== null) parts.push("naver");
  if (fuelPrice !== null) parts.push("opinet");
  return {
    ok: true,
    distanceKm,
    fuelPrice,
    source: parts.length > 0 ? parts.join("+") : null,
  };
}

const travelSubmitSchema = z.object({
  purpose: z.string().min(1, "출장 목적을 입력하세요.").max(200),
  travelDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .or(z.literal("")),
  origin: z.string().max(200).optional(),
  destination: z.string().max(200).optional(),
  roundTrip: z.boolean(),
  fuelType: z.string().min(1),
  distanceKm: z.number().int().min(0).max(100000),
  fuelPricePerL: z.number().int().min(0).max(100000),
  fuelEfficiencyKmpl: z
    .number({ invalid_type_error: "연비를 입력하세요." })
    .int()
    .min(1, "연비는 1 이상이어야 합니다.")
    .max(100),
  tollCost: z.number().int().min(0).max(100000000),
  otherCost: z.number().int().min(0).max(100000000),
  autoSource: z.string().max(40).optional(),
  note: z.string().max(1000).optional(),
});
export type TravelSubmitInput = z.infer<typeof travelSubmitSchema>;

export type TravelSubmitResult =
  | { ok: true }
  | { ok: false; error: string };

/** 출장품의 상신 — 유류비 계산 + 지출 품의(expense) 생성 + 전용 테이블 기록. */
export async function submitTravelRequest(
  input: TravelSubmitInput
): Promise<TravelSubmitResult> {
  const auth = await requireTravelSession();
  if (!auth.ok) return auth;
  const { session } = auth;

  const parsed = travelSubmitSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "입력값을 확인하세요." };
  }
  const d = parsed.data;
  if (!isFuelType(d.fuelType)) {
    return { ok: false, error: "연료 유형을 확인하세요." };
  }

  const fuelCost = computeFuelCost(
    d.distanceKm,
    d.roundTrip,
    d.fuelEfficiencyKmpl,
    d.fuelPricePerL
  );
  const total = fuelCost + d.tollCost + d.otherCost;

  const matched = await matchApprovalRule("expense", total);
  if (!matched) {
    return {
      ok: false,
      error:
        "지출 품의에 적용할 전결규정이 없습니다. 전결규정(유형: 지출 품의)을 등록한 뒤 다시 상신하세요.",
    };
  }

  const body = [
    `출장 목적: ${d.purpose}`,
    d.travelDate ? `출장일: ${d.travelDate}` : null,
    d.origin || d.destination
      ? `경로: ${d.origin ?? "?"} → ${d.destination ?? "?"}${d.roundTrip ? " (왕복)" : " (편도)"}`
      : null,
    `거리: ${d.distanceKm}km${d.roundTrip ? " × 왕복" : ""}`,
    `연료: ${FUEL_TYPE_LABELS[d.fuelType] ?? d.fuelType} · ${d.fuelPricePerL}원/L · ${d.fuelEfficiencyKmpl}km/L`,
    "",
    `유류비 ${formatKrw(fuelCost)} + 통행료 ${formatKrw(d.tollCost)} + 기타 ${formatKrw(d.otherCost)}`,
    `합계 ${formatKrw(total)}`,
    d.autoSource ? `(거리·유가 자동계산: ${d.autoSource})` : "(수동 입력)",
  ]
    .filter((v): v is string => v !== null)
    .join("\n");

  const created = await createApprovalWithSteps({
    tenantId: session.tenantId,
    requesterUserId: session.userId,
    title: `[출장품의] ${d.purpose}`,
    body,
    approvalType: "expense",
    amount: total,
    projectId: null,
    appliedRuleId: matched.ruleId,
    steps: matched.steps,
  });
  if (!created.ok) return created;

  const supabase = createClient();
  const { error: insertError } = await supabase.from("travel_requests").insert({
    tenant_id: session.tenantId,
    approval_id: created.approvalId,
    requester_user_id: session.userId,
    purpose: d.purpose,
    travel_date: d.travelDate || null,
    origin: d.origin?.trim() || null,
    destination: d.destination?.trim() || null,
    round_trip: d.roundTrip,
    distance_km: d.distanceKm,
    fuel_type: d.fuelType,
    fuel_price_per_l: d.fuelPricePerL,
    fuel_efficiency_kmpl: d.fuelEfficiencyKmpl,
    fuel_cost: fuelCost,
    toll_cost: d.tollCost,
    other_cost: d.otherCost,
    total_cost: total,
    auto_source: d.autoSource || null,
    note: d.note?.trim() || null,
  });
  if (insertError) {
    return {
      ok: false,
      error: "출장 내역 저장에 실패했습니다 (품의는 상신됨). 관리자에게 문의하세요.",
    };
  }

  await supabase.from("audit_logs").insert({
    tenant_id: session.tenantId,
    actor_auth_user_id: session.userId,
    actor_role: session.role,
    action: "travel_request.submit",
    resource_type: "travel_request",
    resource_id: created.approvalId,
    after_data: { total, auto_source: d.autoSource ?? null },
  });

  revalidatePath("/[tenantSlug]/approvals/travel", "page");
  return { ok: true };
}
