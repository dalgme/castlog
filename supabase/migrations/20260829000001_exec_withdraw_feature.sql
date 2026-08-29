-- ============================================================================
-- 실행 권한 축 분리: 섭외 '응답 전 회수' 신설 (기획 확정 2026-08-29 — 검수 F5)
--
-- 문제: '회수(응답 전)'와 '긴급 취소(확정 후)'가 한 축(engagementCancel,
-- 레벨 3)에 묶여 있어, 대리(레벨 4)는 수동 '섭외 완료'로 계약을 성립시킬 수는
-- 있는데 자기가 잘못 보낸 요청을 거둘 수는 없었다 — 더 위험한 행위의 문턱이
-- 더 낮은 역전.
--
-- 조치: engagementWithdraw(기본 레벨 4 = deputy)를 신설한다. 요청을 보낼 수
-- 있는 사람이 자기 오발송을 거둘 수 있다. 확정 후 긴급 취소는 레벨 3 유지.
-- lib/auth/exec-permissions.ts EXEC_FEATURES와 반드시 동일 유지.
--
-- 멱등: create or replace — 기존 키를 전부 보존한 전체 재정의.
-- ============================================================================

create or replace function app.exec_default_min(p_feature text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_feature
    when 'projectCreate'      then 'team_lead'
    when 'bulkImport'         then 'team_lead'
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
