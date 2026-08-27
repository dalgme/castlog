import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { generateLinkToken, hashLinkToken } from "@/lib/auth/tokens";
import { buildSlotCode } from "@/lib/integrations/slot-codes";
import { ensurePracticeAcceptance } from "@/lib/integrations/acceptance";

/**
 * 연습 환경 시드 — 연습모드 최초 진입 시 1회 구축한다 (멱등).
 *
 * 무엇을 만드는가 (테넌트당):
 *  - 가상 전문가 5명 (experts.is_practice = true, 자사와 active 연결)
 *  - 완료 프로젝트 1개: 지난달 3세션 × 5명 = 전문가별 **과거 완료 3건**
 *  - 진행 프로젝트 1개: 이번 주 일요일까지
 *      · 확정 세션 8개 × 5명 = 전문가별 **섭외 승인 8건**
 *      · 빈 슬롯 3개(미섭외) — 후보군 고르기·섭외요청을 연습하는 자리
 *  - 가상 타사(peer) 테넌트에서 각 전문가에게 **섭외 중 3건**.
 *    빈 슬롯 3개와 날짜를 맞춰 두었으므로, 그 슬롯의 후보군을 열면
 *    "해당 일정과 중복되어 섭외 진행 중 1건"이 실제로 뜬다.
 *  - 자사 '요청중' 건 2건(전화 섭외 실습) — 수동 '섭외 완료(수락서 생성)'
 *    버튼·섭외 이력 버튼을 눌러 보는 자리. 소진하면 다음 진입 때 보충된다.
 *  - 섭외 이력(engagement_events) 백필 — 이력 없는 연습 건에 요청·동의 기록.
 *
 * 왜 타사 건을 따로 만드는가: 중복 경고의 핵심은 '다른 회사가 먼저 요청해 둔
 * 상태'다. 자사 건으로는 그 상황이 재현되지 않는다. peer 테넌트는 status를
 * suspended로 두어 아무도 로그인할 수 없다.
 *
 * 실데이터 오염 위험: 없다. 모든 행이 is_practice = true이고, DB 트리거가
 * 연습/실제를 섞는 INSERT를 거부한다 (20260818000001_practice_mode.sql).
 */

/**
 * 가상 전문가 명단 — 실존 인물과 겹치지 않도록 흔치 않은 이름 조합을 쓴다.
 *
 * paymentType(소득유형)을 사람마다 섞어 둔다. 실제 현장이 그렇기 때문이다 —
 * 같은 프로젝트 안에서도 어떤 분은 기타소득(8.8%), 어떤 분은 사업소득(3.3%)으로
 * 원천징수된다. 연습에서 한 가지 유형만 나오면 지급 화면의 핵심인 '유형에 따라
 * 실지급액이 달라진다'를 아예 볼 수 없다.
 *
 * 무작위가 아니라 **사람별로 고정**한다. 들어갈 때마다 값이 바뀌면 어제 본 금액과
 * 오늘 본 금액이 달라져 연습이 오히려 헷갈린다.
 */
const PRACTICE_EXPERTS = [
  {
    name: "가온 강사",
    specialty: "사업계획서·IR",
    region: "서울",
    careerYears: 12,
    bio: "연습용 가상 전문가입니다. 실존 인물이 아닙니다.",
    paymentType: "other_income",
    organization: "(연습) 가온대학교",
    jobTitle: "교수",
  },
  {
    name: "나래 멘토",
    specialty: "마케팅·브랜딩",
    region: "경기",
    careerYears: 8,
    bio: "연습용 가상 전문가입니다. 실존 인물이 아닙니다.",
    paymentType: "business_income",
    organization: "(연습) 나래브랜딩",
    jobTitle: "대표",
  },
  {
    name: "다올 심사",
    specialty: "재무·회계",
    region: "부산",
    careerYears: 15,
    bio: "연습용 가상 전문가입니다. 실존 인물이 아닙니다.",
    paymentType: "other_income",
    organization: "(연습) 다올회계법인",
    jobTitle: "회계사",
  },
  {
    name: "라온 진행",
    specialty: "행사 진행·MC",
    region: "서울",
    careerYears: 6,
    bio: "연습용 가상 전문가입니다. 실존 인물이 아닙니다.",
    paymentType: "business_income",
    organization: "(연습) 라온이벤트",
    jobTitle: "실장",
  },
  {
    name: "마루 컨설턴트",
    specialty: "기술창업·특허",
    region: "대전",
    careerYears: 10,
    bio: "연습용 가상 전문가입니다. 실존 인물이 아닙니다.",
    paymentType: "other_income",
    organization: "(연습) 마루기술컨설팅",
    jobTitle: "수석 컨설턴트",
  },
] as const;

const PEER_TENANT_SLUG = "castlog-practice-peer";
const PEER_TENANT_NAME = "(연습용 가상 기업)";

const COMPLETED_PROJECT_NAME = "[연습] 지난 분기 창업 아카데미";
const ACTIVE_PROJECT_NAME = "[연습] 예비창업패키지 교육·멘토링";
const CLOSING_PROJECT_NAME = "[연습] 상반기 창업캠프 — 종료·지급 실습";

/** YYYY-MM-DD (KST 기준). Date의 UTC 밀림을 피하려고 직접 만든다. */
function ymd(d: Date): string {
  const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10);
}

function addDays(d: Date, days: number): Date {
  return new Date(d.getTime() + days * 24 * 60 * 60 * 1000);
}

/**
 * 오늘부터 이번 주 일요일까지의 날짜 목록 (KST).
 * "섭외 승인된 건은 모두 이번주 일요일 안에 수행" 요구를 지키기 위한 축이다.
 */
function daysUntilSunday(now: Date): string[] {
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const dow = kst.getUTCDay(); // 0=일요일
  const untilSunday = dow === 0 ? 0 : 7 - dow;
  const out: string[] = [];
  for (let i = 0; i <= untilSunday; i++) out.push(ymd(addDays(now, i)));
  return out;
}

/** 테넌트별 고정 가상 번호 — 실번호와 겹치면 unique 제약에 걸리므로 자리를 바꿔 재시도한다. */
function practicePhone(tenantId: string, index: number, attempt: number): string {
  const digits = tenantId.replace(/\D/g, "").padStart(6, "0");
  const seed = digits.slice(-5);
  return `+8210${(70 + attempt) % 100}${seed}${index}`;
}

type Admin = ReturnType<typeof createAdminClient>;

async function ensurePeerTenant(admin: Admin): Promise<string | null> {
  const { data: existing } = await admin
    .from("tenants")
    .select("id")
    .eq("slug", PEER_TENANT_SLUG)
    .maybeSingle();
  if (existing) return existing.id;

  const { data: created } = await admin
    .from("tenants")
    .insert({
      slug: PEER_TENANT_SLUG,
      name: PEER_TENANT_NAME,
      // 아무도 로그인할 수 없어야 한다 — 계정을 만들지 않고 상태도 중지로 둔다.
      status: "suspended",
      plan_name: "practice-fixture",
      feature_flags: { modules: { experts: true, approvals: false, operations: false } },
    })
    .select("id")
    .maybeSingle();
  return created?.id ?? null;
}

async function ensureExperts(
  admin: Admin,
  tenantId: string
): Promise<{ id: string; name: string }[]> {
  // 이미 연결된 연습 전문가가 있으면 그대로 쓴다(멱등).
  const { data: links } = await admin
    .from("expert_tenant_links")
    .select("expert_id, experts (id, name, is_practice)")
    .eq("tenant_id", tenantId)
    .eq("is_practice", true);

  const found = (links ?? [])
    .map((l) => l.experts)
    .filter((e): e is NonNullable<typeof e> => e !== null)
    .map((e) => ({ id: e.id, name: e.name }));
  if (found.length >= PRACTICE_EXPERTS.length) return found;

  const created: { id: string; name: string }[] = [...found];
  const existingNames = new Set(found.map((e) => e.name));

  for (let i = 0; i < PRACTICE_EXPERTS.length; i++) {
    const spec = PRACTICE_EXPERTS[i];
    if (!spec || existingNames.has(spec.name)) continue;

    let expertId: string | null = null;
    for (let attempt = 0; attempt < 20 && !expertId; attempt++) {
      const { data, error } = await admin
        .from("experts")
        .insert({
          name: spec.name,
          phone: practicePhone(tenantId, i, attempt),
          email: null,
          specialty: spec.specialty,
          region: spec.region,
          career_years: spec.careerYears,
          bio: spec.bio,
          organization: spec.organization,
          job_title: spec.jobTitle,
          is_practice: true,
        })
        .select("id")
        .maybeSingle();
      if (data) expertId = data.id;
      else if (error && error.code !== "23505") break; // 중복 외 오류는 재시도 의미 없음
    }
    if (!expertId) continue;

    await admin.from("expert_tenant_links").insert({
      expert_id: expertId,
      tenant_id: tenantId,
      status: "active",
      accepted_at: new Date().toISOString(),
      is_practice: true,
    });
    created.push({ id: expertId, name: spec.name });
  }

  return created;
}

/**
 * 소속·직위 백필 — 프로필 항목이 늘어난 뒤(2026-08-23 소속/직위 추가) 먼저
 * 시드된 연습 전문가는 그 칸이 비어 있다. 목록·상세에서 빈 칸만 보이면
 * 새 항목이 있다는 것 자체를 연습에서 알 수 없으므로 채워 둔다 (멱등 —
 * 값이 이미 있으면 존중한다).
 */
async function backfillExpertProfiles(
  admin: Admin,
  experts: { id: string; name: string }[]
): Promise<void> {
  const specByName = new Map<string, (typeof PRACTICE_EXPERTS)[number]>(
    PRACTICE_EXPERTS.map((e) => [e.name, e])
  );
  const { data: rows } = await admin
    .from("experts")
    .select("id, name, organization, job_title")
    .in(
      "id",
      experts.map((e) => e.id)
    );
  for (const row of rows ?? []) {
    const spec = specByName.get(row.name);
    if (!spec) continue;
    const patch: { organization?: string; job_title?: string } = {};
    if (!row.organization) patch.organization = spec.organization;
    if (!row.job_title) patch.job_title = spec.jobTitle;
    if (Object.keys(patch).length > 0) {
      await admin.from("experts").update(patch).eq("id", row.id);
    }
  }
}

/**
 * 소득유형(세무 프로필) 보장 — 지급 화면이 원천징수·실지급액을 계산하려면
 * expert_tax_profiles.payment_type이 있어야 한다. 없으면 지급 대상 목록에서
 * '소득유형 미설정'으로 뜨고 금액 칸이 전부 '-'가 되어, 연습에서 지급 단계를
 * 아예 볼 수 없다.
 *
 * 이미 시드된 연습 환경에도 붙도록 진입할 때마다 채운다(멱등 — 이미 값이 있으면
 * 건드리지 않는다. 연습 중에 전문가가 유형을 바꿔 봤다면 그 선택을 존중한다).
 *
 * 사업자(business)는 넣지 않는다. 원천징수가 없어 실지급액 = 총비용이라
 * 연습으로 볼 것이 없고, 세금계산서 수취라는 별개 절차가 따라붙는다.
 */
async function ensureTaxProfiles(
  admin: Admin,
  experts: { id: string; name: string }[]
): Promise<void> {
  const typeByName = new Map<string, string>(
    PRACTICE_EXPERTS.map((e) => [e.name, e.paymentType])
  );

  const { data: existing } = await admin
    .from("expert_tax_profiles")
    .select("expert_id, payment_type")
    .in(
      "expert_id",
      experts.map((e) => e.id)
    );
  const hasType = new Set(
    (existing ?? []).filter((p) => p.payment_type).map((p) => p.expert_id)
  );
  const hasRow = new Set((existing ?? []).map((p) => p.expert_id));

  for (const expert of experts) {
    if (hasType.has(expert.id)) continue;
    // 명단에 없는 이름(직접 만든 연습 전문가)은 기타소득으로 둔다 — 강사·멘토
    // 단발 지급에서 가장 흔한 유형이다.
    const paymentType = typeByName.get(expert.name) ?? "other_income";

    if (hasRow.has(expert.id)) {
      await admin
        .from("expert_tax_profiles")
        .update({ payment_type: paymentType })
        .eq("expert_id", expert.id);
    } else {
      await admin
        .from("expert_tax_profiles")
        .insert({ expert_id: expert.id, payment_type: paymentType });
    }
  }
}

/**
 * 수락서가 없는 연습 확정 건을 채운다 (멱등).
 *
 * 연습 확정 건은 수락서가 있어야 '수락서 보기'가 열린다. 열람 시점 자동 생성
 * 경로도 있지만, 그 경로는 한 건씩만 고치고 실패하면 화면이 비어 보인다.
 * 연습모드에 들어올 때 한 번에 채워 두는 편이 확실하다.
 */
async function backfillPracticeAcceptances(
  admin: Admin,
  tenantId: string
): Promise<void> {
  const { data: accepted } = await admin
    .from("expert_engagements")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("is_practice", true)
    .eq("status", "accepted");
  if (!accepted || accepted.length === 0) return;

  const { data: existing } = await admin
    .from("engagement_acceptances")
    .select("engagement_id")
    .in(
      "engagement_id",
      accepted.map((e) => e.id)
    );
  const have = new Set((existing ?? []).map((a) => a.engagement_id));

  for (const engagement of accepted) {
    if (have.has(engagement.id)) continue;
    await ensurePracticeAcceptance(engagement.id);
  }
}

type SlotSpec = {
  date: string;
  startsTime: string;
  endsTime: string;
  sessionName: string;
  roleType: string;
  roleDescription: string;
  fee: number;
};

async function createProject(
  admin: Admin,
  tenantId: string,
  name: string,
  status: "completed" | "active",
  startsOn: string,
  endsOn: string
): Promise<string | null> {
  const { data: existing } = await admin
    .from("projects")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("name", name)
    .eq("is_practice", true)
    .maybeSingle();
  if (existing) return existing.id;

  const { data } = await admin
    .from("projects")
    .insert({
      tenant_id: tenantId,
      name,
      business_year: Number(startsOn.slice(0, 4)),
      client_name: "(연습용 가상 발주처)",
      status,
      starts_on: startsOn,
      ends_on: endsOn,
      description:
        "연습모드 전용 가상 프로젝트입니다. 실제 사업이 아니며 통계에 잡히지 않습니다.",
      is_practice: true,
    })
    .select("id")
    .maybeSingle();
  return data?.id ?? null;
}

/** 슬롯 + 넘버링코드 생성. fillWith가 있으면 그 전문가들로 확정까지 만든다. */
async function createSlot(
  admin: Admin,
  tenantId: string,
  projectId: string,
  spec: SlotSpec,
  fillWith: { id: string; name: string }[]
): Promise<void> {
  const requiredCount = Math.max(1, fillWith.length);

  const { data: slot } = await admin
    .from("engagement_slots")
    .insert({
      tenant_id: tenantId,
      project_id: projectId,
      slot_date: spec.date,
      starts_time: spec.startsTime,
      ends_time: spec.endsTime,
      session_name: spec.sessionName,
      role_type: spec.roleType,
      role_description: spec.roleDescription,
      required_count: requiredCount,
      fee_amount: spec.fee,
      location_name: "(연습) 창업지원센터 대강당",
      location_address: "서울특별시 중구 세종대로 110",
    })
    .select("id")
    .maybeSingle();
  if (!slot) return;

  for (let n = 1; n <= requiredCount; n++) {
    const expert = fillWith[n - 1];
    const code = buildSlotCode(spec.date, spec.roleType, n, slot.id.slice(0, 4));

    let engagementId: string | null = null;
    if (expert) {
      const token = generateLinkToken();
      const { data: engagement } = await admin
        .from("expert_engagements")
        .insert({
          tenant_id: tenantId,
          expert_id: expert.id,
          project_id: projectId,
          role_description: spec.roleDescription,
          role_type: spec.roleType,
          program_name: "(연습) 예비창업패키지",
          session_name: spec.sessionName,
          position_code: code,
          starts_on: spec.date,
          ends_on: spec.date,
          starts_time: spec.startsTime,
          ends_time: spec.endsTime,
          location_name: "(연습) 창업지원센터 대강당",
          location_address: "서울특별시 중구 세종대로 110",
          fee_amount: spec.fee,
          status: "accepted",
          responded_at: new Date().toISOString(),
          token_hash: hashLinkToken(token),
          token_expires_at: new Date(Date.now() + 30 * 86400_000).toISOString(),
          is_practice: true,
        })
        .select("id")
        .maybeSingle();
      engagementId = engagement?.id ?? null;
      // 확정 건에는 수락서가 있어야 한다 — 연습에서도 '수락서 보기'가 열려야 하므로
      // 가상 수락서를 함께 만든다.
      if (engagementId) await ensurePracticeAcceptance(engagementId);
    }

    await admin.from("engagement_slot_positions").insert({
      tenant_id: tenantId,
      slot_id: slot.id,
      position_no: n,
      code,
      status: engagementId ? "filled" : "open",
      engagement_id: engagementId,
      expert_id: engagementId ? expert?.id ?? null : null,
    });
  }
}

/** 가상 타사에서 보낸 '아직 수락 전' 섭외요청 — 중복 경고 데모용. */
async function createPeerPendingEngagements(
  admin: Admin,
  peerTenantId: string,
  experts: { id: string; name: string }[],
  dates: string[]
): Promise<void> {
  for (const expert of experts) {
    for (const date of dates) {
      const token = generateLinkToken();
      await admin.from("expert_engagements").insert({
        tenant_id: peerTenantId,
        expert_id: expert.id,
        project_id: null,
        role_description: "특강",
        role_type: "lecturer",
        starts_on: date,
        ends_on: date,
        status: "requested",
        token_hash: hashLinkToken(token),
        token_expires_at: new Date(Date.now() + 7 * 86400_000).toISOString(),
        is_practice: true,
      });
    }
  }
}

export type SeedResult =
  | { ok: true; created: boolean; experts: number }
  | { ok: false; error: string };

/**
 * 연습 환경을 보장한다. 이미 있으면 아무것도 만들지 않는다.
 * service_role로 실행되므로 RLS를 우회하지만, is_practice를 명시하므로
 * 무결성 트리거가 실데이터와의 혼입을 막는다.
 */
/**
 * 종료·지급 실습용 프로젝트 (멱등).
 *
 * 마감 탭(참여율·만족도·지급 품의)을 실제로 눌러 보려면 '전원 확정'까지 온
 * 프로젝트가 하나 있어야 한다. 진행 프로젝트는 후보 고르기 연습을 위해 빈
 * 자리를 일부러 남겨 두므로 그 역할을 못 한다.
 *
 * **이미 만들어진 연습 환경에도 붙어야 한다.** 새 환경에서만 만들면 먼저
 * 시드된 회사는 마감 연습을 영영 못 한다 (수락서 404와 같은 실수).
 */
async function ensureClosingPracticeProject(
  admin: Admin,
  tenantId: string,
  experts: { id: string; name: string }[],
  now: Date
): Promise<void> {
  const closingId = await createProject(
    admin,
    tenantId,
    CLOSING_PROJECT_NAME,
    "active",
    ymd(addDays(now, -20)),
    ymd(addDays(now, -5))
  );
  if (!closingId) return;

  const { count } = await admin
    .from("engagement_slots")
    .select("id", { count: "exact", head: true })
    .eq("project_id", closingId);
  if ((count ?? 0) === 0) {
    const closingSessions: SlotSpec[] = [
      {
        date: ymd(addDays(now, -18)),
        startsTime: "10:00",
        endsTime: "12:00",
        sessionName: "1일차 · 아이디어 워크숍",
        roleType: "lecturer",
        roleDescription: "강사",
        fee: 350000,
      },
      {
        date: ymd(addDays(now, -12)),
        startsTime: "13:00",
        endsTime: "17:00",
        sessionName: "2일차 · 팀별 멘토링",
        roleType: "mentor",
        roleDescription: "멘토",
        fee: 400000,
      },
      {
        date: ymd(addDays(now, -6)),
        startsTime: "14:00",
        endsTime: "17:00",
        sessionName: "3일차 · 데모데이 심사",
        roleType: "judge",
        roleDescription: "심사위원",
        fee: 300000,
      },
    ];
    for (const spec of closingSessions) {
      await createSlot(admin, tenantId, closingId, spec, experts);
    }
  }

  // 이미 마감을 진행한 뒤라면 되돌리지 않는다
  const { data: project } = await admin
    .from("projects")
    .select("engagement_stage")
    .eq("id", closingId)
    .maybeSingle();
  if (!project?.engagement_stage || project.engagement_stage === "assigning") {
    await admin
      .from("projects")
      .update({ engagement_stage: "confirmed" })
      .eq("id", closingId);
  }
}

/** 먼저 시드된 연습 환경의 단계 값을 실제 모습에 맞춘다 (멱등). */
async function backfillPracticeStages(
  admin: Admin,
  tenantId: string
): Promise<void> {
  const targets: [string, string][] = [
    [COMPLETED_PROJECT_NAME, "settled"],
    [ACTIVE_PROJECT_NAME, "requesting"],
  ];
  for (const [name, stage] of targets) {
    const { data: project } = await admin
      .from("projects")
      .select("id, engagement_stage")
      .eq("tenant_id", tenantId)
      .eq("is_practice", true)
      .eq("name", name)
      .maybeSingle();
    if (!project) continue;
    if (project.engagement_stage && project.engagement_stage !== "assigning") {
      continue;
    }
    await admin
      .from("projects")
      .update({ engagement_stage: stage })
      .eq("id", project.id);
  }
}

/** 수기(전화) 섭외 연습용 마커 — 이 이름의 건은 시드가 만든 '요청중' 건이다. */
const MANUAL_PRACTICE_PROGRAM = "(연습) 전화 섭외 실습";

/**
 * 자사 '요청중' 섭외 건 보장 — 수동 '섭외 완료(수락서 생성)' 버튼과 섭외
 * 이력 버튼(2026-08-23 추가)을 눌러 볼 자사 소유의 회신 대기 건이 없으면
 * 연습에서 그 기능이 존재하지 않는 것과 같다 (타사 peer 건은 자사 화면에
 * 뜨지 않는다).
 *
 * 보충형 멱등: 연습자가 완료·회수 처리로 소진하면 다음 진입 때 2건까지
 * 다시 채운다. 다만 마커 건 총량이 10건을 넘으면 더 만들지 않는다 —
 * 처리하지 않고 드나들기만 하는 환경에서 무한히 쌓이는 것을 막는다.
 */
async function ensureManualPracticeEngagements(
  admin: Admin,
  tenantId: string,
  experts: { id: string; name: string }[],
  now: Date
): Promise<void> {
  const { data: activeProject } = await admin
    .from("projects")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("is_practice", true)
    .eq("name", ACTIVE_PROJECT_NAME)
    .maybeSingle();
  // 프로젝트 없이 만든 건은 열람 범위(RLS)상 담당자에게 보이지 않는다 —
  // 붙일 프로젝트가 아직 없으면 만들지 않는다 (다음 진입 때 만들어진다).
  if (!activeProject) return;

  const { data: markers } = await admin
    .from("expert_engagements")
    .select("id, status, expert_id, project_id")
    .eq("tenant_id", tenantId)
    .eq("is_practice", true)
    .eq("program_name", MANUAL_PRACTICE_PROGRAM);

  // 자가 복구 — 프로젝트 생성 전에 만들어져 미연결로 남은 건을 붙인다
  // (양쪽 다 연습 데이터라 혼입 트리거에 걸리지 않는다)
  const orphans = (markers ?? []).filter((m) => m.project_id === null);
  for (const orphan of orphans) {
    await admin
      .from("expert_engagements")
      .update({ project_id: activeProject.id })
      .eq("id", orphan.id);
  }

  const total = (markers ?? []).length;
  const open = (markers ?? []).filter((m) => m.status === "requested").length;
  if (open >= 2 || total >= 10) return;

  // 이미 회신 대기 마커를 들고 있는 전문가는 제외 — 같은 사람에게 실습 요청이
  // 두 건 겹치면 화면이 이상해 보인다. 전원이 보유 중이면 앞사람부터 재사용.
  const holding = new Set(
    (markers ?? [])
      .filter((m) => m.status === "requested")
      .map((m) => m.expert_id)
  );
  const pool = experts.filter((e) => !holding.has(e.id));
  const targets = (pool.length > 0 ? pool : experts).slice(0, 2 - open);
  for (let i = 0; i < targets.length; i++) {
    const expert = targets[i];
    if (!expert) continue;
    const date = ymd(addDays(now, 3 + i));
    const token = generateLinkToken();
    const { data: engagement } = await admin
      .from("expert_engagements")
      .insert({
        tenant_id: tenantId,
        expert_id: expert.id,
        project_id: activeProject.id,
        program_name: MANUAL_PRACTICE_PROGRAM,
        role_description: "특강",
        role_type: "lecturer",
        starts_on: date,
        ends_on: date,
        starts_time: "10:00",
        ends_time: "12:00",
        fee_amount: 300000,
        status: "requested",
        token_hash: hashLinkToken(token),
        token_expires_at: new Date(Date.now() + 30 * 86400_000).toISOString(),
        is_practice: true,
      })
      .select("id")
      .maybeSingle();
    // 이력 버튼이 비어 보이지 않게 — 요청 시작 이벤트를 함께 남긴다
    if (engagement) {
      await admin.from("engagement_events").insert({
        tenant_id: tenantId,
        engagement_id: engagement.id,
        event_type: "requested",
        actor_kind: "staff",
        actor_label: "(연습) 담당자",
        note: "전화로 섭외를 진행한 뒤 '섭외 완료(수락서 생성)' 버튼으로 확정해 보세요.",
        is_practice: true,
      });
    }
  }
}

/**
 * 섭외 이력 백필 — 이력 로그(engagement_events, 2026-08-23 도입) 이전에
 * 시드된 연습 건은 이력 버튼을 눌러도 "기록된 이력이 없습니다"만 나온다.
 * 기능이 있는데 보이지 않으면 없는 것과 같으므로, 이벤트가 하나도 없는
 * 연습 건에 요청·동의 이력을 만들어 준다 (멱등 — 있으면 건드리지 않는다).
 */
async function backfillPracticeEngagementEvents(
  admin: Admin,
  tenantId: string
): Promise<void> {
  const { data: engagements } = await admin
    .from("expert_engagements")
    .select("id, status, created_at, responded_at, experts (name)")
    .eq("tenant_id", tenantId)
    .eq("is_practice", true)
    .in("status", ["requested", "accepted"]);
  if (!engagements || engagements.length === 0) return;

  const { data: existing } = await admin
    .from("engagement_events")
    .select("engagement_id")
    .in(
      "engagement_id",
      engagements.map((e) => e.id)
    );
  const have = new Set((existing ?? []).map((e) => e.engagement_id));

  for (const eng of engagements) {
    if (have.has(eng.id)) continue;
    const requestedAt = eng.created_at ?? new Date().toISOString();
    await admin.from("engagement_events").insert({
      tenant_id: tenantId,
      engagement_id: eng.id,
      event_type: "requested",
      actor_kind: "staff",
      actor_label: "(연습) 담당자",
      is_practice: true,
      created_at: requestedAt,
    });
    if (eng.status === "accepted") {
      await admin.from("engagement_events").insert({
        tenant_id: tenantId,
        engagement_id: eng.id,
        event_type: "accepted",
        actor_kind: "expert",
        actor_label: eng.experts?.name ?? "전문가",
        is_practice: true,
        created_at: eng.responded_at ?? requestedAt,
      });
    }
  }
}

export async function ensurePracticeEnvironment(
  tenantId: string
): Promise<SeedResult> {
  const admin = createAdminClient();

  // 이미 진행 프로젝트가 있으면 구축 완료로 본다.
  const { data: already } = await admin
    .from("projects")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("is_practice", true)
    .eq("name", ACTIVE_PROJECT_NAME)
    .maybeSingle();

  const experts = await ensureExperts(admin, tenantId);
  if (experts.length === 0) {
    return { ok: false, error: "연습용 전문가를 만들지 못했습니다." };
  }
  // 소득유형·수락서는 **이미 만들어진** 연습 환경에도 붙어야 하므로
  // 조기 반환보다 앞에 둔다. createSlot 안에서만 만들면 새 환경만 채워지고,
  // 먼저 시드된 환경은 영영 비어 있다 (수락서 404의 원인이었다).
  await ensureTaxProfiles(admin, experts);
  await backfillExpertProfiles(admin, experts);
  await backfillPracticeAcceptances(admin, tenantId);
  await backfillPracticeStages(admin, tenantId);
  await ensureClosingPracticeProject(admin, tenantId, experts, new Date());
  if (already) {
    // 이력 로그·수동 완료(2026-08-23) 연습 대상 — 기존 환경에도 붙는다.
    // 신규 환경은 프로젝트·섭외 건이 아래에서 만들어지므로 그 뒤(함수 끝)에서
    // 호출한다 — 먼저 부르면 첫 진입에 실습 건이 미연결로 남고 이력이 비었다.
    await ensureManualPracticeEngagements(admin, tenantId, experts, new Date());
    await backfillPracticeEngagementEvents(admin, tenantId);
    return { ok: true, created: false, experts: experts.length };
  }

  const now = new Date();
  const week = daysUntilSunday(now);
  const sunday = week[week.length - 1] ?? ymd(now);

  // ---- 1) 완료 프로젝트: 전문가별 과거 완료 3건 -----------------------------
  const pastStart = ymd(addDays(now, -45));
  const pastEnd = ymd(addDays(now, -30));
  const completedId = await createProject(
    admin,
    tenantId,
    COMPLETED_PROJECT_NAME,
    "completed",
    pastStart,
    pastEnd
  );
  if (completedId) {
    const pastSessions: SlotSpec[] = [
      {
        date: ymd(addDays(now, -44)),
        startsTime: "10:00",
        endsTime: "12:00",
        sessionName: "1차시 · 사업 아이템 검증",
        roleType: "lecturer",
        roleDescription: "강사",
        fee: 300000,
      },
      {
        date: ymd(addDays(now, -37)),
        startsTime: "14:00",
        endsTime: "17:00",
        sessionName: "2차시 · 사업계획서 작성",
        roleType: "mentor",
        roleDescription: "멘토",
        fee: 400000,
      },
      {
        date: ymd(addDays(now, -31)),
        startsTime: "13:00",
        endsTime: "16:00",
        sessionName: "3차시 · 최종 발표 심사",
        roleType: "judge",
        roleDescription: "심사위원",
        fee: 350000,
      },
    ];
    for (const spec of pastSessions) {
      await createSlot(admin, tenantId, completedId, spec, experts);
    }
    // 끝난 사업이므로 단계도 끝까지 와 있어야 한다 — '임의 배정 중'으로 남으면
    // 마감 탭이 사실과 다른 상태를 보여 준다
    await admin
      .from("projects")
      .update({ engagement_stage: "settled" })
      .eq("id", completedId);
  }

  // ---- 2) 진행 프로젝트: 승인 8건 + 빈 슬롯 3개 ------------------------------
  const activeId = await createProject(
    admin,
    tenantId,
    ACTIVE_PROJECT_NAME,
    "active",
    ymd(now),
    sunday
  );
  if (!activeId) {
    return { ok: false, error: "연습용 프로젝트를 만들지 못했습니다." };
  }

  const SESSION_TITLES = [
    "1교시 · 창업 개론",
    "2교시 · 시장 조사 실습",
    "3교시 · 비즈니스 모델 설계",
    "4교시 · 재무 계획 수립",
    "5교시 · IR 피칭 코칭",
    "6교시 · 지식재산 전략",
    "7교시 · 마케팅 실행",
    "8교시 · 중간 점검 멘토링",
  ];
  const TIMES: [string, string][] = [
    ["09:30", "11:30"],
    ["13:30", "15:30"],
  ];
  const ROLES = ["lecturer", "mentor", "host", "judge"];

  // 8세션을 이번 주 남은 날짜에 흩는다 — 같은 날 최대 2세션(오전·오후).
  for (let i = 0; i < SESSION_TITLES.length; i++) {
    const date = week[i % week.length] ?? sunday;
    const time = TIMES[Math.floor(i / week.length) % TIMES.length] ?? TIMES[0];
    const role = ROLES[i % ROLES.length] ?? "lecturer";
    await createSlot(
      admin,
      tenantId,
      activeId,
      {
        date,
        startsTime: time![0],
        endsTime: time![1],
        sessionName: SESSION_TITLES[i] ?? `${i + 1}교시`,
        roleType: role,
        roleDescription: "강사·멘토",
        fee: 300000 + (i % 3) * 50000,
      },
      experts
    );
  }

  // 아직 아무도 섭외하지 않은 슬롯 3개 — 여기서 후보군 고르기를 연습한다.
  const openDates = [
    week[Math.min(1, week.length - 1)] ?? sunday,
    week[Math.min(2, week.length - 1)] ?? sunday,
    sunday,
  ];
  for (let i = 0; i < openDates.length; i++) {
    await createSlot(
      admin,
      tenantId,
      activeId,
      {
        date: openDates[i] ?? sunday,
        startsTime: "16:00",
        endsTime: "18:00",
        sessionName: `추가 세션 ${i + 1} · 1:1 컨설팅`,
        roleType: "mentor",
        roleDescription: "멘토",
        fee: 250000,
      },
      [] // 미섭외 상태로 남긴다
    );
  }

  // 8세션이 확정되고 3자리가 비어 있는 상태 = '섭외 요청 발송됨'
  await admin
    .from("projects")
    .update({ engagement_stage: "requesting" })
    .eq("id", activeId);

  // ---- 3) 가상 타사의 '섭외 중' 3건 — 빈 슬롯 날짜와 겹치게 -------------------
  const peerTenantId = await ensurePeerTenant(admin);
  if (peerTenantId) {
    await createPeerPendingEngagements(admin, peerTenantId, experts, openDates);
  }

  // ---- 4) 수동 완료·이력 연습 대상 — 방금 만든 프로젝트·섭외 건 위에서 ---------
  await ensureManualPracticeEngagements(admin, tenantId, experts, now);
  await backfillPracticeEngagementEvents(admin, tenantId);

  return { ok: true, created: true, experts: experts.length };
}
