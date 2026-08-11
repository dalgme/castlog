-- ============================================================================
-- 단계 23: 프로젝트 종료 기여도(합 100%) + 종료 품의서 게이트 (operations ↔ approvals)
--
-- 설계:
--  * 프로젝트 종료 시 참여 직원별 기여도(%)를 입력한다. 합계는 정확히 100%여야
--    하며(앱 레벨 강제), 이는 종료 품의 상신의 선행 조건이다.
--  * 종료는 '종료 품의(approval_type=project)' 승인으로만 확정된다(게이트).
--    approvals 비활성 테넌트는 결재 없이 직접 종료(단독 동작 경로).
--  * 기여도는 임원 대시보드(단계 24)의 직원별 성과 집계 근거가 된다 — 테넌트 격리.
-- ============================================================================

create table public.project_contributions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  user_id uuid not null references public.users (id) on delete cascade,
  percentage int not null check (percentage >= 0 and percentage <= 100),
  note text,
  created_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, user_id)
);

create index project_contributions_project_idx
  on public.project_contributions (tenant_id, project_id);
create index project_contributions_user_idx
  on public.project_contributions (tenant_id, user_id);

create trigger set_updated_at before update on public.project_contributions
  for each row execute function app.set_updated_at();

-- ---- 종료 품의 연결 + 종료 시각 (projects 확장) ----------------------------
alter table public.projects
  add column closing_approval_id uuid references public.approvals (id) on delete set null,
  add column closed_at timestamptz;

-- ============================================================================
-- RLS — 테넌트 격리. 작성·수정은 관리자 이상.
-- ============================================================================
alter table public.project_contributions enable row level security;

create policy project_contributions_select on public.project_contributions
  for select using (tenant_id = app.tenant_id());

create policy project_contributions_insert on public.project_contributions
  for insert with check (
    tenant_id = app.tenant_id()
    and app.user_role() in ('org_admin', 'manager')
  );

create policy project_contributions_update on public.project_contributions
  for update using (
    tenant_id = app.tenant_id()
    and app.user_role() in ('org_admin', 'manager')
  )
  with check (
    tenant_id = app.tenant_id()
    and app.user_role() in ('org_admin', 'manager')
  );

create policy project_contributions_delete on public.project_contributions
  for delete using (
    tenant_id = app.tenant_id()
    and app.user_role() in ('org_admin', 'manager')
  );
