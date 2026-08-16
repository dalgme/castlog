-- ============================================================================
-- 저장소 B (별도 Supabase 프로젝트: castlog-rrn-store-b, 서울) — 뒷조각 전용
-- 설계: docs/decisions/rrn-phase2-secure-subsystem.md §4·§6
--
-- 주민등록번호의 "뒷조각"만 보관한다. 메인 DB(앞조각·래핑 DEK)와 물리 분리되어
-- 있으며(별도 프로젝트·별도 자격증명·별도 키), 어느 한쪽만으로는 복원할 수 없다.
-- 이 프로젝트에는 rrn-decrypt Edge Function(복호화 서비스)의 전용 자격증명만
-- 접근한다. RLS deny-all — service_role만.
-- ============================================================================

create table if not exists public.rrn_fragments_back (
  id uuid primary key default gen_random_uuid(),
  -- 메인 DB rrn_fragments_front.id 와 논리적으로 대응(물리 분리라 FK 제약 없음)
  front_id uuid not null unique,
  back_ciphertext text not null,
  created_at timestamptz not null default now(),
  purged_at timestamptz
);

alter table public.rrn_fragments_back enable row level security;
-- 정책 없음 → deny-all. 복호화 서비스의 service_role만 접근.
