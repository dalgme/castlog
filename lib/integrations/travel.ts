import "server-only";

/**
 * 단계 22: 출장 유류비 자동 계산 (오피넷 유가 · 네이버 지도 거리).
 *
 * 외부 API 키 미설정 시 각 함수는 null을 반환 → 담당자 수동 입력으로 폴백한다
 * (더미 금지 — CLAUDE.md 14-7). 서버 전용.
 */

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

/** 오피넷 전국 평균 판매가(원/L). 미설정·실패 시 null. */
export async function fetchFuelPrice(fuelType: FuelType): Promise<number | null> {
  const key = process.env.OPINET_API_KEY;
  if (!key) return null;
  const prodcd =
    fuelType === "gasoline" ? "B027" : fuelType === "diesel" ? "D047" : "K015";
  try {
    const res = await fetch(
      `http://www.opinet.co.kr/api/avgAllPrice.do?out=json&code=${key}&prodcd=${prodcd}`,
      { cache: "no-store" }
    );
    if (!res.ok) return null;
    const data = (await res.json()) as OpinetResponse;
    const oil =
      data.RESULT?.OIL?.find((o) => o.PRODCD === prodcd) ?? data.RESULT?.OIL?.[0];
    const price = oil?.PRICE ? Math.round(parseFloat(oil.PRICE)) : null;
    return price && price > 0 ? price : null;
  } catch {
    return null;
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
): Promise<string | null> {
  const res = await fetch(
    `https://naveropenapi.apigw.ntruss.com/map-geocode/v2/geocode?query=${encodeURIComponent(query)}`,
    {
      headers: {
        "X-NCP-APIGW-API-KEY-ID": id,
        "X-NCP-APIGW-API-KEY": secret,
      },
      cache: "no-store",
    }
  );
  if (!res.ok) return null;
  const data = (await res.json()) as NaverGeocode;
  const a = data.addresses?.[0];
  return a?.x && a?.y ? `${a.x},${a.y}` : null;
}

/** 네이버 지도 주행 거리(km). 미설정·실패 시 null. */
export async function fetchDrivingDistanceKm(
  origin: string,
  destination: string
): Promise<number | null> {
  const id = process.env.NAVER_MAP_CLIENT_ID;
  const secret = process.env.NAVER_MAP_CLIENT_SECRET;
  if (!id || !secret) return null;
  try {
    const start = await geocode(origin, id, secret);
    const goal = await geocode(destination, id, secret);
    if (!start || !goal) return null;
    const res = await fetch(
      `https://naveropenapi.apigw.ntruss.com/map-direction/v1/driving?start=${start}&goal=${goal}`,
      {
        headers: {
          "X-NCP-APIGW-API-KEY-ID": id,
          "X-NCP-APIGW-API-KEY": secret,
        },
        cache: "no-store",
      }
    );
    if (!res.ok) return null;
    const data = (await res.json()) as NaverDirections;
    const meters = data.route?.traoptimal?.[0]?.summary?.distance;
    return typeof meters === "number" ? Math.round(meters / 1000) : null;
  } catch {
    return null;
  }
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
