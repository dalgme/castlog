-- ============================================================================
-- 단계 11: 전문가 섭외 (experts ↔ operations 핵심 연동 — CLAUDE.md 1-2-6)
--
-- 연동 규칙:
--  * 전용 연결 테이블(expert_engagements)로 표현 — 양쪽 도메인 테이블 직접 오염 금지.
--  * project_id는 선택 — experts만 활성인 테넌트는 프로젝트 없이 섭외 가능(단독 동작).
--  * 섭외이력·의뢰비용은 테넌트 격리 데이터 — 절대 교차 노출 금지 (설계문서 3.2).
--  * 전문가의 섭외 승인 = 계약 성립 (Phase 2: 이 시점에 tax_project_grants 래핑 발생).
--  * 공개 /e 동의 링크: 원문 토큰 미저장(SHA-256 해시), 검증은 service_role 전용.
-- ============================================================================

create table public.expert_engagements (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  expert_id uuid not null references public.experts (id) on delete cascade,
  project_id uuid references public.projects (id) on delete set null,
  role_description text not null, -- 멘토·심사위원·강사 등
  message text,                   -- 요청 내용 (업무연락 — 사전동의 불요)
  fee_amount bigint check (fee_amount is null or fee_amount >= 0), -- 의뢰비용(원)
  starts_on date,
  ends_on date,
  status text not null default 'requested'
    check (status in ('requested', 'accepted', 'declined', 'canceled', 'expired')),
  token_hash text not null unique, -- 공개 /e 동의 링크
  token_expires_at timestamptz not null,
  requested_by uuid references public.users (id) on delete set null,
  responded_at timestamptz,
  response_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index expert_engagements_tenant_idx
  on public.expert_engagements (tenant_id, status, created_at desc);
create index expert_engagements_expert_idx
  on public.expert_engagements (expert_id, status);
create index expert_engagements_project_idx
  on public.expert_engagements (project_id);

create trigger set_updated_at before update on public.expert_engagements
  for each row execute function app.set_updated_at();

-- ============================================================================
-- RLS — 기업(자사 범위) + 전문가 본인. 교차 노출 없음.
-- ============================================================================
alter table public.expert_engagements enable row level security;

create policy expert_engagements_select on public.expert_engagements
  for select using (
    tenant_id = app.tenant_id()
    or app.is_expert_self(expert_id)
  );

-- 섭외 요청 생성은 기업 관리자 이상
create policy expert_engagements_insert on public.expert_engagements
  for insert with check (
    tenant_id = app.tenant_id()
    and app.user_role() in ('org_admin', 'manager')
  );

-- 갱신: 기업(회수 등, 관리자 이상) 또는 전문가 본인(수락·거절)
create policy expert_engagements_update on public.expert_engagements
  for update using (
    (tenant_id = app.tenant_id() and app.user_role() in ('org_admin', 'manager'))
    or app.is_expert_self(expert_id)
  )
  with check (
    (tenant_id = app.tenant_id() and app.user_role() in ('org_admin', 'manager'))
    or app.is_expert_self(expert_id)
  );
