-- ============================================================================
-- CASTLOG 1차 스키마 (Phase 1 실행계획서 단계 4 / 설계문서 10장)
--
-- 원칙:
--  * 테넌트 데이터 테이블은 전부 tenant_id + RLS (설계문서 3.6)
--  * tenant_id는 JWT app_metadata에서만 읽는다 → app.tenant_id() 헬퍼 경유
--  * experts / expert_documents는 플랫폼 전역 테이블 — 연결(expert_tenant_links)과
--    열람 허용(expert_document_grants)이 있는 범위만 기업에 공개
--  * 주민등록번호 관련 컬럼은 만들지 않는다 (Phase 1 미수집 — 설계문서 4.4)
--  * audit_logs는 INSERT 전용
--  * 모든 테이블에 created_at / updated_at
-- ============================================================================

create extension if not exists "pgcrypto";

-- ----------------------------------------------------------------------------
-- 0. 헬퍼: JWT app_metadata 접근 (권한 판정의 유일한 진입점)
-- ----------------------------------------------------------------------------
create schema if not exists app;

-- RLS 정책이 app.* 헬퍼를 호출할 수 있도록 스키마 사용 권한 부여
grant usage on schema app to anon, authenticated, service_role;
alter default privileges in schema app
  grant execute on functions to anon, authenticated, service_role;

-- JWT app_metadata.tenant_id — 서버(service_role)만 심을 수 있는 값
create or replace function app.tenant_id()
returns uuid
language sql
stable
as $$
  select nullif(
    coalesce(auth.jwt() -> 'app_metadata' ->> 'tenant_id', ''),
    ''
  )::uuid
$$;

-- JWT app_metadata.role — 5단계 권한 (설계문서 3.1)
create or replace function app.user_role()
returns text
language sql
stable
as $$
  select coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '')
$$;

create or replace function app.is_platform_admin()
returns boolean
language sql
stable
as $$
  select app.user_role() = 'platform_admin'
$$;

create or replace function app.is_org_admin()
returns boolean
language sql
stable
as $$
  select app.user_role() in ('org_admin', 'platform_admin')
$$;

-- updated_at 자동 갱신
create or replace function app.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ----------------------------------------------------------------------------
-- 1. tenants — 기업 (테넌트)
--    로고·브랜드컬러 컬럼은 Phase 2 화이트라벨 대비 (실행계획서 2.3)
-- ----------------------------------------------------------------------------
create table public.tenants (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique
    check (slug ~ '^[a-z0-9](?:[a-z0-9]|-(?=[a-z0-9])){1,39}$'),
  name text not null,
  business_registration_number text,
  status text not null default 'active'
    check (status in ('active', 'suspended', 'terminated')),
  -- 화이트라벨 대비 (기능은 Phase 2)
  logo_url text,
  brand_color text check (brand_color is null or brand_color ~ '^#[0-9A-Fa-f]{6}$'),
  -- 계약 정보 (과금은 시스템 밖 — 참고용, 설계문서 4.1)
  plan_name text,
  contract_started_on date,
  contract_ends_on date,
  -- 기능 플래그 (자사 전용 요구는 하드코딩 대신 여기서 On/Off — 설계문서 1.3)
  feature_flags jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger set_updated_at before update on public.tenants
  for each row execute function app.set_updated_at();

-- ----------------------------------------------------------------------------
-- 2. positions — 직급 (기업별 관리, 하드코딩 금지 — 실행계획서 단계 8 대비 선반영)
-- ----------------------------------------------------------------------------
create table public.positions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  name text not null,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, name)
);

create index positions_tenant_idx on public.positions (tenant_id);

create trigger set_updated_at before update on public.positions
  for each row execute function app.set_updated_at();

-- ----------------------------------------------------------------------------
-- 3. users — 직원 계정 (auth.users 1:1)
-- ----------------------------------------------------------------------------
create table public.users (
  id uuid primary key, -- = auth.users.id
  tenant_id uuid not null references public.tenants (id) on delete restrict,
  name text not null,
  email text not null,
  phone text,
  department text,
  position_id uuid references public.positions (id) on delete set null,
  role text not null default 'staff'
    check (role in ('org_admin', 'manager', 'staff')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, email)
);

create index users_tenant_idx on public.users (tenant_id);

create trigger set_updated_at before update on public.users
  for each row execute function app.set_updated_at();

-- ----------------------------------------------------------------------------
-- 4. experts [전역] — 전문가 1인 = 1계정 (휴대폰 인증 기준 중복 방지)
-- ----------------------------------------------------------------------------
create table public.experts (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique, -- 셀프 가입 완료 시 연결
  name text not null,
  phone text not null unique, -- 중복 판정 기준 (설계문서 3.2)
  email text,
  specialty text,
  region text,
  career_years int check (career_years is null or career_years >= 0),
  bio text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger set_updated_at before update on public.experts
  for each row execute function app.set_updated_at();

-- 현재 세션이 특정 전문가 본인인지 (experts.auth_user_id 기준)
create or replace function app.is_expert_self(p_expert_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.experts e
    where e.id = p_expert_id and e.auth_user_id = auth.uid()
  )
$$;

-- ----------------------------------------------------------------------------
-- 5. expert_documents [전역] — 서류의 소유자는 전문가
--    실제 파일은 암호화 버킷, 여기는 메타데이터만. 민감 서류는 리사이즈 금지.
-- ----------------------------------------------------------------------------
create table public.expert_documents (
  id uuid primary key default gen_random_uuid(),
  expert_id uuid not null references public.experts (id) on delete cascade,
  document_type text not null check (document_type in (
    'resume',            -- 이력서
    'bank_account_copy', -- 통장사본
    'id_card_copy',      -- 신분증사본
    'business_card',     -- 명함
    'business_registration', -- 사업자등록증
    'signature'          -- 서명
  )),
  storage_path text not null, -- 암호화 버킷 내 경로 (공개 URL 금지)
  file_name text not null,
  file_size_bytes bigint check (file_size_bytes is null or file_size_bytes >= 0),
  mime_type text,
  status text not null default 'active'
    check (status in ('active', 'replaced', 'destroyed')),
  destroyed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index expert_documents_expert_idx on public.expert_documents (expert_id);

create trigger set_updated_at before update on public.expert_documents
  for each row execute function app.set_updated_at();

-- 서류 등록·수정 이력 (설계문서 10.1 expert_document_history)
create table public.expert_document_history (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.expert_documents (id) on delete cascade,
  expert_id uuid not null references public.experts (id) on delete cascade,
  action text not null check (action in ('created', 'updated', 'replaced', 'destroyed')),
  actor_auth_user_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index expert_document_history_doc_idx
  on public.expert_document_history (document_id);

-- ----------------------------------------------------------------------------
-- 6. expert_tenant_links — 전문가 ↔ 기업 연결
-- ----------------------------------------------------------------------------
create table public.expert_tenant_links (
  id uuid primary key default gen_random_uuid(),
  expert_id uuid not null references public.experts (id) on delete cascade,
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending', 'active', 'revoked')),
  requested_at timestamptz not null default now(),
  accepted_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (expert_id, tenant_id)
);

create index expert_tenant_links_tenant_idx on public.expert_tenant_links (tenant_id);
create index expert_tenant_links_expert_idx on public.expert_tenant_links (expert_id);

create trigger set_updated_at before update on public.expert_tenant_links
  for each row execute function app.set_updated_at();

-- 기업이 특정 전문가와 활성 연결을 갖는지 (RLS에서 사용)
create or replace function app.tenant_linked_to_expert(p_expert_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.expert_tenant_links l
    where l.expert_id = p_expert_id
      and l.tenant_id = app.tenant_id()
      and l.status = 'active'
  )
$$;

-- ----------------------------------------------------------------------------
-- 7. expert_document_grants — 기업별 서류 열람 허용 (명시적 허용 범위만)
-- ----------------------------------------------------------------------------
create table public.expert_document_grants (
  id uuid primary key default gen_random_uuid(),
  link_id uuid not null references public.expert_tenant_links (id) on delete cascade,
  document_type text not null check (document_type in (
    'resume', 'bank_account_copy', 'id_card_copy',
    'business_card', 'business_registration', 'signature'
  )),
  granted_at timestamptz not null default now(),
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (link_id, document_type)
);

create index expert_document_grants_link_idx on public.expert_document_grants (link_id);

create trigger set_updated_at before update on public.expert_document_grants
  for each row execute function app.set_updated_at();

-- 현재 테넌트가 해당 전문가의 특정 서류 유형을 열람할 수 있는지
create or replace function app.tenant_can_view_document(
  p_expert_id uuid,
  p_document_type text
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.expert_tenant_links l
    join public.expert_document_grants g on g.link_id = l.id
    where l.expert_id = p_expert_id
      and l.tenant_id = app.tenant_id()
      and l.status = 'active'
      and g.document_type = p_document_type
      and g.revoked_at is null
  )
$$;

-- ----------------------------------------------------------------------------
-- 8. expert_tax_profiles — 지급유형만 (주민등록번호 컬럼 절대 금지 — Phase 2)
-- ----------------------------------------------------------------------------
create table public.expert_tax_profiles (
  id uuid primary key default gen_random_uuid(),
  expert_id uuid not null unique references public.experts (id) on delete cascade,
  payment_type text check (payment_type in (
    'business_income', -- 사업소득 (개인, 3.3% 원천징수)
    'other_income',    -- 기타소득 (개인)
    'business'         -- 사업자 (세금계산서 — 주민번호 불필요)
  )),
  business_registration_number text, -- 사업자 청구 시에만
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger set_updated_at before update on public.expert_tax_profiles
  for each row execute function app.set_updated_at();

-- ----------------------------------------------------------------------------
-- 9. tax_project_grants — Phase 2 계약 시점 키 위임 대비 (지금은 빈 테이블)
--    섭외 승인 시점에 프로젝트 범위 열람 권한이 발생하는 구조의 자리 확보.
-- ----------------------------------------------------------------------------
create table public.tax_project_grants (
  id uuid primary key default gen_random_uuid(),
  expert_id uuid not null references public.experts (id) on delete cascade,
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  project_id uuid, -- projects 테이블은 단계 9에서 생성 — FK는 그때 추가
  status text not null default 'inactive'
    check (status in ('inactive', 'active', 'expired', 'revoked')),
  remaining_view_count int,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index tax_project_grants_tenant_idx on public.tax_project_grants (tenant_id);

create trigger set_updated_at before update on public.tax_project_grants
  for each row execute function app.set_updated_at();

-- ----------------------------------------------------------------------------
-- 10. consents — 동의 항목별 개별 기록 (하나로 묶지 않는다 — 설계문서 14.6)
--     주민등록번호 동의 항목은 만들지 않는다 (동의가 아니라 법령 근거 — 4.4절)
-- ----------------------------------------------------------------------------
create table public.consents (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null,
  consent_type text not null check (consent_type in (
    'terms_of_service',      -- 이용약관 (필수)
    'privacy_collection',    -- 개인정보 수집·이용 (필수)
    'id_card_processing',    -- 신분증사본 등 처리 (필수, 별도 분리)
    'document_share_tenant'  -- 이력서·통장사본의 연결 기업 제공 (연결 건별)
  )),
  granted boolean not null,
  terms_version text not null,
  -- document_share_tenant의 경우 대상 테넌트
  target_tenant_id uuid references public.tenants (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index consents_user_idx on public.consents (auth_user_id);

-- ----------------------------------------------------------------------------
-- 11. ad_consents — 광고성 정보 수신동의
--     개인정보 동의와 법적으로 별개이므로 반드시 별도 테이블 (설계문서 6.5)
-- ----------------------------------------------------------------------------
create table public.ad_consents (
  id uuid primary key default gen_random_uuid(),
  expert_id uuid references public.experts (id) on delete cascade,
  auth_user_id uuid,
  channel text not null check (channel in ('sms', 'email')),
  granted boolean not null,
  granted_at timestamptz,
  revoked_at timestamptz,
  terms_version text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (expert_id is not null or auth_user_id is not null)
);

create index ad_consents_expert_idx on public.ad_consents (expert_id);

create trigger set_updated_at before update on public.ad_consents
  for each row execute function app.set_updated_at();

-- ----------------------------------------------------------------------------
-- 12. audit_logs — INSERT 전용 (UPDATE/DELETE 불가)
-- ----------------------------------------------------------------------------
create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid, -- 전역 행위(전문가 포털 등)는 null 가능
  actor_auth_user_id uuid,
  actor_role text,
  action text not null,          -- 예: 'approval.approve', 'expert_document.view'
  resource_type text not null,   -- 예: 'approval', 'expert_document'
  resource_id uuid,
  before_data jsonb,
  after_data jsonb,
  ip_address inet,
  user_agent text,
  created_at timestamptz not null default now()
);

create index audit_logs_tenant_created_idx
  on public.audit_logs (tenant_id, created_at desc);
create index audit_logs_resource_idx
  on public.audit_logs (resource_type, resource_id);

-- 방어 2중화: RLS와 별개로 트리거 레벨에서도 UPDATE/DELETE 차단
create or replace function app.block_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'audit_logs는 INSERT 전용입니다 (%는 허용되지 않음)', tg_op;
end;
$$;

create trigger audit_logs_block_update
  before update or delete on public.audit_logs
  for each row execute function app.block_mutation();

-- ----------------------------------------------------------------------------
-- 13. tenant_usage_metrics — 사용량 미터링 (소급 불가 — 설계문서 4.2)
-- ----------------------------------------------------------------------------
create table public.tenant_usage_metrics (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  metric_date date not null,
  project_count int not null default 0,
  active_user_count int not null default 0,
  sms_sent_count int not null default 0,
  email_sent_count int not null default 0,
  storage_used_bytes bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, metric_date)
);

create index tenant_usage_metrics_tenant_idx
  on public.tenant_usage_metrics (tenant_id, metric_date desc);

create trigger set_updated_at before update on public.tenant_usage_metrics
  for each row execute function app.set_updated_at();

-- ----------------------------------------------------------------------------
-- 14. retention_policies — 유형별 보유기간 (자동 파기 스케줄러의 기준 — 8.6절)
-- ----------------------------------------------------------------------------
create table public.retention_policies (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references public.tenants (id) on delete cascade, -- null = 플랫폼 기본값
  data_category text not null check (data_category in (
    'tax_documents',   -- 세무 관련 서류
    'general_documents', -- 일반 서류
    'logs',            -- 로그
    'marketing_consent' -- 마케팅 동의
  )),
  retention_days int not null check (retention_days > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, data_category)
);

create trigger set_updated_at before update on public.retention_policies
  for each row execute function app.set_updated_at();

-- ============================================================================
-- RLS 정책
-- ============================================================================

-- ---- tenants ---------------------------------------------------------------
alter table public.tenants enable row level security;

create policy tenants_select on public.tenants
  for select using (
    app.is_platform_admin() or id = app.tenant_id()
  );

-- 테넌트 생성·수정은 플랫폼관리자만 (셀프 온보딩은 Phase 2)
create policy tenants_insert on public.tenants
  for insert with check (app.is_platform_admin());

create policy tenants_update on public.tenants
  for update using (app.is_platform_admin());

-- ---- positions -------------------------------------------------------------
alter table public.positions enable row level security;

create policy positions_select on public.positions
  for select using (tenant_id = app.tenant_id());

create policy positions_write on public.positions
  for all using (tenant_id = app.tenant_id() and app.is_org_admin())
  with check (tenant_id = app.tenant_id() and app.is_org_admin());

-- ---- users -----------------------------------------------------------------
alter table public.users enable row level security;

create policy users_select on public.users
  for select using (
    tenant_id = app.tenant_id() or app.is_platform_admin()
  );

create policy users_write on public.users
  for all using (tenant_id = app.tenant_id() and app.is_org_admin())
  with check (tenant_id = app.tenant_id() and app.is_org_admin());

-- ---- experts [전역] ---------------------------------------------------------
-- 기업은 활성 연결이 있는 전문가만 조회 (플랫폼 전체 풀 검색 금지 — 설계문서 3.2)
alter table public.experts enable row level security;

create policy experts_select on public.experts
  for select using (
    auth_user_id = auth.uid()             -- 전문가 본인
    or app.tenant_linked_to_expert(id)    -- 활성 연결이 있는 기업
  );

create policy experts_insert on public.experts
  for insert with check (auth_user_id = auth.uid());

create policy experts_update_self on public.experts
  for update using (auth_user_id = auth.uid())
  with check (auth_user_id = auth.uid());

-- ---- expert_documents [전역] ------------------------------------------------
-- 소유자는 전문가. 기업은 grants가 허용한 유형만 열람.
alter table public.expert_documents enable row level security;

create policy expert_documents_select on public.expert_documents
  for select using (
    app.is_expert_self(expert_id)
    or app.tenant_can_view_document(expert_id, document_type)
  );

create policy expert_documents_write on public.expert_documents
  for all using (app.is_expert_self(expert_id))
  with check (app.is_expert_self(expert_id));

-- ---- expert_document_history ----------------------------------------------
alter table public.expert_document_history enable row level security;

create policy expert_document_history_select on public.expert_document_history
  for select using (app.is_expert_self(expert_id));

create policy expert_document_history_insert on public.expert_document_history
  for insert with check (app.is_expert_self(expert_id));

-- ---- expert_tenant_links ---------------------------------------------------
alter table public.expert_tenant_links enable row level security;

-- 기업: 자사 연결만 / 전문가: 본인 연결 전부(전 기업 통합 뷰)
create policy expert_tenant_links_select on public.expert_tenant_links
  for select using (
    tenant_id = app.tenant_id()
    or app.is_expert_self(expert_id)
  );

-- 연결 요청 생성은 기업(관리자 이상)
create policy expert_tenant_links_insert on public.expert_tenant_links
  for insert with check (
    tenant_id = app.tenant_id()
    and app.user_role() in ('org_admin', 'manager')
  );

-- 수락·해제: 전문가 본인 (해제 시 즉시 접근 차단 — status로 판정되므로 자동)
create policy expert_tenant_links_update_expert on public.expert_tenant_links
  for update using (app.is_expert_self(expert_id))
  with check (app.is_expert_self(expert_id));

-- ---- expert_document_grants ------------------------------------------------
alter table public.expert_document_grants enable row level security;

create policy expert_document_grants_select on public.expert_document_grants
  for select using (
    exists (
      select 1 from public.expert_tenant_links l
      where l.id = link_id
        and (l.tenant_id = app.tenant_id() or app.is_expert_self(l.expert_id))
    )
  );

-- 열람 허용의 부여·회수는 서류 소유자인 전문가만
create policy expert_document_grants_write on public.expert_document_grants
  for all using (
    exists (
      select 1 from public.expert_tenant_links l
      where l.id = link_id and app.is_expert_self(l.expert_id)
    )
  )
  with check (
    exists (
      select 1 from public.expert_tenant_links l
      where l.id = link_id and app.is_expert_self(l.expert_id)
    )
  );

-- ---- expert_tax_profiles ---------------------------------------------------
alter table public.expert_tax_profiles enable row level security;

-- 전문가 본인 + 활성 연결 기업(지급유형 확인·서류 게이트 판단용)
create policy expert_tax_profiles_select on public.expert_tax_profiles
  for select using (
    app.is_expert_self(expert_id)
    or app.tenant_linked_to_expert(expert_id)
  );

create policy expert_tax_profiles_write on public.expert_tax_profiles
  for all using (app.is_expert_self(expert_id))
  with check (app.is_expert_self(expert_id));

-- ---- tax_project_grants (빈 테이블 — Phase 2 전까지 클라이언트 접근 차단) ----
alter table public.tax_project_grants enable row level security;
-- 정책 없음 = service_role 외 전면 차단

-- ---- consents --------------------------------------------------------------
alter table public.consents enable row level security;

create policy consents_select_self on public.consents
  for select using (auth_user_id = auth.uid());

create policy consents_insert_self on public.consents
  for insert with check (auth_user_id = auth.uid());
-- 동의 기록은 수정·삭제 정책 없음 (이력 보존 — 철회는 새 행으로 기록)

-- ---- ad_consents -----------------------------------------------------------
alter table public.ad_consents enable row level security;

create policy ad_consents_select on public.ad_consents
  for select using (
    (auth_user_id is not null and auth_user_id = auth.uid())
    or (expert_id is not null and app.is_expert_self(expert_id))
  );

create policy ad_consents_write on public.ad_consents
  for all using (
    (auth_user_id is not null and auth_user_id = auth.uid())
    or (expert_id is not null and app.is_expert_self(expert_id))
  )
  with check (
    (auth_user_id is not null and auth_user_id = auth.uid())
    or (expert_id is not null and app.is_expert_self(expert_id))
  );

-- ---- audit_logs (INSERT 전용) ----------------------------------------------
alter table public.audit_logs enable row level security;

-- 기록: 로그인한 사용자는 자기 테넌트(또는 전역 null) 범위로만 기록 가능
create policy audit_logs_insert on public.audit_logs
  for insert with check (
    auth.uid() is not null
    and (tenant_id is null or tenant_id = app.tenant_id() or app.is_platform_admin())
  );

-- 조회: 기업총괄관리자는 자사 범위 접속기록 조회 (설계문서 7.5)
create policy audit_logs_select on public.audit_logs
  for select using (
    (tenant_id = app.tenant_id() and app.is_org_admin())
    or app.is_platform_admin()
  );

-- UPDATE/DELETE 정책 없음 + 트리거 차단 + 권한 회수 (3중 방어)
revoke update, delete on public.audit_logs from anon, authenticated;

-- ---- tenant_usage_metrics --------------------------------------------------
alter table public.tenant_usage_metrics enable row level security;

-- 조회: 자사(총괄관리자) 또는 플랫폼관리자. 기록은 서버(service_role)만.
create policy tenant_usage_metrics_select on public.tenant_usage_metrics
  for select using (
    (tenant_id = app.tenant_id() and app.is_org_admin())
    or app.is_platform_admin()
  );

-- ---- retention_policies ----------------------------------------------------
alter table public.retention_policies enable row level security;

create policy retention_policies_select on public.retention_policies
  for select using (
    tenant_id is null
    or tenant_id = app.tenant_id()
    or app.is_platform_admin()
  );

create policy retention_policies_write on public.retention_policies
  for all using (
    (tenant_id = app.tenant_id() and app.is_org_admin())
    or app.is_platform_admin()
  )
  with check (
    (tenant_id = app.tenant_id() and app.is_org_admin())
    or app.is_platform_admin()
  );

-- ============================================================================
-- 플랫폼 기본 보유기간 (테넌트가 재정의 가능)
-- ============================================================================
insert into public.retention_policies (tenant_id, data_category, retention_days)
values
  (null, 'tax_documents', 1825),      -- 5년 (법정 보존 — 세무사 확인 후 조정)
  (null, 'general_documents', 1095),  -- 3년
  (null, 'logs', 730),                -- 2년
  (null, 'marketing_consent', 730);   -- 2년
