-- ============================================================================
-- 단계 10: 전자결재 엔진 (approvals 모듈 — 설계문서 9장 / CLAUDE.md 7)
--
-- 원칙:
--  * approval_rules(전결규정): 금액 구간·결재유형 조건 → 결재라인 자동 결정.
--    개정은 새 버전 행 생성(구 버전 비활성) — 개정 이력 보존 (CLAUDE.md 14-5).
--  * 병렬 합의: 같은 step_order의 결재자들은 순서 없이 동시 승인 (전원 승인 시 통과).
--  * 대결: approval_delegations 기간 내 대결자가 처리 가능.
--    처리 건은 원 결재자(approver)와 실제 처리자(acted_by)를 병기한다.
--  * 반려 후 재상신은 새 결재건 + resubmitted_from_id로 원 건 연결.
--  * 모든 결재 행위는 audit_logs 기록. 결재건 삭제 없음(취소 상태 전환만).
--  * project_id는 operations 모듈 연동 지점 — 양쪽 활성 시에만 노출 (CLAUDE.md 1-2-6).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. approvals — 품의서(결재건)
-- ----------------------------------------------------------------------------
create table public.approvals (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  title text not null,
  body text,
  approval_type text not null default 'general'
    check (approval_type in ('general', 'expense', 'payment', 'project')),
  amount bigint check (amount is null or amount >= 0), -- 원 단위
  project_id uuid references public.projects (id) on delete set null,
  status text not null default 'in_progress'
    check (status in ('in_progress', 'approved', 'rejected', 'canceled')),
  requester_user_id uuid not null references public.users (id) on delete restrict,
  resubmitted_from_id uuid references public.approvals (id) on delete set null,
  applied_rule_id uuid, -- 적용된 전결규정 (FK는 아래 rules 생성 후 추가)
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index approvals_tenant_idx
  on public.approvals (tenant_id, status, created_at desc);
create index approvals_requester_idx
  on public.approvals (requester_user_id, created_at desc);

create trigger set_updated_at before update on public.approvals
  for each row execute function app.set_updated_at();

-- ----------------------------------------------------------------------------
-- 2. approval_steps — 결재라인 단계 (같은 step_order = 병렬 합의 그룹)
-- ----------------------------------------------------------------------------
create table public.approval_steps (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  approval_id uuid not null references public.approvals (id) on delete cascade,
  step_order int not null check (step_order > 0),
  step_kind text not null default 'approval'
    check (step_kind in ('approval', 'agreement')), -- 결재 / 합의(병렬)
  approver_user_id uuid not null references public.users (id) on delete restrict,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected')),
  acted_by_user_id uuid references public.users (id) on delete set null, -- 대결 처리자
  acted_at timestamptz,
  comment text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (approval_id, step_order, approver_user_id)
);

create index approval_steps_approval_idx
  on public.approval_steps (approval_id, step_order);
create index approval_steps_approver_idx
  on public.approval_steps (approver_user_id, status);

create trigger set_updated_at before update on public.approval_steps
  for each row execute function app.set_updated_at();

-- ----------------------------------------------------------------------------
-- 3. approval_rules — 전결규정 (버전 관리: 개정 시 새 행 + 구 버전 비활성)
-- ----------------------------------------------------------------------------
create table public.approval_rules (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  name text not null,
  approval_type text
    check (approval_type is null or approval_type in ('general', 'expense', 'payment', 'project')),
  min_amount bigint check (min_amount is null or min_amount >= 0),
  max_amount bigint check (max_amount is null or max_amount >= 0),
  priority int not null default 0, -- 클수록 우선
  version int not null default 1,
  superseded_by_id uuid references public.approval_rules (id) on delete set null,
  is_active boolean not null default true,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index approval_rules_tenant_idx
  on public.approval_rules (tenant_id, is_active, priority desc);

create trigger set_updated_at before update on public.approval_rules
  for each row execute function app.set_updated_at();

alter table public.approvals
  add constraint approvals_applied_rule_id_fkey
  foreign key (applied_rule_id) references public.approval_rules (id) on delete set null;

-- 전결규정 결재라인 정의 (정규화 — JSON 저장 금지)
create table public.approval_rule_steps (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  rule_id uuid not null references public.approval_rules (id) on delete cascade,
  step_order int not null check (step_order > 0),
  step_kind text not null default 'approval'
    check (step_kind in ('approval', 'agreement')),
  approver_user_id uuid not null references public.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (rule_id, step_order, approver_user_id)
);

create index approval_rule_steps_rule_idx
  on public.approval_rule_steps (rule_id, step_order);

create trigger set_updated_at before update on public.approval_rule_steps
  for each row execute function app.set_updated_at();

-- ----------------------------------------------------------------------------
-- 4. approval_delegations — 대결·위임 (기간)
--    주의: 주민번호 조회 권한(tax_access)은 대결·위임 대상에서 제외 —
--    Phase 2 구현 시 코드로 강제한다 (설계문서 4.4).
-- ----------------------------------------------------------------------------
create table public.approval_delegations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  delegator_user_id uuid not null references public.users (id) on delete cascade,
  delegate_user_id uuid not null references public.users (id) on delete cascade,
  starts_on date not null,
  ends_on date not null,
  reason text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (delegator_user_id <> delegate_user_id),
  check (starts_on <= ends_on)
);

create index approval_delegations_tenant_idx
  on public.approval_delegations (tenant_id, delegate_user_id, is_active);

create trigger set_updated_at before update on public.approval_delegations
  for each row execute function app.set_updated_at();

-- 현재 세션이 특정 결재자의 유효한 대결자인지 (RLS·액션 공용)
create or replace function app.is_active_delegate_of(p_delegator uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.approval_delegations d
    where d.delegate_user_id = auth.uid()
      and d.delegator_user_id = p_delegator
      and d.tenant_id = app.tenant_id()
      and d.is_active
      and current_date between d.starts_on and d.ends_on
  )
$$;

-- ============================================================================
-- RLS
-- ============================================================================

-- ---- approvals -------------------------------------------------------------
alter table public.approvals enable row level security;

-- 조회: 상신자·결재라인 참여자(대결자 포함)·총괄관리자
create policy approvals_select on public.approvals
  for select using (
    tenant_id = app.tenant_id()
    and (
      requester_user_id = auth.uid()
      or app.is_org_admin()
      or exists (
        select 1 from public.approval_steps s
        where s.approval_id = approvals.id
          and (
            s.approver_user_id = auth.uid()
            or app.is_active_delegate_of(s.approver_user_id)
          )
      )
    )
  );

create policy approvals_insert on public.approvals
  for insert with check (
    tenant_id = app.tenant_id() and requester_user_id = auth.uid()
  );

-- 갱신: 상신자(취소)·결재 참여자(상태 전이)·총괄관리자. DELETE 정책 없음.
create policy approvals_update on public.approvals
  for update using (
    tenant_id = app.tenant_id()
    and (
      requester_user_id = auth.uid()
      or app.is_org_admin()
      or exists (
        select 1 from public.approval_steps s
        where s.approval_id = approvals.id
          and (
            s.approver_user_id = auth.uid()
            or app.is_active_delegate_of(s.approver_user_id)
          )
      )
    )
  )
  with check (tenant_id = app.tenant_id());

-- ---- approval_steps --------------------------------------------------------
alter table public.approval_steps enable row level security;

-- 조회는 테넌트 범위 (결재 현황 공유). approvals 정책과의 상호 재귀를 피한다.
create policy approval_steps_select on public.approval_steps
  for select using (tenant_id = app.tenant_id());

-- 라인 생성은 해당 결재건 상신자만 (상신 시점에 구성)
create policy approval_steps_insert on public.approval_steps
  for insert with check (
    tenant_id = app.tenant_id()
    and exists (
      select 1 from public.approvals a
      where a.id = approval_id and a.requester_user_id = auth.uid()
    )
  );

-- 처리(승인·반려)는 결재자 본인 또는 유효한 대결자
create policy approval_steps_update on public.approval_steps
  for update using (
    tenant_id = app.tenant_id()
    and (
      approver_user_id = auth.uid()
      or app.is_active_delegate_of(approver_user_id)
    )
  )
  with check (tenant_id = app.tenant_id());

-- ---- approval_rules / approval_rule_steps ---------------------------------
alter table public.approval_rules enable row level security;

create policy approval_rules_select on public.approval_rules
  for select using (tenant_id = app.tenant_id());

create policy approval_rules_write on public.approval_rules
  for all using (tenant_id = app.tenant_id() and app.is_org_admin())
  with check (tenant_id = app.tenant_id() and app.is_org_admin());

alter table public.approval_rule_steps enable row level security;

create policy approval_rule_steps_select on public.approval_rule_steps
  for select using (tenant_id = app.tenant_id());

create policy approval_rule_steps_write on public.approval_rule_steps
  for all using (tenant_id = app.tenant_id() and app.is_org_admin())
  with check (tenant_id = app.tenant_id() and app.is_org_admin());

-- ---- approval_delegations --------------------------------------------------
alter table public.approval_delegations enable row level security;

-- 대결 현황은 테넌트 내 투명 공개
create policy approval_delegations_select on public.approval_delegations
  for select using (tenant_id = app.tenant_id());

-- 설정은 위임자 본인 또는 총괄관리자
create policy approval_delegations_write on public.approval_delegations
  for all using (
    tenant_id = app.tenant_id()
    and (delegator_user_id = auth.uid() or app.is_org_admin())
  )
  with check (
    tenant_id = app.tenant_id()
    and (delegator_user_id = auth.uid() or app.is_org_admin())
  );
