-- ============================================================================
-- 단계 9: 프로젝트 기본 구조 (operations 모듈 — 설계문서 6장 / CLAUDE.md 8)
--
-- 원칙:
--  * project_lifecycle_steps는 오케스트레이션 전용 (스텝유형·순서·상태·담당자·기한).
--    업무 데이터를 JSON 블롭으로 저장 금지 — 반드시 전용 정규화 테이블 (Hard NO 5).
--  * 프로젝트 삭제 없음 — 상태 전환(cancelled)으로 처리 (CLAUDE.md 14-4).
--  * business_year: 모든 통계의 사업연도 축 (CLAUDE.md 12-7).
-- ============================================================================

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  name text not null,
  code text, -- 내부 관리 코드 (선택)
  business_year int not null check (business_year between 2000 and 2100),
  client_name text, -- 발주처·주관기관
  status text not null default 'planned'
    check (status in ('planned', 'active', 'on_hold', 'completed', 'cancelled')),
  starts_on date,
  ends_on date,
  description text,
  created_by uuid, -- users.id
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index projects_tenant_year_idx
  on public.projects (tenant_id, business_year desc, created_at desc);

create trigger set_updated_at before update on public.projects
  for each row execute function app.set_updated_at();

-- ----------------------------------------------------------------------------
-- 21스텝 라이프사이클 — 오케스트레이션 전용
-- ----------------------------------------------------------------------------
create table public.project_lifecycle_steps (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  step_no int not null check (step_no > 0),
  step_type text not null check (step_type in (
    'preparation',  -- 준비
    'recruitment',  -- 모집
    'operation',    -- 운영
    'settlement',   -- 정산
    'reporting'     -- 보고·종료
  )),
  title text not null,
  status text not null default 'pending'
    check (status in ('pending', 'in_progress', 'completed', 'skipped')),
  assignee_user_id uuid references public.users (id) on delete set null,
  due_on date,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, step_no)
);

create index project_lifecycle_steps_project_idx
  on public.project_lifecycle_steps (tenant_id, project_id, step_no);

create trigger set_updated_at before update on public.project_lifecycle_steps
  for each row execute function app.set_updated_at();

-- ----------------------------------------------------------------------------
-- tax_project_grants.project_id FK — 1차 스키마에서 예약해 둔 연결 (단계 4 주석)
-- ----------------------------------------------------------------------------
alter table public.tax_project_grants
  add constraint tax_project_grants_project_id_fkey
  foreign key (project_id) references public.projects (id) on delete set null;

-- ============================================================================
-- RLS
-- ============================================================================

-- ---- projects --------------------------------------------------------------
alter table public.projects enable row level security;

create policy projects_select on public.projects
  for select using (tenant_id = app.tenant_id());

-- 생성·수정은 관리자 이상. DELETE 정책 없음 — 상태 전환으로만 처리.
create policy projects_insert on public.projects
  for insert with check (
    tenant_id = app.tenant_id()
    and app.user_role() in ('org_admin', 'manager')
  );

create policy projects_update on public.projects
  for update using (
    tenant_id = app.tenant_id()
    and app.user_role() in ('org_admin', 'manager')
  )
  with check (
    tenant_id = app.tenant_id()
    and app.user_role() in ('org_admin', 'manager')
  );

-- ---- project_lifecycle_steps ----------------------------------------------
alter table public.project_lifecycle_steps enable row level security;

create policy project_steps_select on public.project_lifecycle_steps
  for select using (tenant_id = app.tenant_id());

-- 스텝 구성(추가·삭제)은 관리자 이상
create policy project_steps_insert on public.project_lifecycle_steps
  for insert with check (
    tenant_id = app.tenant_id()
    and app.user_role() in ('org_admin', 'manager')
  );

create policy project_steps_delete on public.project_lifecycle_steps
  for delete using (
    tenant_id = app.tenant_id()
    and app.user_role() in ('org_admin', 'manager')
  );

-- 상태·담당자·기한 갱신은 테넌트 직원 전원 (진행 체크는 실무자 몫)
create policy project_steps_update on public.project_lifecycle_steps
  for update using (tenant_id = app.tenant_id())
  with check (tenant_id = app.tenant_id());
