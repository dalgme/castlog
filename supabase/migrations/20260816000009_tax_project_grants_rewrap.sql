-- ============================================================================
-- 재래핑 결과 저장 — 섭외 승인 시 전문가 브라우저가 DEK를 테넌트 키로 다시 래핑(§2.2)
-- 설계: docs/decisions/rrn-rewrap-key-custody.md (Stage 2)
--
--  * tax_project_grants(1차 스키마의 빈 테이블)에 재래핑 봉투 자료를 저장한다.
--  * wrapped_dek_for_tenant: DEK를 그 테넌트 공개키로 RSA-OAEP 재래핑한 암호문.
--    이후 조회는 그 테넌트 조회 비밀번호로만 풀 수 있다(마스터키 없음).
--  * 평문 주민번호·DEK는 저장하지 않는다(암호문만).
-- ============================================================================
alter table public.tax_project_grants
  add column if not exists engagement_id uuid,
  add column if not exists front_id uuid,
  add column if not exists wrapped_dek_for_tenant text,
  add column if not exists wrap_alg text;

comment on column public.tax_project_grants.wrapped_dek_for_tenant is
  'DEK를 테넌트 공개키로 재래핑한 암호문(base64). 조회 비밀번호로만 복호화 가능.';

create index if not exists tax_project_grants_expert_tenant_idx
  on public.tax_project_grants (expert_id, tenant_id);
