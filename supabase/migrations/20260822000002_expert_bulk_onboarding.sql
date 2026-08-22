-- ============================================================================
-- 보유자료 전문가 일괄 가입/등록 + 분야 마스터 + 관계기업 + 전문가 관리
-- (기획 개정 2026-08-22 — 신원 모델 v1.2에 '기업 보유자료 직접 등록' 예외 추가)
--
-- 1) experts 확장: 최종학위·자격증 / 강의(멘토링) 분야 '기타' 텍스트
--    (거주지는 기존 region 컬럼을 사용한다 — 근접 중복 컬럼을 만들지 않는다)
-- 2) expertise_fields: 강의(멘토링) 분야 전역 마스터 — 캐스트로그 관리모드 CRUD
-- 3) expert_expertise_fields: 전문가↔분야 다대다 (전문가 본인 중복 선택)
-- 4) expert_tenant_links.relation_source: 관계의 출처(자가등록/보유자료등록)
--    + engaged_at: 섭외 수락으로 관계가 실증된 최초 시각
--    ※ '관계기업' 표시는 이 링크 테이블로 판정한다. 기업에게는 자사 링크만
--      보인다(§4 테넌트 격리) — 타사 관계는 절대 노출하지 않는다.
-- 5) tenant_recruit_fields: 테넌트별 '섭외분야' 사전 — CEO 설정 CRUD
-- 6) expert_tenant_recruit_fields: 전문가↔섭외분야 배정 (테넌트 격리)
-- 7) expert_tenant_profiles: 테넌트별 전문가 평점·메모 (전문가 관리 탭)
--
-- 추가 전용·멱등 (docs/ops/release-playbook.md §3).
-- ============================================================================

-- 1) experts 확장 ------------------------------------------------------------
alter table public.experts
  add column if not exists degree_certifications text,
  add column if not exists expertise_other text;

comment on column public.experts.degree_certifications is '최종학위 및 자격증 (자유 텍스트)';
comment on column public.experts.expertise_other is '강의(멘토링) 분야 — 마스터에 없는 기타 항목 (자유 텍스트)';

-- 2) 강의(멘토링) 분야 전역 마스터 -------------------------------------------
create table if not exists public.expertise_fields (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  sort_order int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.expertise_fields enable row level security;

-- 전역 사전: 로그인한 모두가 읽는다 (선택지 목록). 쓰기는 플랫폼관리자만.
drop policy if exists expertise_fields_select on public.expertise_fields;
create policy expertise_fields_select on public.expertise_fields
  for select using (auth.uid() is not null);

drop policy if exists expertise_fields_write on public.expertise_fields;
create policy expertise_fields_write on public.expertise_fields
  for all using (app.is_platform_admin())
  with check (app.is_platform_admin());

-- 3) 전문가↔분야 -------------------------------------------------------------
create table if not exists public.expert_expertise_fields (
  expert_id uuid not null references public.experts (id) on delete cascade,
  field_id uuid not null references public.expertise_fields (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (expert_id, field_id)
);

alter table public.expert_expertise_fields enable row level security;

drop policy if exists expert_expertise_fields_select on public.expert_expertise_fields;
create policy expert_expertise_fields_select on public.expert_expertise_fields
  for select using (
    app.is_expert_self(expert_id)
    or app.tenant_linked_to_expert(expert_id)
    or app.is_platform_admin()
  );

-- 분야 선택은 전문가 본인의 것 (보유자료 등록은 service_role 경유)
drop policy if exists expert_expertise_fields_insert on public.expert_expertise_fields;
create policy expert_expertise_fields_insert on public.expert_expertise_fields
  for insert with check (app.is_expert_self(expert_id));

drop policy if exists expert_expertise_fields_delete on public.expert_expertise_fields;
create policy expert_expertise_fields_delete on public.expert_expertise_fields
  for delete using (app.is_expert_self(expert_id));

-- 4) 관계기업 출처 ------------------------------------------------------------
alter table public.expert_tenant_links
  add column if not exists relation_source text not null default 'self_join',
  add column if not exists engaged_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'expert_tenant_links_relation_source_check'
  ) then
    alter table public.expert_tenant_links
      add constraint expert_tenant_links_relation_source_check
      check (relation_source in ('self_join', 'bulk_registered'));
  end if;
end $$;

comment on column public.expert_tenant_links.relation_source is
  '관계의 출처 — self_join: 전문가 본인 등록(/j), bulk_registered: 기업 보유자료 직접 등록';
comment on column public.expert_tenant_links.engaged_at is
  '이 기업의 섭외를 전문가가 처음 수락한 시각 (관계 실증)';

-- 5) 테넌트별 섭외분야 사전 (CEO 설정 CRUD — project_categories 패턴) ---------
create table if not exists public.tenant_recruit_fields (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  name text not null,
  sort_order int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (tenant_id, name)
);

create index if not exists tenant_recruit_fields_tenant_idx
  on public.tenant_recruit_fields (tenant_id, is_active, sort_order);

alter table public.tenant_recruit_fields enable row level security;

drop policy if exists tenant_recruit_fields_select on public.tenant_recruit_fields;
create policy tenant_recruit_fields_select on public.tenant_recruit_fields
  for select using (tenant_id = app.tenant_id());

drop policy if exists tenant_recruit_fields_write on public.tenant_recruit_fields;
create policy tenant_recruit_fields_write on public.tenant_recruit_fields
  for all using (
    tenant_id = app.tenant_id()
    and (app.is_org_admin() or app.has_admin_scope('settings'))
  )
  with check (
    tenant_id = app.tenant_id()
    and (app.is_org_admin() or app.has_admin_scope('settings'))
  );

-- 6) 전문가↔섭외분야 (테넌트 격리 — 전문가 본인에게도 비노출) -----------------
create table if not exists public.expert_tenant_recruit_fields (
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  expert_id uuid not null references public.experts (id) on delete cascade,
  field_id uuid not null references public.tenant_recruit_fields (id) on delete cascade,
  created_by uuid,
  created_at timestamptz not null default now(),
  primary key (tenant_id, expert_id, field_id)
);

alter table public.expert_tenant_recruit_fields enable row level security;

drop policy if exists expert_tenant_recruit_fields_select on public.expert_tenant_recruit_fields;
create policy expert_tenant_recruit_fields_select on public.expert_tenant_recruit_fields
  for select using (
    tenant_id = app.tenant_id() and app.user_role() <> 'expert'
  );

drop policy if exists expert_tenant_recruit_fields_write on public.expert_tenant_recruit_fields;
create policy expert_tenant_recruit_fields_write on public.expert_tenant_recruit_fields
  for all using (
    tenant_id = app.tenant_id()
    and app.user_role() in ('org_admin', 'manager')
  )
  with check (
    tenant_id = app.tenant_id()
    and app.user_role() in ('org_admin', 'manager')
  );

-- 7) 테넌트별 전문가 평점·메모 (전문가 관리 탭 — 프로젝트 비귀속) -------------
create table if not exists public.expert_tenant_profiles (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  expert_id uuid not null references public.experts (id) on delete cascade,
  rating int check (rating between 1 and 10),
  memo text,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, expert_id)
);

alter table public.expert_tenant_profiles enable row level security;

-- 내부 평가는 전문가 본인에게 절대 비노출 (expert_tenant_tags와 동일 원칙)
drop policy if exists expert_tenant_profiles_select on public.expert_tenant_profiles;
create policy expert_tenant_profiles_select on public.expert_tenant_profiles
  for select using (
    tenant_id = app.tenant_id() and app.user_role() <> 'expert'
  );

drop policy if exists expert_tenant_profiles_write on public.expert_tenant_profiles;
create policy expert_tenant_profiles_write on public.expert_tenant_profiles
  for all using (
    tenant_id = app.tenant_id()
    and app.user_role() in ('org_admin', 'manager')
  )
  with check (
    tenant_id = app.tenant_id()
    and app.user_role() in ('org_admin', 'manager')
  );

do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgname = 'set_updated_at' and tgrelid = 'public.expert_tenant_profiles'::regclass
  ) then
    create trigger set_updated_at before update on public.expert_tenant_profiles
      for each row execute function app.set_updated_at();
  end if;
end $$;
