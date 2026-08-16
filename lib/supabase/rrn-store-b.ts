import "server-only";

import { createClient } from "@supabase/supabase-js";

/**
 * 저장소 B (별도 Supabase 프로젝트: castlog-rrn-store-b) 서버 클라이언트.
 * 주민번호 "뒷조각"만 이 저장소에 기록·조회한다. 메인 DB와 물리 분리.
 *
 * 환경변수(서버 전용 — NEXT_PUBLIC_ 금지):
 *   RRN_STORE_B_URL          예: https://jdtgbtigpjvxxvrdcbrg.supabase.co
 *   RRN_STORE_B_SERVICE_KEY  저장소 B의 service_role 키 (대시보드에서 복사)
 */
export function hasStoreBEnv(): boolean {
  return Boolean(
    process.env.RRN_STORE_B_URL && process.env.RRN_STORE_B_SERVICE_KEY
  );
}

export function createStoreBClient() {
  const url = process.env.RRN_STORE_B_URL;
  const key = process.env.RRN_STORE_B_SERVICE_KEY;
  if (!url || !key) {
    throw new Error("저장소 B 환경변수가 설정되지 않았습니다.");
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
