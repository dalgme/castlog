-- ============================================================================
-- 일괄 등록(bulkImport) 기본 레벨 개방 (기획 개정 2026-08-30 — 24번)
--
-- 요구: "일괄 등록 탭에 누구나 접근·등록 가능하게" — 기본 문턱을
-- team_lead(레벨 3) → staff(레벨 6, 전 직원)로 내린다. 중복 위험은
-- 미리보기 대조(이름·이메일·휴대폰 재확인)로 막는다. 더 좁히고 싶은 회사는
-- tenant_exec_overrides(회사 조정)로 계속 올릴 수 있다 — 판정 우선순위
-- (개인 지정 > 회사 조정 > 기본)는 그대로다.
--
-- lib/auth/exec-permissions.ts EXEC_FEATURES와 반드시 동일 유지.
-- 멱등: create or replace — 기존 키 전부 보존한 전체 재정의.
-- ============================================================================

create or replace function app.exec_default_min(p_feature text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_feature
    when 'projectCreate'      then 'team_lead'
    when 'bulkImport'         then 'staff' -- 개정 2026-08-30: 전 직원 개방
    when 'engagementCancel'   then 'team_lead'
    when 'freeMessageSend'    then 'team_lead'
    when 'projectBudget'      then 'team_lead'
    when 'sendTemplate'       then 'team_lead'
    when 'engagementRequest'  then 'deputy'
    when 'engagementWithdraw' then 'deputy'
    when 'sessionNotice'      then 'deputy'
    when 'acceptanceSend'     then 'deputy'
    when 'planSubmit'         then 'deputy'
    when 'paymentBatchCreate' then 'deputy'
    when 'expertInvite'       then 'deputy'
    when 'expertRecord'       then 'deputy'
    when 'planInput'          then 'senior'
    else 'ceo' -- 모르는 키는 가장 좁게
  end
$$;

revoke all on function app.exec_default_min(text) from public;
