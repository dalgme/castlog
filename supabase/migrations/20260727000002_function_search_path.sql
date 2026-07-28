-- ============================================================================
-- app.* 헬퍼 함수 search_path 고정 (Supabase 보안 어드바이저 대응)
-- search_path = '' 로 고정하고 모든 참조를 스키마 한정자로 명시한다.
-- ============================================================================

create or replace function app.tenant_id()
returns uuid
language sql
stable
set search_path = ''
as $$
  select nullif(
    coalesce(auth.jwt() -> 'app_metadata' ->> 'tenant_id', ''),
    ''
  )::uuid
$$;

create or replace function app.user_role()
returns text
language sql
stable
set search_path = ''
as $$
  select coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '')
$$;

create or replace function app.is_platform_admin()
returns boolean
language sql
stable
set search_path = ''
as $$
  select app.user_role() = 'platform_admin'
$$;

create or replace function app.is_org_admin()
returns boolean
language sql
stable
set search_path = ''
as $$
  select app.user_role() in ('org_admin', 'platform_admin')
$$;

create or replace function app.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create or replace function app.block_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'audit_logs는 INSERT 전용입니다 (%는 허용되지 않음)', tg_op;
end;
$$;
