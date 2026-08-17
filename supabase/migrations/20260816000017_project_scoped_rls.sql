-- ============================================================================
-- 하위 리소스 RLS 정밀화 — 프로젝트 배정 가시성을 종속 데이터까지 일관 적용
-- 근거: Phase A-1(project_assignments)에서 프로젝트 자체는 배정 기준으로 좁혔으나,
--       하위 리소스(스텝·기여도·평가·섭외)는 여전히 테넌트 단위였다.
--
--  * app.can_view_project(uuid): 권한자(org_admin·manager)=전체,
--    담당자(staff)=배정된 프로젝트만. SECURITY DEFINER + search_path 고정.
--  * 결재(approvals)·지급(payment_batches)은 결재선·회계 담당 경로가 별도 권한
--    체계를 쓰므로 이번 범위에서 제외한다(과도한 차단 방지). 필요 시 별도 판단.
-- ============================================================================

create or replace function app.can_view_project(p_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    p_project_id is not null
    and (
      app.user_role() in ('org_admin', 'manager')
      or exists (
        select 1
        from public.project_assignments pa
        where pa.project_id = p_project_id
          and pa.user_id = auth.uid()
      )
    )
$$;

-- ---- project_lifecycle_steps ------------------------------------------------
drop policy if exists project_steps_select on public.project_lifecycle_steps;
create policy project_steps_select on public.project_lifecycle_steps
  for select using (
    tenant_id = app.tenant_id() and app.can_view_project(project_id)
  );

-- 상태·담당자·기한 갱신도 해당 프로젝트를 볼 수 있는 직원으로 제한
drop policy if exists project_steps_update on public.project_lifecycle_steps;
create policy project_steps_update on public.project_lifecycle_steps
  for update using (
    tenant_id = app.tenant_id() and app.can_view_project(project_id)
  )
  with check (
    tenant_id = app.tenant_id() and app.can_view_project(project_id)
  );

-- ---- project_contributions --------------------------------------------------
drop policy if exists project_contributions_select on public.project_contributions;
create policy project_contributions_select on public.project_contributions
  for select using (
    tenant_id = app.tenant_id() and app.can_view_project(project_id)
  );

-- ---- expert_evaluations (전문가 비공개 — 기업 내부 평가) ---------------------
drop policy if exists expert_evaluations_select on public.expert_evaluations;
create policy expert_evaluations_select on public.expert_evaluations
  for select using (
    tenant_id = app.tenant_id()
    and (project_id is null or app.can_view_project(project_id))
  );

-- ---- expert_engagements -----------------------------------------------------
-- 기업 측: 권한자는 전체, 담당자는 배정 프로젝트 건만. 프로젝트 미연결 건은 권한자만.
-- 전문가 본인 경로(app.is_expert_self)는 그대로 유지한다.
drop policy if exists expert_engagements_select on public.expert_engagements;
create policy expert_engagements_select on public.expert_engagements
  for select using (
    (
      tenant_id = app.tenant_id()
      and (
        app.user_role() in ('org_admin', 'manager')
        or app.can_view_project(project_id)
      )
    )
    or app.is_expert_self(expert_id)
  );
