-- ============================================================================
-- 전역 전문가 DB 관리 — 이용 중지(비활성) 개념 신설 (기획 2026-08-30)
--
-- 배경: 캐스트로그는 전문가 등록플랫폼(§4)인데, 문제 전문가(허위 프로필·
-- 분쟁·본인 요청 탈퇴 등)를 플랫폼 차원에서 중지할 수단이 없었다 —
-- experts에는 상태 컬럼이 없고, 관리모드에는 전문가 DB 화면 자체가 없었다.
--
-- 설계 (§14-4 "삭제보다 비활성화"):
-- - is_active=false는 "새로운 노출·신규 관계에서 빠진다"는 뜻이다:
--   전 테넌트 공개 풀 목록·탐색·신규 자동 연결·포털 로그인에서 제외.
-- - 기존 데이터(연결·섭외 이력·수락서·지급 기록)는 그대로 남는다 — 이력
--   화면의 이름 표기가 사라지면 기록 신뢰가 깨진다.
-- - 판정·전환은 앱 레벨(관리모드 서버 액션, service_role)이 한다. experts의
--   RLS는 기존 정책(본인/연결 기업) 유지 — 전 테넌트 공개가 원래 RLS 밖의
--   "admin 조회 + 공개 컬럼 명시" 관례이므로, 비활성 필터도 같은 자리에 건다.
-- - auth 계정이 연결된 전문가는 ban(로그인 차단)을 병행한다. 계정이 없는
--   보유자료 등록 건은 이 컬럼이 유일한 차단 수단이다 (claim도 거부).
--
-- 멱등: add column if not exists.
-- ============================================================================

alter table public.experts
  add column if not exists is_active boolean not null default true;
alter table public.experts
  add column if not exists deactivated_at timestamptz;
-- 중지 사유 — 위험 작업은 사유를 남긴다(§14-3). 화면에는 관리모드에만 노출.
alter table public.experts
  add column if not exists deactivation_note text;

-- 비활성 건은 소수 — 부분 인덱스로 충분하다 (관리모드 필터용)
create index if not exists experts_inactive_idx
  on public.experts (is_active) where is_active = false;

comment on column public.experts.is_active is
  '플랫폼 이용 상태 — false면 공개 풀·탐색·신규 연결·포털 로그인에서 제외 (기존 이력은 유지)';
