-- ============================================================================
-- 견적서 · 내부실견적서 · 정산서 (기획 지시 2026-09-09)
--
--  * project_quotes / _items      — 대외 견적서. 세부내역 자동계산, 절사 옵션,
--                                   버전(수정 시 이전본 보관).
--  * project_cost_sheets / _lines — 내부실견적서(internal)·정산서(settlement).
--    같은 구조라 kind로 구분한다. 왼쪽(견적/내부실견적)은 스냅샷으로 굳히고
--    오른쪽(지출·부가세 환급·수익)만 기입한다. 상급자 승인으로 확정되고,
--    수정하면 새 버전 초안이 생겨 재승인을 받는다.
--  * quote_logs                   — 언제·누가·어떤 값을 바꿨는지 (3종 공용).
--
-- 금액은 numeric(14,2) — 원 단위지만 비율 계산 중간값(부가세·환급)이 소수로
-- 떨어진다. 표시·저장 반올림은 앱(lib/quotes/calc.ts)이 한곳에서 정한다.
--
-- 추가 전용·멱등 (docs/ops/release-playbook.md §3 — SQL 먼저).
-- ============================================================================

-- ---- 견적서 ----------------------------------------------------------------
create table if not exists public.project_quotes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  version integer not null default 1,
  status text not null default 'draft' check (status in ('draft', 'issued')),
  -- 상단 정보 (프로젝트에서 자동 채움 후 문서별로 고칠 수 있다)
  title text not null default '',
  headcount text,
  period_text text,
  quote_date date,
  valid_text text,
  client_name text,
  -- 공급자(자사) 정보 — 발행 시점 스냅샷. 회사 정보가 바뀌어도 발행본은 그대로.
  supplier_name text,
  supplier_reg_no text,
  supplier_ceo text,
  supplier_address text,
  supplier_biz_type text,
  supplier_biz_item text,
  supplier_phone text,
  supplier_email text,
  -- 계산 파라미터
  indirect_label text not null default '일반운영비',
  indirect_rate numeric(6,4) not null default 0.05,
  profit_label text not null default '기업이윤',
  profit_rate numeric(6,4) not null default 0.07,
  vat_rate numeric(6,4) not null default 0.1,
  rounding text not null default 'none'
    check (rounding in ('none', 'floor_1k', 'floor_10k', 'floor_100k')),
  note text,
  issued_at timestamptz,
  issued_by uuid,
  is_practice boolean not null default false,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists project_quotes_project_idx
  on public.project_quotes (project_id, version desc);
create unique index if not exists project_quotes_version_uniq
  on public.project_quotes (project_id, version);

create table if not exists public.project_quote_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  quote_id uuid not null references public.project_quotes(id) on delete cascade,
  sort_order integer not null default 0,
  section text,               -- 항 목 (기획비·인건비·운영비·행사재료비 …)
  name text not null default '',  -- 세부내역
  qty numeric(14,2) not null default 1,
  qty_unit text,
  times numeric(14,2) not null default 1,
  times_unit text,
  days numeric(14,2) not null default 1,
  days_unit text,
  unit_price numeric(14,2) not null default 0,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists project_quote_items_quote_idx
  on public.project_quote_items (quote_id, sort_order);

-- ---- 내부실견적서 · 정산서 ---------------------------------------------------
create table if not exists public.project_cost_sheets (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  kind text not null check (kind in ('internal', 'settlement')),
  version integer not null default 1,
  status text not null default 'draft'
    check (status in ('draft', 'submitted', 'confirmed')),
  -- 왼쪽(읽기 전용) 원본 — internal은 견적서, settlement는 내부실견적서
  quote_id uuid references public.project_quotes(id) on delete set null,
  source_sheet_id uuid references public.project_cost_sheets(id) on delete set null,
  source_version integer,
  -- 왼쪽 합계 스냅샷 — 원본 버전이 올라가도 이 문서의 계산은 흔들리지 않는다
  base_total numeric(14,2) not null default 0,      -- 총계(부가세 포함)
  base_vat numeric(14,2) not null default 0,        -- 계약금액 부가세
  base_proposal numeric(14,2) not null default 0,   -- 절사 후 제안금액
  base_trimmed numeric(14,2) not null default 0,    -- 절사액
  -- 하단 필수 영역 (기획 지시: 출장교통비·사업담당자 예비비·계약금액 부가세)
  travel_note text,
  travel_amount numeric(14,2) not null default 0,
  travel_refundable boolean not null default false,
  reserve_note text,
  reserve_amount numeric(14,2) not null default 0,
  reserve_refundable boolean not null default false,
  -- 상급자 결재
  submitted_at timestamptz,
  submitted_by uuid,
  approved_at timestamptz,
  approved_by uuid,
  -- 상급자 승인하에 하급자가 수정 — 지정된 1인에게 다음 버전 작성을 연다
  edit_grant_to uuid,
  edit_grant_by uuid,
  edit_grant_at timestamptz,
  is_practice boolean not null default false,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists project_cost_sheets_project_idx
  on public.project_cost_sheets (project_id, kind, version desc);
create unique index if not exists project_cost_sheets_version_uniq
  on public.project_cost_sheets (project_id, kind, version);

create table if not exists public.project_cost_lines (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  sheet_id uuid not null references public.project_cost_sheets(id) on delete cascade,
  sort_order integer not null default 0,
  -- 왼쪽 스냅샷 (원본 항목) — 화면에서 수정할 수 없다
  base_section text,
  base_name text,
  base_amount numeric(14,2) not null default 0,
  -- 비교용 스냅샷 — 정산서에서 내부실견적의 지출·비고를 읽기 전용으로 나란히 본다
  compare_note text,
  compare_spend numeric(14,2),
  -- 오른쪽 기입
  note text,
  spend numeric(14,2) not null default 0,
  vat_refundable boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists project_cost_lines_sheet_idx
  on public.project_cost_lines (sheet_id, sort_order);

-- ---- 변경 로그 (3종 공용) -----------------------------------------------------
create table if not exists public.quote_logs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null,
  doc_type text not null check (doc_type in ('quote', 'internal', 'settlement')),
  doc_id uuid,
  version integer,
  action text not null,     -- doc.create / doc.update / doc.issue / doc.submit /
                            -- doc.approve / doc.reject / doc.new_version /
                            -- doc.edit_grant / item.add / item.update / item.delete / doc.export
  item_title text,
  field text,
  before_value text,
  after_value text,
  actor_user_id uuid,
  actor_name text,
  is_practice boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists quote_logs_doc_idx
  on public.quote_logs (doc_id, created_at desc);
create index if not exists quote_logs_project_idx
  on public.quote_logs (project_id, created_at desc);

-- ---- 트리거 ------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'project_quotes', 'project_quote_items', 'project_cost_sheets', 'project_cost_lines'
  ] loop
    execute format('drop trigger if exists set_updated_at on public.%I', t);
    execute format(
      'create trigger set_updated_at before update on public.%I
         for each row execute function app.set_updated_at()', t
    );
  end loop;
  foreach t in array array['project_quotes', 'project_cost_sheets', 'quote_logs'] loop
    execute format('drop trigger if exists stamp_practice on public.%I', t);
    execute format(
      'create trigger stamp_practice before insert on public.%I
         for each row execute function app.stamp_practice()', t
    );
  end loop;
end $$;

-- ---- RLS ---------------------------------------------------------------------
-- 견적서: 열람은 프로젝트 열람 범위, 쓰기는 프로젝트 팀.
-- 내부실견적·정산: 원가·수익이 담기므로 열람도 프로젝트 팀으로 좁힌다.
alter table public.project_quotes enable row level security;
alter table public.project_quote_items enable row level security;
alter table public.project_cost_sheets enable row level security;
alter table public.project_cost_lines enable row level security;
alter table public.quote_logs enable row level security;

drop policy if exists project_quotes_select on public.project_quotes;
create policy project_quotes_select on public.project_quotes
  for select using (
    tenant_id = app.tenant_id()
    and is_practice = app.is_practice()
    and app.can_view_project(project_id)
  );
drop policy if exists project_quotes_write on public.project_quotes;
create policy project_quotes_write on public.project_quotes
  for all using (
    tenant_id = app.tenant_id()
    and is_practice = app.is_practice()
    and app.is_project_team(project_id)
  )
  with check (
    tenant_id = app.tenant_id()
    and is_practice = app.is_practice()
    and app.is_project_team(project_id)
  );

drop policy if exists project_quote_items_select on public.project_quote_items;
create policy project_quote_items_select on public.project_quote_items
  for select using (
    tenant_id = app.tenant_id()
    and exists (
      select 1 from public.project_quotes q
      where q.id = quote_id and q.is_practice = app.is_practice()
        and app.can_view_project(q.project_id)
    )
  );
drop policy if exists project_quote_items_write on public.project_quote_items;
create policy project_quote_items_write on public.project_quote_items
  for all using (
    tenant_id = app.tenant_id()
    and exists (
      select 1 from public.project_quotes q
      where q.id = quote_id and q.is_practice = app.is_practice()
        and app.is_project_team(q.project_id)
    )
  )
  with check (
    tenant_id = app.tenant_id()
    and exists (
      select 1 from public.project_quotes q
      where q.id = quote_id and q.is_practice = app.is_practice()
        and app.is_project_team(q.project_id)
    )
  );

drop policy if exists project_cost_sheets_all on public.project_cost_sheets;
create policy project_cost_sheets_all on public.project_cost_sheets
  for all using (
    tenant_id = app.tenant_id()
    and is_practice = app.is_practice()
    and app.is_project_team(project_id)
  )
  with check (
    tenant_id = app.tenant_id()
    and is_practice = app.is_practice()
    and app.is_project_team(project_id)
  );

drop policy if exists project_cost_lines_all on public.project_cost_lines;
create policy project_cost_lines_all on public.project_cost_lines
  for all using (
    tenant_id = app.tenant_id()
    and exists (
      select 1 from public.project_cost_sheets s
      where s.id = sheet_id and s.is_practice = app.is_practice()
        and app.is_project_team(s.project_id)
    )
  )
  with check (
    tenant_id = app.tenant_id()
    and exists (
      select 1 from public.project_cost_sheets s
      where s.id = sheet_id and s.is_practice = app.is_practice()
        and app.is_project_team(s.project_id)
    )
  );

-- 로그는 남기고 지우지 않는다 (INSERT + SELECT만)
drop policy if exists quote_logs_select on public.quote_logs;
create policy quote_logs_select on public.quote_logs
  for select using (
    tenant_id = app.tenant_id()
    and is_practice = app.is_practice()
    and app.user_role() <> 'expert'
    and (project_id is null or app.can_view_project(project_id))
  );
drop policy if exists quote_logs_insert on public.quote_logs;
create policy quote_logs_insert on public.quote_logs
  for insert with check (
    tenant_id = app.tenant_id()
    and app.user_role() <> 'expert'
  );
