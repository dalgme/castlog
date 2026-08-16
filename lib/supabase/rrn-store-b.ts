import "server-only";

import { createClient } from "@supabase/supabase-js";

/**
 * 저장소 B (별도 Supabase 프로젝트: castlog-rrn-store-b) 서버 클라이언트.
 * 주민번호 "뒷조각"만 이 저장소에 기록·조회한다. 메인 DB와 물리 분리.
 *
 * URL은 비밀이 아니므로 기본값을 코드에 둔다(환경변수로 재정의 가능).
 * 필요한 비밀 환경변수는 service_role 키 하나뿐:
 *   RRN_STORE_B_SERVICE_KEY  저장소 B의 service_role 키 (대시보드에서 복사)
 *   RRN_STORE_B_URL          (선택) 기본값 재정의용
 */
const DEFAULT_STORE_B_URL = "https://jdtgbtigpjvxxvrdcbrg.supabase.co";

function storeBUrl(): string {
  return process.env.RRN_STORE_B_URL || DEFAULT_STORE_B_URL;
}

/** 저장소 B 연결 준비 여부 = service_role 키 설정 여부 */
export function hasStoreBEnv(): boolean {
  return Boolean(process.env.RRN_STORE_B_SERVICE_KEY);
}

export function createStoreBClient() {
  const key = process.env.RRN_STORE_B_SERVICE_KEY;
  if (!key) {
    throw new Error("저장소 B service_role 키가 설정되지 않았습니다.");
  }
  return createClient(storeBUrl(), key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
