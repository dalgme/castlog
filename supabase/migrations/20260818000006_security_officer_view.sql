-- ============================================================================
-- 기업 보안책임자 열람 — 주민번호 조회 이력·초과 조회 요청을 자사가 볼 수 있게
--
-- 문제: tax_access_logs를 읽는 화면이 /expert/tax-access(전문가 본인) 하나뿐이었다.
--       CLAUDE.md §5는 "프로젝트당 2회 한도 + 초과 시 사유 기재·대표 승인·전문가
--       통지"를 규정했는데, 정작 **회사 안에서 그 한도를 감시할 경로가 없었다.**
--       조회는 남지만 아무도 보지 않는 기록은 통제가 아니다.
--
-- 판단: 조회 '실행' 권한과 조회 '감시' 권한을 분리한다.
--       - 실행: tax_access_grants 지정자만 (변경 없음, 위임 불가)
--       - 감시: 대표(ceo) 또는 audit 위임을 받은 보안책임자
--       감시자는 **언제·누가·왜 조회했는지**만 본다. 번호 자체에는 접근할 수 없다 —
--       복호화 경로(tax_project_grants·rrn_fragments·tenant_rrn_keys)는 그대로
--       deny-all이며 이 마이그레이션이 건드리지 않는다.
--
-- 감시자가 실행자를 겸할 수 있느냐는 기업이 정한다. 다만 겸하더라도 두 권한은
-- 별개 레코드로 남아 "감시 권한만 있는 사람"을 만들 수 있어야 한다.
-- ============================================================================

/**
 * 보안 감시 권한 — 대표 또는 audit 위임자.
 * 주민번호 '조회' 권한이 아니다. 조회 이력을 '읽는' 권한이다.
 */
create or replace function app.can_view_security()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.is_org_admin() or app.has_admin_scope('audit')
$$;

revoke all on function app.can_view_security() from public;
grant execute on function app.can_view_security() to authenticated;

comment on function app.can_view_security() is
  '주민번호 조회 이력 등 보안 기록 열람 권한(대표 또는 audit 위임자). 복호화 권한과 무관.';

-- ---- 조회 이력: 자사에서 발생한 건만 -----------------------------------------
-- tax_access_logs는 전역 테이블(전문가 소유)이다. 전문가 본인 정책은 그대로 두고
-- '자사에서 발생한 조회'만 보이는 정책을 한 겹 더한다. 타사 조회 이력은 여전히
-- 보이지 않는다 — 전문가의 전 기업 통합 이력은 전문가 본인만 본다 (§4).
drop policy if exists tax_access_logs_select_security on public.tax_access_logs;
create policy tax_access_logs_select_security on public.tax_access_logs
  for select using (
    tenant_id is not null
    and tenant_id = app.tenant_id()
    and app.can_view_security()
  );

-- ---- 조회 요청(한도·초과사유·대표승인) ---------------------------------------
-- 한도 초과 건이 왜·누구 승인으로 열렸는지를 감시자가 확인할 수 있어야 한다.
drop policy if exists tax_access_requests_select_security on public.tax_access_requests;
create policy tax_access_requests_select_security on public.tax_access_requests
  for select using (
    tenant_id = app.tenant_id() and app.can_view_security()
  );

-- INSERT/UPDATE/DELETE 정책은 만들지 않는다. 두 테이블 모두 게이트(service_role)만
-- 기록한다 — 감시자가 기록을 지우거나 고칠 수 있으면 감시 기록이 아니다.

-- tax_lockdown · tax_rate_limits · tax_honeytokens · tax_project_grants ·
-- rrn_fragments_* · tenant_rrn_keys 는 계속 deny-all(정책 없음)로 둔다.
-- 잠금 상태는 화면에서 서버측 admin 클라이언트로 '자사 범위만' 요약해 보여준다.
