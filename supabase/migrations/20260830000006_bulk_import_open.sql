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

-- ---- 등록 요청(expert_invitations) RLS를 일괄 등록 축과 합집합으로 ----------
-- 일괄 등록 화면의 "신규 전문가 등록 요청"은 세션 클라이언트로 insert한다.
-- 정책이 expertInvite(기본 deputy)만 보면, bulkImport를 통과한 주임·사원이
-- 미리보기까지 가고 확정에서 42501로 죽는다 (리뷰 P1-1 — §12-9 막다른 길).
-- 합집합 선례: 20260829000001 expert_engagements_update.
drop policy if exists expert_invitations_insert on public.expert_invitations;
create policy expert_invitations_insert on public.expert_invitations
  for insert with check (
    tenant_id = app.tenant_id()
    and (app.can_exec('expertInvite') or app.can_exec('bulkImport'))
  );

drop policy if exists expert_invitations_update on public.expert_invitations;
create policy expert_invitations_update on public.expert_invitations
  for update using (
    tenant_id = app.tenant_id()
    and (app.can_exec('expertInvite') or app.can_exec('bulkImport'))
  )
  with check (
    tenant_id = app.tenant_id()
    and (app.can_exec('expertInvite') or app.can_exec('bulkImport'))
  );

-- 결정 기록 (§14-9): 이번 개방은 '일괄 등록 탭 전체'(등록 요청 링크·보유자료
-- 등록·서류 일괄 업로드)가 같은 bulkImport 축을 쓰는 현 구조 그대로 적용된다.
-- 서류 일괄 업로드까지 전 직원 개방이 과하다고 판단되면 tenant_exec_overrides
-- (회사 조정)로 올리거나, 별도 키 분리를 후속 개정으로 다룬다.
