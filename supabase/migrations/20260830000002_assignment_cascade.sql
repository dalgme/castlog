-- ============================================================================
-- 프로젝트 배정 권한 계단화 (기획 확정 2026-08-30)
--
-- 기존: 배정·해제·역할 변경은 대표·이사(can_view_all_projects)만.
-- 확정: 대표·이사 → PL 이하 전부 / PL(겸임 포함) → PM 이하 전부 /
--       PM(겸임 포함) → 부PM 이하 / 부PM → 담당.
-- 근거: 팀장이 개설한 프로젝트가 대표·이사의 배정 없이는 팀을 못 꾸리는
-- 막다른 길이었다(시뮬레이션 P1-8). 개설자는 앱이 자동으로 PL로 배정한다.
--
-- 역할 최소 레벨 트리거(app.enforce_assignment_role_grade)는 그대로 최종
-- 강제된다 — 계단은 "누가 지정하나", 트리거는 "누구를 지정할 수 있나"다.
--
-- 멱등: create or replace / drop-and-create 쌍.
-- ============================================================================

-- ---- 1. 계단 판정 헬퍼 -------------------------------------------------------
create or replace function app.can_assign_project_role(
  p_project_id uuid,
  p_role text
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select app.can_view_all_projects()
    or case app.project_assignment_role(p_project_id)
         when 'pl'        then p_role in ('pm', 'deputy_pm', 'member')
         when 'pl_pm'     then p_role in ('pm', 'deputy_pm', 'member')
         when 'pm'        then p_role in ('deputy_pm', 'member')
         when 'deputy_pm' then p_role = 'member'
         else false
       end
$$;

revoke all on function app.can_assign_project_role(uuid, text) from public;
grant execute on function app.can_assign_project_role(uuid, text) to authenticated;

comment on function app.can_assign_project_role(uuid, text) is
  '배정 계단: 대표·이사=전부 / PL(겸임)→PM 이하 / PM(겸임)→부PM 이하 / 부PM→담당';

-- ---- 2. 배정 정책을 계단 기준으로 재정의 -------------------------------------
drop policy if exists project_assignments_insert on public.project_assignments;
create policy project_assignments_insert on public.project_assignments
  for insert with check (
    tenant_id = app.tenant_id()
    and app.can_assign_project_role(project_id, assignment_role)
  );

-- 해제·역할 변경은 "그 역할을 지정할 수 있는 사람"이 할 수 있다
drop policy if exists project_assignments_delete on public.project_assignments;
create policy project_assignments_delete on public.project_assignments
  for delete using (
    tenant_id = app.tenant_id()
    and app.can_assign_project_role(project_id, assignment_role)
  );

drop policy if exists project_assignments_update on public.project_assignments;
create policy project_assignments_update on public.project_assignments
  for update using (
    tenant_id = app.tenant_id()
    and app.can_assign_project_role(project_id, assignment_role)
  )
  with check (
    tenant_id = app.tenant_id()
    and app.can_assign_project_role(project_id, assignment_role)
  );

-- ---- 3. 배정 목록 열람 — 같은 프로젝트 팀원에게 개방 -------------------------
-- PL·PM·부PM이 배정을 관리하려면 팀 구성이 보여야 한다. 기존 정책(전사
-- 권한자 or 본인 행)에서는 PL조차 자기 팀 명단을 못 봤다. 담당자 배정
-- 목록은 팀 구성 정보이므로 그 프로젝트의 배정자 전원에게 연다 —
-- 다른 프로젝트의 명단은 여전히 보이지 않는다(§3-1 열람 범위 유지).
drop policy if exists project_assignments_select on public.project_assignments;
create policy project_assignments_select on public.project_assignments
  for select using (
    tenant_id = app.tenant_id()
    and (
      app.can_view_all_projects()
      or user_id = auth.uid()
      or app.project_assignment_role(project_id) is not null
    )
  );
