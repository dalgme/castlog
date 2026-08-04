-- ============================================================================
-- 단계 14: 발송 인프라 (공통 기반 — CLAUDE.md 5-1·5-2)
--
-- 확정 구조:
--  * 업무·광고 SMS는 테넌트별 BYO 공급자 (tenant_sms_configs — API 키 암호화 저장).
--  * 인증 OTP만 전역 (Send SMS Hook → 운영사 솔라피, tenant_id null로 계측).
--  * 발송 유형 분리(법적 필수): 업무연락/광고성. 광고성은 미동의 자동 제외,
--    (광고) 표기, 수신거부 링크(/u) 강제, 야간(21~08 KST) 차단 — 서버 강제.
--  * 모든 발송은 sms_logs/email_logs 기록 (CLAUDE.md 12-3).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. tenant_sms_configs — 테넌트별 SMS 공급자 설정 (API 키는 앱 레벨 AES-GCM 암호화)
-- ----------------------------------------------------------------------------
create table public.tenant_sms_configs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null unique references public.tenants (id) on delete cascade,
  provider text not null check (provider in ('solapi', 'aligo', 'nhncloud')),
  api_key_encrypted text not null,
  api_secret_encrypted text, -- 솔라피: API Secret / 알리고: 사용자 ID
  sender_number text not null, -- 사전등록 발신번호
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger set_updated_at before update on public.tenant_sms_configs
  for each row execute function app.set_updated_at();

alter table public.tenant_sms_configs enable row level security;

-- 공급자 설정은 총괄관리자만 (암호화된 값이지만 노출 최소화)
create policy tenant_sms_configs_all on public.tenant_sms_configs
  for all using (tenant_id = app.tenant_id() and app.is_org_admin())
  with check (tenant_id = app.tenant_id() and app.is_org_admin());

-- ----------------------------------------------------------------------------
-- 2. sms_logs / email_logs — 발송 기록 (INSERT 전용 성격, 수정·삭제 정책 없음)
-- ----------------------------------------------------------------------------
create table public.sms_logs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references public.tenants (id) on delete cascade, -- null = 전역(인증 OTP)
  batch_id uuid, -- 같은 발송 실행 묶음
  message_type text not null
    check (message_type in ('transactional', 'advertising', 'auth_otp')),
  recipient_phone text not null,
  recipient_expert_id uuid references public.experts (id) on delete set null,
  body text not null,
  status text not null check (status in ('sent', 'failed', 'blocked', 'test')),
  provider text,
  error_message text,
  sent_by uuid, -- users.id (전역 발송은 null)
  created_at timestamptz not null default now()
);

create index sms_logs_tenant_idx on public.sms_logs (tenant_id, created_at desc);
create index sms_logs_batch_idx on public.sms_logs (batch_id);

alter table public.sms_logs enable row level security;

create policy sms_logs_select on public.sms_logs
  for select using (
    (tenant_id is not null and tenant_id = app.tenant_id())
    or app.is_platform_admin()
  );

-- 기록은 발송 실행 주체(관리자 이상)의 세션 또는 서버(service_role)
create policy sms_logs_insert on public.sms_logs
  for insert with check (
    tenant_id = app.tenant_id()
    and app.user_role() in ('org_admin', 'manager')
  );

create table public.email_logs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references public.tenants (id) on delete cascade,
  batch_id uuid,
  message_type text not null
    check (message_type in ('transactional', 'advertising')),
  recipient_email text not null,
  recipient_expert_id uuid references public.experts (id) on delete set null,
  subject text not null,
  body text not null,
  status text not null check (status in ('sent', 'failed', 'blocked', 'test')),
  error_message text,
  sent_by uuid,
  created_at timestamptz not null default now()
);

create index email_logs_tenant_idx on public.email_logs (tenant_id, created_at desc);

alter table public.email_logs enable row level security;

create policy email_logs_select on public.email_logs
  for select using (
    (tenant_id is not null and tenant_id = app.tenant_id())
    or app.is_platform_admin()
  );

create policy email_logs_insert on public.email_logs
  for insert with check (
    tenant_id = app.tenant_id()
    and app.user_role() in ('org_admin', 'manager')
  );

-- ----------------------------------------------------------------------------
-- 3. 수신거부 (법적 필수 — /u 공개 링크)
--    수신거부는 발송 주체(테넌트) 단위. 광고 발송 시 자동 제외 목록.
-- ----------------------------------------------------------------------------
create table public.ad_unsubscribes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  channel text not null default 'sms' check (channel in ('sms', 'email')),
  phone text,  -- sms 채널
  email text,  -- email 채널
  expert_id uuid references public.experts (id) on delete set null,
  created_at timestamptz not null default now(),
  check (phone is not null or email is not null)
);

create unique index ad_unsubscribes_phone_uniq
  on public.ad_unsubscribes (tenant_id, channel, phone) where phone is not null;
create unique index ad_unsubscribes_email_uniq
  on public.ad_unsubscribes (tenant_id, channel, email) where email is not null;

alter table public.ad_unsubscribes enable row level security;

-- 기업은 자사 수신거부 목록 조회만 (처리 자체는 /u → service_role)
create policy ad_unsubscribes_select on public.ad_unsubscribes
  for select using (tenant_id = app.tenant_id());

-- 수신거부 링크 토큰 (원문 미저장 — 해시만. 발송 시 개인별 생성, 만료 없음:
-- 인쇄·발송된 링크는 회수 불가하므로 영구 유효해야 한다)
create table public.unsubscribe_tokens (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  channel text not null default 'sms' check (channel in ('sms', 'email')),
  phone text,
  email text,
  expert_id uuid references public.experts (id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.unsubscribe_tokens enable row level security;

-- 조회·기록 전부 service_role 전용이지만, 감사 편의상 자사 조회만 허용
create policy unsubscribe_tokens_select on public.unsubscribe_tokens
  for select using (tenant_id = app.tenant_id());
