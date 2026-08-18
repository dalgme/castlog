-- ============================================================================
-- 가입정보·법적요건 + 임직원 셀프 가입 → 대표 승인
--
-- 검수에서 확인된 결함
--  1) /contact 문의 폼이 이름·이메일·전화(=개인정보)를 받으면서 **수집·이용 동의를
--     받지 않았다.** 동의 없이 개인정보를 수집·저장하고 있었다.
--  2) 전문가 등록 폼에 "(필수) 이용약관에 동의합니다" 체크박스는 있는데 **약관
--     문서가 존재하지 않았다.** 동의할 대상이 없는 동의였다.
--  3) 테넌트 생성 시 사업자등록번호·대표자명·주소·연락처를 받지 않았다.
--     B2B 계약·세금계산서·본인확인의 최소 정보가 비어 있었다.
--  4) **개인정보 보호책임자(CPO) 지정 정보가 없었다** — 개인정보보호법 제31조는
--     처리자에게 지정·공개 의무를 지운다. 테넌트가 처리자다.
--  5) 임직원 셀프 가입 경로가 없었다. 대표가 한 명씩 만들어 임시 비밀번호를
--     전달하는 경로뿐이었다.
--  6) 직원 계정에 휴대폰을 받지 않았다(컬럼은 있으나 폼에 없음).
--  7) 직원 계정 생성 시 약관·개인정보 동의 기록을 남기지 않았다.
--
-- 이 마이그레이션은 저장 구조만 만든다. 약관·처리방침 본문은 lib/legal에 두고
-- 버전으로 관리한다(문서는 법무 검토 대상이므로 코드에서 초안임을 명시한다).
-- ============================================================================

-- ---- 1. 기업(테넌트) 가입정보 ------------------------------------------------
alter table public.tenants
  add column if not exists representative_name text,   -- 대표자 성명
  add column if not exists address text,               -- 사업장 주소
  add column if not exists contact_phone text,         -- 대표 연락처
  add column if not exists industry text,              -- 업종·업태
  -- 개인정보 보호책임자 (개인정보보호법 §31 — 지정·공개 의무)
  add column if not exists privacy_officer_name text,
  add column if not exists privacy_officer_email text,
  add column if not exists privacy_officer_phone text,
  -- 가입 시점에 동의한 약관 버전 (기업 단위 계약 동의)
  add column if not exists terms_version text,
  add column if not exists terms_agreed_at timestamptz;

comment on column public.tenants.privacy_officer_name is
  '개인정보 보호책임자. 테넌트가 개인정보처리자이므로 테넌트별로 지정·공개한다.';

-- ---- 2. 직원 가입 경로 표시 --------------------------------------------------
alter table public.users
  add column if not exists joined_via text not null default 'admin_created'
    check (joined_via in ('admin_created', 'self_signup')),
  add column if not exists terms_version text,
  add column if not exists terms_agreed_at timestamptz;

-- ---- 3. 문의 폼 동의 기록 ----------------------------------------------------
-- 필수(수집·이용)와 선택(마케팅)은 법적으로 별개다. 한 칸으로 묶지 않는다.
alter table public.platform_inquiries
  add column if not exists privacy_consent_at timestamptz,
  add column if not exists marketing_consent_at timestamptz,
  add column if not exists terms_version text;

-- ---- 4. 임직원 셀프 가입 신청 → 대표 승인 -----------------------------------
-- 신청자는 아직 계정이 없다(비로그인). 그래서 anon INSERT를 허용하되,
-- **읽기는 자사 권한자만** 가능하게 해 신청 목록이 밖으로 새지 않게 한다.
create table if not exists public.staff_join_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null,
  email text not null,
  phone text,
  department text,
  -- 신청자가 적는 참고 정보. 권한단계(grade)는 신청자가 정하지 않는다 —
  -- 승인하는 대표가 정한다. 자기 등급을 신청자가 고르면 그건 권한 상승 경로다.
  note text,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected')),
  -- 신청 시점 동의 기록 (계정이 없으므로 consents 테이블을 쓸 수 없다)
  terms_version text not null,
  terms_agreed_at timestamptz not null default now(),
  privacy_agreed_at timestamptz not null default now(),
  decided_by uuid,
  decided_at timestamptz,
  decision_note text,
  -- 승인으로 만들어진 계정
  created_user_id uuid,
  created_at timestamptz not null default now()
);

create index if not exists staff_join_requests_tenant_idx
  on public.staff_join_requests (tenant_id, status, created_at desc);
create unique index if not exists staff_join_requests_open_idx
  on public.staff_join_requests (tenant_id, lower(email))
  where status = 'pending';

alter table public.staff_join_requests enable row level security;

-- 신청: 비로그인 방문자도 낼 수 있다. 상태·결정 필드는 서버가 기본값으로 채운다.
drop policy if exists staff_join_requests_insert_anon on public.staff_join_requests;
create policy staff_join_requests_insert_anon on public.staff_join_requests
  for insert
  with check (status = 'pending' and decided_by is null and created_user_id is null);

-- 열람·처리: 자사의 대표 또는 staff 위임자만.
drop policy if exists staff_join_requests_select on public.staff_join_requests;
create policy staff_join_requests_select on public.staff_join_requests
  for select using (
    tenant_id = app.tenant_id()
    and (app.is_org_admin() or app.has_admin_scope('staff'))
  );

drop policy if exists staff_join_requests_update on public.staff_join_requests;
create policy staff_join_requests_update on public.staff_join_requests
  for update using (
    tenant_id = app.tenant_id()
    and (app.is_org_admin() or app.has_admin_scope('staff'))
  );

comment on table public.staff_join_requests is
  '임직원 셀프 가입 신청. 권한단계는 신청자가 아니라 승인자(대표·staff 위임자)가 정한다.';
