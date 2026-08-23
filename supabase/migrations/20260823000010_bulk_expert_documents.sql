-- ============================================================================
-- 파일 일괄 등록 — 기업 보유 전문가 서류 (기획 확정 2026-08-23)
--
-- 1) expert_documents.uploaded_by_tenant_id — 기업이 등록한 서류의 출처.
--    null = 전문가 본인 등록 (기존 데이터 전부 해당).
-- 2) document_type에 'combined'(통합서류·혼합) 추가 — 이력서·신분증·통장이
--    한 파일에 섞인 보유자료. 가장 민감한 서류 기준의 보호를 통째로 적용한다.
-- 3) 자기 회사가 올린 서류는 grant 없이 열람 허용 (자기가 제공한 파일).
--    타 기업에는 기존대로 전문가의 열람 허용(grants)이 필요하다.
-- 4) experts.organization / job_title — 소속·직위 (누적 현황 표 표기용,
--    전문가 공개 프로필 항목. 전 기업 공개 정보 축 — §4 전면 공개 범위).
--
-- 기업 쓰기는 RLS를 열지 않는다 — 보유자료 등록과 동일하게 service_role +
-- 앱 게이트(bulkImport)로만 수행한다.
-- ============================================================================

-- ---- 1. 출처 컬럼 ------------------------------------------------------------
alter table public.expert_documents
  add column if not exists uploaded_by_tenant_id uuid
    references public.tenants(id) on delete set null;

comment on column public.expert_documents.uploaded_by_tenant_id is
  '기업이 일괄 등록한 서류의 출처 테넌트 — null이면 전문가 본인 등록.';

-- ---- 2. 통합서류 유형 --------------------------------------------------------
alter table public.expert_documents
  drop constraint if exists expert_documents_document_type_check;
alter table public.expert_documents
  add constraint expert_documents_document_type_check check (document_type in (
    'resume', 'bank_account_copy', 'id_card_copy', 'business_card',
    'business_registration', 'signature', 'seal', 'attachment', 'certificate',
    'combined'
  ));

alter table public.expert_document_grants
  drop constraint if exists expert_document_grants_document_type_check;
alter table public.expert_document_grants
  add constraint expert_document_grants_document_type_check check (document_type in (
    'resume', 'bank_account_copy', 'id_card_copy', 'business_card',
    'business_registration', 'signature', 'seal', 'attachment', 'certificate',
    'combined'
  ));

-- ---- 3. 올린 기업 자동 열람 --------------------------------------------------
drop policy if exists expert_documents_select on public.expert_documents;
create policy expert_documents_select on public.expert_documents
  for select using (
    app.is_expert_self(expert_id)
    or app.tenant_can_view_document(expert_id, document_type)
    -- 자기 회사가 제공한 파일은 전문가 허용 없이도 열람 (타사에는 미공개)
    or (uploaded_by_tenant_id is not null
        and uploaded_by_tenant_id = app.tenant_id())
  );

-- ---- 4. 소속·직위 ------------------------------------------------------------
alter table public.experts
  add column if not exists organization text;
alter table public.experts
  add column if not exists job_title text;

comment on column public.experts.organization is '소속 (전문가 공개 프로필)';
comment on column public.experts.job_title is '직위 (전문가 공개 프로필)';
