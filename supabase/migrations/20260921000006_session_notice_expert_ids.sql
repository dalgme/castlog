-- 안내문자 전문가별 발송 (기획 지시 2026-09-21) — 섭외 확정 탭에서 전문가 한 명에게 보낸다.
-- expert_ids가 null이면 종전처럼 세션의 확정 전문가 전원, 값이 있으면 그 전문가들에게만.
-- 추가 전용·멱등 (§14-10 "SQL 먼저"). 코드는 컬럼 부재(42703)를 폴백한다.

alter table public.session_notices
  add column if not exists expert_ids uuid[];

comment on column public.session_notices.expert_ids is
  '발송 대상 전문가 제한 (기획 2026-09-21). null = 세션 확정 전문가 전원';
