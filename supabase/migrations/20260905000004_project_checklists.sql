-- ============================================================================
-- 프로젝트 체크리스트 (기획 지시 2026-09-05 — 렛츠 양식 ver.20260703)
--
-- 공통 기반 소속(모듈 게이트 없음). 두 층으로 나뉜다:
--  * 표준시트(checklist_templates / _items) — 테넌트별. 임직원 누구나 수정한다.
--    종류: common(공통) · typed(유형별) · kickoff(착수보고회) · deadline(마감일)
--         · venue(숙소·강의장) · supplies(준비물품, 여러 시트 가능)
--  * 프로젝트별 체크리스트(project_checklists / _items) — 표준시트를 불러와
--    프로젝트 팀(PL·PM·부PM·담당)과 전사 열람 권한자가 수정·추가·삭제한다.
--  * 마감일 계획 변경 사유(project_checklist_due_changes) — 등록 다음날부터의
--    변경은 사유 필수. 상급자가 열어 본 뒤에는 그 상급자만 사유를 고친다.
--  * 변경 로그(checklist_logs) — 언제·누가·어떤 항목을 추가/수정/삭제했는지.
--    업무 데이터가 아니라 로그 본문이므로 before/after는 text로 둔다.
--
-- 추가 전용·멱등 (docs/ops/release-playbook.md §3 — SQL 먼저).
-- ============================================================================

-- ---- 팀 판정 헬퍼 -------------------------------------------------------------
-- 프로젝트 팀(배정된 누구나) 또는 전사 열람 권한자(대표·이사·팀장 = org_admin/manager)
create or replace function app.is_project_team(p_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    p_project_id is not null
    and (
      app.user_role() in ('org_admin', 'manager')
      or app.is_platform_admin()
      or exists (
        select 1
        from public.project_assignments pa
        where pa.project_id = p_project_id
          and pa.user_id = auth.uid()
      )
    )
$$;
revoke all on function app.is_project_team(uuid) from public;
grant execute on function app.is_project_team(uuid) to authenticated;

-- ---- 표준시트 ------------------------------------------------------------------
create table if not exists public.checklist_templates (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  kind text not null check (kind in ('common','typed','kickoff','deadline','venue','supplies')),
  name text not null,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists checklist_templates_tenant_idx
  on public.checklist_templates (tenant_id, kind, sort_order);

create table if not exists public.checklist_template_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  template_id uuid not null references public.checklist_templates(id) on delete cascade,
  sort_order integer not null default 0,
  phase text,          -- 시기 (행사전/행사일/행사후)
  category text,       -- 구분 (유형별) / 사업 분류 / 구분(숙소·강의장·준비물품)
  subcategory text,    -- 세부 분류
  title text not null, -- 업무 내용 / 확인 내용 / 항목 / 진행 내용
  offset_days integer, -- 권장 마감일 (D-Day 기준 ±일)
  quantity text,       -- 수량 (준비물품)
  note text,           -- 참고사항 / 비고 / 결정사항 기본값
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists checklist_template_items_template_idx
  on public.checklist_template_items (template_id, sort_order);

-- ---- 프로젝트별 체크리스트 -----------------------------------------------------
create table if not exists public.project_checklists (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  kind text not null check (kind in ('common','typed','kickoff','deadline','venue','supplies')),
  template_id uuid references public.checklist_templates(id) on delete set null,
  name text not null,
  dday_date date,      -- 마감일 자동계산 기준 (프로젝트 D-Day에서 복사, 수정 가능)
  is_practice boolean not null default false,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists project_checklists_project_idx
  on public.project_checklists (project_id, kind);

create table if not exists public.project_checklist_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  checklist_id uuid not null references public.project_checklists(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  sort_order integer not null default 0,
  phase text,
  category text,
  subcategory text,
  title text not null,
  offset_days integer,
  quantity text,
  assignee_user_id uuid references public.users(id) on delete set null, -- 담당
  planned_due_on date,          -- 마감일 계획
  planned_due_set_on date,      -- 마감일 계획을 마지막으로 정한 날(KST) — 다음날부터 변경 사유 필수
  planned_due_set_by uuid,
  completed_on date,            -- 완료일
  note text,                    -- 참고사항 / 비고 / 진행 내용
  memo text,                    -- 실행목록별 메모
  check1 text,                  -- 1차 확인 / 발주기관 특이사항
  check2 text,                  -- 최종 확인 / 운영기관 특이사항
  decision text,                -- 결정사항 / 최종 점검 사항
  applicable text,              -- 해당사항 (착수보고)
  is_practice boolean not null default false,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists project_checklist_items_checklist_idx
  on public.project_checklist_items (checklist_id, sort_order);
create index if not exists project_checklist_items_project_idx
  on public.project_checklist_items (project_id);

create table if not exists public.project_checklist_due_changes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  item_id uuid not null references public.project_checklist_items(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  changed_on date not null,     -- 변경 일자 (팝업 입력)
  prev_due_on date,
  new_due_on date,
  reason text not null,         -- 변경 사유 (팝업 입력)
  changed_by uuid,              -- users.id
  changed_by_grade text,
  opened_by uuid,               -- 처음 열어 본 상급자 (users.id) — 이후 이 사람만 수정
  opened_at timestamptz,
  is_practice boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists project_checklist_due_changes_item_idx
  on public.project_checklist_due_changes (item_id, created_at);

-- ---- 변경 로그 -------------------------------------------------------------------
create table if not exists public.checklist_logs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  scope text not null check (scope in ('template','project')),
  template_id uuid references public.checklist_templates(id) on delete set null,
  checklist_id uuid references public.project_checklists(id) on delete set null,
  project_id uuid references public.projects(id) on delete set null,
  item_id uuid,
  action text not null,         -- item.add / item.update / item.delete / item.reorder / checklist.create / checklist.delete / due.change / due.reason_update / template.create / template.delete / dday.update
  item_title text,
  field text,
  before_value text,
  after_value text,
  actor_user_id uuid,           -- users.id
  actor_name text,
  is_practice boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists checklist_logs_template_idx
  on public.checklist_logs (template_id, created_at desc);
create index if not exists checklist_logs_checklist_idx
  on public.checklist_logs (checklist_id, created_at desc);

-- ---- updated_at · 연습모드 스탬프 ----------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'checklist_templates','checklist_template_items','project_checklists',
    'project_checklist_items','project_checklist_due_changes'
  ] loop
    execute format('drop trigger if exists set_updated_at on public.%I', t);
    execute format(
      'create trigger set_updated_at before update on public.%I
         for each row execute function app.set_updated_at()', t
    );
  end loop;
  foreach t in array array[
    'project_checklists','project_checklist_items','project_checklist_due_changes','checklist_logs'
  ] loop
    execute format('drop trigger if exists stamp_practice on public.%I', t);
    execute format(
      'create trigger stamp_practice before insert on public.%I
         for each row execute function app.stamp_practice()', t
    );
  end loop;
end $$;

-- ---- RLS ------------------------------------------------------------------------
alter table public.checklist_templates enable row level security;
alter table public.checklist_template_items enable row level security;
alter table public.project_checklists enable row level security;
alter table public.project_checklist_items enable row level security;
alter table public.project_checklist_due_changes enable row level security;
alter table public.checklist_logs enable row level security;

-- 표준시트: 자사 임직원(전문가 제외) 누구나 조회·수정 (기획 01·11·13·14)
drop policy if exists checklist_templates_all on public.checklist_templates;
create policy checklist_templates_all on public.checklist_templates
  for all using (tenant_id = app.tenant_id() and app.user_role() <> 'expert')
  with check (tenant_id = app.tenant_id() and app.user_role() <> 'expert');

drop policy if exists checklist_template_items_all on public.checklist_template_items;
create policy checklist_template_items_all on public.checklist_template_items
  for all using (tenant_id = app.tenant_id() and app.user_role() <> 'expert')
  with check (tenant_id = app.tenant_id() and app.user_role() <> 'expert');

-- 프로젝트별: 열람은 프로젝트 열람 범위, 쓰기는 프로젝트 팀 (기획 02~04·08)
drop policy if exists project_checklists_select on public.project_checklists;
create policy project_checklists_select on public.project_checklists
  for select using (
    tenant_id = app.tenant_id()
    and is_practice = app.is_practice()
    and app.can_view_project(project_id)
  );
drop policy if exists project_checklists_write on public.project_checklists;
create policy project_checklists_write on public.project_checklists
  for all using (
    tenant_id = app.tenant_id()
    and is_practice = app.is_practice()
    and app.is_project_team(project_id)
  )
  with check (
    tenant_id = app.tenant_id() and app.is_project_team(project_id)
  );

drop policy if exists project_checklist_items_select on public.project_checklist_items;
create policy project_checklist_items_select on public.project_checklist_items
  for select using (
    tenant_id = app.tenant_id()
    and is_practice = app.is_practice()
    and app.can_view_project(project_id)
  );
drop policy if exists project_checklist_items_write on public.project_checklist_items;
create policy project_checklist_items_write on public.project_checklist_items
  for all using (
    tenant_id = app.tenant_id()
    and is_practice = app.is_practice()
    and app.is_project_team(project_id)
  )
  with check (
    tenant_id = app.tenant_id() and app.is_project_team(project_id)
  );

drop policy if exists project_checklist_due_changes_select on public.project_checklist_due_changes;
create policy project_checklist_due_changes_select on public.project_checklist_due_changes
  for select using (
    tenant_id = app.tenant_id()
    and is_practice = app.is_practice()
    and app.can_view_project(project_id)
  );
-- 사유 수정 권한(작성자 / 오픈한 상급자)은 앱에서 판정한다 — 행 단위 규칙이
-- 두 사람의 직급 비교라 RLS로는 표현이 거칠다. 삽입·갱신 자체는 팀에 한한다.
drop policy if exists project_checklist_due_changes_write on public.project_checklist_due_changes;
create policy project_checklist_due_changes_write on public.project_checklist_due_changes
  for all using (
    tenant_id = app.tenant_id()
    and is_practice = app.is_practice()
    and app.is_project_team(project_id)
  )
  with check (
    tenant_id = app.tenant_id() and app.is_project_team(project_id)
  );

-- 로그: 자사 임직원 조회, 삽입만 (INSERT 전용)
drop policy if exists checklist_logs_select on public.checklist_logs;
create policy checklist_logs_select on public.checklist_logs
  for select using (
    tenant_id = app.tenant_id()
    and is_practice = app.is_practice()
    and app.user_role() <> 'expert'
  );
drop policy if exists checklist_logs_insert on public.checklist_logs;
create policy checklist_logs_insert on public.checklist_logs
  for insert with check (tenant_id = app.tenant_id() and app.user_role() <> 'expert');
