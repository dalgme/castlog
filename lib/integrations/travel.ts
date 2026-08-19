import "server-only";

/**
 * 출장 유류비 자동 계산 (오피넷 유가 · 네이버 지도 거리).
 *
 * 외부 API 키 미설정·실패 시 값은 null이고 담당자가 직접 입력한다(더미 금지 —
 * CLAUDE.md §14-7). 다만 **왜 실패했는지는 반드시 남긴다** — "그냥 안 됨"으로
 * 뭉개면 키가 없는 건지, 주소를 못 찾은 건지, 호스트가 바뀐 건지 알 수 없어
 * 연결 자체를 못 고친다.
 *
 * 네이버 클라우드 플랫폼은 Maps API 게이트웨이 호스트를 옮긴 이력이 있다.
 * 계정마다 열려 있는 호스트가 달라서, 설정값 → 신규 → 구 순으로 시도한다.
 * NAVER_MAP_API_HOST를 지정하면 그 호스트만 쓴다.
 */

/** 네이버 Maps 게이트웨이 후보 (앞에서부터 시도) */
const NAVER_HOSTS = [
  "https://maps.apigw.ntruss.com",
  "https://naveropenapi.apigw.ntruss.com",
];

function naverHosts(): string[] {
  const pinned = process.env.NAVER_MAP_API_HOST?.replace(/\/+$/, "");
  return pinned ? [pinned] : NAVER_HOSTS;
}

/** 자동계산 결과 — 실패 사유를 함께 돌려준다 */
export type AutoValue<T> = {
  value: T | null;
  /** 실패 시 사람이 읽고 조치할 수 있는 사유 */
  reason: string | null;
};

export const FUEL_TYPES = ["gasoline", "diesel", "lpg"] as const;
export type FuelType = (typeof FUEL_TYPES)[number];

export const FUEL_TYPE_LABELS: Record<string, string> = {
  gasoline: "휘발유",
  diesel: "경유",
  lpg: "LPG",
};

/** 소득유형별 기본 연비(km/L) — 수동 폴백 기본값 */
export const DEFAULT_EFFICIENCY: Record<FuelType, number> = {
  gasoline: 12,
  diesel: 14,
  lpg: 9,
};

export function isFuelType(v: string): v is FuelType {
  return (FUEL_TYPES as readonly string[]).includes(v);
}

export function travelIntegrationStatus(): {
  fuelPrice: boolean;
  distance: boolean;
} {
  return {
    fuelPrice: Boolean(process.env.OPINET_API_KEY),
    distance: Boolean(
      process.env.NAVER_MAP_CLIENT_ID && process.env.NAVER_MAP_CLIENT_SECRET
    ),
  };
}

type OpinetResponse = {
  RESULT?: { OIL?: Array<{ PRODCD?: string; PRICE?: string }> };
};

/** 오피넷 전국 평균 판매가(원/L). 실패 시 value=null + 사유. */
export async function fetchFuelPrice(
  fuelType: FuelType
): Promise<AutoValue<number>> {
  const key = process.env.OPINET_API_KEY;
  if (!key) {
    return { value: null, reason: "오피넷 API 키(OPINET_API_KEY)가 설정되지 않았습니다." };
  }
  const prodcd =
    fuelType === "gasoline" ? "B027" : fuelType === "diesel" ? "D047" : "K015";
  try {
    const res = await fetch(
      `https://www.opinet.co.kr/api/avgAllPrice.do?out=json&code=${key}&prodcd=${prodcd}`,
      { cache: "no-store" }
    );
    if (!res.ok) {
      return { value: null, reason: `오피넷 응답 오류 (HTTP ${res.status}).` };
    }
    const data = (await res.json()) as OpinetResponse;
    const oil =
      data.RESULT?.OIL?.find((o) => o.PRODCD === prodcd) ?? data.RESULT?.OIL?.[0];
    const price = oil?.PRICE ? Math.round(parseFloat(oil.PRICE)) : null;
    if (!price || price <= 0) {
      return { value: null, reason: "오피넷이 유가를 반환하지 않았습니다(키 권한 확인)." };
    }
    return { value: price, reason: null };
  } catch (e) {
    return {
      value: null,
      reason: `오피넷 연결 실패: ${e instanceof Error ? e.message : "알 수 없는 오류"}`,
    };
  }
}

type NaverGeocode = { addresses?: Array<{ x?: string; y?: string }> };
type NaverDirections = {
  route?: { traoptimal?: Array<{ summary?: { distance?: number } }> };
};

async function geocode(
  query: string,
  id: string,
  secret: string
): Promise<{ coord: string | null; reason: string | null }> {
  let lastReason = "주소 좌표 변환에 실패했습니다.";
  for (const host of naverHosts()) {
    try {
      const res = await fetch(
        `${host}/map-geocode/v2/geocode?query=${encodeURIComponent(query)}`,
        {
          headers: {
            "x-ncp-apigw-api-key-id": id,
            "x-ncp-apigw-api-key": secret,
          },
          cache: "no-store",
        }
      );
      if (!res.ok) {
        lastReason =
          res.status === 401 || res.status === 403
            ? `네이버 지도 인증 실패 (HTTP ${res.status}) — 키와 Maps 서비스 이용 신청을 확인하세요.`
            : `네이버 지도 응답 오류 (HTTP ${res.status}).`;
        continue; // 다른 게이트웨이 호스트로 재시도
      }
      const data = (await res.json()) as NaverGeocode;
      const a = data.addresses?.[0];
      if (!a?.x || !a?.y) {
        return { coord: null, reason: `‘${query}’ 주소를 찾지 못했습니다.` };
      }
      return { coord: `${a.x},${a.y}`, reason: null };
    } catch (e) {
      lastReason = `네이버 지도 연결 실패: ${e instanceof Error ? e.message : "알 수 없는 오류"}`;
    }
  }
  return { coord: null, reason: lastReason };
}

/** 네이버 지도 주행 거리(km). 실패 시 value=null + 사유. */
export async function fetchDrivingDistanceKm(
  origin: string,
  destination: string
): Promise<AutoValue<number>> {
  const id = process.env.NAVER_MAP_CLIENT_ID;
  const secret = process.env.NAVER_MAP_CLIENT_SECRET;
  if (!id || !secret) {
    return {
      value: null,
      reason:
        "네이버 지도 키(NAVER_MAP_CLIENT_ID / NAVER_MAP_CLIENT_SECRET)가 설정되지 않았습니다.",
    };
  }

  const start = await geocode(origin, id, secret);
  if (!start.coord) return { value: null, reason: start.reason };
  const goal = await geocode(destination, id, secret);
  if (!goal.coord) return { value: null, reason: goal.reason };

  let lastReason = "경로를 계산하지 못했습니다.";
  for (const host of naverHosts()) {
    try {
      const res = await fetch(
        `${host}/map-direction/v1/driving?start=${start.coord}&goal=${goal.coord}`,
        {
          headers: {
            "x-ncp-apigw-api-key-id": id,
            "x-ncp-apigw-api-key": secret,
          },
          cache: "no-store",
        }
      );
      if (!res.ok) {
        lastReason = `네이버 길찾기 응답 오류 (HTTP ${res.status}).`;
        continue;
      }
      const data = (await res.json()) as NaverDirections;
      const meters = data.route?.traoptimal?.[0]?.summary?.distance;
      if (typeof meters !== "number") {
        return { value: null, reason: "두 지점 사이 자동차 경로를 찾지 못했습니다." };
      }
      return { value: Math.round(meters / 1000), reason: null };
    } catch (e) {
      lastReason = `네이버 길찾기 연결 실패: ${e instanceof Error ? e.message : "알 수 없는 오류"}`;
    }
  }
  return { value: null, reason: lastReason };
}

/** 유류비 = 편도거리 × (왕복?2:1) / 연비 × 단가 (원, 반올림) */
export function computeFuelCost(
  distanceKm: number,
  roundTrip: boolean,
  efficiencyKmpl: number,
  pricePerL: number
): number {
  if (efficiencyKmpl <= 0) return 0;
  const dist = distanceKm * (roundTrip ? 2 : 1);
  return Math.round((dist / efficiencyKmpl) * pricePerL);
}
