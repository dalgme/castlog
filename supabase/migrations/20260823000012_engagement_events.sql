-- ============================================================================
-- 섭외 이력 로그 + 수동 섭외 완료 (기획 확정 2026-08-23)
--
-- 1) engagement_events — 섭외 대상자(건)별 이벤트 타임라인.
--    일시·이벤트·실행자(전문가 동의=전문가 이름, 수동 처리=담당자 이름)를
--    남겨 후보 행의 '이력' 버튼으로 확인한다. 감사로그(audit_logs)와 별개로,
--    실무자가 보는 업무 이력이다 (audit는 보안 감사 전용 화면).
-- 2) 수락서 signed_via에 'manual' 추가 — 전화 등으로 수락을 확인하고
--    담당자가 수동으로 '섭외 완료(수락서 생성)' 처리한 건.
-- ============================================================================

-- ---- 1. 이벤트 테이블 --------------------------------------------------------
create table if not exists public.engagement_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  engagement_id uuid not null references public.expert_engagements(id) on delete cascade,
  event_type text not null,
  -- 실행자 표기 (전문가 이름 / 담당자 이름 / '시스템')
  actor_label text not null,
  actor_kind text not null default 'staff',
  note text,
  is_practice boolean not null default false,
  created_at timestamptz not null default now(),
  constraint engagement_events_type_check check (event_type in (
    'requested', 'reminded', 'accepted', 'declined', 'manual_accepted',
    'canceled', 'urgent_canceled', 'expired', 'acceptance_sent',
    'acceptance_confirmed'
  )),
  constraint engagement_events_actor_kind_check check (actor_kind in (
    'expert', 'staff', 'system'
  ))
);

create index if not exists engagement_events_engagement_idx
  on public.engagement_events (engagement_id, created_at);

alter table public.engagement_events enable row level security;

-- 조회: 자사 직원 (전문가 세션 제외 — 실행자 실명이 담긴 내부 업무 이력).
--   + 연습모드 격리(is_practice = app.is_practice() — 20260818000001 총칙)
--   + 열람 범위는 섭외 건 자체의 RLS를 그대로 미러링한다(exists 서브쿼리가
--     호출자 세션의 expert_engagements 정책 아래에서 돌므로, 팀장 이하는
--     배정 프로젝트 건만 보인다 — 20260816000017과 동일 범위).
-- 쓰기: 서버 로직(service_role) 전용 — 세션 정책을 열지 않는다.
drop policy if exists engagement_events_select on public.engagement_events;
create policy engagement_events_select on public.engagement_events
  for select using (
    tenant_id = app.tenant_id()
    and app.user_role() <> 'expert'
    and is_practice = app.is_practice()
    and exists (
      select 1 from public.expert_engagements e
      where e.id = engagement_events.engagement_id
    )
  );

comment on table public.engagement_events is
  '섭외 건별 이벤트 이력 — 발송·동의·거절·수동 완료·재안내·취소·수락서 송신.';

-- ---- 2. 수동 섭외 완료 -------------------------------------------------------
alter table public.engagement_acceptances
  drop constraint if exists engagement_acceptances_signed_via_check;
alter table public.engagement_acceptances
  add constraint engagement_acceptances_signed_via_check
  check (signed_via in ('public_link', 'portal', 'manual'));
