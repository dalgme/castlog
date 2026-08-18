-- ============================================================================
-- 모듈 추가 요청 (CLAUDE.md §1-2-8)
--
--  * 모듈 조합은 계약(플랜) 정보다. 기업이 스스로 켜지 않고 **요청 → 캐스트로그
--    승인** 경로를 거친다. 결제 기능은 만들지 않는다 (§11 Hard NO 유지).
--  * 그동안 기업 화면에는 "플랫폼 관리자에게 요청하세요"라는 문구만 있고 요청할
--    수단이 없었다. 문구가 곧 막다른 길이었다.
--  * 삭제 없음 — 거절도 상태로 남긴다 (§14-4).
-- ============================================================================

create table if not exists public.tenant_module_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  -- 요청한 모듈 조합(켜 달라는 것만). 예: {"approvals": true}
  requested_modules jsonb not null,
  note text,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected', 'canceled')),
  requested_by uuid references public.users (id) on delete set null,
  decided_by uuid,                      -- 플랫폼관리자 auth user id
  decided_at timestamptz,
  decision_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists tenant_module_requests_tenant_idx
  on public.tenant_module_requests (tenant_id, status, created_at desc);

-- 대기 중인 요청은 테넌트당 1건만 — 중복 상신을 막는다.
create unique index if not exists tenant_module_requests_open_idx
  on public.tenant_module_requests (tenant_id)
  where status = 'pending';

create trigger set_updated_at before update on public.tenant_module_requests
  for each row execute function app.set_updated_at();

alter table public.tenant_module_requests enable row level security;

-- 조회: 자사 대표(또는 settings 위임자) + 플랫폼관리자
drop policy if exists tenant_module_requests_select on public.tenant_module_requests;
create policy tenant_module_requests_select on public.tenant_module_requests
  for select using (
    (tenant_id = app.tenant_id() and app.has_admin_scope('settings'))
    or app.is_platform_admin()
  );

-- 요청 생성: 자사 대표(또는 settings 위임자)만
drop policy if exists tenant_module_requests_insert on public.tenant_module_requests;
create policy tenant_module_requests_insert on public.tenant_module_requests
  for insert with check (
    tenant_id = app.tenant_id() and app.has_admin_scope('settings')
  );

-- 갱신: 기업은 자기 요청 취소만, 승인·거절은 플랫폼관리자만.
-- (기업이 status='approved'로 바꿔 스스로 켜는 걸 막기 위해 판정은 서버 액션에서
--  한 번 더 검사하고, 여기서는 행 접근만 제한한다)
drop policy if exists tenant_module_requests_update on public.tenant_module_requests;
create policy tenant_module_requests_update on public.tenant_module_requests
  for update using (
    (tenant_id = app.tenant_id() and app.has_admin_scope('settings'))
    or app.is_platform_admin()
  )
  with check (
    (tenant_id = app.tenant_id() and app.has_admin_scope('settings'))
    or app.is_platform_admin()
  );

comment on table public.tenant_module_requests is
  '기업의 모듈 추가 요청. 승인은 캐스트로그 관리모드에서만 — feature_flags는 서버가 반영.';

-- ---- 모듈 활성화 온보딩 안내 (§1-2-8) ---------------------------------------
-- 모듈이 새로 켜졌을 때 '무엇이 열렸는지·무엇을 이어야 하는지' 한 번 안내한다.
-- 확인하면 해제. 테넌트 단위가 아니라 사용자 단위로 둔다 — 사람마다 처음 보는
-- 시점이 다르다.
create table if not exists public.module_onboarding_acks (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  user_id uuid not null references public.users (id) on delete cascade,
  module_key text not null check (module_key in ('experts', 'approvals', 'operations')),
  acked_at timestamptz not null default now(),
  unique (user_id, module_key)
);

alter table public.module_onboarding_acks enable row level security;

drop policy if exists module_onboarding_acks_select on public.module_onboarding_acks;
create policy module_onboarding_acks_select on public.module_onboarding_acks
  for select using (tenant_id = app.tenant_id() and user_id = auth.uid());

drop policy if exists module_onboarding_acks_insert on public.module_onboarding_acks;
create policy module_onboarding_acks_insert on public.module_onboarding_acks
  for insert with check (tenant_id = app.tenant_id() and user_id = auth.uid());

comment on table public.module_onboarding_acks is
  '모듈 활성화 안내 확인 기록 (사용자별). 안내 배너 해제 판정용.';

-- 모듈이 켜진 시각 — 안내를 언제까지 보여줄지 판정한다.
-- feature_flags(JSONB) 안에 넣으면 갱신 경합이 나므로 별도 컬럼으로 둔다.
alter table public.tenants
  add column if not exists modules_changed_at timestamptz;

comment on column public.tenants.modules_changed_at is
  '모듈 조합이 마지막으로 바뀐 시각. 활성화 온보딩 안내 노출 판정에 쓴다.';
