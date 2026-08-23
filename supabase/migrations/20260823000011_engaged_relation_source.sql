-- ============================================================================
-- 미연결 전문가 후보 등록 (기획 확정 2026-08-23)
--
-- 섭외후보 등록에서 미연결 전문가를 후보로 넣으면 자사 관계가 자동 생성된다
-- (§4 전면 공개 — 어느 기업이든 섭외를 시작할 수 있다).
-- 관계 출처 값 'engaged'(섭외 시작으로 생성)를 추가한다.
-- engaged_at은 기존 정의대로 첫 섭외 수락 시점에 채워진다.
-- ============================================================================

alter table public.expert_tenant_links
  drop constraint if exists expert_tenant_links_relation_source_check;
alter table public.expert_tenant_links
  add constraint expert_tenant_links_relation_source_check
  check (relation_source in ('self_join', 'bulk_registered', 'engaged'));
