-- ============================================================================
-- 단계 22: 출장품의 (approvals 확장 — 유류비 자동 계산)
--
-- 설계:
--  * 출장 유류비를 오피넷(유가)·네이버 지도(거리)로 자동 계산 → 지출 품의로 상신.
--    외부 API 키 미설정 시 담당자 수동 입력으로 우아하게 폴백(더미 금지 — 14-7).
--  * 업무 데이터는 전용 정규화 테이블(JSON 블롭 금지 — CLAUDE.md 8).
--  * 상신 시 지출 품의(approval_type=expense)와 연결. 상태는 연결된 결재를 따른다.
--  * 상신자는 본인(auth.uid()) — 임직원 누구나 자신의 출장품의를 올린다.
-- ============================================================================

create table public.travel_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  approval_id uuid references public.approvals (id) on delete set null,
  requester_user_id uuid not null references public.users (id) on delete restrict,
  purpose text not null,
  travel_date date,
  origin text,
  destination text,
  round_trip boolean not null default true,
  distance_km int not null default 0 check (distance_km >= 0),
  fuel_type text not null default 'gasoline'
    check (fuel_type in ('gasoline', 'diesel', 'lpg')),
  fuel_price_per_l int not null default 0 check (fuel_price_per_l >= 0), -- 원/L
  fuel_efficiency_kmpl int not null default 10 check (fuel_efficiency_kmpl > 0), -- km/L
  fuel_cost bigint not null default 0 check (fuel_cost >= 0),
  toll_cost bigint not null default 0 check (toll_cost >= 0),
  other_cost bigint not null default 0 check (other_cost >= 0),
  total_cost bigint not null default 0 check (total_cost >= 0),
  auto_source text, -- 자동계산 출처(예: 'opinet+naver'). 수동 시 null.
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index travel_requests_tenant_idx
  on public.travel_requests (tenant_id, created_at desc);
create index travel_requests_requester_idx
  on public.travel_requests (requester_user_id, created_at desc);
create index travel_requests_approval_idx
  on public.travel_requests (approval_id);

create trigger set_updated_at before update on public.travel_requests
  for each row execute function app.set_updated_at();

-- ============================================================================
-- RLS — 자사 테넌트 열람, 상신은 본인(임직원 누구나 자기 출장품의).
-- ============================================================================
alter table public.travel_requests enable row level security;

create policy travel_requests_select on public.travel_requests
  for select using (tenant_id = app.tenant_id());

create policy travel_requests_insert on public.travel_requests
  for insert with check (
    tenant_id = app.tenant_id() and requester_user_id = auth.uid()
  );
