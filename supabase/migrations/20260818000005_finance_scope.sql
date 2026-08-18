-- ============================================================================
-- finance 위임 스코프 + 지급 데이터 열람 제한
--
-- 문제: 지급 화면이 requireRole([...,'staff'])라 **사원까지 전원**이 회사 전체
--       지급 예정액·확정액·전문가별 의뢰비용을 볼 수 있었다. 섭외 실무자가
--       자기 건을 보는 것과, 전사 지급 규모를 보는 것은 전혀 다른 문제다.
--
-- 판단: 지급은 별도 축이다. 직급(grade)만으로 가르면 "재무를 맡은 대리"를
--       표현할 수 없고, 반대로 "지급과 무관한 팀장"에게 열린다. 그래서
--       위임 스코프에 finance를 추가하고, 대표·이사는 기본 포함한다.
--
-- 주의: finance는 **금액**을 다루는 권한이다. 주민등록번호 조회 권한이 아니다.
--       세무 조회 지정자는 여전히 tax_access_grants + app.is_org_admin() 전용이며
--       위임 대상이 아니다 (CLAUDE.md §3-1 위임 금지 대상 1).
-- ============================================================================

alter table public.tenant_admin_grants
  drop constraint if exists tenant_admin_grants_scope_check;
alter table public.tenant_admin_grants
  add constraint tenant_admin_grants_scope_check
  check (scope in ('settings', 'staff', 'sending', 'audit', 'finance'));

/**
 * 지급 정보를 다룰 수 있는가.
 *   - 대표(ceo)·이사(director): 기본 포함 — 경영 판단에 금액이 필요하다
 *   - finance 위임을 받은 직원: 직급과 무관하게 포함
 *   - 그 외(팀장 이하, 미위임): 제외
 */
create or replace function app.can_manage_payments()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.user_role() = 'platform_admin'
      or app.grade_rank(app.user_grade()) >= app.grade_rank('director')
      or app.has_admin_scope('finance')
$$;

revoke all on function app.can_manage_payments() from public;
grant execute on function app.can_manage_payments() to authenticated;

comment on function app.can_manage_payments() is
  '지급(금액) 열람·실행 권한. 대표·이사 기본 포함 + finance 위임자. 세무(주민번호) 권한과 무관.';

-- ---- 지급 테이블 RLS 정밀화 -------------------------------------------------
-- 기존 정책이 무엇이든 restrictive 정책으로 한 겹 덧대 최소 기준을 강제한다.
-- (전문가 본인 경로는 별도 정책에서 다루므로 role='expert'는 통과시킨다)
drop policy if exists expert_payment_batches_finance on public.expert_payment_batches;
create policy expert_payment_batches_finance on public.expert_payment_batches
  as restrictive
  for select
  using (app.user_role() = 'expert' or app.can_manage_payments());

drop policy if exists expert_payment_items_finance on public.expert_payment_items;
create policy expert_payment_items_finance on public.expert_payment_items
  as restrictive
  for select
  using (app.user_role() = 'expert' or app.can_manage_payments());
