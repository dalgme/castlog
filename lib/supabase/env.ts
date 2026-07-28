/**
 * Supabase 환경변수 존재 여부.
 * 프리뷰 배포 등 환경변수 미설정 상태에서는 인증 기능을 비활성화하고
 * 크래시 없이 통과시킨다 (미들웨어·가드·서버액션 공통 판단 기준).
 */
export function hasSupabaseEnv(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );
}
