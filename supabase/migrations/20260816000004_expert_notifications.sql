-- ============================================================================
-- 통합 알림함 (전문가용) — 섭외·서류요청·주민번호 조회·외부발송 열람 등을 한 곳에
-- 설계: docs/decisions/expert-utility-features.md §6
--
--  * 전역 테이블(전문가 소유). 알림은 여러 테넌트 행위로 발생하므로 tenant_id로
--    격리하지 않고 expert_id로 소유한다. 표시용 테넌트명만 스냅샷(tenant_name).
--  * insert는 이벤트 발생 지점(서버, service_role)에서만 — 일반 사용자 insert 정책 없음.
--    전문가는 본인 알림 조회 + 읽음 처리(update)만 가능.
--  * 실데이터 알림만 생성한다(더미 금지, CLAUDE.md 14-7). 발생 소스:
--    섭외 요청/취소, 서류 요청, 외부 발송 열람. (주민번호 조회는 복호화 서비스
--    배포 시 연결 — category만 미리 확보)
-- ============================================================================
create table if not exists public.expert_notifications (
  id uuid primary key default gen_random_uuid(),
  expert_id uuid not null references public.experts(id) on delete cascade,
  category text not null check (category in (
    'engagement_request',      -- 섭외 요청 도착
    'engagement_cancelled',    -- 섭외 회수/취소
    'document_request',        -- 서류 제출 요청
    'rrn_access',              -- 주민등록번호 조회 발생(즉시 통지)
    'external_send_opened',    -- 내가 보낸 외부 서류를 수신자가 열람
    'system'                   -- 시스템 안내
  )),
  title text not null,
  body text,
  link text,                   -- 포털 내 이동 경로(선택)
  tenant_name text,            -- 표시용 테넌트/기관명 스냅샷(교차 테넌트 알림)
  metadata jsonb not null default '{}'::jsonb,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists expert_notifications_expert_idx
  on public.expert_notifications (expert_id, created_at desc);
create index if not exists expert_notifications_unread_idx
  on public.expert_notifications (expert_id) where read_at is null;

alter table public.expert_notifications enable row level security;

-- 본인 알림만 조회. 읽음 처리(update)만 허용. insert/delete는 service_role 전용.
create policy expert_notifications_self_select on public.expert_notifications
  for select using (app.is_expert_self(expert_id));
create policy expert_notifications_self_update on public.expert_notifications
  for update using (app.is_expert_self(expert_id))
  with check (app.is_expert_self(expert_id));
