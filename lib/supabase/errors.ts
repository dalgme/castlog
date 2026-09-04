/**
 * "컬럼이 아직 없다" 판정 (§14-10 — SQL 먼저, 신규 컬럼 참조 코드의 부재 폴백).
 *
 * SELECT의 미지 컬럼은 PostgreSQL이 42703을 내지만, INSERT/UPDATE 본문의 미지
 * 키는 PostgREST가 스키마 캐시 단계에서 PGRST204로 거른다. 42703만 보면
 * 쓰기 경로의 폴백이 영영 동작하지 않는다 (38번 리뷰 P2-1).
 */
export function isMissingColumnError(
  error: { code?: string | null } | null | undefined
): boolean {
  return error?.code === "42703" || error?.code === "PGRST204";
}
