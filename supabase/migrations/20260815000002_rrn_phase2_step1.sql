-- ============================================================================
-- 주민등록번호 Phase 2 · 단계 2.1 — 메인 앱 안전 골격
-- (설계: docs/decisions/rrn-phase2-secure-subsystem.md)
--
-- 이 마이그레이션의 모든 테이블은 RLS 활성 + **정책 없음(deny-all)**.
-- 즉 authenticated/anon 세션은 읽지도 쓰지도 못하며, 오직 분리 복호화
-- 서비스가 사용하는 service_role만 접근한다. 메인 앱은 복호화 능력이 없다.
-- 실제 조회/수집 로직은 이후 단계(2.2~)에서 각 신뢰 경계에 맞춰 배선한다.
-- ============================================================================

-- 1) rrn_fragments_front [메인 DB = 분할 저장소 A] — 앞조각 + 래핑된 DEK
--    뒷조각(rrn_fragments_back)은 별도 저장소 B(별도 자격증명)에 둔다(단계 2.4).
create table if not exists public.rrn_fragments_front (
  id uuid primary key default gen_random_uuid(),
  expert_id uuid not null references public.experts(id) on delete restrict,
  tenant_id uuid,
  project_id uuid,
  front_ciphertext text not null, -- 앞조각 암호문(레코드 DEK, AES-256-GCM)
  wrapped_dek text not null,      -- DEK를 테넌트키→조회비밀번호유도키로 래핑
  alg text not null default 'aes-256-gcm+argon2id',
  created_at timestamptz not null default now(),
  purged_at timestamptz          -- 보존기간 경과 자동 파기 시각
);
alter table public.rrn_fragments_front enable row level security;
-- 정책 없음 → deny-all (service_role만)

-- 2) tax_access_grants [메인 DB] — 조회 지정자(회계담당·대표)만.
--    대결·위임 대상 아님(코드로 강제 — 단계 2.2). 플랫폼관리자 불가.
create table if not exists public.tax_access_grants (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  user_id uuid not null,       -- 지정된 권한자(회계담당/대표)
  role_label text,             -- '회계담당자' | '대표자'
  granted_by uuid,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);
create index if not exists tax_access_grants_tenant_idx
  on public.tax_access_grants (tenant_id) where revoked_at is null;
alter table public.tax_access_grants enable row level security;

-- 3) tax_access_requests [메인 DB] — 승인된 지급 결재건에 연결된 1건 조회 요청.
--    연결 없으면 거부. 상시 조회 화면 없음. 재인증·한도·초과사유를 여기서 관리.
create table if not exists public.tax_access_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  project_id uuid,
  expert_id uuid not null,
  approval_id uuid,            -- 지급 결재건 연결(필수 — 단계 2.2에서 강제)
  reason text not null,        -- 'payment_approval' | 'tax_filing'
  status text not null default 'pending', -- pending|reauthed|fulfilled|denied|locked
  requested_by uuid,
  reauth_at timestamptz,       -- 재인증(조회 비밀번호+2차) 완료 시각
  is_over_limit boolean not null default false,
  over_limit_reason text,      -- 프로젝트당 2회 초과 시 사유
  over_limit_approved_by uuid, -- 대표 승인자
  created_at timestamptz not null default now()
);
create index if not exists tax_access_requests_lookup_idx
  on public.tax_access_requests (tenant_id, expert_id, project_id);
alter table public.tax_access_requests enable row level security;

-- 4) tax_rate_limits [메인 DB] — 사용자·테넌트별 시간당 복호화 상한/자동 잠금
create table if not exists public.tax_rate_limits (
  id uuid primary key default gen_random_uuid(),
  subject_type text not null,  -- 'user' | 'tenant'
  subject_id uuid not null,
  window_start timestamptz not null,
  count int not null default 0,
  locked_until timestamptz,    -- 상한 초과 시 자동 잠금 만료 시각
  created_at timestamptz not null default now(),
  unique (subject_type, subject_id, window_start)
);
alter table public.tax_rate_limits enable row level security;

-- 5) tax_honeytokens [메인 DB] — 미끼 레코드. 복호화 시도 감지 시 전체 잠금(단계 2.6).
create table if not exists public.tax_honeytokens (
  id uuid primary key default gen_random_uuid(),
  label text,
  front_ciphertext text not null,
  triggered_at timestamptz,    -- 복호화 시도 감지 시각
  created_at timestamptz not null default now()
);
alter table public.tax_honeytokens enable row level security;
