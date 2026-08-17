-- ============================================================================
-- 섭외요청 행사 상세 필드 (Phase A-2) — 수락서 샘플 양식에 맞춘 구조화
-- 근거: 사용자 제공 수락서(.hwp) — 사업명·일정(시간구간)·장소·주제·특기사항·구분
--
--  * 기존에는 role_description(자유문) + starts_on/ends_on(날짜) + message(자유문)뿐이라
--    수락서에 필요한 항목을 담을 수 없었다. 구조화 필드로 승격한다.
--  * role_type: 수락서의 '구분' 체크 항목. role_description(세부 역할)은 유지.
-- ============================================================================
alter table public.expert_engagements
  add column if not exists program_name text,        -- 사업명/프로그램명
  add column if not exists role_type text,           -- 구분(진행·강사·멘토링/컨설팅 등)
  add column if not exists starts_time time,         -- 일시 구간 시작
  add column if not exists ends_time time,           -- 일시 구간 종료
  add column if not exists location_name text,       -- 장소
  add column if not exists location_address text,    -- 장소 주소
  add column if not exists event_summary text,       -- 주제/행사 기본 내용
  add column if not exists special_notes text;       -- 특기사항(대상·내용·도출물)

alter table public.expert_engagements
  drop constraint if exists expert_engagements_role_type_check;
alter table public.expert_engagements
  add constraint expert_engagements_role_type_check
  check (role_type is null or role_type in (
    'host',        -- 진행
    'lecturer',    -- 강사
    'mentor',      -- 멘토링/컨설팅
    'judge',       -- 심사위원
    'announcer',   -- 아나운서
    'assistant',   -- 아르바이트/보조
    'other'        -- 기타
  ));

comment on column public.expert_engagements.role_type is
  '수락서 구분 항목. 세부 역할 설명은 role_description 유지.';
