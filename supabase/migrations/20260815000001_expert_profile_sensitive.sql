-- ============================================================================
-- 전문가 프로필 정확 정보 직접입력 + 주민등록번호 조회 이력 (설계문서 4.4 · 5.x)
--
-- 주민등록번호(RRN) 본체는 이 마이그레이션에서 **저장하지 않는다**.
-- RRN 실수집·복호화는 §5의 분리 복호화 서비스·분할저장·Argon2id 기반
-- Phase 2 보안 서브시스템에서만 처리한다 (Hard NO #3·#4 유지).
-- 여기서는 (1) 비-주민 정확정보(보조연락처·계좌: 계좌는 AES-256-GCM 암호화),
-- (2) RRN "조회 이력" 열람 테이블(전문가 본인 공개 — §5 이력 공개 의무)만 만든다.
-- ============================================================================

-- 1) 보조 연락처 — experts 전역 테이블에 컬럼 추가 (주 연락처=로그인 phone)
alter table public.experts
  add column if not exists secondary_phone text;

-- 2) expert_bank_accounts [전역, 전문가 소유] — 계좌 정보 암호화 저장
--    account_number_enc: lib/crypto/secrets (AES-256-GCM) 저장 형식.
--    평문 계좌번호는 어디에도 저장하지 않는다. 표시는 account_last4만.
create table if not exists public.expert_bank_accounts (
  expert_id uuid primary key references public.experts(id) on delete cascade,
  bank_name text,
  account_holder text,
  account_number_enc text,
  account_last4 text,
  updated_at timestamptz not null default now()
);

create trigger set_updated_at before update on public.expert_bank_accounts
  for each row execute function app.set_updated_at();

alter table public.expert_bank_accounts enable row level security;

-- 본인만 읽고 쓴다 (지급 단계의 기업 열람은 Phase 2 지급 서비스에서 별도 처리)
create policy expert_bank_accounts_self_select on public.expert_bank_accounts
  for select using (app.is_expert_self(expert_id));
create policy expert_bank_accounts_self_insert on public.expert_bank_accounts
  for insert with check (app.is_expert_self(expert_id));
create policy expert_bank_accounts_self_update on public.expert_bank_accounts
  for update using (app.is_expert_self(expert_id))
  with check (app.is_expert_self(expert_id));

-- 3) tax_access_logs [전역] — 주민등록번호 "조회 이력" (전문가 본인 열람 공개)
--    §5: 모든 RRN 조회는 기록 + 전문가 본인에게 즉시 알림 및 이력 공개.
--    INSERT 정책 없음 → 클라이언트/기업 세션은 기록 불가. Phase 2 분리 복호화
--    서비스(service_role)만 기록한다. 표시용 기관/프로젝트명은 스냅샷 저장
--    (전문가는 타 테넌트 projects를 RLS로 못 읽으므로 조인 대신 denormalize).
create table if not exists public.tax_access_logs (
  id uuid primary key default gen_random_uuid(),
  expert_id uuid not null references public.experts(id) on delete cascade,
  tenant_id uuid,
  tenant_name text,
  project_id uuid,
  project_name text,
  -- 조회 사유: payment_approval(지급품의) · tax_filing(세무자료 제출) · other
  reason text not null,
  -- 조회 형태: file_generation(지급명세서 파일 생성) · screen(화면 단건 조회)
  access_type text not null default 'file_generation',
  accessor_label text, -- 조회자(직책/이름) 스냅샷
  accessed_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists tax_access_logs_expert_idx
  on public.tax_access_logs (expert_id, accessed_at desc);

alter table public.tax_access_logs enable row level security;

-- 전문가 본인만 SELECT (전 기업 통합 이력). INSERT/UPDATE/DELETE 정책 없음.
create policy tax_access_logs_select_self on public.tax_access_logs
  for select using (app.is_expert_self(expert_id));
