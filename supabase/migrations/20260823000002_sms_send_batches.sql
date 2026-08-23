-- ============================================================================
-- 문자 발송 이력·제목·예약발송 (기획 확정 2026-08-23)
--
--  * 발송 화면의 문자 발송(일반 문자)을 '발송 건(batch)' 단위로 기록한다:
--    제목(이력 표시용)·유형·본문·발신번호·수신 인원·결과 집계.
--  * 예약발송: status='scheduled' + scheduled_at. 크론(/api/cron/sms-scheduled)이
--    기한 도래 건을 발송한다. 발송 전에는 취소(status='canceled')할 수 있다
--    (CLAUDE.md 14-5 — 미리보기·예약·중지).
--  * 개별 수신·성공/실패 상세는 기존 sms_logs(batch_id로 연결)가 그대로 담당.
--  * 예약 건의 수신자는 전용 정규화 테이블에 보관한다 (JSON 블롭 금지 — §8).
-- ============================================================================

create table if not exists public.sms_send_batches (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  title text not null,                  -- 발송 제목 (이력 표시용)
  message_type text not null check (message_type in ('transactional', 'advertising')),
  body text not null,                   -- 서명 포함 최종 본문 (광고 표기·수신거부 링크는 발송 시 삽입)
  sender_number text,                   -- 지정 발신번호 (null = 기본 규칙)
  status text not null default 'scheduled'
    check (status in ('scheduled', 'sending', 'sent', 'canceled', 'failed')),
  scheduled_at timestamptz,             -- null = 즉시 발송 건
  sent_at timestamptz,
  recipient_count int not null default 0,
  sent_count int not null default 0,
  failed_count int not null default 0,
  excluded_count int not null default 0,
  last_error text,
  created_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists set_updated_at on public.sms_send_batches;
create trigger set_updated_at before update on public.sms_send_batches
  for each row execute function app.set_updated_at();

create index if not exists sms_send_batches_tenant_idx
  on public.sms_send_batches (tenant_id, created_at desc);
-- 예약 처리(크론) 조회용
create index if not exists sms_send_batches_due_idx
  on public.sms_send_batches (status, scheduled_at);

alter table public.sms_send_batches enable row level security;

drop policy if exists sms_send_batches_select on public.sms_send_batches;
create policy sms_send_batches_select on public.sms_send_batches
  for select using (
    tenant_id = app.tenant_id()
    and app.user_role() in ('org_admin', 'manager')
  );

drop policy if exists sms_send_batches_insert on public.sms_send_batches;
create policy sms_send_batches_insert on public.sms_send_batches
  for insert with check (
    tenant_id = app.tenant_id()
    and app.user_role() in ('org_admin', 'manager')
  );

-- 취소(scheduled → canceled)만 세션에서 일어난다. 발송 진행 갱신은 service_role.
drop policy if exists sms_send_batches_update on public.sms_send_batches;
create policy sms_send_batches_update on public.sms_send_batches
  for update using (
    tenant_id = app.tenant_id()
    and app.user_role() in ('org_admin', 'manager')
  )
  with check (
    tenant_id = app.tenant_id()
    and app.user_role() in ('org_admin', 'manager')
  );

-- 예약 건 수신자 (발송 시점에 sms_logs로 실기록이 남는다)
create table if not exists public.sms_send_batch_recipients (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.sms_send_batches (id) on delete cascade,
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  expert_id uuid references public.experts (id) on delete set null,
  name text,
  phone text not null,
  created_at timestamptz not null default now()
);

create index if not exists sms_send_batch_recipients_batch_idx
  on public.sms_send_batch_recipients (batch_id);

alter table public.sms_send_batch_recipients enable row level security;

drop policy if exists sms_send_batch_recipients_select on public.sms_send_batch_recipients;
create policy sms_send_batch_recipients_select on public.sms_send_batch_recipients
  for select using (
    tenant_id = app.tenant_id()
    and app.user_role() in ('org_admin', 'manager')
  );

drop policy if exists sms_send_batch_recipients_insert on public.sms_send_batch_recipients;
create policy sms_send_batch_recipients_insert on public.sms_send_batch_recipients
  for insert with check (
    tenant_id = app.tenant_id()
    and app.user_role() in ('org_admin', 'manager')
  );

comment on table public.sms_send_batches is
  '문자 발송 건(제목·예약·결과 집계). 개별 발송 상세는 sms_logs.batch_id로 연결.';
