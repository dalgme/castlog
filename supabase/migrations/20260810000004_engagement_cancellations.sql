-- ============================================================================
-- 단계 29: 섭외 취소 워크플로우 + 전사 긴급 취소 알림 + 취소 내역
--          (대표 피드백 ③, 비-AI)
--
-- 설계:
--  * 섭외 취소는 두 종류:
--    - 회수(prior_status='requested'): 전문가 응답 전 요청 회수. 사유 선택.
--    - 긴급 취소(prior_status='accepted'): 계약 성립 후 취소 = 파급이 크다.
--      사유 필수 + 전사(테넌트 전원) 긴급 알림 발생.
--  * 취소 내역(engagement_cancellations)은 테넌트 격리 + 전문가 본인 열람
--    (본인이 섭외 취소 사실을 알 권리).
--  * 전사 알림(tenant_alerts)은 대시보드 배너로 노출 — 위험 작업의 가시성 확보
--    (CLAUDE.md 14-3 위험 작업 보호와 동일 취지).
-- ============================================================================

create table public.engagement_cancellations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  engagement_id uuid not null unique
    references public.expert_engagements (id) on delete cascade,
  expert_id uuid not null references public.experts (id) on delete cascade,
  project_id uuid references public.projects (id) on delete set null,
  prior_status text not null check (prior_status in ('requested', 'accepted')),
  is_urgent boolean not null default false, -- prior_status='accepted' 시 true
  reason text,
  canceled_by uuid references public.users (id) on delete set null,
  canceled_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index engagement_cancellations_tenant_idx
  on public.engagement_cancellations (tenant_id, canceled_at desc);
create index engagement_cancellations_expert_idx
  on public.engagement_cancellations (expert_id, canceled_at desc);

alter table public.engagement_cancellations enable row level security;

-- 열람: 자사 테넌트 + 전문가 본인
create policy engagement_cancellations_select on public.engagement_cancellations
  for select using (
    tenant_id = app.tenant_id()
    or app.is_expert_self(expert_id)
  );

-- 작성: 관리자 이상 (취소 실행자)
create policy engagement_cancellations_insert on public.engagement_cancellations
  for insert with check (
    tenant_id = app.tenant_id()
    and app.user_role() in ('org_admin', 'manager')
  );

-- ============================================================================
-- 전사 알림 (테넌트 브로드캐스트) — 대시보드 배너
-- ============================================================================
create table public.tenant_alerts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  severity text not null default 'info' check (severity in ('info', 'urgent')),
  category text not null, -- 예: 'engagement_cancel'
  title text not null,
  body text,
  resource_type text,
  resource_id uuid,
  created_by uuid references public.users (id) on delete set null,
  dismissed_at timestamptz,
  dismissed_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create index tenant_alerts_active_idx
  on public.tenant_alerts (tenant_id, dismissed_at, created_at desc);

alter table public.tenant_alerts enable row level security;

-- 열람: 자사 테넌트 전원 (전사 알림)
create policy tenant_alerts_select on public.tenant_alerts
  for select using (tenant_id = app.tenant_id());

-- 생성: 관리자 이상
create policy tenant_alerts_insert on public.tenant_alerts
  for insert with check (
    tenant_id = app.tenant_id()
    and app.user_role() in ('org_admin', 'manager')
  );

-- 확인(닫기): 관리자 이상 (전사 긴급 알림을 임의로 지우지 않도록 권한 제한)
create policy tenant_alerts_update on public.tenant_alerts
  for update using (
    tenant_id = app.tenant_id()
    and app.user_role() in ('org_admin', 'manager')
  )
  with check (
    tenant_id = app.tenant_id()
    and app.user_role() in ('org_admin', 'manager')
  );
