-- ============================================================================
-- 주민번호 Phase 2 · 단계 2.4 — 테넌트 RRN 키페어 (비대칭 봉투)
-- 설계: rrn-phase2-secure-subsystem.md §5·§13
--
-- 수집 시점엔 조회 비밀번호가 없으므로 테넌트별 비대칭 키페어로 봉투 암호화한다.
--  - public_key_jwk: 공개키(비밀 아님) — 수집 시 레코드 DEK 래핑
--  - wrapped_private_key: 개인키를 "조회 비밀번호 유도 키(Argon2id)"로 래핑(AES-GCM)
-- 조회 비밀번호는 어디에도 저장하지 않는다. RLS deny-all — 쓰기·읽기는 서버 액션
-- (service_role) + 코드 권한검증으로만.
-- ============================================================================
create table if not exists public.tenant_rrn_keys (
  tenant_id uuid primary key,
  public_key_jwk jsonb not null,
  wrapped_private_key text not null,
  kdf_salt text not null,
  kdf_params jsonb not null,
  wrap_iv text not null,
  alg text not null default 'RSA-OAEP-256/AES-256-GCM/argon2id',
  created_at timestamptz not null default now(),
  updated_at timestamptz
);

alter table public.tenant_rrn_keys enable row level security;
-- 정책 없음 → deny-all.
