-- ============================================================================
-- Phase B-1: 섭외 테이블(날짜별 타임테이블) + 넘버링코드
-- 근거: 사용자 요청 워크플로우 — "섭외 테이블 작성(날짜별 타임테이블, 타임테이블별
--       필요한 전문가 인원 및 역할, 각 비용) - 각 필요인원에 대한 넘버링코드 부여"
--
--  * engagement_slots      : 타임테이블 한 줄 (날짜 + 시간구간 + 역할 + 필요인원 + 비용)
--  * engagement_slot_positions : 슬롯 안의 개별 필요인원 1명 = 1행. 넘버링코드 부여.
--    → 코드별 후보군 조회·섭외요청·현황집계의 기준 단위가 된다.
--  * 가시성은 프로젝트를 따른다(권한자=전체, 담당자=배정분만) — projects RLS와 동일 조건.
-- ============================================================================

create table if not exists public.engagement_slots (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  slot_date date not null,
  starts_time time,
  ends_time time,
  role_type text not null,
  role_description text,                 -- 세부 역할(선택)
  required_count int not null default 1 check (required_count between 1 and 100),
  fee_amount bigint check (fee_amount is null or fee_amount >= 0), -- 1인당 비용
  location_name text,
  location_address text,
  notes text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint engagement_slots_role_type_check check (role_type in (
    'host','lecturer','mentor','judge','announcer','assistant','other'
  )),
  constraint engagement_slots_time_order
    check (starts_time is null or ends_time is null or starts_time < ends_time)
);
create index if not exists engagement_slots_project_idx
  on public.engagement_slots (project_id, slot_date, starts_time);

create trigger set_updated_at before update on public.engagement_slots
  for each row execute function app.set_updated_at();

-- 개별 필요인원 (넘버링코드 단위) ---------------------------------------------
create table if not exists public.engagement_slot_positions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  slot_id uuid not null references public.engagement_slots(id) on delete cascade,
  position_no int not null,              -- 슬롯 내 순번 (1..required_count)
  code text not null,                    -- 넘버링코드 (예: 0527-MEN-01)
  status text not null default 'open'
    check (status in ('open', 'requested', 'filled', 'canceled')),
  engagement_id uuid references public.expert_engagements(id) on delete set null,
  expert_id uuid references public.experts(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (slot_id, position_no)
);
create index if not exists engagement_slot_positions_slot_idx
  on public.engagement_slot_positions (slot_id, position_no);
create index if not exists engagement_slot_positions_engagement_idx
  on public.engagement_slot_positions (engagement_id);
create unique index if not exists engagement_slot_positions_code_idx
  on public.engagement_slot_positions (tenant_id, code);

create trigger set_updated_at before update on public.engagement_slot_positions
  for each row execute function app.set_updated_at();

-- ---- RLS: 프로젝트 가시성 상속 ----------------------------------------------
alter table public.engagement_slots enable row level security;
alter table public.engagement_slot_positions enable row level security;

-- 조회: 해당 프로젝트가 보이는 사용자만 (projects RLS가 배정 기준으로 이미 좁혀져 있음)
create policy engagement_slots_select on public.engagement_slots
  for select using (
    tenant_id = app.tenant_id()
    and exists (select 1 from public.projects p where p.id = project_id)
  );
-- 작성·수정·삭제: 관리자 이상
create policy engagement_slots_insert on public.engagement_slots
  for insert with check (
    tenant_id = app.tenant_id() and app.user_role() in ('org_admin','manager')
  );
create policy engagement_slots_update on public.engagement_slots
  for update using (
    tenant_id = app.tenant_id() and app.user_role() in ('org_admin','manager')
  )
  with check (
    tenant_id = app.tenant_id() and app.user_role() in ('org_admin','manager')
  );
create policy engagement_slots_delete on public.engagement_slots
  for delete using (
    tenant_id = app.tenant_id() and app.user_role() in ('org_admin','manager')
  );

create policy engagement_slot_positions_select on public.engagement_slot_positions
  for select using (
    tenant_id = app.tenant_id()
    and exists (select 1 from public.engagement_slots s where s.id = slot_id)
  );
create policy engagement_slot_positions_insert on public.engagement_slot_positions
  for insert with check (
    tenant_id = app.tenant_id() and app.user_role() in ('org_admin','manager')
  );
create policy engagement_slot_positions_update on public.engagement_slot_positions
  for update using (
    tenant_id = app.tenant_id() and app.user_role() in ('org_admin','manager')
  )
  with check (
    tenant_id = app.tenant_id() and app.user_role() in ('org_admin','manager')
  );
create policy engagement_slot_positions_delete on public.engagement_slot_positions
  for delete using (
    tenant_id = app.tenant_id() and app.user_role() in ('org_admin','manager')
  );
