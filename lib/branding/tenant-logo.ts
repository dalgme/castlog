import "server-only";

import { createClient } from "@/lib/supabase/server";
import { hasSupabaseEnv } from "@/lib/supabase/env";

/**
 * 회사 로고.
 *
 * 파일은 기존 비공개 버킷에 두고, 화면에는 `/api/tenant-logo`로만 노출한다.
 * 공개 URL을 만들지 않는 이유는 서류와 같다 — 한 번 공개 URL이 생기면 회수할
 * 방법이 없고, 그 주소는 로그인 없이 누구나 열 수 있게 된다.
 *
 * `tenants.logo_url`에는 외부 주소가 아니라 **버킷 안의 경로**를 저장한다.
 * (칼럼 이름은 초기 스키마에서 온 것이라 그대로 두되, 의미는 여기서 고정한다)
 */

export const TENANT_LOGO_BUCKET = "expert-documents";
/** 화면에서 쓰는 최대 크기 — 업로드 시 브라우저에서 이 크기로 줄여 보낸다 */
export const TENANT_LOGO_MAX_PX = 400;
/** 줄여서 올리므로 이보다 크면 정상적인 로고가 아니다 */
export const TENANT_LOGO_MAX_BYTES = 300 * 1024;

/** 현재 테넌트에 로고가 등록되어 있는가 (경로는 노출하지 않는다) */
export async function hasTenantLogo(): Promise<boolean> {
  if (!hasSupabaseEnv()) return false;
  const supabase = createClient();
  const { data } = await supabase
    .from("tenants")
    .select("logo_url")
    .maybeSingle();
  return Boolean(data?.logo_url);
}

/**
 * 화면에서 쓸 로고 주소.
 *
 * 경로가 아니라 앱 라우트를 돌려준다. 로고를 바꿔도 주소는 그대로이므로
 * 캐시를 깨기 위해 갱신 시각을 쿼리로 붙인다.
 */
export async function tenantLogoSrc(): Promise<string | null> {
  if (!hasSupabaseEnv()) return null;
  const supabase = createClient();
  const { data } = await supabase
    .from("tenants")
    .select("logo_url, updated_at")
    .maybeSingle();
  if (!data?.logo_url) return null;
  const stamp = data.updated_at ? Date.parse(data.updated_at) : 0;
  return `/api/tenant-logo?v=${Number.isFinite(stamp) ? stamp : 0}`;
}
