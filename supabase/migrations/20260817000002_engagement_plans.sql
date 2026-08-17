-- ============================================================================
-- 섭외계획 품의 게이트 (operations ↔ approvals — CLAUDE.md 1-2-6)
--
-- 업무 흐름:
--   섭외 테이블(TO·역할·비용) 작성 → **섭외계획 품의 상신 → 승인** → 섭외요청 송신
--   → (TO·비용 변경 필요 시) **계획 변경 품의 → 승인** → 재섭외
--
-- 원칙:
--  * 계획 내용은 JSON이 아니라 정규화 스냅샷 테이블에 저장한다 (CLAUDE.md 8).
--  * 승인 시점의 계획을 스냅샷으로 고정하고, 현재 섭외 테이블과 대조해
--    변경 여부를 판정한다(plan_signature). 달라지면 변경 품의를 요구한다.
--  * approvals 모듈이 비활성인 테넌트는 이 게이트를 적용하지 않는다
--    (모듈 단독 동작 경로 — CLAUDE.md 1-2-4).
--  * 계획은 삭제하지 않는다. 새 리비전이 생기면 이전 계획을 superseded로 전환한다.
-- ============================================================================

create table if not exists public.engagement_plans (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  revision int not null default 1 check (revision > 0),
  status text not null default 'draft'
    check (status in ('draft', 'in_progress', 'approved', 'rejected', 'superseded')),
  approval_id uuid references public.approvals (id) on delete set null,
  parent_plan_id uuid references public.engagement_plans (id) on delete set null,
  -- 계획 요약 (승인 시점 고정)
  slot_count int not null default 0,
  position_count int not null default 0,
  planned_amount bigint not null default 0 check (planned_amount >= 0),
  plan_signature text not null,
  note text,
  last_rejection_note text,
  submitted_by uuid,
  submitted_at timestamptz,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists engagement_plans_project_idx
  on public.engagement_plans (project_id, revision desc);
-- 프로젝트당 진행중·승인 계획은 각각 1건만
create unique index if not exists engagement_plans_open_idx
  on public.engagement_plans (project_id)
  where status in ('draft', 'in_progress', 'approved');

create trigger set_updated_at before update on public.engagement_plans
  for each row execute function app.set_updated_at();

-- 계획 명세 (섭외 테이블 스냅샷 — 정규화) --------------------------------------
create table if not exists public.engagement_plan_lines (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  plan_id uuid not null references public.engagement_plans (id) on delete cascade,
  slot_id uuid references public.engagement_slots (id) on delete set null,
  slot_date date not null,
  starts_time time,
  ends_time time,
  role_type text not null,
  role_description text,
  required_count int not null check (required_count > 0),
  fee_amount bigint not null default 0 check (fee_amount >= 0),
  location_name text,
  subtotal bigint not null default 0 check (subtotal >= 0),
  created_at timestamptz not null default now()
);

create index if not exists engagement_plan_lines_plan_idx
  on public.engagement_plan_lines (plan_id, slot_date, starts_time);

-- ---- RLS: 프로젝트 가시성 상속 ----------------------------------------------
alter table public.engagement_plans enable row level security;
alter table public.engagement_plan_lines enable row level security;

drop policy if exists engagement_plans_select on public.engagement_plans;
create policy engagement_plans_select on public.engagement_plans
  for select using (
    tenant_id = app.tenant_id() and app.can_view_project(project_id)
  );

drop policy if exists engagement_plans_write on public.engagement_plans;
create policy engagement_plans_write on public.engagement_plans
  for all using (
    tenant_id = app.tenant_id()
    and app.user_role() in ('org_admin', 'manager')
    and app.can_view_project(project_id)
  )
  with check (
    tenant_id = app.tenant_id()
    and app.user_role() in ('org_admin', 'manager')
    and app.can_view_project(project_id)
  );

drop policy if exists engagement_plan_lines_select on public.engagement_plan_lines;
create policy engagement_plan_lines_select on public.engagement_plan_lines
  for select using (
    tenant_id = app.tenant_id()
    and exists (
      select 1 from public.engagement_plans p where p.id = plan_id
    )
  );

drop policy if exists engagement_plan_lines_write on public.engagement_plan_lines;
create policy engagement_plan_lines_write on public.engagement_plan_lines
  for all using (
    tenant_id = app.tenant_id()
    and app.user_role() in ('org_admin', 'manager')
    and exists (select 1 from public.engagement_plans p where p.id = plan_id)
  )
  with check (
    tenant_id = app.tenant_id()
    and app.user_role() in ('org_admin', 'manager')
    and exists (select 1 from public.engagement_plans p where p.id = plan_id)
  );

comment on table public.engagement_plans is
  '섭외계획 품의 — 승인된 계획이 있어야 섭외요청을 보낼 수 있다(approvals 모듈 활성 시).';
comment on column public.engagement_plans.plan_signature is
  '승인 시점 섭외 테이블의 정규화 지문. 현재 테이블과 다르면 변경 품의가 필요하다.';
