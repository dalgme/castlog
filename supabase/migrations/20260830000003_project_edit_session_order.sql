-- ============================================================================
-- 프로젝트 편집권 확대 + 세션 수동 정렬 (기획 확정 2026-08-30 오후)
--
-- 1) 기초정보 수정 권한을 PM급 이상으로 — "PM급 이상에게 제목·내용·수정
--    권한을 기본 제공" 확정. DB 컬럼 가드(app.guard_project_update_grade)가
--    projectBudget 축(기본 팀장)만 인정해 대리 PM의 이름·설명 수정이 트리거에
--    막혔다. 그 프로젝트의 PL·PM(겸임 포함)이면 통과하도록 확장한다.
--    (앱 게이트도 같은 기준 — basic-info-actions.ts)
-- 2) engagement_slots.sort_order — 세션 드래그 순서 변경용. null이면 기존
--    정렬(날짜·시작시간)로 폴백한다 (§14-10 부재 폴백과 같은 원리).
--
-- 멱등: create or replace / add column if not exists.
-- ============================================================================

-- ---- 1. 프로젝트 컬럼 가드 — PL·PM(겸임)도 기초정보 수정 가능 ---------------
create or replace function app.guard_project_update_grade()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_open text[] := array[
    'engagement_stage', 'engagement_plan_approval_id',
    'engagement_channel', 'engagement_deadline', 'engagement_requested_at',
    'acceptance_channel', 'acceptance_sent_at', 'updated_at'
  ];
begin
  if auth.role() = 'service_role'
     or app.can_exec('projectBudget')
     -- PM급 이상(그 프로젝트의 PL·PM·겸임)은 기초정보를 수정할 수 있다
     -- (기획 확정 2026-08-30 — 배정 계단과 같은 역할 축)
     or app.project_assignment_role(new.id) in ('pl', 'pl_pm', 'pm') then
    return new;
  end if;
  if (to_jsonb(new) - v_open) is distinct from (to_jsonb(old) - v_open) then
    raise exception '프로젝트 기본정보(예산·기간·상태 등) 수정 권한이 없습니다 (권한 규칙).'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

-- ---- 2. 세션 수동 정렬 -------------------------------------------------------
alter table public.engagement_slots
  add column if not exists sort_order int;

comment on column public.engagement_slots.sort_order is
  '세션 수동 정렬 순서 (드래그) — null이면 날짜·시작시간 정렬로 폴백';
