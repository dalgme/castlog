-- ============================================================================
-- 외부 송신 일반 첨부 유형(attachment) 추가
-- 설계: docs/decisions/expert-utility-features.md §A
--
--  * 외부 송신 탭에서 이력서/통장사본/신분증사본 외에 임의 파일을 함께 보낼 수
--    있도록, 표준 유형에 속하지 않는 일반 첨부를 'attachment'로 저장한다.
--  * 저장·열람 규칙은 다른 서류와 동일(암호화 버킷, 서명 만료 URL, 공개 URL 금지).
--  * 서류함 화면에는 표준 유형만 슬롯으로 노출하고 attachment는 숨긴다.
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
    'seal',                -- 날인(도장)
    'attachment'           -- 외부 송신용 일반 첨부(비표준 파일)
  ));
