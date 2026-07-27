import { RESERVED_SLUGS } from "./reserved-slugs";

/**
 * 테넌트 슬러그 정책 (설계문서 5.2)
 * - 영문 소문자 kebab-case만 허용 (한글은 URL 인코딩이 깨지므로 금지)
 * - 시작·끝은 영문 소문자 또는 숫자, 하이픈 연속 불가
 * - 길이 2~40자 (1글자는 전부 공개 경로 예약)
 * - 예약어 차단
 */
const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9]|-(?=[a-z0-9])){1,39}$/;

export type SlugValidation =
  | { ok: true; slug: string }
  | { ok: false; reason: "format" | "reserved" };

export function validateTenantSlug(input: string): SlugValidation {
  const slug = input.trim();
  if (!SLUG_PATTERN.test(slug)) {
    return { ok: false, reason: "format" };
  }
  if (RESERVED_SLUGS.has(slug)) {
    return { ok: false, reason: "reserved" };
  }
  return { ok: true, slug };
}

/** URL 첫 세그먼트가 테넌트 슬러그 형태인지 판정 (예약어·시스템 경로 제외) */
export function isTenantSlugSegment(segment: string): boolean {
  return validateTenantSlug(segment).ok;
}
