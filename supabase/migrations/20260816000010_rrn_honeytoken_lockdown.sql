-- ============================================================================
-- 주민번호 허니토큰 + 전체 잠금 (§5: 허니토큰 복호화 시도 감지 시 즉시 전체 잠금)
-- 설계: docs/decisions/rrn-phase2-secure-subsystem.md §9
--
--  * 미끼(honeytoken): 실제 전문가의 것이 아닌 가짜 조회 대상. 정상 업무 흐름에서는
--    절대 선택되지 않는다(listRevealTargets에서 제외). 누군가 게이트에 미끼 grant를
--    직접 요청하면 = 정상 경로를 벗어난 접근 → 즉시 전체 잠금 + 경보.
--  * 잠금(tax_lockdown): 미해제(resolved_at is null) 행이 하나라도 있으면 모든
--    주민번호 조회를 차단한다. 해제는 플랫폼 운영자만.
--  * 두 테이블 모두 service_role(게이트)만 접근 — RLS deny-all(정책 없음).
-- ============================================================================

-- 미끼 표식(재래핑 grant에 부여) — 미끼 grant는 조회 목록에서 제외, 요청 시 잠금 트리거
alter table public.tax_project_grants
  add column if not exists is_honeytoken boolean not null default false,
  add column if not exists honeytoken_id uuid;

-- 전체 잠금 상태
create table if not exists public.tax_lockdown (
  id uuid primary key default gen_random_uuid(),
  reason text not null,               -- 'honeytoken' | 'manual' | ...
  honeytoken_id uuid,
  triggered_by_user uuid,
  triggered_tenant uuid,
  triggered_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid,
  resolved_note text
);
create index if not exists tax_lockdown_active_idx
  on public.tax_lockdown (triggered_at desc) where resolved_at is null;

alter table public.tax_lockdown enable row level security;
-- 정책 없음 = deny-all. 게이트(service_role)만 접근.
