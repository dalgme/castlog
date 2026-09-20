-- ============================================================================
-- 세션 날짜 유형·회차·온오프라인 + 회당 단가 (기획 지시 2026-09-21)
--
--  * 세션(engagement_slots)이 날짜 유형을 갖는다:
--      continuous(연속형) = 시작일~종료일 한 덩어리, 회차 최소~최대
--      individual(개별선택형) = 특정 날짜 여러 개 (engagement_slot_dates)
--    기존 slot_date/period_end_date는 그대로 둔다 — 첫 날·마지막 날로 유지되어
--    날짜만 보던 화면(결재 상세·안내문자·캘린더)이 그대로 동작한다.
--  * 진행 방식 delivery_mode: online / offline / hybrid(병행)
--  * 회당 단가: 세션에 일괄 단가(unit_fee_online/offline), 후보(position)에는
--    개별 단가 + 총액(최소~최대) + '개별 수정' 표시(fee_custom → 코랄 표시)
--  * 추가 전용·멱등. 파괴적 변경 없음 (CLAUDE.md §14-10 "SQL 먼저").
-- ============================================================================

-- ---- 1. engagement_slots 확장 ----------------------------------------------
alter table public.engagement_slots
  add column if not exists date_kind text not null default 'individual'
    constraint engagement_slots_date_kind_check check (date_kind in ('continuous', 'individual')),
  add column if not exists end_starts_time time,
  add column if not exists end_ends_time time,
  add column if not exists session_count_min int
    constraint engagement_slots_session_count_min_check
    check (session_count_min is null or session_count_min between 1 and 999),
  add column if not exists session_count_max int
    constraint engagement_slots_session_count_max_check
    check (session_count_max is null or session_count_max between 1 and 999),
  add column if not exists delivery_mode text
    constraint engagement_slots_delivery_mode_check
    check (delivery_mode is null or delivery_mode in ('online', 'offline', 'hybrid')),
  add column if not exists unit_fee_online bigint
    constraint engagement_slots_unit_fee_online_check check (unit_fee_online is null or unit_fee_online >= 0),
  add column if not exists unit_fee_offline bigint
    constraint engagement_slots_unit_fee_offline_check check (unit_fee_offline is null or unit_fee_offline >= 0);

-- 기존 컨설팅 프로젝트의 수행기간 세션은 연속형이다
update public.engagement_slots s
   set date_kind = 'continuous'
  from public.projects p
 where p.id = s.project_id
   and p.project_kind = 'consulting'
   and s.period_end_date is not null
   and s.date_kind = 'individual';

-- ---- 2. 개별선택형 날짜 ----------------------------------------------------
create table if not exists public.engagement_slot_dates (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  slot_id uuid not null references public.engagement_slots(id) on delete cascade,
  on_date date not null,
  starts_time time,
  ends_time time,
  sort_order int not null default 0,
  is_practice boolean not null default false,
  created_at timestamptz not null default now(),
  unique (slot_id, on_date),
  constraint engagement_slot_dates_time_order
    check (starts_time is null or ends_time is null or starts_time < ends_time)
);
create index if not exists engagement_slot_dates_slot_idx
  on public.engagement_slot_dates (slot_id, on_date);

drop trigger if exists stamp_practice on public.engagement_slot_dates;
create trigger stamp_practice before insert on public.engagement_slot_dates
  for each row execute function app.stamp_practice();

alter table public.engagement_slot_dates enable row level security;

drop policy if exists engagement_slot_dates_select on public.engagement_slot_dates;
create policy engagement_slot_dates_select on public.engagement_slot_dates
  for select using (
    tenant_id = app.tenant_id()
    and exists (select 1 from public.engagement_slots s where s.id = slot_id)
  );
drop policy if exists engagement_slot_dates_insert on public.engagement_slot_dates;
create policy engagement_slot_dates_insert on public.engagement_slot_dates
  for insert with check (
    tenant_id = app.tenant_id()
    and app.has_exec_grade('senior')
    and exists (
      select 1 from public.engagement_slots s
      where s.id = slot_id and app.can_view_project(s.project_id)
    )
  );
drop policy if exists engagement_slot_dates_update on public.engagement_slot_dates;
create policy engagement_slot_dates_update on public.engagement_slot_dates
  for update using (
    tenant_id = app.tenant_id()
    and app.has_exec_grade('senior')
    and exists (
      select 1 from public.engagement_slots s
      where s.id = slot_id and app.can_view_project(s.project_id)
    )
  )
  with check (
    tenant_id = app.tenant_id()
    and app.has_exec_grade('senior')
    and exists (
      select 1 from public.engagement_slots s
      where s.id = slot_id and app.can_view_project(s.project_id)
    )
  );
drop policy if exists engagement_slot_dates_delete on public.engagement_slot_dates;
create policy engagement_slot_dates_delete on public.engagement_slot_dates
  for delete using (
    tenant_id = app.tenant_id()
    and app.has_exec_grade('senior')
    and exists (
      select 1 from public.engagement_slots s
      where s.id = slot_id and app.can_view_project(s.project_id)
    )
  );

-- 기존 개별(행사) 세션의 날짜를 한 건씩 옮겨 둔다 — 새 화면이 빈 목록을 보지 않게
insert into public.engagement_slot_dates (tenant_id, slot_id, on_date, starts_time, ends_time, sort_order, is_practice)
select s.tenant_id, s.id, s.slot_date, s.starts_time, s.ends_time, 0,
       coalesce((select p.is_practice from public.projects p where p.id = s.project_id), false)
  from public.engagement_slots s
 where s.date_kind = 'individual'
on conflict (slot_id, on_date) do nothing;

-- ---- 3. 후보(position) 회당 단가·총액·개별 수정 표시 --------------------------
alter table public.engagement_slot_positions
  add column if not exists unit_fee_online bigint
    constraint engagement_slot_positions_unit_fee_online_check check (unit_fee_online is null or unit_fee_online >= 0),
  add column if not exists unit_fee_offline bigint
    constraint engagement_slot_positions_unit_fee_offline_check check (unit_fee_offline is null or unit_fee_offline >= 0),
  add column if not exists expected_fee_max bigint
    constraint engagement_slot_positions_expected_fee_max_check check (expected_fee_max is null or expected_fee_max >= 0),
  add column if not exists fee_custom boolean not null default false;

comment on column public.engagement_slot_positions.fee_custom is
  '일괄 등록 단가에서 개별 수정한 금액 — 상신자·결재자 화면에 코랄색으로 표시';

-- ---- 확인 -------------------------------------------------------------------
-- select count(*) from information_schema.columns where table_name='engagement_slots'
--   and column_name in ('date_kind','end_starts_time','end_ends_time','session_count_min','session_count_max','delivery_mode','unit_fee_online','unit_fee_offline');  -- 8
-- select count(*) from pg_policies where tablename='engagement_slot_dates';  -- 4
-- select count(*) from information_schema.columns where table_name='engagement_slot_positions'
--   and column_name in ('unit_fee_online','unit_fee_offline','expected_fee_max','fee_custom');  -- 4
