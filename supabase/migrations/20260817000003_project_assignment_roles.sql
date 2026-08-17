-- ============================================================================
-- 프로젝트 담당 역할 — PM / 부PM / 담당자 (기획 확정)
--
--  * 배정 자체는 그대로 권한자(대표·이사)가 한다 (app.can_view_all_projects).
--  * PM·부PM은 프로젝트당 각 1명. 담당자(member)는 인원 제한 없음.
--  * 역할은 '누가 책임자인가'를 표시하는 운영 정보이며, 열람 범위는 배정 여부로
--    결정된다(역할이 무엇이든 배정되면 열람 가능) — 권한 판정을 복잡하게 만들지 않는다.
-- ============================================================================

alter table public.project_assignments
  add column if not exists assignment_role text not null default 'member';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'project_assignments_role_check'
  ) then
    alter table public.project_assignments
      add constraint project_assignments_role_check
      check (assignment_role in ('pm', 'deputy_pm', 'member'));
  end if;
end $$;

-- 프로젝트당 PM 1명 / 부PM 1명
create unique index if not exists project_assignments_pm_idx
  on public.project_assignments (project_id)
  where assignment_role = 'pm';
create unique index if not exists project_assignments_deputy_pm_idx
  on public.project_assignments (project_id)
  where assignment_role = 'deputy_pm';

-- 역할 변경도 배정과 같은 권한 (권한자만)
drop policy if exists project_assignments_update on public.project_assignments;
create policy project_assignments_update on public.project_assignments
  for update using (
    tenant_id = app.tenant_id() and app.can_view_all_projects()
  )
  with check (
    tenant_id = app.tenant_id() and app.can_view_all_projects()
  );

comment on column public.project_assignments.assignment_role is
  'pm(책임) / deputy_pm(부책임) / member(담당). 프로젝트당 pm·deputy_pm 각 1명.';
