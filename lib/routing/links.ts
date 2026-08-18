import { PUBLIC_LINK_PATHS, type PublicLinkKind } from "./reserved-slugs";

/**
 * 링크 생성 유틸리티 (설계문서 5.2)
 *
 * 모든 외부 노출 링크는 환경변수 기반 base URL로 생성한다.
 * 도메인·경로를 코드에 하드코딩하지 않는다 — 인쇄된 QR과 발송된 문자는
 * 회수할 수 없으므로, 경로 체계가 바뀌어도 기존 링크가 살아 있어야 한다.
 */
export function getBaseUrl(): string {
  const base = process.env.NEXT_PUBLIC_BASE_URL;
  if (!base) {
    throw new Error(
      "NEXT_PUBLIC_BASE_URL 환경변수가 설정되지 않았습니다 (.env.example 참조)."
    );
  }
  return base.replace(/\/+$/, "");
}

/** 공개 짧은 경로 링크 생성: buildPublicLink("engagementConsent", token) → {base}/e/{token} */
export function buildPublicLink(kind: PublicLinkKind, token: string): string {
  const path = PUBLIC_LINK_PATHS[kind];
  return `${getBaseUrl()}/${path}/${encodeURIComponent(token)}`;
}

/** 테넌트 내부 경로 생성 (표시·네비게이션 용도 — 권한 판정은 항상 JWT tenant_id) */
export function buildTenantPath(tenantSlug: string, subPath = ""): string {
  const cleaned = subPath.replace(/^\/+/, "");
  return cleaned ? `/${tenantSlug}/${cleaned}` : `/${tenantSlug}`;
}

/**
 * 임직원 가입 신청 링크 (/join/{tenant-slug}) — 사내 공유용 절대 URL.
 * 테넌트 경로 밖이다: 아직 계정이 없는 사람이 여는 화면이라 인증 게이트 안에
 * 두면 예외를 뚫어야 하고, 예외는 곧 구멍이 된다.
 */
export function buildStaffJoinLink(tenantSlug: string): string {
  return `${getBaseUrl()}/join/${encodeURIComponent(tenantSlug)}`;
}
