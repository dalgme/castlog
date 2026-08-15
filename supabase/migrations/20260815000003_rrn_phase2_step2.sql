-- ============================================================================
-- 주민등록번호 Phase 2 · 단계 2.2 — 조회 지정자 관리 (org_admin)
-- tax_access_grants: 기업총괄관리자가 회계담당·대표를 조회 지정자로 등록한다.
-- 지정자만 이후(2.3) 복호화 요청 주체가 될 수 있다. 대결·위임 대상 아님(코드 강제).
-- 플랫폼관리자는 조회 지정 대상에서 제외(정책에 platform_admin 없음).
-- ============================================================================

create policy tax_access_grants_org_admin_all on public.tax_access_grants
  for all
  using (tenant_id = app.tenant_id() and app.is_org_admin())
  with check (tenant_id = app.tenant_id() and app.is_org_admin());
