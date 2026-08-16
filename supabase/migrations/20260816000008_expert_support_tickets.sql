-- ============================================================================
-- 전문가 문의/지원 티켓 (#7)
-- 설계: docs/decisions/expert-utility-features.md §B-7
--
--  * 전역 테이블(전문가 소유). 로그인 전문가가 플랫폼(넥스트랩)에 문의를 남기고
--    스레드로 답변받는다. 상태: open(접수) · in_progress(처리중) · resolved(완료).
--  * 도입 문의(platform_inquiries)와 구분 — 이건 로그인 전문가 전용 지원 채널.
--  * target='tenant'는 향후 확장용 컬럼만 확보(현 단계 UI는 platform 대상).
-- ============================================================================
create table if not exists public.expert_support_tickets (
  id uuid primary key default gen_random_uuid(),
  expert_id uuid not null references public.experts(id) on delete cascade,
  subject text not null,
  target text not null default 'platform' check (target in ('platform', 'tenant')),
  target_tenant_id uuid references public.tenants(id) on delete set null,
  status text not null default 'open' check (status in ('open', 'in_progress', 'resolved')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists expert_support_tickets_expert_idx
  on public.expert_support_tickets (expert_id, created_at desc);
create index if not exists expert_support_tickets_status_idx
  on public.expert_support_tickets (status, created_at desc);

create trigger set_updated_at before update on public.expert_support_tickets
  for each row execute function app.set_updated_at();

alter table public.expert_support_tickets enable row level security;

-- 전문가 본인 + 플랫폼 관리자 조회. 생성은 본인. 상태 변경은 본인(닫기)·플랫폼.
create policy expert_support_tickets_select on public.expert_support_tickets
  for select using (app.is_expert_self(expert_id) or app.is_platform_admin());
create policy expert_support_tickets_insert on public.expert_support_tickets
  for insert with check (app.is_expert_self(expert_id));
create policy expert_support_tickets_update on public.expert_support_tickets
  for update using (app.is_expert_self(expert_id) or app.is_platform_admin())
  with check (app.is_expert_self(expert_id) or app.is_platform_admin());

-- 티켓 메시지(스레드) ------------------------------------------------------
create table if not exists public.expert_support_ticket_messages (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.expert_support_tickets(id) on delete cascade,
  author_type text not null check (author_type in ('expert', 'platform')),
  author_auth_user_id uuid,
  body text not null,
  created_at timestamptz not null default now()
);

create index if not exists expert_support_ticket_messages_ticket_idx
  on public.expert_support_ticket_messages (ticket_id, created_at);

alter table public.expert_support_ticket_messages enable row level security;

-- 티켓 참여자(소유 전문가 또는 플랫폼 관리자)만 조회·작성.
create policy expert_support_ticket_messages_select on public.expert_support_ticket_messages
  for select using (
    exists (
      select 1 from public.expert_support_tickets t
      where t.id = ticket_id
        and (app.is_expert_self(t.expert_id) or app.is_platform_admin())
    )
  );
create policy expert_support_ticket_messages_insert on public.expert_support_ticket_messages
  for insert with check (
    exists (
      select 1 from public.expert_support_tickets t
      where t.id = ticket_id
        and (
          (author_type = 'expert' and app.is_expert_self(t.expert_id))
          or (author_type = 'platform' and app.is_platform_admin())
        )
    )
  );
