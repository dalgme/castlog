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

-- ---- 기능 키 CHECK 제약에 새 키 반영 (리뷰 2) --------------------------------
-- 설정 화면(문턱 조정·개인 지정)은 EXEC_FEATURES를 순회해 새 키를 자동으로
-- 노출한다 — 제약을 안 넓히면 저장 시 check_violation(23514)으로 실패한다.
alter table public.tenant_exec_overrides
  drop constraint if exists tenant_exec_overrides_feature_check;
alter table public.tenant_exec_overrides
  add constraint tenant_exec_overrides_feature_check check (feature in (
    'projectCreate', 'bulkImport', 'engagementCancel', 'freeMessageSend',
    'projectBudget', 'sendTemplate',
    'engagementRequest', 'engagementWithdraw', 'sessionNotice',
    'acceptanceSend', 'planSubmit',
    'paymentBatchCreate', 'expertInvite', 'expertRecord',
    'planInput'
  ));

alter table public.tenant_exec_grants
  drop constraint if exists tenant_exec_grants_feature_check;
alter table public.tenant_exec_grants
  add constraint tenant_exec_grants_feature_check check (feature in (
    'projectCreate', 'bulkImport', 'engagementCancel', 'freeMessageSend',
    'projectBudget', 'sendTemplate',
    'engagementRequest', 'engagementWithdraw', 'sessionNotice',
    'acceptanceSend', 'planSubmit',
    'paymentBatchCreate', 'expertInvite', 'expertRecord',
    'planInput'
  ));

-- ---- 섭외 건 UPDATE 정책을 세 축 합집합으로 (리뷰 9) --------------------------
-- 기존 정책은 engagementRequest 하나만 봤다. 회사가 문턱을 조정해 축들이
-- 어긋나면, 앱 게이트는 통과했는데 RLS가 0행을 만들어 엉뚱한 문구("이미
-- 처리되어…")가 나온다. RLS는 거친 울타리로 두고(세 축 중 하나), 정밀 판정은
-- 각 서버 액션이 한다.
drop policy if exists expert_engagements_update on public.expert_engagements;
create policy expert_engagements_update on public.expert_engagements
  for update using (
    (tenant_id = app.tenant_id()
      and (app.can_exec('engagementRequest')
        or app.can_exec('engagementWithdraw')
        or app.can_exec('engagementCancel')))
    or app.is_expert_self(expert_id)
  )
  with check (
    (tenant_id = app.tenant_id()
      and (app.can_exec('engagementRequest')
        or app.can_exec('engagementWithdraw')
        or app.can_exec('engagementCancel')))
    or app.is_expert_self(expert_id)
  );
