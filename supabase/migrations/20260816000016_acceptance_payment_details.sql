-- ============================================================================
-- 수락서 지급 정보 (Phase C-2) — 제공 수락서 양식의 '인적 정보 / 비고' 대응
--
--  * 소득구분(원천징수 안내)·입금 계좌(은행·예금주·뒷4자리)·입금예정일·제출서류.
--  * ❗ 주민등록번호는 수락서에 저장하지 않는다(§5·§11-3). 지급 시점에 분리된
--    안전 절차(재래핑·지정자 조회)로만 확인한다. 제공 샘플에서도 해당 칸은 공란.
--  * ❗ 계좌번호 전체도 저장하지 않는다 — 뒷 4자리만 표기(원본은 전문가 소유·암호화).
-- ============================================================================
alter table public.engagement_acceptances
  add column if not exists payment_type text,       -- 사업소득/기타소득/사업자
  add column if not exists bank_name text,
  add column if not exists account_holder text,
  add column if not exists account_last4 text,      -- 뒷 4자리만
  add column if not exists payment_due_note text,   -- 입금예정일 안내(기업 입력)
  add column if not exists submission_docs text;    -- 제출서류(기업 입력)

comment on column public.engagement_acceptances.account_last4 is
  '계좌 뒷 4자리만 표기. 전체 계좌번호·주민등록번호는 수락서에 저장하지 않는다(§5).';
