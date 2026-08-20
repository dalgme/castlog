-- ============================================================================
-- 비밀번호 재설정 메일 쿨다운
--
-- 비밀번호 찾기 발송을 Supabase 내장(resetPasswordForEmail)에서 자체 발송으로
-- 옮기면서(#96) 내장 레이트리밋이 함께 사라졌다. /forgot-password는 로그인 없이
-- 열리는 공개 표면이라, 가입된 이메일 하나를 겨냥해 무한 반복 요청이 가능하다 —
-- 피해자 메일함 폭탄에 더해, generateLink가 호출마다 이전 토큰을 무효화하므로
-- 정상 링크까지 계속 죽는다.
--
-- 이메일당 마지막 발송 시각만 기록하고, 앱이 60초 안의 재요청을 조용히 삼킨다
-- (응답은 항상 성공 — 계정 존재 여부를 노출하지 않는 원칙 유지).
--
-- 전역 데이터다(발송 시점에 세션·테넌트가 없다). RLS는 켜되 정책을 만들지
-- 않는다 — service_role만 접근한다.
-- ============================================================================

create table if not exists public.auth_email_cooldowns (
  email text primary key,          -- 소문자 정규화하여 저장
  last_sent_at timestamptz not null default now()
);

alter table public.auth_email_cooldowns enable row level security;

comment on table public.auth_email_cooldowns is
  '비밀번호 재설정 메일 이메일당 쿨다운 (공개 표면 남용 방지 · service_role 전용).';
