-- ============================================================================
-- 발송 문구 템플릿 (기획 확정 2026-08-22)
--
-- 자주 바뀌는 발송 문구는 코드가 아니라 설정으로 관리한다 (CLAUDE.md §14-2).
-- 첫 용도: 전문가 등록 요청 문자 (template_key = 'expert_invite_sms') —
-- 설정 > SMS 설정에서 '수정' 버튼으로 문구를 고칠 수 있다.
-- 치환 토큰: {URL} 등록 링크(필수), {회사명}, {이름}(요청 대상자명).
--
-- 추가 전용·멱등 (docs/ops/release-playbook.md §3).
-- ============================================================================

create table if not exists public.tenant_message_templates (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  template_key text not null,
  body text not null,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, template_key)
);

alter table public.tenant_message_templates enable row level security;

-- 읽기는 발송을 실행하는 직원 전원, 수정은 대표 또는 '발송 문구(templates)' 위임자
drop policy if exists tenant_message_templates_select on public.tenant_message_templates;
create policy tenant_message_templates_select on public.tenant_message_templates
  for select using (
    tenant_id = app.tenant_id() and app.user_role() <> 'expert'
  );

drop policy if exists tenant_message_templates_write on public.tenant_message_templates;
create policy tenant_message_templates_write on public.tenant_message_templates
  for all using (
    tenant_id = app.tenant_id()
    and (app.is_org_admin() or app.has_admin_scope('templates'))
  )
  with check (
    tenant_id = app.tenant_id()
    and (app.is_org_admin() or app.has_admin_scope('templates'))
  );

do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgname = 'set_updated_at' and tgrelid = 'public.tenant_message_templates'::regclass
  ) then
    create trigger set_updated_at before update on public.tenant_message_templates
      for each row execute function app.set_updated_at();
  end if;
end $$;
