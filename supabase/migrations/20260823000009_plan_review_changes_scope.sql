-- ============================================================================
-- plan_review_changes 열람 범위 정정 (보안 리뷰 2026-08-23)
--
-- 기존: 테넌트 전 직원 열람 → 팀장 이하가 배정되지 않은 프로젝트의
-- 결재자 수정 내역(전문가 이름·예정가 변경)을 직접 조회할 수 있었다.
-- engagement_plans와 같은 기준(can_view_project)으로 좁힌다 —
-- "팀장 이하는 배정 프로젝트만" 원칙(§3-1).
-- ============================================================================

drop policy if exists plan_review_changes_select on public.plan_review_changes;
create policy plan_review_changes_select on public.plan_review_changes
  for select using (
    tenant_id = app.tenant_id()
    and app.user_role() <> 'expert'
    and app.can_view_project(project_id)
  );
