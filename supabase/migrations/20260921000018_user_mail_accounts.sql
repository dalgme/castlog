-- 직원 개인 메일 계정으로 발송 (기획 지시 2026-11-08 — 렛츠 요구: 섭외·수락서 메일이 각자 개인 계정에서 나가야 한다)
--
-- 1) user_mail_accounts — 직원 1명당 1개. SMTP 호스트·포트·계정·앱 비밀번호(AES-256-GCM 암호화, 화면 재표시 없음).
--    테스트 발송에 성공해야(verified_at) 쓰인다. 본인만 읽고 쓴다(§5 자격증명 원칙 — 발송 권한자도 남의 비밀번호를 못 본다).
-- 2) tenant_email_settings — 회사 스위치 personal_mail_allowed(기본 false). 대표 또는 sending 위임자가 켠다.
-- 멱등·추가 전용. 코드는 표 부재(42P01/PGRST205)를 '기능 미개방'으로 폴백한다.

create table if not exists public.user_mail_accounts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  user_id uuid not null references public.users (id) on delete cascade,
  provider text not null check (provider in ('naverworks', 'google', 'hiworks', 'naver', 'daum', 'kakao', 'custom')),
  smtp_host text not null check (length(smtp_host) between 3 and 200),
  smtp_port int not null check (smtp_port between 1 and 65535),
  smtp_secure boolean not null default true,
  username text not null check (length(username) between 1 and 200),
  from_email text not null check (position('@' in from_email) > 1),
  password_encrypted text not null,
  is_active boolean not null default false,
  verified_at timestamptz,
  last_used_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, user_id)
);

alter table public.user_mail_accounts enable row level security;

-- 본인 행만 — 전문가 role은 제외
drop policy if exists user_mail_accounts_self on public.user_mail_accounts;
create policy user_mail_accounts_self on public.user_mail_accounts
  for all using (
    tenant_id = app.tenant_id() and user_id = auth.uid() and app.user_role() <> 'expert'
  ) with check (
    tenant_id = app.tenant_id() and user_id = auth.uid() and app.user_role() <> 'expert'
  );

do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgname = 'set_updated_at' and tgrelid = 'public.user_mail_accounts'::regclass
  ) then
    create trigger set_updated_at before update on public.user_mail_accounts
      for each row execute function app.set_updated_at();
  end if;
end $$;

comment on table public.user_mail_accounts is
  '직원 개인 메일 계정(SMTP) — 섭외·수락서 메일을 본인 계정으로 발송 (기획 2026-11-08). 비밀번호는 암호화·재표시 없음';

create table if not exists public.tenant_email_settings (
  tenant_id uuid primary key references public.tenants (id) on delete cascade,
  personal_mail_allowed boolean not null default false,
  updated_by uuid references public.users (id) on delete set null,
  updated_at timestamptz not null default now()
);

alter table public.tenant_email_settings enable row level security;

drop policy if exists tenant_email_settings_select on public.tenant_email_settings;
create policy tenant_email_settings_select on public.tenant_email_settings
  for select using (tenant_id = app.tenant_id() and app.user_role() <> 'expert');

-- 쓰기: 대표 또는 '문자 발송 자격증명(sending)' 위임자 — 발송 경로를 바꾸는 권한은 같은 스코프다
drop policy if exists tenant_email_settings_write on public.tenant_email_settings;
create policy tenant_email_settings_write on public.tenant_email_settings
  for all using (
    tenant_id = app.tenant_id() and (app.is_org_admin() or app.has_admin_scope('sending'))
  ) with check (
    tenant_id = app.tenant_id() and (app.is_org_admin() or app.has_admin_scope('sending'))
  );

comment on table public.tenant_email_settings is
  '회사 메일 발송 설정 — personal_mail_allowed: 직원 개인 메일 계정 발송 허용 (기획 2026-11-08)';
