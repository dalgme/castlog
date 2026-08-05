-- ============================================================================
-- 단계 15: 서류 제출·갱신 요청 (/d 공개 링크 — 설계문서 5.2) + 포털 지급 내역
--
--  * 기업이 기존 전문가에게 특정 서류 제출·갱신을 요청한다 (업무연락).
--  * 업로드 자체는 소유자(전문가) 로그인 후 서류함에서 — /d는 안내·착지점.
--  * 전문가 포털에서 확정·완료된 지급 내역을 볼 수 있도록 배치 조회 정책 추가.
-- ============================================================================

create table public.document_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  expert_id uuid not null references public.experts (id) on delete cascade,
  requested_types text[] not null check (array_length(requested_types, 1) >= 1),
  message text,
  token_hash text not null unique,
  token_expires_at timestamptz not null,
  status text not null default 'pending'
    check (status in ('pending', 'completed', 'canceled', 'expired')),
  requested_by uuid references public.users (id) on delete set null,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index document_requests_tenant_idx
  on public.document_requests (tenant_id, status, created_at desc);
create index document_requests_expert_idx
  on public.document_requests (expert_id, status);

create trigger set_updated_at before update on public.document_requests
  for each row execute function app.set_updated_at();

alter table public.document_requests enable row level security;

-- 기업(자사) + 전문가 본인 조회
create policy document_requests_select on public.document_requests
  for select using (
    tenant_id = app.tenant_id()
    or app.is_expert_self(expert_id)
  );

-- 생성·회수는 기업 관리자 이상 (완료 처리는 검증 후 service_role)
create policy document_requests_write on public.document_requests
  for all using (
    tenant_id = app.tenant_id()
    and app.user_role() in ('org_admin', 'manager')
  )
  with check (
    tenant_id = app.tenant_id()
    and app.user_role() in ('org_admin', 'manager')
  );

-- ----------------------------------------------------------------------------
-- 전문가 포털 지급 내역 — 확정·완료된 배치만 본인 라인 범위에서 조회 허용
-- (결재 진행 중인 내부 문서는 노출하지 않는다)
-- ----------------------------------------------------------------------------
create policy expert_payment_batches_select_expert on public.expert_payment_batches
  for select using (
    status in ('confirmed', 'paid')
    and exists (
      select 1 from public.expert_payment_items i
      where i.batch_id = expert_payment_batches.id
        and app.is_expert_self(i.expert_id)
    )
  );
