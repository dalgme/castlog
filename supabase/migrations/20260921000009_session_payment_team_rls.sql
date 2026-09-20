-- 지급 품의 탭 · 참여율 배분 권한 (기획 지시 2026-09-21)
--
-- 1) 지급 품의 탭 — 종료(평가·완료)가 끝난 세션을 프로젝트 팀(배정 PL·PM·부PM)이 묶어
--    지급 품의를 올린다. 지급 건(expert_payment_batches·items)은 그동안 지급 권한자
--    (대표·이사·finance 위임)만 만들고 볼 수 있었다. 프로젝트 팀에게는 **자기 프로젝트의
--    지급 건**에 한해 만들기·보기(상태)·상신을 연다. 다른 프로젝트·회사 전체 지급 목록은
--    종전대로 지급 권한자만 본다.
-- 2) 참여율 배분 — 대표(ceo 직급)와 그 프로젝트의 PM(pm·pl_pm 배정)만 쓴다.
--
-- 멱등 (drop policy if exists → create). 코드는 정책 거부(42501)를 규칙 문구로 안내한다.

-- ---- 1) 지급 건: 프로젝트 팀 ------------------------------------------------
-- 열람 최소 기준(restrictive) — 지급 권한자 또는 자기 프로젝트 팀
drop policy if exists expert_payment_batches_finance on public.expert_payment_batches;
create policy expert_payment_batches_finance on public.expert_payment_batches
  as restrictive
  for select
  using (
    app.user_role() = 'expert'
    or app.can_manage_payments()
    or (project_id is not null and app.is_project_team(project_id))
  );

drop policy if exists expert_payment_items_finance on public.expert_payment_items;
create policy expert_payment_items_finance on public.expert_payment_items
  as restrictive
  for select
  using (
    app.user_role() = 'expert'
    or app.can_manage_payments()
    or exists (
      select 1
      from public.expert_payment_batches b
      where b.id = batch_id
        and b.project_id is not null
        and app.is_project_team(b.project_id)
    )
  );

-- 만들기·고치기 — 자기 프로젝트 팀 (기존 org_admin/manager 정책과 OR)
drop policy if exists expert_payment_batches_team_insert on public.expert_payment_batches;
create policy expert_payment_batches_team_insert on public.expert_payment_batches
  for insert with check (
    tenant_id = app.tenant_id()
    and project_id is not null
    and app.is_project_team(project_id)
  );

drop policy if exists expert_payment_batches_team_update on public.expert_payment_batches;
create policy expert_payment_batches_team_update on public.expert_payment_batches
  for update using (
    tenant_id = app.tenant_id()
    and project_id is not null
    and app.is_project_team(project_id)
  )
  with check (
    tenant_id = app.tenant_id()
    and project_id is not null
    and app.is_project_team(project_id)
  );

drop policy if exists expert_payment_items_team_insert on public.expert_payment_items;
create policy expert_payment_items_team_insert on public.expert_payment_items
  for insert with check (
    tenant_id = app.tenant_id()
    and exists (
      select 1
      from public.expert_payment_batches b
      where b.id = batch_id
        and b.project_id is not null
        and app.is_project_team(b.project_id)
    )
  );

-- ---- 2) 참여율 배분: 대표 + 프로젝트 PM ----------------------------------------
drop policy if exists project_contributions_insert on public.project_contributions;
create policy project_contributions_insert on public.project_contributions
  for insert with check (
    tenant_id = app.tenant_id()
    and (
      app.user_grade() = 'ceo'
      or app.project_assignment_role(project_id) in ('pm', 'pl_pm')
    )
  );

drop policy if exists project_contributions_update on public.project_contributions;
create policy project_contributions_update on public.project_contributions
  for update using (
    tenant_id = app.tenant_id()
    and (
      app.user_grade() = 'ceo'
      or app.project_assignment_role(project_id) in ('pm', 'pl_pm')
    )
  )
  with check (
    tenant_id = app.tenant_id()
    and (
      app.user_grade() = 'ceo'
      or app.project_assignment_role(project_id) in ('pm', 'pl_pm')
    )
  );

drop policy if exists project_contributions_delete on public.project_contributions;
create policy project_contributions_delete on public.project_contributions
  for delete using (
    tenant_id = app.tenant_id()
    and (
      app.user_grade() = 'ceo'
      or app.project_assignment_role(project_id) in ('pm', 'pl_pm')
    )
  );

comment on policy project_contributions_insert on public.project_contributions is
  '참여율 배분은 대표(ceo)와 그 프로젝트의 PM(pm·pl_pm)만 쓴다 (기획 2026-09-21)';
