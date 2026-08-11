import "server-only";

import { createClient } from "@/lib/supabase/server";

/**
 * 단계 25: 전문가 후보 추천 (결정론적 랭킹 — AI 아님).
 *
 * 경계(CLAUDE.md 14-1): 후보 '순위/판정'은 시스템이 설명 가능한 규칙으로 계산한다.
 * AI는 이후 '섭외 사유 초안(문장화)'에만 개입한다(lib/ai).
 *
 * 평판 데이터는 자사 평가(expert_evaluations)만 사용 — RLS가 테넌트 격리를 강제한다.
 * (전문가 본인·타 기업 평가는 절대 유입되지 않는다 — 설계문서 4장)
 */

export type ExpertCandidate = {
  expertId: string;
  name: string;
  specialty: string | null;
  region: string | null;
  careerYears: number | null;
  avgScore: number | null; // 자사 평판 평균(10점) — 평가 없으면 null
  evalCount: number;
  score: number; // 결정론적 종합 점수(정렬 기준)
  reasons: string[]; // 사람이 읽는 추천 근거
};

export async function rankExpertCandidates(opts: {
  keyword?: string;
  limit?: number;
}): Promise<ExpertCandidate[]> {
  const supabase = createClient();
  const keyword = opts.keyword?.trim().toLowerCase() ?? "";
  const limit = opts.limit ?? 5;

  const { data: links } = await supabase
    .from("expert_tenant_links")
    .select("status, experts (id, name, specialty, region, career_years)")
    .eq("status", "active");

  const experts = (links ?? [])
    .map((l) => l.experts)
    .filter((e): e is NonNullable<typeof e> => e !== null);

  if (experts.length === 0) return [];

  const expertIds = experts.map((e) => e.id);
  const { data: evals } = await supabase
    .from("expert_evaluations")
    .select("expert_id, score")
    .in("expert_id", expertIds);

  // 자사 평가 집계 (테넌트 격리 — RLS)
  const agg = new Map<string, { sum: number; count: number }>();
  for (const row of evals ?? []) {
    const cur = agg.get(row.expert_id) ?? { sum: 0, count: 0 };
    cur.sum += row.score;
    cur.count += 1;
    agg.set(row.expert_id, cur);
  }

  const candidates: ExpertCandidate[] = experts.map((e) => {
    const a = agg.get(e.id);
    const avgScore = a && a.count > 0 ? a.sum / a.count : null;
    const evalCount = a?.count ?? 0;

    const reasons: string[] = [];

    // 1) 평판 (자사 평가) — 없으면 중립 5.0 (불이익 없음)
    const reputation = avgScore ?? 5.0;
    if (avgScore !== null) {
      reasons.push(`자사 평가 평균 ${avgScore.toFixed(1)}/10 (${evalCount}건)`);
    } else {
      reasons.push("자사 평가 이력 없음 (중립 반영)");
    }

    // 2) 키워드 일치 (분야·지역)
    let keywordBonus = 0;
    if (keyword) {
      const hay = `${e.specialty ?? ""} ${e.region ?? ""}`.toLowerCase();
      if (hay.includes(keyword)) {
        keywordBonus = 2;
        reasons.push(`검색어 '${opts.keyword?.trim()}' 일치`);
      }
    }

    // 3) 경력 (소폭 가점, 상한 +1.0)
    const careerBonus = Math.min((e.career_years ?? 0) * 0.05, 1.0);
    if ((e.career_years ?? 0) >= 5) {
      reasons.push(`경력 ${e.career_years}년`);
    }

    const score = reputation + keywordBonus + careerBonus;

    return {
      expertId: e.id,
      name: e.name,
      specialty: e.specialty,
      region: e.region,
      careerYears: e.career_years,
      avgScore,
      evalCount,
      score,
      reasons,
    };
  });

  candidates.sort((a, b) => b.score - a.score);
  return candidates.slice(0, limit);
}
