-- ============================================================================
-- 테넌트 발신번호 다중 등록 (기획 확정 2026-08-22)
--
-- 솔라피 계정에 발신번호를 여러 개 등록해 둔 회사가 있다. 플랫폼에서도
-- 발송마다 발신번호를 고를 수 있어야 하고, 기본값은 "보내는 직원 본인의
-- 휴대폰과 일치하는 등록 번호"다 (예: 김예나 선임이 보내면 김예나 번호로).
--
-- - 회사 대표번호는 종전대로 tenant_sms_configs.sender_number.
-- - 추가 번호는 이 테이블. 발송 시 선택 가능한 번호 = 대표번호 + 이 목록.
-- - 여기 등록해도 **공급자(솔라피) 계정에 사전등록되지 않은 번호는 발송이
--   거부된다** (발신번호 사전등록제 — 법·통신사 규제, 코드로 우회 불가).
-- - phone은 숫자만 저장한다 (예: 01012345678, 0212345678).
--
-- 추가 전용·멱등 (docs/ops/release-playbook.md §3).
-- ============================================================================

create table if not exists public.tenant_sms_senders (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  phone text not null, -- 숫자만
  label text, -- 표시명 (예: 대표번호, 김예나 선임)
  created_by uuid,
  created_at timestamptz not null default now(),
  unique (tenant_id, phone)
);

create index if not exists tenant_sms_senders_tenant_idx
  on public.tenant_sms_senders (tenant_id, created_at);

alter table public.tenant_sms_senders enable row level security;

-- 목록은 발송 화면에서 직원 전원이 본다. 관리(추가·삭제)는 발송 설정 권한.
drop policy if exists tenant_sms_senders_select on public.tenant_sms_senders;
create policy tenant_sms_senders_select on public.tenant_sms_senders
  for select using (
    tenant_id = app.tenant_id() and app.user_role() <> 'expert'
  );

drop policy if exists tenant_sms_senders_write on public.tenant_sms_senders;
create policy tenant_sms_senders_write on public.tenant_sms_senders
  for all using (
    tenant_id = app.tenant_id()
    and (app.is_org_admin() or app.has_admin_scope('sending'))
  )
  with check (
    tenant_id = app.tenant_id()
    and (app.is_org_admin() or app.has_admin_scope('sending'))
  );
