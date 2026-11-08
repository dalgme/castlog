"use server";

import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireProjectTeam } from "@/lib/projects/team";
import { buildPublicLink } from "@/lib/routing/links";
import { ENGAGEMENT_EXPIRES_DAYS } from "@/lib/integrations/engagements";
import { formatKstDateTimeFull, roleTypeLabel } from "@/lib/integrations/engagement-roles";
import { loadSlotDates, scheduleFromRow, SLOT_SCHEDULE_COLUMNS } from "@/lib/integrations/slot-schedule";
import { describeSchedule } from "@/lib/sessions/schedule";
import { engagementFeeTerms, feeTermsFeeLine, feeTermsToText, type EngagementFeeTerms } from "@/lib/sessions/fees";
import { getProjectEngagementState, pickDispatchTargets } from "@/lib/integrations/project-engagement";
import {
  FEE_UNDECIDED_LINE,
  buildEngagementBundleSms,
  buildEngagementRequestSms,
  feeTermsLines,
} from "@/lib/integrations/engagement-sms";
import { portalUrl } from "@/lib/integrations/engagement-email";
import {
  composeAcceptanceLetterMail,
  composeEngagementBundleMail,
  composeEngagementRequestMail,
} from "@/lib/email/mail-templates";

/**
 * 발송 전 미리보기 (기획 지시 2026-11-08) — 섭외 요청·수락서 송부에서 **실제로 나갈 메일(HTML 강조)과
 * 문자를 그대로** 보여 준다. 실제 발송 경로와 같은 작성기(lib/email/mail-templates.ts ·
 * lib/integrations/engagement-sms.ts)를 쓰므로 본 것이 그대로 나간다. 저장·발송은 하지 않는다.
 * 전문가별 링크는 발송 시점에 생성되므로 자리표시 링크로 보인다.
 */

export type MessagePreviewSample = {
  expertName: string;
  email: string | null;
  phone: string | null;
  subject: string;
  text: string;
  html: string;
  sms: string | null;
  /** 이 전문가에게 가는 세션 수 (묶음이면 2 이상) */
  itemCount: number;
};

export type MessagePreviewResult =
  | { ok: true; samples: MessagePreviewSample[]; total: number; note: string | null }
  | { ok: false; error: string };

const PLACEHOLDER_TOKEN = "링크는-발송-시-전문가별로-생성됩니다";

function placeholderLink(kind: "engagementConsent" | "engagementBundle"): string {
  try {
    return buildPublicLink(kind, PLACEHOLDER_TOKEN);
  } catch {
    return `/${kind === "engagementBundle" ? "b" : "e"}/${PLACEHOLDER_TOKEN}`;
  }
}

const dispatchSchema = z.object({
  projectId: z.string().uuid(),
  slotIds: z.array(z.string().uuid()).max(200).optional(),
  positionIds: z.array(z.string().uuid()).max(200).optional(),
  programName: z.string().max(200).optional(),
  eventSummary: z.string().max(2000).optional(),
  memo: z.string().max(2000).optional(),
  deadline: z.string().max(40).optional(),
});

export async function previewEngagementMessages(input: z.infer<typeof dispatchSchema>): Promise<MessagePreviewResult> {
  const parsed = dispatchSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "입력값을 확인하세요 (시스템 결함). 화면을 새로고침한 뒤 다시 시도해 주세요." };
  const { projectId } = parsed.data;
  const gate = await requireProjectTeam(projectId, "exec:mailPreview");
  if (!gate.ok) return gate;

  const supabase = createClient();
  const admin = createAdminClient();
  const state = await getProjectEngagementState(projectId);
  const redispatch = state ? state.stage !== "plan_approved" : false;

  const { data: project } = await supabase.from("projects").select("name, description").eq("id", projectId).maybeSingle();
  const { data: tenant } = await supabase.from("tenants").select("name").eq("id", gate.actor.tenantId).maybeSingle();
  const tenantName = tenant?.name ?? "기업";

  const { data: allSlots } = await supabase
    .from("engagement_slots")
    .select(
      `id, slot_date, period_end_date, starts_time, ends_time, role_type, session_name, role_description, required_count, fee_amount, location_name, location_address, ${SLOT_SCHEDULE_COLUMNS}`
    )
    .eq("project_id", projectId);
  const slots = (allSlots ?? []).filter((s) => !parsed.data.slotIds || parsed.data.slotIds.length === 0 || parsed.data.slotIds.includes(s.id));
  const slotIds = slots.map((s) => s.id);
  if (slotIds.length === 0) return { ok: true, samples: [], total: 0, note: "대상 세션이 없습니다." };
  const [dates, { data: positions }] = await Promise.all([
    loadSlotDates(supabase, slotIds),
    supabase
      .from("engagement_slot_positions")
      .select("id, code, assigned_expert_id, status, slot_id, rank, position_no, expected_fee, unit_fee_online, unit_fee_offline")
      .in("slot_id", slotIds)
      .in("status", ["assigned", "requested", "filled", "open"]),
  ]);
  const onlyPositions = parsed.data.positionIds && parsed.data.positionIds.length > 0 ? new Set(parsed.data.positionIds) : null;

  type Target = NonNullable<typeof positions>[number];
  const targets: { position: Target; slot: (typeof slots)[number] }[] = [];
  for (const slot of slots) {
    const sorted = (positions ?? [])
      .filter((p) => p.slot_id === slot.id)
      .sort((a, b) => (a.rank ?? a.position_no) - (b.rank ?? b.position_no));
    const picked = onlyPositions
      ? sorted.filter((p) => onlyPositions.has(p.id) && (p.status === "assigned" || p.status === "open") && p.assigned_expert_id)
      : pickDispatchTargets(sorted, slot.required_count, redispatch);
    for (const p of picked) targets.push({ position: p, slot });
  }
  if (targets.length === 0) {
    return { ok: true, samples: [], total: 0, note: "지금 보낼 수 있는 배정 자리가 없습니다 — 세션마다 필요인원만큼 이미 요청·확정되었거나 배정이 비어 있습니다." };
  }

  const expertIds = Array.from(new Set(targets.map((t) => t.position.assigned_expert_id as string)));
  const { data: experts } = await admin.from("experts").select("id, name, email, phone").in("id", expertIds);
  const expertById = new Map((experts ?? []).map((e) => [e.id, e]));

  const expiresAtIso = (parsed.data.deadline
    ? new Date(parsed.data.deadline)
    : new Date(Date.now() + ENGAGEMENT_EXPIRES_DAYS * 24 * 60 * 60 * 1000)
  ).toISOString();
  const deadlineText = formatKstDateTimeFull(expiresAtIso);
  const programName = parsed.data.programName?.trim() || project?.name || null;

  const byExpert = new Map<string, typeof targets>();
  for (const t of targets) {
    const key = t.position.assigned_expert_id as string;
    const arr = byExpert.get(key) ?? [];
    arr.push(t);
    byExpert.set(key, arr);
  }

  const samples: MessagePreviewSample[] = [];
  for (const [expertId, group] of Array.from(byExpert.entries()).slice(0, 10)) {
    const expert = expertById.get(expertId);
    const expertName = expert?.name ?? "전문가";
    const detailed = group.map(({ position, slot }) => {
      const schedule = scheduleFromRow(slot, dates.get(slot.id) ?? []);
      const terms: EngagementFeeTerms = engagementFeeTerms(
        schedule,
        position.unit_fee_online ?? slot.unit_fee_online,
        position.unit_fee_offline ?? slot.unit_fee_offline,
        slot.role_type
      );
      return {
        position,
        slot,
        schedule,
        formal: describeSchedule(schedule, { withYear: true, withMeta: false, formal: true }),
        terms,
        termsText: feeTermsToText(terms),
        roleLabel: [roleTypeLabel(slot.role_type), slot.role_description].filter(Boolean).join(" · ") || null,
        legacyFee: position.expected_fee ?? slot.fee_amount,
      };
    });
    if (detailed.length === 1) {
      const d = detailed[0]!;
      const termsHaveFee = Boolean(feeTermsFeeLine(d.terms));
      const url = placeholderLink("engagementConsent");
      const mail = composeEngagementRequestMail({
        tenantName,
        expertName,
        programName,
        sessionName: d.slot.session_name,
        roleLabel: d.roleLabel,
        schedule: d.formal,
        termLines: d.termsText ? feeTermsLines(d.terms) : [],
        feeFallbackLine: termsHaveFee ? null : d.legacyFee ? `의뢰비용: ${d.legacyFee.toLocaleString("ko-KR")}원` : FEE_UNDECIDED_LINE,
        locationLine: d.slot.location_name ? `${d.slot.location_name}${d.slot.location_address ? ` (${d.slot.location_address})` : ""}` : null,
        eventSummary: parsed.data.eventSummary,
        specialNotes: parsed.data.memo,
        deadlineText,
        url,
      });
      samples.push({
        expertName,
        email: expert?.email ?? null,
        phone: expert?.phone ?? null,
        subject: mail.subject,
        text: mail.text,
        html: mail.html,
        sms: buildEngagementRequestSms({
          tenantName,
          programName,
          expertName,
          roleLabel: d.roleLabel,
          sessionName: d.slot.session_name,
          schedule: d.formal,
          terms: d.terms,
          locationName: d.slot.location_name,
          feeAmount: d.legacyFee,
          deadline: expiresAtIso,
          url,
        }),
        itemCount: 1,
      });
    } else {
      const url = placeholderLink("engagementBundle");
      const feeValues = detailed.map((d) => d.legacyFee).filter((v): v is number => v !== null);
      const mail = composeEngagementBundleMail({
        tenantName,
        expertName,
        programName,
        items: detailed.map((d) => ({
          sessionName: d.slot.session_name,
          schedule: d.formal,
          terms: d.termsText,
          location: d.slot.location_name,
          fee: d.legacyFee !== null ? `의뢰비용 ${d.legacyFee.toLocaleString("ko-KR")}원` : null,
        })),
        eventSummary: parsed.data.eventSummary,
        specialNotes: parsed.data.memo,
        deadlineText,
        url,
      });
      samples.push({
        expertName,
        email: expert?.email ?? null,
        phone: expert?.phone ?? null,
        subject: mail.subject,
        text: mail.text,
        html: mail.html,
        sms: buildEngagementBundleSms({
          tenantName,
          programName,
          itemCount: detailed.length,
          totalFee: feeValues.length > 0 ? feeValues.reduce((a, b) => a + b, 0) : null,
          items: detailed.map((d) => ({ name: d.slot.session_name, terms: d.termsText ? d.terms : null })),
          deadline: expiresAtIso,
          url,
        }),
        itemCount: detailed.length,
      });
    }
  }
  return {
    ok: true,
    samples,
    total: byExpert.size,
    note: byExpert.size > samples.length ? `전문가 ${byExpert.size}명 중 ${samples.length}명만 미리 보입니다.` : null,
  };
}

export async function previewAcceptanceMessages(projectId: string, memo?: string): Promise<MessagePreviewResult> {
  if (!z.string().uuid().safeParse(projectId).success) return { ok: false, error: "프로젝트를 확인하세요." };
  const gate = await requireProjectTeam(projectId, "exec:mailPreview");
  if (!gate.ok) return gate;
  const supabase = createClient();
  const admin = createAdminClient();
  const [{ data: project }, { data: tenant }, { data: slots }] = await Promise.all([
    supabase.from("projects").select("name").eq("id", projectId).maybeSingle(),
    supabase.from("tenants").select("name").eq("id", gate.actor.tenantId).maybeSingle(),
    supabase.from("engagement_slots").select("id").eq("project_id", projectId),
  ]);
  if (!project) return { ok: false, error: "프로젝트를 찾을 수 없습니다." };
  const tenantName = tenant?.name ?? "기업";
  const slotIds = (slots ?? []).map((s) => s.id);
  const [{ data: positions }, { data: loose }] = await Promise.all([
    slotIds.length
      ? supabase.from("engagement_slot_positions").select("engagement_id, expert_id").in("slot_id", slotIds).eq("status", "filled")
      : Promise.resolve({ data: [] as { engagement_id: string | null; expert_id: string | null }[] }),
    supabase.from("expert_engagements").select("id, expert_id").eq("project_id", projectId).eq("status", "accepted"),
  ]);
  const byEngagement = new Map<string, string>();
  for (const p of positions ?? []) if (p.engagement_id && p.expert_id) byEngagement.set(p.engagement_id, p.expert_id);
  for (const e of loose ?? []) if (!byEngagement.has(e.id)) byEngagement.set(e.id, e.expert_id);
  if (byEngagement.size === 0) return { ok: true, samples: [], total: 0, note: "송부할 수락 건이 없습니다." };
  const expertIds = Array.from(new Set(Array.from(byEngagement.values())));
  const { data: experts } = await admin.from("experts").select("id, name, email, phone").in("id", expertIds);
  const expertById = new Map((experts ?? []).map((e) => [e.id, e]));
  const samples: MessagePreviewSample[] = [];
  for (const [engagementId, expertId] of Array.from(byEngagement.entries()).slice(0, 10)) {
    const expert = expertById.get(expertId);
    const letterPath = `/expert/engagements/${engagementId}/acceptance`;
    const url = portalUrl(letterPath);
    const mail = composeAcceptanceLetterMail({ tenantName, expertName: expert?.name ?? null, projectName: project.name, memo, url });
    samples.push({
      expertName: expert?.name ?? "전문가",
      email: expert?.email ?? null,
      phone: expert?.phone ?? null,
      subject: mail.subject,
      text: mail.text,
      html: mail.html,
      sms: [`[${tenantName}] 수락서 도착`, project.name, memo?.trim() || null, "※ 아래 링크(전문가 포털)에서 수락서를 확인·승인해 주세요.", url]
        .filter(Boolean)
        .join("\n"),
      itemCount: 1,
    });
  }
  return {
    ok: true,
    samples,
    total: byEngagement.size,
    note: byEngagement.size > samples.length ? `${byEngagement.size}건 중 ${samples.length}건만 미리 보입니다.` : null,
  };
}
