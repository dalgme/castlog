-- ============================================================================
-- 수락서 스냅샷에 행사 상세 반영 (Phase A-2)
-- 섭외요청에 추가된 사업명·구분·시간구간·장소·주제·특기사항을 수락서에도 스냅샷한다.
-- (수락서는 수락 시점 조건의 불변 스냅샷 — 원본 변경과 무관하게 보존)
-- ============================================================================
alter table public.engagement_acceptances
  add column if not exists program_name text,
  add column if not exists role_type text,
  add column if not exists starts_time time,
  add column if not exists ends_time time,
  add column if not exists location_name text,
  add column if not exists location_address text,
  add column if not exists event_summary text,
  add column if not exists special_notes text;
