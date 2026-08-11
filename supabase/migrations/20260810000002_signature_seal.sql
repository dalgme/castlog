-- ============================================================================
-- 단계 28-A: 전문가 서명·날인 등록 (대표 피드백 ②, 비-AI)
--
--  * 서명(signature)은 1차 스키마에 이미 반영됨. 여기서 날인(도장, seal)을 추가한다.
--  * 서명·날인은 서명 캔버스(PNG)로 수집 — 암호화 버킷(expert-documents) 저장,
--    공개 URL 금지, 서명된 만료 URL로만 열람 (CLAUDE.md 5·6).
--  * 소유자는 전문가(전역 테이블). 섭외 수락 시 수락서에 스냅샷된다(단계 28-B).
-- ============================================================================

alter table public.expert_documents
  drop constraint expert_documents_document_type_check;

alter table public.expert_documents
  add constraint expert_documents_document_type_check
  check (document_type in (
    'resume',
    'bank_account_copy',
    'id_card_copy',
    'business_card',
    'business_registration',
    'signature',           -- 서명
    'seal'                 -- 날인(도장)
  ));
