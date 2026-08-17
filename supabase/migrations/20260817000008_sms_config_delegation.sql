-- ============================================================================
-- SMS 공급자 설정을 'sending' 위임 스코프로 개방 (기획 수정)
--
-- 관리권한 위임 화면은 sending 스코프를 "SMS 공급자·발신번호·발송 템플릿을
-- 관리할 수 있습니다"로 안내해 왔으나, 실제 정책은 CEO 전용이라 위임받은
-- 임원이 SMS 설정을 열 수 없었다. 안내와 동작을 일치시킨다.
--
-- app.has_admin_scope('sending')은 CEO를 항상 포함하므로 대표 권한은 그대로다.
-- 세무(주민등록번호) 권한은 여전히 위임 대상이 아니다 (CLAUDE.md §5).
-- ============================================================================
drop policy if exists tenant_sms_configs_all on public.tenant_sms_configs;
create policy tenant_sms_configs_all on public.tenant_sms_configs
  for all using (
    tenant_id = app.tenant_id() and app.has_admin_scope('sending')
  )
  with check (
    tenant_id = app.tenant_id() and app.has_admin_scope('sending')
  );
