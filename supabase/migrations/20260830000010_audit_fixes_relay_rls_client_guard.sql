-- ============================================================================
-- 8/30 전면 감사 결함 수정 (2026-08-30 저녁)
--
-- P1. 상급자 릴레이 결재(27번) — approvals 행 정책 미확장.
--     0007은 approval_steps_update만 직급 분기를 넣었고, approvals_select /
--     approvals_update(0730)는 approver_user_id = auth.uid()만 인정했다.
--     릴레이 단계는 approver_user_id가 null이라 대표(org_admin) 외에는 결재건이
--     목록·상세·처리 어디에서도 보이지 않았다. 두 정책에 직급 분기를 더한다
--     (앱 ↔ DB 게이트 동일 원칙 — 조건은 0007 approval_steps_update와 같다).
-- P3. 릴레이 결재자가 배정 없는 팀장이면 engagement_plans_select
--     (can_view_project)에 막혀 결재 상세의 후보 검토가 비었다 — 자기가
--     열람할 수 있는 결재건에 연결된 계획은 볼 수 있게 한다.
-- 정책. 발주처(client_name) 필수 (기획 확정 2026-08-30 — 31번 + 저녁 개정):
--     개설·수정 어느 경로에서도 빈 발주처로는 저장할 수 없다. 실수로 지운 뒤
--     저장하는 것까지 DB에서 막는다. 레거시 null 행은 건드리지 않는다(읽기는
--     그대로, 다음 수정 때 채워야 저장된다).
-- 추가 전용·멱등 (§14-10 "SQL 먼저").
-- ============================================================================

-- ---- P1. 릴레이 단계 열람·갱신 -------------------------------------------
-- 릴레이 단계가 이 사용자에게 열려 있는가 — 0007 approval_steps_update와 동일:
-- pending 단계 · 상신자 본인 제외 · 직급 이상 또는 그런 위임자의 유효한 대결자.
create or replace function app.can_act_grade_step(p_approval_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.approval_steps s
    join public.approvals a on a.id = s.approval_id
    where s.approval_id = p_approval_id
      and s.tenant_id = app.tenant_id()
      and s.approver_user_id is null
      and s.step_grade is not null
      and s.status = 'pending'
      and app.user_role() <> 'expert'
      and a.requester_user_id <> auth.uid()
      and (
        app.grade_rank(app.user_grade()) >= app.grade_rank(s.step_grade)
        or exists (
          select 1
          from public.approval_delegations d
          join public.users u on u.id = d.delegator_user_id
          where d.delegate_user_id = auth.uid()
            and d.is_active
            and d.starts_on <= current_date
            and current_date <= d.ends_on
            and u.tenant_id = app.tenant_id()
            and u.is_active
            and app.grade_rank(u.grade) >= app.grade_rank(s.step_grade)
            and a.requester_user_id <> d.delegator_user_id
        )
      )
  )
$$;

comment on function app.can_act_grade_step(uuid) is
  '릴레이(직급) 단계가 현재 사용자에게 열려 있는가 — approvals 행 정책과 approval_steps_update가 같은 판정을 쓴다 (감사 P1-1).';

-- 처리한 릴레이 단계는 acted_by_user_id에 남는다 — 처리 후에도 그 결재건을
-- 계속 볼 수 있어야 한다(내가 결재한 문서가 목록에서 사라지면 안 된다).
drop policy if exists approvals_select on public.approvals;
create policy approvals_select on public.approvals
  for select using (
    tenant_id = app.tenant_id()
    and (
      requester_user_id = auth.uid()
      or app.is_org_admin()
      or exists (
        select 1 from public.approval_steps s
        where s.approval_id = approvals.id
          and (
            s.approver_user_id = auth.uid()
            or s.acted_by_user_id = auth.uid()
            or app.is_active_delegate_of(s.approver_user_id)
          )
      )
      or app.can_act_grade_step(approvals.id)
    )
  );

drop policy if exists approvals_update on public.approvals;
create policy approvals_update on public.approvals
  for update using (
    tenant_id = app.tenant_id()
    and (
      requester_user_id = auth.uid()
      or app.is_org_admin()
      or exists (
        select 1 from public.approval_steps s
        where s.approval_id = approvals.id
          and (
            s.approver_user_id = auth.uid()
            or s.acted_by_user_id = auth.uid()
            or app.is_active_delegate_of(s.approver_user_id)
          )
      )
      or app.can_act_grade_step(approvals.id)
    )
  )
  with check (tenant_id = app.tenant_id());

-- 릴레이 단계 처리 정책도 같은 함수로 통일한다 (0007과 판정 동일, 중복 제거)
drop policy if exists approval_steps_update on public.approval_steps;
create policy approval_steps_update on public.approval_steps
  for update using (
    tenant_id = app.tenant_id()
    and (
      approver_user_id = auth.uid()
      or app.is_active_delegate_of(approver_user_id)
      or (
        approver_user_id is null
        and step_grade is not null
        and status = 'pending'
        and app.can_act_grade_step(approval_id)
      )
    )
  )
  with check (tenant_id = app.tenant_id());

-- ---- P3. 결재자의 계획 열람 ------------------------------------------------
-- 내가 열람할 수 있는 결재건(approvals RLS 통과)에 연결된 계획은 프로젝트
-- 배정과 무관하게 볼 수 있다 — 결재 상세의 후보 검토·멘티 확인용.
drop policy if exists engagement_plans_select on public.engagement_plans;
create policy engagement_plans_select on public.engagement_plans
  for select using (
    tenant_id = app.tenant_id()
    and (
      app.can_view_project(project_id)
      or (
        approval_id is not null
        and exists (select 1 from public.approvals a where a.id = engagement_plans.approval_id)
      )
    )
  );

-- ---- 정책. 발주처 빈 값 저장 차단 ----------------------------------------
create or replace function app.guard_project_client_name()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  -- 레거시(발주처 없는 기존 프로젝트)의 상태 전환·집계 갱신은 막지 않는다 —
  -- 발주처를 건드리지 않는 갱신은 통과, 발주처를 비우는 갱신만 거부한다.
  if tg_op = 'UPDATE' and new.client_name is not distinct from old.client_name then
    return new;
  end if;
  if new.client_name is null or btrim(new.client_name) = '' then
    raise exception '발주처는 필수입니다 — 비워 둔 채 저장할 수 없습니다 (필수 규칙).'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_project_client_name on public.projects;
create trigger trg_guard_project_client_name
  before insert or update on public.projects
  for each row execute function app.guard_project_client_name();

comment on function app.guard_project_client_name() is
  '발주처(client_name) 필수 — 개설·수정 모두 빈 값 저장 거부. 발주처를 건드리지 않는 레거시 행 갱신은 통과 (기획 확정 2026-08-30).';
