-- ============================================================================
-- 상급자 릴레이 결재 — 직급 단계 결재선 (기획 확정 2026-08-30 — 27번)
--
-- 섭외계획 품의를 상신하면, 결재 단계가 '특정 결재자'가 아니라 **직급**으로
-- 구성될 수 있다: 상신자의 상급 직급마다 한 단계씩, 그 직급(이상)의 누구나
-- 결재할 수 있고, 결재하면 다음 상급 직급 단계가 자동으로 열린다(기존 병렬
-- 그룹 진행 로직 그대로). 기능은 전자결재 메뉴에서 테넌트별로 켠다
-- (tenants.feature_flags.approval_plan_relay — 앱 레벨).
--
-- 스키마: approval_steps.step_grade(직급 단계) 신설 + approver_user_id를
-- nullable로 완화(expand — 기존 행은 전부 named라 영향 없음). 한 단계는
-- named 또는 grade 둘 중 하나여야 한다.
--
-- 멱등: add column if not exists / drop-and-create.
-- ============================================================================

alter table public.approval_steps
  add column if not exists step_grade text;

alter table public.approval_steps
  drop constraint if exists approval_steps_step_grade_check;
alter table public.approval_steps
  add constraint approval_steps_step_grade_check check (
    step_grade is null
    or step_grade in ('ceo', 'director', 'team_lead', 'deputy', 'senior', 'staff')
  );

alter table public.approval_steps
  alter column approver_user_id drop not null;

-- named도 grade도 아닌 빈 단계는 만들 수 없다
alter table public.approval_steps
  drop constraint if exists approval_steps_actor_present_check;
alter table public.approval_steps
  add constraint approval_steps_actor_present_check check (
    approver_user_id is not null or step_grade is not null
  );

-- 같은 결재건·같은 차수에 같은 직급 단계 중복 금지
-- (named 중복은 기존 unique(approval_id, step_order, approver_user_id)가 막는다
--  — NULL approver끼리는 그 제약에 걸리지 않으므로 부분 인덱스로 보강)
create unique index if not exists approval_steps_grade_uidx
  on public.approval_steps (approval_id, step_order, step_grade)
  where step_grade is not null;

comment on column public.approval_steps.step_grade is
  '직급 릴레이 단계 (기획 2026-08-30 — 27번): approver_user_id 없이 직급으로 지정된 단계. 그 직급 이상의 자사 직원 누구나 결재할 수 있고, 실제 처리자는 acted_by_user_id에 남는다.';

-- 처리(승인·반려) 정책 확장: named 단계는 기존대로(본인·대결자),
-- 직급 단계는 그 직급 이상의 자사 직원(전문가 세션 제외).
-- 상신자 본인 배제는 별도 조건이 필요 없다 — 릴레이 단계는 항상 상신자보다
-- 높은 직급으로만 구성되므로 rank 비교에서 자연 배제된다. 앱 액션은
-- 상신자 일치도 별도로 검사한다(방어 이중화).
drop policy if exists approval_steps_update on public.approval_steps;
create policy approval_steps_update on public.approval_steps
  for update using (
    tenant_id = app.tenant_id()
    and (
      approver_user_id = auth.uid()
      or app.is_active_delegate_of(approver_user_id)
      or (
        approver_user_id is null
        and step_grade is not null
        and app.user_role() <> 'expert'
        and app.grade_rank(app.user_grade()) >= app.grade_rank(step_grade)
      )
    )
  )
  with check (tenant_id = app.tenant_id());
