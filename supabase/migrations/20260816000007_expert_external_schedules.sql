-- ============================================================================
-- 전문가 활동 캘린더 — 외부(캐스트로그 밖)에서 직접 섭외된 일정 직접 입력(#2 확장)
-- 설계: docs/decisions/expert-utility-features.md §B-2
--
--  * 전역 테이블(전문가 소유, RLS 본인). 캐스트로그 섭외는 expert_engagements에서
--    파생하고, 외부 섭외 일정은 전문가가 직접 여기에 기입한다(캘린더에서 구분 표시).
--  * shared_with_tenants=true 인 외부 일정은 '가용성 확인' 목적에 한해 연결 기업에
--    노출된다. 단, 다른 테넌트의 캐스트로그 섭외 일정은 절대 교차 노출하지 않는다(§4).
--    기업 조회는 서버(관리자 클라이언트)에서 연결 확인 후 shared 항목만 반환.
-- ============================================================================
create table if not exists public.expert_external_schedules (
  id uuid primary key default gen_random_uuid(),
  expert_id uuid not null references public.experts(id) on delete cascade,
  title text not null,
  org_name text,                        -- 섭외 기관/주최
  location text,                        -- 장소
  starts_at timestamptz not null,
  ends_at timestamptz,
  all_day boolean not null default false,
  memo text,
  -- 연결 기업의 '가용성 사전 확인'에 노출할지 여부(전문가 통제). 기본 공유.
  shared_with_tenants boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint expert_external_schedules_time_order
    check (ends_at is null or ends_at >= starts_at)
);

create index if not exists expert_external_schedules_expert_idx
  on public.expert_external_schedules (expert_id, starts_at);
create index if not exists expert_external_schedules_shared_idx
  on public.expert_external_schedules (expert_id, starts_at)
  where shared_with_tenants;

create trigger set_updated_at before update on public.expert_external_schedules
  for each row execute function app.set_updated_at();

alter table public.expert_external_schedules enable row level security;

create policy expert_external_schedules_self_select on public.expert_external_schedules
  for select using (app.is_expert_self(expert_id));
create policy expert_external_schedules_self_insert on public.expert_external_schedules
  for insert with check (app.is_expert_self(expert_id));
create policy expert_external_schedules_self_update on public.expert_external_schedules
  for update using (app.is_expert_self(expert_id))
  with check (app.is_expert_self(expert_id));
create policy expert_external_schedules_self_delete on public.expert_external_schedules
  for delete using (app.is_expert_self(expert_id));
