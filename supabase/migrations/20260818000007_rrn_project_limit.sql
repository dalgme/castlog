-- ============================================================================
-- 주민번호 프로젝트당 조회 한도 실제 강제 + 초과 승인 흐름
--
-- 문제: CLAUDE.md §5는 "프로젝트당 2회 한도 + 초과 시 사유 기재 + 대표 승인 +
--       전문가 통지"를 규정했다. 상수(RRN_PROJECT_LIMIT)와 판정 함수
--       (isOverProjectLimit)는 있었지만 **실제 조회 경로에서 아무 데도 호출되지
--       않았다.** 강제된 것은 시간당 상한뿐이었다. 규정이 코드에 없으면 규정이
--       아니다.
--
-- 설계: 한도 초과를 **차단하지 않는다**(§5 — 세무조사·경정청구 등 정당한 초과가
--       실제로 발생한다). 대신 한 번의 초과 조회마다:
--         1) 지정자가 초과 사유를 적어 요청(tax_access_requests, is_over_limit)
--         2) 대표(ceo)가 승인 — 위임 불가, 대표만
--         3) 승인 1건 = 조회 1회 (consumed_at으로 소진 처리)
--         4) 조회 시 tax_access_logs에 초과 표시 + 전문가에게 초과 사실 통지
--
--       tax_access_requests는 게이트(service_role)만 쓰고, 보안책임자·대표는
--       읽기만 한다(20260818000006). 승인 행위는 서버 액션이 admin 클라이언트로
--       수행하며 audit_logs에 남는다.
-- ============================================================================

-- ---- 조회 이력에 '초과 조회' 표식 -------------------------------------------
-- 전문가 본인 화면과 보안책임자 화면 양쪽에서 "이건 한도를 넘긴 조회였다"가
-- 보여야 한다. 초과 사실을 이력에서 못 읽으면 통지도 사후 확인도 성립하지 않는다.
alter table public.tax_access_logs
  add column if not exists is_over_limit boolean not null default false,
  add column if not exists over_limit_reason text;

-- 프로젝트당 사용 횟수 집계용 (tenant+project+expert)
create index if not exists tax_access_logs_quota_idx
  on public.tax_access_logs (tenant_id, project_id, expert_id, accessed_at desc);

-- ---- 초과 조회 요청: 승인·소진 시각 ----------------------------------------
alter table public.tax_access_requests
  add column if not exists decided_by uuid,
  add column if not exists decided_at timestamptz,
  add column if not exists decision_note text,
  add column if not exists consumed_at timestamptz;

comment on column public.tax_access_requests.consumed_at is
  '승인 1건 = 조회 1회. 조회 성사 시 소진 처리되어 재사용되지 않는다.';

-- 승인 대기·미소진 승인 조회용
create index if not exists tax_access_requests_pending_idx
  on public.tax_access_requests (tenant_id, status, created_at desc);
create index if not exists tax_access_requests_open_idx
  on public.tax_access_requests (tenant_id, expert_id, project_id)
  where consumed_at is null;
