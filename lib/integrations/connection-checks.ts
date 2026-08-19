import "server-only";

import {
  fetchDrivingDistanceKm,
  fetchFuelPrice,
  travelIntegrationStatus,
} from "@/lib/integrations/travel";
import { generateChat, isAiConfigured } from "@/lib/ai/client";

/**
 * 외부 연동 점검.
 *
 * 왜 필요한가: 환경변수는 Vercel에 넣고 재배포해야 적용된다. 그런데 "제대로
 * 들어갔는지"를 확인할 방법이 지금까지는 **실제 업무 화면에 들어가 시도해 보는
 * 것**뿐이었다. 출장품의를 작성하다가 값이 안 채워지면, 키가 없는 건지 주소를
 * 못 찾은 건지 네이버 쪽 신청이 안 된 건지 알 수 없다.
 *
 * 그래서 각 연동을 **실제로 한 번 호출해 보고** 결과와 실패 사유를 그대로
 * 돌려준다. 키를 넣은 직후 여기서 한 번 눌러 보면 끝난다.
 *
 * 점검은 버튼을 눌렀을 때만 돈다 — 화면을 열 때마다 외부 API를 때리면
 * 그 자체가 비용이고 호출 한도를 갉아먹는다.
 */

export type CheckStatus = "ok" | "not_configured" | "failed";

export type ConnectionCheck = {
  key: string;
  label: string;
  /** 이 연동이 켜면 무엇이 되는가 */
  purpose: string;
  /** 설정에 필요한 환경변수 이름 */
  envKeys: string[];
  status: CheckStatus;
  /** 성공 시 사람이 눈으로 확인할 수 있는 값 */
  detail: string | null;
  /** 실패 사유 — 화면에 그대로 보여 준다 */
  reason: string | null;
};

/** 거리 점검용 고정 구간 — 결과가 대략 얼마인지 눈으로 검산할 수 있는 곳 */
const SAMPLE_ORIGIN = "서울특별시청";
const SAMPLE_DESTINATION = "경기도청";

async function checkOpinet(): Promise<ConnectionCheck> {
  const base = {
    key: "opinet",
    label: "오피넷 (유가)",
    purpose: "출장품의에서 휘발유·경유·LPG 단가를 자동으로 채웁니다.",
    envKeys: ["OPINET_API_KEY"],
  };

  if (!travelIntegrationStatus().fuelPrice) {
    return {
      ...base,
      status: "not_configured",
      detail: null,
      reason: "OPINET_API_KEY가 설정되지 않았습니다.",
    };
  }

  const result = await fetchFuelPrice("gasoline");
  if (result.value === null) {
    return { ...base, status: "failed", detail: null, reason: result.reason };
  }
  return {
    ...base,
    status: "ok",
    detail: `전국 평균 휘발유 ${result.value.toLocaleString("ko-KR")}원/L`,
    reason: null,
  };
}

async function checkNaverMap(): Promise<ConnectionCheck> {
  const base = {
    key: "naver_map",
    label: "네이버 지도 (거리)",
    purpose: "출장품의에서 출발지~도착지 주행 거리를 자동으로 계산합니다.",
    envKeys: ["NAVER_MAP_CLIENT_ID", "NAVER_MAP_CLIENT_SECRET"],
  };

  if (!travelIntegrationStatus().distance) {
    return {
      ...base,
      status: "not_configured",
      detail: null,
      reason:
        "NAVER_MAP_CLIENT_ID / NAVER_MAP_CLIENT_SECRET이 설정되지 않았습니다.",
    };
  }

  // 주소 변환(Geocoding)과 길찾기(Directions)를 한 번에 통과해야 성공이다 —
  // 둘은 네이버에서 각각 따로 이용 신청하는 상품이라, 하나만 열려 있는 경우가
  // 흔하다. 실패 사유 문구로 어느 쪽이 막혔는지 구분된다.
  const result = await fetchDrivingDistanceKm(SAMPLE_ORIGIN, SAMPLE_DESTINATION);
  if (result.value === null) {
    return { ...base, status: "failed", detail: null, reason: result.reason };
  }
  return {
    ...base,
    status: "ok",
    detail: `${SAMPLE_ORIGIN} → ${SAMPLE_DESTINATION} ${result.value}km`,
    reason: null,
  };
}

async function checkAnthropic(): Promise<ConnectionCheck> {
  const base = {
    key: "anthropic",
    label: "Anthropic (도우미 챗봇)",
    purpose: "사용법 도우미 응답과 상담게시판 자동 분류를 담당합니다.",
    envKeys: ["ANTHROPIC_API_KEY"],
  };

  if (!isAiConfigured()) {
    return {
      ...base,
      status: "not_configured",
      detail: null,
      reason: "ANTHROPIC_API_KEY가 설정되지 않았습니다.",
    };
  }

  // 가장 짧은 왕복 한 번 — 점검 비용을 최소로 둔다
  const result = await generateChat({
    system: "You are a connection test. Reply with exactly: OK",
    messages: [{ role: "user", content: "ping" }],
    maxTokens: 8,
  });
  if (!result.ok) {
    return { ...base, status: "failed", detail: null, reason: result.error };
  }
  return {
    ...base,
    status: "ok",
    detail: `응답 확인 (${result.text.slice(0, 20)})`,
    reason: null,
  };
}

export async function runConnectionChecks(): Promise<ConnectionCheck[]> {
  // 서로 무관한 호출이라 함께 돌린다
  return Promise.all([checkOpinet(), checkNaverMap(), checkAnthropic()]);
}

/** 호출 없이 환경변수 설정 여부만 — 화면을 열 때 쓴다 */
export function connectionSummary(): {
  key: string;
  label: string;
  configured: boolean;
}[] {
  const travel = travelIntegrationStatus();
  return [
    { key: "opinet", label: "오피넷 (유가)", configured: travel.fuelPrice },
    { key: "naver_map", label: "네이버 지도 (거리)", configured: travel.distance },
    {
      key: "anthropic",
      label: "Anthropic (도우미 챗봇)",
      configured: isAiConfigured(),
    },
  ];
}
