-- ============================================================================
-- [결함] 연습모드 격리 누락 — tenant_alerts · engagement_cancellations
-- (2026-08-23 실사고: 연습모드에서 전문가 섭외 취소 → '긴급: 섭외 취소' 배너가
--  연습모드 종료 후에도 실모드 화면에 계속 노출)
--
-- 원인: 연습모드는 같은 테넌트에서 is_practice + RLS로 격리하는데(20260818000001),
--       전사 알림·취소 내역 두 테이블에는 플래그·SELECT 필터·스탬프가 빠져 있었다.
-- 조치: 컬럼 추가 + SELECT 정책에 모드 일치 조건 + 스탬프 트리거 + 기존 데이터
--       소급 표시(연결된 섭외 건의 is_practice 기준).
-- ============================================================================

alter table public.tenant_alerts
  add column if not exists is_practice boolean not null default false;
alter table public.engagement_cancellations
  add column if not exists is_practice boolean not null default false;

-- 세션 삽입분 자동 스탬프 (JWT app_metadata.practice)
drop trigger if exists a_stamp_practice on public.tenant_alerts;
create trigger a_stamp_practice before insert on public.tenant_alerts
  for each row execute function app.stamp_practice();
drop trigger if exists a_stamp_practice on public.engagement_cancellations;
create trigger a_stamp_practice before insert on public.engagement_cancellations
  for each row execute function app.stamp_practice();

-- SELECT: 모드까지 일치해야 보인다 (양방향 차단)
drop policy if exists tenant_alerts_select on public.tenant_alerts;
create policy tenant_alerts_select on public.tenant_alerts
  for select using (
    tenant_id = app.tenant_id()
    and is_practice = app.is_practice()
  );

drop policy if exists engagement_cancellations_select on public.engagement_cancellations;
create policy engagement_cancellations_select on public.engagement_cancellations
  for select using (
    (tenant_id = app.tenant_id() and is_practice = app.is_practice())
    or app.is_expert_self(expert_id)
  );

-- 기존 데이터 소급 표시 — 연결된 섭외 건이 연습이면 연습으로 (멱등)
update public.tenant_alerts a
set is_practice = true
from public.expert_engagements e
where a.resource_type = 'expert_engagement'
  and a.resource_id = e.id
  and e.is_practice
  and a.is_practice = false;

update public.engagement_cancellations c
set is_practice = true
from public.expert_engagements e
where c.engagement_id = e.id
  and e.is_practice
  and c.is_practice = false;
