-- ============================================================================
-- 프로젝트 캘린더 일정표 — 일자 스캐폴드 (기획 확정 2026-08-30 — 29번)
--
-- 기본설정 탭의 캘린더: "7월 26일(수)~7월 28일(금)"처럼 기간을 만들면 일자별
-- 시간표 열이 자동 생성되고, "7월 26일, 8월 3일, 8월 8일"처럼 개별 날짜도
-- 추가할 수 있다. 각 일자에 세션(일정/시간구간/세션명)을 등록하면 그대로
-- engagement_slots(세션 계획 등록의 원본)로 저장된다 — 세션 데이터는 이
-- 테이블에 두지 않는다. 이 테이블은 **아직 세션이 없는 날짜**를 기억하는
-- 스캐폴드일 뿐이다 (세션이 있는 날짜는 slots에서 파생).
--
-- 멱등: create if not exists / drop-and-create.
-- ============================================================================

create table if not exists public.project_calendar_days (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  day date not null,
  is_practice boolean not null default false,
  created_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (project_id, day)
);

create index if not exists project_calendar_days_project_idx
  on public.project_calendar_days (project_id, day);

alter table public.project_calendar_days enable row level security;

-- 열람: 자사 직원 (전문가 세션 제외 — 내부 계획 화면이다)
drop policy if exists project_calendar_days_select on public.project_calendar_days;
create policy project_calendar_days_select on public.project_calendar_days
  for select using (
    tenant_id = app.tenant_id() and app.user_role() <> 'expert'
  );

-- 생성·삭제: 세션 입력 축 (planInput — 기본 레벨 5, 회사 조정 반영)
drop policy if exists project_calendar_days_insert on public.project_calendar_days;
create policy project_calendar_days_insert on public.project_calendar_days
  for insert with check (
    tenant_id = app.tenant_id() and app.can_exec('planInput')
  );
drop policy if exists project_calendar_days_delete on public.project_calendar_days;
create policy project_calendar_days_delete on public.project_calendar_days
  for delete using (
    tenant_id = app.tenant_id() and app.can_exec('planInput')
  );

-- 연습모드 격리 — 자매 테이블들과 동일한 restrictive 정책
drop policy if exists project_calendar_days_practice on public.project_calendar_days;
create policy project_calendar_days_practice on public.project_calendar_days
  as restrictive for select using (is_practice = app.is_practice());

comment on table public.project_calendar_days is
  '프로젝트 캘린더 일정표의 일자 스캐폴드 (기획 2026-08-30 — 29번). 세션 자체는 engagement_slots가 원본이고, 여기는 세션 없는 날짜만 기억한다.';
