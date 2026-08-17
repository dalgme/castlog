-- ============================================================================
-- 프로젝트 담당자 배정 + 권한 기반 가시성 (기업 대시보드 워크플로우 §13·§14)
--
--  * 권한자(대표=org_admin, 이사=manager)는 자사 전체 프로젝트를 보고 담당자를 배정한다.
--  * 담당 직원(staff)은 배정된 프로젝트만 볼 수 있다.
--  * tenant_id는 JWT(app.tenant_id())에서만. users.id = auth.users.id 이므로
--    user_id로 auth.uid()와 직접 매칭한다.
-- ============================================================================
create table if not exists public.project_assignments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  assigned_by uuid,
  created_at timestamptz not null default now(),
  unique (project_id, user_id)
);
create index if not exists project_assignments_user_idx
  on public.project_assignments (user_id);
create index if not exists project_assignments_project_idx
  on public.project_assignments (project_id);

alter table public.project_assignments enable row level security;

-- 권한자는 자사 전체 배정 조회, 담당자는 본인 배정만
create policy project_assignments_select on public.project_assignments
  for select using (
    tenant_id = app.tenant_id()
    and (app.user_role() in ('org_admin', 'manager') or user_id = auth.uid())
  );
-- 배정·해제는 권한자만
create policy project_assignments_insert on public.project_assignments
  for insert with check (
    tenant_id = app.tenant_id() and app.user_role() in ('org_admin', 'manager')
  );
create policy project_assignments_delete on public.project_assignments
  for delete using (
    tenant_id = app.tenant_id() and app.user_role() in ('org_admin', 'manager')
  );

-- ---- 프로젝트 가시성 재정의: 권한자=전체, 담당자=배정분만 ----
drop policy if exists projects_select on public.projects;
create policy projects_select on public.projects
  for select using (
    tenant_id = app.tenant_id()
    and (
      app.user_role() in ('org_admin', 'manager')
      or exists (
        select 1
        from public.project_assignments pa
        where pa.project_id = projects.id
          and pa.user_id = auth.uid()
      )
    )
  );
