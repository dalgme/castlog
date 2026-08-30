-- ============================================================================
-- 클라이언트 런타임 에러 수집 (실시간 사용자 테스트 모니터링 — 기획 2026-08-29)
--
-- 배경: 실고객(렛츠) 사용자 테스트를 캐스트로그 관리모드에서 실시간으로
-- 지켜보려는데, 지금까지 런타임 에러는 어디에도 남지 않았다 — app/error.tsx의
-- console.error가 유일했고, 그 주석("운영 환경 에러 모니터링 연동 지점")이
-- 비어 있는 훅이었다. 이 테이블이 그 연동 지점의 저장소다.
--
-- 설계:
-- - 수집은 테넌트의 모니터링 창(tenants.feature_flags.monitor_until)이 열려
--   있는 동안만 한다. 창은 관리모드에서 기업별로 켠다 — 상시 수집이 아니라
--   테스트 세션 계측이다. (플래그 키는 JSONB라 스키마 변경 불필요)
-- - 화면에는 error.message를 노출하지 않는 기존 방침(digest만)을 유지하되,
--   저장은 message까지 한다 — 해석하려면 내용이 필요하다. 예외 문구에 업무
--   값이 섞여 들어올 가능성 때문에 열람은 플랫폼관리자 전용으로 잠근다.
-- - INSERT 전용 (audit_logs와 동일 — app.block_mutation). 같은 이유로
--   tenant_id·user_id에 FK를 걸지 않는다 — audit_logs 선례: FK cascade가
--   block 트리거와 충돌해 테넌트 정리(생성 롤백 포함)를 깨뜨린다.
-- - 쓰기는 API 라우트의 service_role만 하므로 세션용 insert 정책이 없다.
-- - 보존: 테스트 계측용이라 장기 보존 가치가 낮다. 90일 경과분은 관리모드
--   정리 작업으로 지울 수 있다(§14-4 예외 — 최소 보존; 정리는 트리거를
--   우회할 수 없으므로 별도 관리 함수를 그때 추가한다).
--
-- 멱등: create if not exists / drop-and-create 쌍.
-- ============================================================================

create table if not exists public.client_error_logs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid, -- 세션 없는 화면(전역 에러)은 null 가능. FK 없음(audit_logs 선례)
  user_id uuid,
  user_role text,
  -- 어느 화면에서 났는지 (pathname). 쿼리스트링은 싣지 않는다.
  path text,
  message text not null,
  -- 스택 최상단 몇 줄만 — 전체 스택은 가치 대비 위험(값 유입)이 크다
  stack_digest text,
  -- Next.js 에러 digest (서버 컴포넌트 에러 대조용)
  error_digest text,
  source text not null default 'client'
    check (source in ('client', 'global', 'api')),
  user_agent text,
  is_practice boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists client_error_logs_tenant_created_idx
  on public.client_error_logs (tenant_id, created_at desc);

alter table public.client_error_logs enable row level security;

-- 열람: 플랫폼관리자 전용. 에러 메시지에 무엇이 섞여 들어올지 통제할 수
-- 없으므로(예외 문구에 업무 값이 실리는 경우) 테넌트 열람도 열지 않는다.
drop policy if exists client_error_logs_select on public.client_error_logs;
create policy client_error_logs_select on public.client_error_logs
  for select using (app.is_platform_admin());

-- INSERT 전용 — 수정·삭제는 차단 (기록 신뢰, audit_logs와 동일 패턴)
drop trigger if exists client_error_logs_block_mutation on public.client_error_logs;
create trigger client_error_logs_block_mutation
  before update or delete on public.client_error_logs
  for each row execute function app.block_mutation();

comment on table public.client_error_logs is
  '런타임 에러 수집 (테넌트 모니터링 창이 열린 동안만) — 열람 플랫폼관리자 전용, INSERT 전용';

-- ============================================================================
-- 렛츠 사전 시뮬레이션(2026-08-29) 상 결함 2건 — RLS 보정
-- ============================================================================

-- ---- 1. 회수 기록이 조용히 유실되던 회귀 (시뮬레이션 P4·P9) ------------------
-- 20260829000001이 expert_engagements UPDATE는 세 축 합집합으로 넓혔지만
-- engagement_cancellations INSERT는 engagementCancel(레벨 3) 단일 축으로
-- 남았다. 기본값에서 대리(레벨 4)의 '응답 전 회수'는 회수 자체는 성공하는데
-- 취소 내역·사유 기록 INSERT만 RLS에 거부돼 조용히 사라졌다 — 취소 내역
-- 화면·전문가 포털의 회수 사유 카드가 비는 원인. 회수 축도 인정한다.
drop policy if exists engagement_cancellations_insert on public.engagement_cancellations;
create policy engagement_cancellations_insert on public.engagement_cancellations
  for insert with check (
    tenant_id = app.tenant_id()
    and (app.can_exec('engagementCancel') or app.can_exec('engagementWithdraw'))
  );

-- ---- 2. PL·PM 겸임(pl_pm)·PL이 부PM 승인을 못 하던 회귀 (시뮬레이션 P2) ------
-- pl_pm 역할 신설(#123) 때 app.is_project_pm이 'pm' 단일 비교로 남아,
-- 승인 화면은 겸임 PM·PL에게 버튼을 보여 주는데 DB 트리거·UPDATE 정책이
-- 거부했다. 권한 안내("부PM이 실행한 민감한 작업은 PM(또는 PL)의 승인을
-- 거칩니다")와 화면 판정에 맞춰 pm·pl_pm·pl 세 역할로 확장한다.
create or replace function app.is_project_pm(p_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select app.project_assignment_role(p_project_id) in ('pm', 'pl_pm', 'pl')
$$;

revoke all on function app.is_project_pm(uuid) from public;
grant execute on function app.is_project_pm(uuid) to authenticated;

comment on function app.is_project_pm(uuid) is
  '현재 세션이 해당 프로젝트의 승인 주체(PM·PL·PM 겸임·PL)인가. 부PM 실행 요청의 승인 판정에 쓴다.';
