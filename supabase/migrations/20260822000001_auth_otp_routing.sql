-- ============================================================================
-- 인증 OTP 테넌트 라우팅 (CLAUDE.md 5-2 개정)
--
-- 전문가 등록 링크(/j)는 특정 회사가 만든다. 그 링크에서 시작된 휴대폰 인증의
-- 인증번호 문자는 "그 회사"의 BYO 솔라피 계정·발신번호로 나가야 한다.
-- 문제: Supabase Send SMS Hook에는 테넌트 문맥이 실려 오지 않는다(전화번호와
-- OTP뿐). 그래서 OTP를 요청하는 서버 액션이 발송 직전에 "이 번호의 인증은
-- 이 테넌트 소속"이라는 라우팅 행을 남기고, 훅이 그 행을 보고 발송 계정을
-- 고른다. 행이 없거나 오래됐거나 발송이 실패하면 플랫폼(넥스트랩) 계정 폴백.
--
-- 접근 정책: service_role 전용 (앱 서버 액션이 기록, 인증 훅이 조회).
-- RLS를 켜고 정책을 만들지 않는다 — 클라이언트 세션은 읽기·쓰기 전부 거부.
-- 추가 전용·멱등 (docs/ops/release-playbook.md §3).
-- ============================================================================

create table if not exists public.auth_otp_routing (
  -- 숫자만 남긴 국제 표기 (예: 821012345678) — 훅 페이로드의 user.phone과 동일 형식
  phone text primary key,
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.auth_otp_routing enable row level security;

comment on table public.auth_otp_routing is
  '인증 OTP 발송 계정 라우팅 — 테넌트 등록 링크(/j)에서 시작된 인증을 그 테넌트 BYO SMS 계정으로 보내기 위한 단기 힌트. 훅은 10분 이내 행만 신뢰. service_role 전용.';
