import "server-only";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatKrMobile } from "@/lib/auth/phone";
import { isPracticeMode } from "@/lib/practice/server";

/**
 * 전문가 목록 엑셀 내보내기 데이터 (기획 확정 2026-08-30 — 25번).
 *
 * **화면(전문가 목록 테이블)과 같은 정보량**을 내보낸다 — 강의(멘토링) 분야,
 * 섭외 분야, 자사 평가, 메모, VIP·즐겨찾기·주의까지.
 *
 * ⚠ 전문가 목록 테이블(app/(dashboard)/[tenantSlug]/experts/page.tsx)에
 * 컬럼을 추가·변경하면 **이 파일의 EXPERT_EXPORT_COLUMNS에도 한 줄**을
 * 추가한다 — 엑셀 컬럼 정의는 여기 한 곳뿐이다 (선언 한 줄 = 컬럼 하나).
 *
 * 범위: 화면과 동일하게 공개 풀 전체(§4 전면 공개 — 프로필·연락처·강의분야).
 * 자사 주관 기록(평가·태그·메모·섭외분야)은 테넌트 격리 데이터만 실린다.
 * 민감정보(주민번호·계좌·서류)는 어떤 내보내기에도 포함하지 않는다.
 */

export type ExpertExportRow = {
  name: string;
  phone: string;
  email: string | null;
  specialty: string | null;
  expertiseFields: string[];
  recruitFields: string[];
  region: string | null;
  careerYears: number | null;
  /** 자사 평점 (1~10, 직접 지정) */
  myRating: number | null;
  /** 프로젝트 평가 평균 (소수 1자리 문자열) */
  avgScore: string | null;
  /** 자사 태그 (favorite/vip/caution/null) */
  tag: string | null;
  /** '주의' 사유 */
  tagNote: string | null;
  noteCount: number;
  linkStatus: string; // active/pending/revoked/none
  linkedAt: string | null;
};

const LINK_STATUS_LABEL: Record<string, string> = {
  active: "연결됨",
  pending: "대기중",
  revoked: "해제됨",
  none: "미연결",
};

/** 엑셀 컬럼 정의 — 화면 테이블과 1:1. 새 컬럼은 여기 한 줄 추가. */
export const EXPERT_EXPORT_COLUMNS: {
  header: string;
  value: (r: ExpertExportRow) => string | number;
}[] = [
  { header: "이름", value: (r) => r.name },
  { header: "휴대폰", value: (r) => formatKrMobile(r.phone) },
  { header: "이메일", value: (r) => r.email ?? "" },
  { header: "전문분야", value: (r) => r.specialty ?? "" },
  { header: "강의(멘토링) 분야", value: (r) => r.expertiseFields.join(", ") },
  { header: "섭외 분야", value: (r) => r.recruitFields.join(", ") },
  { header: "지역", value: (r) => r.region ?? "" },
  { header: "경력(년)", value: (r) => r.careerYears ?? "" },
  { header: "자사 평점", value: (r) => r.myRating ?? "" },
  { header: "프로젝트 평가 평균", value: (r) => r.avgScore ?? "" },
  { header: "즐겨찾기", value: (r) => (r.tag === "favorite" ? "O" : "") },
  { header: "VIP", value: (r) => (r.tag === "vip" ? "O" : "") },
  { header: "주의", value: (r) => (r.tag === "caution" ? "O" : "") },
  { header: "주의 사유", value: (r) => (r.tag === "caution" ? (r.tagNote ?? "") : "") },
  { header: "메모(건수)", value: (r) => (r.noteCount > 0 ? r.noteCount : "") },
  {
    header: "연결상태",
    value: (r) => LINK_STATUS_LABEL[r.linkStatus] ?? r.linkStatus,
  },
  { header: "연결일", value: (r) => (r.linkedAt ? r.linkedAt.slice(0, 10) : "") },
];

/** 내보내기 행 조립 — 전문가 목록 화면과 같은 소스에서 읽는다 */
export async function loadExpertExportRows(): Promise<ExpertExportRow[]> {
  const supabase = createClient();
  const admin = createAdminClient();
  const practice = await isPracticeMode();

  const [poolResult, { data: linkRows }] = await Promise.all([
    admin
      .from("experts")
      .select("id, name, phone, email, specialty, region, career_years")
      .eq("is_practice", practice)
      .eq("is_active", true)
      .order("name", { ascending: true }),
    supabase
      .from("expert_tenant_links")
      .select("status, accepted_at, experts (id)"),
  ]);
  // 부재 폴백 (§14-10, 42703 한정) — is_active 미적용 환경
  let poolRows = poolResult.data;
  if (poolResult.error?.code === "42703") {
    ({ data: poolRows } = await admin
      .from("experts")
      .select("id, name, phone, email, specialty, region, career_years")
      .eq("is_practice", practice)
      .order("name", { ascending: true }));
  }

  const linkByExpert = new Map<string, { status: string; acceptedAt: string | null }>();
  for (const link of linkRows ?? []) {
    if (!link.experts) continue;
    const prev = linkByExpert.get(link.experts.id);
    if (prev && prev.status === "active") continue;
    if (prev && prev.status === "pending" && link.status === "revoked") continue;
    linkByExpert.set(link.experts.id, {
      status: link.status,
      acceptedAt: link.accepted_at,
    });
  }

  // 연습모드는 자사 연결 시드만 (화면과 동일)
  const pool = practice
    ? (poolRows ?? []).filter((e) => linkByExpert.has(e.id))
    : (poolRows ?? []);
  if (pool.length === 0) return [];

  const ids = pool.map((e) => e.id);

  const [
    { data: expertiseFieldRows },
    { data: expertiseAssignments },
    { data: recruitFields },
    { data: recruitAssignments },
    { data: tagRows },
    { data: profileRows },
    { data: evaluationRows },
    notesResult,
  ] = await Promise.all([
    admin.from("expertise_fields").select("id, name"),
    admin
      .from("expert_expertise_fields")
      .select("expert_id, field_id")
      .in("expert_id", ids),
    supabase.from("tenant_recruit_fields").select("id, name"),
    supabase.from("expert_tenant_recruit_fields").select("expert_id, field_id"),
    supabase.from("expert_tenant_tags").select("expert_id, tag, note"),
    supabase.from("expert_tenant_profiles").select("expert_id, rating"),
    supabase.from("expert_evaluations").select("expert_id, score"),
    supabase.from("expert_tenant_notes").select("expert_id"),
  ]);

  const expertiseNameById = new Map(
    (expertiseFieldRows ?? []).map((f) => [f.id, f.name])
  );
  const expertiseByExpert = new Map<string, string[]>();
  for (const a of expertiseAssignments ?? []) {
    const name = expertiseNameById.get(a.field_id);
    if (!name) continue;
    const list = expertiseByExpert.get(a.expert_id) ?? [];
    list.push(name);
    expertiseByExpert.set(a.expert_id, list);
  }

  const recruitNameById = new Map(
    (recruitFields ?? []).map((f) => [f.id, f.name])
  );
  const recruitByExpert = new Map<string, string[]>();
  for (const a of recruitAssignments ?? []) {
    const name = recruitNameById.get(a.field_id);
    if (!name) continue;
    const list = recruitByExpert.get(a.expert_id) ?? [];
    list.push(name);
    recruitByExpert.set(a.expert_id, list);
  }

  const tagByExpert = new Map(
    (tagRows ?? []).map((t) => [t.expert_id, { tag: t.tag, note: t.note }])
  );
  const ratingByExpert = new Map(
    (profileRows ?? []).map((p) => [p.expert_id, p.rating])
  );
  const scoreByExpert = new Map<string, { sum: number; count: number }>();
  for (const row of evaluationRows ?? []) {
    if (row.score === null) continue;
    const acc = scoreByExpert.get(row.expert_id) ?? { sum: 0, count: 0 };
    acc.sum += row.score;
    acc.count += 1;
    scoreByExpert.set(row.expert_id, acc);
  }
  const noteCountByExpert = new Map<string, number>();
  for (const n of notesResult.data ?? []) {
    noteCountByExpert.set(
      n.expert_id,
      (noteCountByExpert.get(n.expert_id) ?? 0) + 1
    );
  }

  return pool.map((e) => {
    const link = linkByExpert.get(e.id);
    const acc = scoreByExpert.get(e.id);
    const tagInfo = tagByExpert.get(e.id);
    return {
      name: e.name,
      phone: e.phone,
      email: e.email,
      specialty: e.specialty,
      expertiseFields: expertiseByExpert.get(e.id) ?? [],
      recruitFields: recruitByExpert.get(e.id) ?? [],
      region: e.region,
      careerYears: e.career_years,
      myRating: ratingByExpert.get(e.id) ?? null,
      avgScore: acc && acc.count > 0 ? (acc.sum / acc.count).toFixed(1) : null,
      tag: tagInfo?.tag ?? null,
      tagNote: tagInfo?.note ?? null,
      noteCount: noteCountByExpert.get(e.id) ?? 0,
      linkStatus: link?.status ?? "none",
      linkedAt: link?.acceptedAt ?? null,
    };
  });
}
