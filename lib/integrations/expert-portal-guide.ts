import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

/**
 * 수락 직후 전문가 포털 안내 (기획 2026-08-30 — E2E 검수 후속).
 *
 * 공개 링크(/e·/b)로 수락한 전문가는 대개 포털에 들어온 적이 없다. 그 상태는
 * 세 갈래로 갈리고, 안내가 달라야 한다:
 *  · registered      — 이미 휴대폰 인증으로 로그인한 적 있음 → "포털에서 수락서·지급 정보"
 *  · claim_prefilled — 기업이 보유자료·서류로 미리 등록해 둠(로그인 0회) →
 *                      "회사가 등록해 둔 정보·서류 N건이 있습니다. 같은 번호로 인증하면
 *                       그대로 이어받습니다(claim)"
 *  · claim_minimal   — 이름·번호 정도만 있음 → "1분이면 가입됩니다. 지급을 위해 계좌 등 필요"
 *  · no_phone        — 휴대폰 번호가 없음 → 인증 로그인이 불가하니 기업에 등록 요청
 *
 * 노출 범위는 호출 문맥(audience)으로 가른다:
 *  · public — 토큰만 있으면 누구나 보는 화면(/e·/b). §4 전면 공개 항목(프로필
 *    라벨)과 서류 '건수', 마스킹 번호까지만. 주민번호·계좌·소득 유형의 존재
 *    여부는 §5 비밀 항목이라 **조회조차 하지 않는다** (missing = null).
 *  · portal — 로그인한 전문가 본인 화면. 누락 항목까지 계산한다.
 * 서류 내용·평가·메모는 어느 문맥에서도 싣지 않는다.
 */

export type PortalGuideKind =
  | "registered"
  | "claim_prefilled"
  | "claim_minimal"
  | "no_phone";

export type PortalGuideAudience = "public" | "portal";

export type ExpertPortalGuide = {
  kind: PortalGuideKind;
  /** 인증에 쓸 번호 — 마스킹 (010-****-1234) */
  phoneMasked: string | null;
  /** 기업이 올려 둔 활성 서류 수 (내용 미노출) */
  documentCount: number;
  /** 이미 채워진 프로필 항목 라벨 (기업 등록분 안내용 — 공개 범위 항목만) */
  prefilled: string[];
  /**
   * 지급·계약에 필요한데 아직 없는 항목 라벨.
   * null = 판정하지 않음(공개 화면) — 화면은 일반 문구로 대신한다.
   */
  missing: string[] | null;
  /** 포털 진입 경로 (로그인 후 돌아올 곳 포함) */
  loginHref: string;
};

function maskPhone(phone: string | null): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 7) return null;
  return `${digits.slice(0, 3)}-****-${digits.slice(-4)}`;
}

export async function getExpertPortalGuide(
  expertId: string,
  options: { audience?: PortalGuideAudience; nextPath?: string } = {}
): Promise<ExpertPortalGuide | null> {
  const audience = options.audience ?? "public";
  const nextPath = options.nextPath ?? "/expert/engagements";
  const admin = createAdminClient();
  const [{ data: expert }, { count: docCount }] = await Promise.all([
    admin
      .from("experts")
      .select(
        "id, auth_user_id, phone, email, organization, job_title, specialty, career_years, region, bio"
      )
      .eq("id", expertId)
      .maybeSingle(),
    admin
      .from("expert_documents")
      .select("id", { count: "exact", head: true })
      .eq("expert_id", expertId)
      .eq("status", "active"),
  ]);
  if (!expert) return null;

  const prefilled: string[] = [];
  if (expert.email) prefilled.push("이메일");
  if (expert.organization || expert.job_title) prefilled.push("소속·직함");
  if (expert.specialty) prefilled.push("전문분야");
  if (expert.career_years !== null) prefilled.push("경력");
  if (expert.region) prefilled.push("지역");
  if (expert.bio) prefilled.push("소개");

  // 비밀 항목 존재 여부는 본인 로그인 화면에서만 조회한다 (§5)
  let missing: string[] | null = null;
  if (audience === "portal") {
    const [{ count: bankCount }, { count: rrnCount }, { data: tax }] =
      await Promise.all([
        admin
          .from("expert_bank_accounts")
          .select("expert_id", { count: "exact", head: true })
          .eq("expert_id", expertId),
        admin
          .from("rrn_fragments_front")
          .select("id", { count: "exact", head: true })
          .eq("expert_id", expertId)
          .is("purged_at", null),
        admin
          .from("expert_tax_profiles")
          .select("payment_type")
          .eq("expert_id", expertId)
          .maybeSingle(),
      ]);
    missing = [];
    if (!expert.email) missing.push("이메일");
    if ((bankCount ?? 0) === 0) missing.push("지급 계좌");
    if (!tax?.payment_type) missing.push("소득 유형(사업/기타소득)");
    // 사업자 청구 전문가는 주민번호를 수집하지 않는다 (§5)
    if (tax?.payment_type !== "business" && (rrnCount ?? 0) === 0) {
      missing.push("주민등록번호(지급명세서용)");
    }
  }

  const loginHref = `/login?tab=expert&next=${encodeURIComponent(nextPath)}`;
  const documentCount = docCount ?? 0;

  let kind: PortalGuideKind;
  if (!expert.phone) kind = "no_phone";
  else if (expert.auth_user_id) kind = "registered";
  else if (documentCount > 0 || prefilled.length >= 2) kind = "claim_prefilled";
  else kind = "claim_minimal";

  return {
    kind,
    phoneMasked: maskPhone(expert.phone),
    documentCount,
    prefilled,
    missing,
    loginHref,
  };
}
