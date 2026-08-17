-- ============================================================================
-- 세션별 안내문자 (operations ↔ 발송 인프라) — 기획 확정
--
-- "각 프로젝트별, 각 세션별 전문가에게 안내문자 자동 및 수동 발급"
--
--  * 대상은 해당 세션(슬롯)에 섭외가 확정된 전문가다.
--  * 안내문자는 업무연락(transactional) 고정 — 광고성이 아니므로 사전동의 불요(§5-1).
--    유형을 사용자가 고를 수 없게 코드에서 고정한다.
--  * 문구는 코드가 아니라 템플릿 테이블로 관리한다(§14-2 운영 설정화).
--  * 예약 발송은 미리보기·중지를 지원한다(§14-5). 취소는 삭제가 아니라 상태 전환(§14-4).
-- ============================================================================

-- 안내문자 템플릿 (테넌트별)
create table if not exists public.session_notice_templates (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  name text not null,
  body text not null,
  is_active boolean not null default true,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, name)
);

create index if not exists session_notice_templates_tenant_idx
  on public.session_notice_templates (tenant_id, is_active);

create trigger set_updated_at before update on public.session_notice_templates
  for each row execute function app.set_updated_at();

-- 세션 단위 안내문자 발송 건
create table if not exists public.session_notices (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  slot_id uuid not null references public.engagement_slots (id) on delete cascade,
  template_id uuid references public.session_notice_templates (id) on delete set null,
  -- 발송 시점 문구 스냅샷 (템플릿이 나중에 바뀌어도 보낸 내용은 그대로)
  body_template text not null,
  status text not null default 'scheduled'
    check (status in ('scheduled', 'sent', 'failed', 'canceled')),
  scheduled_at timestamptz,          -- null = 즉시 발송
  sent_at timestamptz,
  batch_id uuid,                     -- sms_logs.batch_id 연결
  recipient_count int not null default 0,
  sent_count int not null default 0,
  failed_count int not null default 0,
  last_error text,
  created_by uuid,
  canceled_by uuid,
  canceled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists session_notices_slot_idx
  on public.session_notices (slot_id, created_at desc);
-- 크론이 집어갈 대기 건 (예약 시각 도래분)
create index if not exists session_notices_due_idx
  on public.session_notices (scheduled_at)
  where status = 'scheduled';

create trigger set_updated_at before update on public.session_notices
  for each row execute function app.set_updated_at();

-- ---- RLS -------------------------------------------------------------------
alter table public.session_notice_templates enable row level security;
alter table public.session_notices enable row level security;

-- 템플릿: 자사 전 직원 조회, 편집은 관리자 이상
drop policy if exists session_notice_templates_select on public.session_notice_templates;
create policy session_notice_templates_select on public.session_notice_templates
  for select using (tenant_id = app.tenant_id());

drop policy if exists session_notice_templates_write on public.session_notice_templates;
create policy session_notice_templates_write on public.session_notice_templates
  for all using (
    tenant_id = app.tenant_id() and app.user_role() in ('org_admin', 'manager')
  )
  with check (
    tenant_id = app.tenant_id() and app.user_role() in ('org_admin', 'manager')
  );

-- 발송 건: 프로젝트 가시성 상속, 편집은 관리자 이상
drop policy if exists session_notices_select on public.session_notices;
create policy session_notices_select on public.session_notices
  for select using (
    tenant_id = app.tenant_id() and app.can_view_project(project_id)
  );

drop policy if exists session_notices_write on public.session_notices;
create policy session_notices_write on public.session_notices
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

comment on table public.session_notices is
  '세션(타임테이블) 단위 전문가 안내문자. 업무연락 고정 — 광고성으로 보낼 수 없다.';
comment on column public.session_notices.body_template is
  '발송 시점 문구 스냅샷. 치환 변수는 수신자별로 발송 직전에 채워진다.';
