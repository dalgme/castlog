-- ============================================================================
-- 단계 12: 일괄 지급·지급 품의 (experts ↔ approvals 핵심 연동 — CLAUDE.md 1-2-6)
--
-- 설계 (기획 확정):
--  * 프로젝트에 귀속된 수락(계약 성립) 섭외들을 리스트로 모아 일괄 지급 건 생성.
--  * 품의도 1건으로 일괄 상신 — 결재 승인 시 배치 전체가 지급 확정.
--  * 전문가별 소득유형(expert_tax_profiles.payment_type)은 품의 시점에 스냅샷 —
--    이후 전문가가 유형을 바꿔도 진행 중인 지급 건은 불변.
--  * 원천징수 계산은 참고치 — 세무 확정은 세무 검토 후 (화면에 고지).
--  * approvals 비활성 테넌트는 결재 없이 단순 확정 (단독 동작 경로).
-- ============================================================================

create table public.expert_payment_batches (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  project_id uuid references public.projects (id) on delete set null,
  title text not null,
  status text not null default 'pending'
    check (status in ('pending', 'approval_in_progress', 'confirmed', 'paid', 'canceled')),
  approval_id uuid references public.approvals (id) on delete set null,
  -- 상신 시점 합계 스냅샷 (기록 보존용 — 라인 합과 일치)
  total_gross bigint not null default 0 check (total_gross >= 0),
  total_withholding bigint not null default 0 check (total_withholding >= 0),
  total_net bigint not null default 0 check (total_net >= 0),
  last_rejection_note text, -- 최근 반려 사유 (반려 시 pending 복귀)
  confirmed_at timestamptz,
  paid_at timestamptz,
  created_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index expert_payment_batches_tenant_idx
  on public.expert_payment_batches (tenant_id, status, created_at desc);
create index expert_payment_batches_approval_idx
  on public.expert_payment_batches (approval_id);

create trigger set_updated_at before update on public.expert_payment_batches
  for each row execute function app.set_updated_at();

-- 지급 라인 — 섭외 1건당 지급 1회 (완료·취소된 배치 제외는 앱 레벨에서 처리)
create table public.expert_payment_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  batch_id uuid not null references public.expert_payment_batches (id) on delete cascade,
  engagement_id uuid not null references public.expert_engagements (id) on delete restrict,
  expert_id uuid not null references public.experts (id) on delete restrict,
  -- 품의 시점 소득유형 스냅샷
  payment_type text not null
    check (payment_type in ('business_income', 'other_income', 'business')),
  gross_amount bigint not null check (gross_amount >= 0),      -- 총비용(계약금액)
  withholding_amount bigint not null check (withholding_amount >= 0), -- 원천징수(참고)
  net_amount bigint not null check (net_amount >= 0),          -- 실지급액
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (batch_id, engagement_id)
);

create index expert_payment_items_batch_idx
  on public.expert_payment_items (batch_id);
create index expert_payment_items_expert_idx
  on public.expert_payment_items (expert_id);
create index expert_payment_items_engagement_idx
  on public.expert_payment_items (engagement_id);

create trigger set_updated_at before update on public.expert_payment_items
  for each row execute function app.set_updated_at();

-- ============================================================================
-- RLS
-- ============================================================================
alter table public.expert_payment_batches enable row level security;

-- 배치는 테넌트 격리 (기업 내부 문서)
create policy expert_payment_batches_select on public.expert_payment_batches
  for select using (tenant_id = app.tenant_id());

create policy expert_payment_batches_insert on public.expert_payment_batches
  for insert with check (
    tenant_id = app.tenant_id()
    and app.user_role() in ('org_admin', 'manager')
  );

create policy expert_payment_batches_update on public.expert_payment_batches
  for update using (
    tenant_id = app.tenant_id()
    and app.user_role() in ('org_admin', 'manager')
  )
  with check (
    tenant_id = app.tenant_id()
    and app.user_role() in ('org_admin', 'manager')
  );

alter table public.expert_payment_items enable row level security;

-- 라인: 기업(자사) + 전문가 본인(자기 지급 내역 — 전 기업 통합 이력)
create policy expert_payment_items_select on public.expert_payment_items
  for select using (
    tenant_id = app.tenant_id()
    or app.is_expert_self(expert_id)
  );

create policy expert_payment_items_insert on public.expert_payment_items
  for insert with check (
    tenant_id = app.tenant_id()
    and app.user_role() in ('org_admin', 'manager')
  );

create policy expert_payment_items_update on public.expert_payment_items
  for update using (
    tenant_id = app.tenant_id()
    and app.user_role() in ('org_admin', 'manager')
  )
  with check (
    tenant_id = app.tenant_id()
    and app.user_role() in ('org_admin', 'manager')
  );
