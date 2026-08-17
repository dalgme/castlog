-- ============================================================================
-- 세션명(섹션명) + 넘버링코드 승계 — 수락서 자동 생성 보강 (기획 확정)
--
-- 수락서는 별도 파일이 아니라 '시스템 데이터를 읽어 자동 구성되는 화면 단계'다.
-- 전문가가 섭외를 승인하면 다음 값이 그대로 흘러 수락서를 구성한다:
--   프로젝트 정보 → 넘버링코드에 귀속된 일시·장소 → 세션명 → 전문가 정보
-- 그동안 '세션명'과 '넘버링코드'가 슬롯에만 있고 섭외·수락서로 넘어가지 않아
-- 수락서에서 어느 세션 건인지 식별할 수 없었다. 스냅샷 경로를 연결한다.
-- ============================================================================

-- 타임테이블 한 줄 = 하나의 세션(섹션)
alter table public.engagement_slots
  add column if not exists session_name text;

-- 섭외 요청 시 슬롯에서 승계 (수락서 스냅샷의 원천)
alter table public.expert_engagements
  add column if not exists session_name text,
  add column if not exists position_code text;

-- 수락서 스냅샷 (수락 시점 고정 — 이후 슬롯이 바뀌어도 수락서는 그대로)
alter table public.engagement_acceptances
  add column if not exists session_name text,
  add column if not exists position_code text;

comment on column public.engagement_slots.session_name is
  '세션(섹션)명 — 예: 1일차 오전 강의, 데모데이 심사. 섭외요청·수락서로 승계된다.';
comment on column public.expert_engagements.position_code is
  '섭외 근거 넘버링코드(engagement_slot_positions.code) 스냅샷.';
