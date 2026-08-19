-- ============================================================================
-- 프로젝트 카테고리 (공통 기반)
--
-- 요구: 프로젝트 개설 시 "창업 · 교육행사 · 엑셀러레이터 · 농업교육 · 로컬창업"처럼
--       분야별 카테고리를 지정하고, 추후 카테고리별 관리·특성화를 붙인다.
--       카테고리명은 대표 계정에서 설정한다.
--
-- 설계 판단
--  1) 카테고리명을 코드에 하드코딩하지 않는다. 기업마다 다르고 자주 바뀐다
--     (CLAUDE.md §14-2 운영 설정화). 테넌트별 설정 테이블로 둔다.
--  2) 프로젝트 개설은 **공통 기반**이므로(§1-2) 카테고리도 모듈 게이트를 걸지 않는다.
--  3) 삭제 대신 비활성화한다(§14-4). 카테고리를 지우면 그 카테고리로 집계해 둔
--     과거 프로젝트의 이력이 끊긴다. 비활성 카테고리는 새 프로젝트에서 고를 수
--     없지만 기존 프로젝트에는 그대로 남는다.
--  4) 프로젝트의 참조는 on delete set null이 아니라 restrict다 — 3)의 비활성화
--     원칙을 DB에서도 지킨다.
-- ============================================================================

create table if not exists public.project_categories (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null,
  -- 통계·특성화에서 쓸 안정 키. 이름이 바뀌어도 집계가 끊기지 않게 한다.
  slug text,
  description text,
  sort_order int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists project_categories_name_idx
  on public.project_categories (tenant_id, name);
create index if not exists project_categories_active_idx
  on public.project_categories (tenant_id, is_active, sort_order);

alter table public.project_categories enable row level security;

-- 열람: 자사 구성원 누구나 (프로젝트 개설 화면에서 골라야 한다)
drop policy if exists project_categories_select on public.project_categories;
create policy project_categories_select on public.project_categories
  for select using (tenant_id = app.tenant_id());

-- 관리: 대표 또는 settings 위임자
drop policy if exists project_categories_write on public.project_categories;
create policy project_categories_write on public.project_categories
  for all
  using (
    tenant_id = app.tenant_id()
    and (app.is_org_admin() or app.has_admin_scope('settings'))
  )
  with check (
    tenant_id = app.tenant_id()
    and (app.is_org_admin() or app.has_admin_scope('settings'))
  );

create trigger set_updated_at before update on public.project_categories
  for each row execute function app.set_updated_at();

-- 프로젝트 연결
alter table public.projects
  add column if not exists category_id uuid
    references public.project_categories(id) on delete restrict;

create index if not exists projects_category_idx
  on public.projects (tenant_id, category_id, business_year);

comment on column public.projects.category_id is
  '분야별 카테고리. 카테고리명은 테넌트가 설정한다(하드코딩 금지). 카테고리별 통계·특성화의 축.';
