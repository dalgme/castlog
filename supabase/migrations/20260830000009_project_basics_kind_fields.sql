-- ============================================================================
-- 프로젝트 기본정보 확장 · 유형(행사/컨설팅) · 공용 분야 · 멘티 정보
-- (기획 확정 2026-08-30 — 신규 31~35번)
--
-- 31) 개설 필수 최소화(사업명·발주처)는 앱 스키마에서 처리 — DB 변경 없음.
-- 32) projects에 주관(host_org)·수행기관(executor_org)·D-Day(dday_date) 추가,
--     기초정보 수정 권한을 "그 프로젝트에 연결된 누구나"로 확대(컬럼 가드는
--     v_basic 화이트리스트 유지 — 상태·정산 컬럼은 계속 잠김).
-- 34) projects.project_kind ('event' 행사 / 'consulting' 컨설팅),
--     engagement_slots.period_end_date(컨설팅 수행기간 종료),
--     slot_mentees(멘티 소속/직위/이름/아이템명/유형 — 품의 본문에 동봉).
-- 35) tenant_session_fields(세션 분야 마스터 — 자사 직원 누구나 추가, 공용),
--     engagement_slots.field_id.
--
-- 멱등: add column if not exists / create or replace / drop-and-create.
-- ============================================================================

-- ---- 32. projects 확장 ------------------------------------------------------
alter table public.projects
  add column if not exists host_org text;
alter table public.projects
  add column if not exists executor_org text;
alter table public.projects
  add column if not exists dday_date date;

-- ---- 34. 프로젝트 유형 ------------------------------------------------------
alter table public.projects
  add column if not exists project_kind text not null default 'event';
alter table public.projects
  drop constraint if exists projects_project_kind_check;
alter table public.projects
  add constraint projects_project_kind_check
  check (project_kind in ('event', 'consulting'));

comment on column public.projects.project_kind is
  '프로젝트 유형 (기획 2026-08-30 — 34번): event=행사(캘린더 세션), consulting=컨설팅(수행기간·분야·멘티)';

-- ---- 35. 세션 분야 마스터 — 자사 직원 누구나 추가, 테넌트 공용 --------------
create table if not exists public.tenant_session_fields (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  name text not null,
  is_active boolean not null default true,
  created_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now()
);

-- 활성 행에만 유일성 — 비활성화된 이름은 재등록할 수 있어야 한다
-- (리뷰 P2-2: 전체 유니크면 비활성 동명 행이 영구 막다른 길이 된다)
create unique index if not exists tenant_session_fields_active_name_uidx
  on public.tenant_session_fields (tenant_id, name)
  where is_active;

alter table public.tenant_session_fields enable row level security;

drop policy if exists tenant_session_fields_select on public.tenant_session_fields;
create policy tenant_session_fields_select on public.tenant_session_fields
  for select using (
    tenant_id = app.tenant_id() and app.user_role() <> 'expert'
  );
-- 추가는 자사 직원 누구나 (기획 확정 — "누구나 추가하면 공통 사용")
drop policy if exists tenant_session_fields_insert on public.tenant_session_fields;
create policy tenant_session_fields_insert on public.tenant_session_fields
  for insert with check (
    tenant_id = app.tenant_id() and app.user_role() <> 'expert'
  );
-- 비활성화(정리)는 설정 위임 축 — 오타·중복 정리는 관리 행위다
drop policy if exists tenant_session_fields_update on public.tenant_session_fields;
create policy tenant_session_fields_update on public.tenant_session_fields
  for update using (
    tenant_id = app.tenant_id() and app.has_admin_scope('settings')
  )
  with check (tenant_id = app.tenant_id());

comment on table public.tenant_session_fields is
  '세션 분야 마스터 (기획 2026-08-30 — 35번). 자사 직원 누구나 추가, 전 직원 공용. 정리(비활성)는 설정 스코프.';

-- ---- 35·34. engagement_slots 확장 ------------------------------------------
alter table public.engagement_slots
  add column if not exists field_id uuid references public.tenant_session_fields (id) on delete set null;
alter table public.engagement_slots
  add column if not exists period_end_date date;

comment on column public.engagement_slots.period_end_date is
  '컨설팅 수행기간 종료일 (34번) — 행사 세션은 null(slot_date 단일 일자)';

-- ---- 34. 멘티 정보 ----------------------------------------------------------
create table if not exists public.slot_mentees (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  slot_id uuid not null references public.engagement_slots (id) on delete cascade,
  org_name text not null,
  position_title text,
  name text not null,
  item_name text,
  mentee_type text,
  sort_order int not null default 0,
  is_practice boolean not null default false,
  created_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists slot_mentees_slot_idx
  on public.slot_mentees (slot_id, sort_order);

alter table public.slot_mentees enable row level security;

-- 열람·기입: 자사 직원(전문가 제외) + 프로젝트 가시성 상속(슬롯→프로젝트)
drop policy if exists slot_mentees_select on public.slot_mentees;
create policy slot_mentees_select on public.slot_mentees
  for select using (
    tenant_id = app.tenant_id()
    and app.user_role() <> 'expert'
    and exists (
      select 1
      from public.engagement_slots sl
      join public.projects p on p.id = sl.project_id
      where sl.id = slot_id
    )
  );
drop policy if exists slot_mentees_write on public.slot_mentees;
create policy slot_mentees_write on public.slot_mentees
  for all using (
    tenant_id = app.tenant_id()
    and app.can_exec('planInput')
    and exists (
      select 1
      from public.engagement_slots sl
      join public.projects p on p.id = sl.project_id
      where sl.id = slot_id
    )
  )
  with check (
    tenant_id = app.tenant_id()
    and app.can_exec('planInput')
    -- INSERT는 with check만 적용된다 — 열람 범위 밖 슬롯으로의 삽입을 막는다
    -- (리뷰 P3-1: using과 동일한 가시성 상속)
    and exists (
      select 1
      from public.engagement_slots sl
      join public.projects p on p.id = sl.project_id
      where sl.id = slot_id
    )
  );

drop policy if exists slot_mentees_practice on public.slot_mentees;
create policy slot_mentees_practice on public.slot_mentees
  as restrictive for select using (is_practice = app.is_practice());

comment on table public.slot_mentees is
  '컨설팅 세션의 멘티 정보 (기획 2026-08-30 — 34번): 소속/직위/이름/아이템명/유형. 섭외계획 품의 본문에 동봉된다.';

-- ---- 32. 기초정보 수정 권한 — 연결된 누구나 (컬럼 가드 + 행 정책) -----------
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
  -- 연결된 담당자에게 열리는 것은 **기초정보 컬럼뿐**이다 (심층방어 유지 —
  -- 상태·종결·정산 컬럼은 계속 잠긴다). 32번 신설 컬럼 포함.
  v_basic text[] := array[
    'name', 'business_year', 'client_name', 'code', 'category_id',
    'starts_on', 'ends_on', 'budget_amount', 'description',
    'host_org', 'executor_org', 'dday_date', 'project_kind', 'updated_at'
  ];
begin
  if auth.role() = 'service_role' or app.can_exec('projectBudget') then
    return new;
  end if;
  -- 기획 개정 2026-08-30 (32번): 그 프로젝트에 **연결된 누구나**(배정 역할
  -- 무관 — 담당 포함) 기초정보를 수정·추가 기입할 수 있다.
  if app.project_assignment_role(new.id) is not null then
    if (to_jsonb(new) - v_basic - v_open) is distinct from (to_jsonb(old) - v_basic - v_open) then
      raise exception '기초정보 외 컬럼(상태·종결·정산 등)은 이 권한으로 수정할 수 없습니다 (권한 규칙).'
        using errcode = 'check_violation';
    end if;
    return new;
  end if;
  if (to_jsonb(new) - v_open) is distinct from (to_jsonb(old) - v_open) then
    raise exception '프로젝트 기본정보(예산·기간·상태 등) 수정 권한이 없습니다 (권한 규칙).'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop policy if exists projects_update on public.projects;
create policy projects_update on public.projects
  for update using (
    tenant_id = app.tenant_id()
    and (app.can_exec('planSubmit') or app.can_exec('engagementRequest')
         or app.can_exec('acceptanceSend') or app.can_exec('projectBudget')
         or app.project_assignment_role(id) is not null)
  )
  with check (
    tenant_id = app.tenant_id()
    and (app.can_exec('planSubmit') or app.can_exec('engagementRequest')
         or app.can_exec('acceptanceSend') or app.can_exec('projectBudget')
         or app.project_assignment_role(id) is not null)
  );
