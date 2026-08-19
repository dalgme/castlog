-- ============================================================================
-- 첫 로그인 안내 투어 + 챗봇 상담 기록 (건의/요청 · FAQ)
--
-- 설계:
--  * user_tour_acks — 안내 투어를 끝냈는지 사용자별로 기록. 모듈 안내
--    (module_onboarding_acks)와 같은 방식이지만 대상이 다르므로 분리한다.
--    투어는 '이 사람이 처음인가'이고, 모듈 안내는 '이 기능이 새로 켜졌는가'다.
--  * help_feedback — 챗봇 대화에서 걸러낸 사용자의 목소리.
--    kind로 두 갈래를 나눈다:
--      suggestion/bug → 관리모드 '건의/요청' 탭
--      confusion      → 관리모드 'FAQ' 탭 (프로세스를 이해 못하거나 버튼을
--                       못 찾은 상담 — 화면을 고쳐야 한다는 신호)
--  * 테넌트 격리: 각 회사는 자기 회사가 남긴 것만 본다.
--    플랫폼관리자는 전 테넌트를 본다 (제품을 고치는 주체가 넥스트랩이므로).
--  * 대화 원문은 저장하지 않는다. 정리된 제목·요약과 화면 경로만 남긴다 —
--    사용법 질문에도 업무 맥락(전문가 이름·금액)이 섞여 들어온다.
-- ============================================================================

-- ---- 1. 안내 투어 확인 -------------------------------------------------------
create table if not exists public.user_tour_acks (
  user_id uuid not null references public.users (id) on delete cascade,
  tour_key text not null,
  acked_at timestamptz not null default now(),
  primary key (user_id, tour_key)
);

alter table public.user_tour_acks enable row level security;

drop policy if exists user_tour_acks_select on public.user_tour_acks;
create policy user_tour_acks_select on public.user_tour_acks
  for select using (user_id = auth.uid());

drop policy if exists user_tour_acks_insert on public.user_tour_acks;
create policy user_tour_acks_insert on public.user_tour_acks
  for insert with check (user_id = auth.uid());

-- ---- 2. 챗봇 상담 기록 -------------------------------------------------------
create table if not exists public.help_feedback (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  user_id uuid references public.users (id) on delete set null,
  kind text not null,
  title text not null,
  summary text not null,
  -- 어느 화면에서 막혔는지 — FAQ를 화면 개선으로 연결하는 핵심 단서
  path text,
  status text not null default 'new',
  admin_note text,
  -- 연습모드에서 나온 상담은 실제 운영 신호가 아니다
  is_practice boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.help_feedback
  drop constraint if exists help_feedback_kind_check;
alter table public.help_feedback
  add constraint help_feedback_kind_check
  check (kind in ('suggestion', 'bug', 'confusion'));

alter table public.help_feedback
  drop constraint if exists help_feedback_status_check;
alter table public.help_feedback
  add constraint help_feedback_status_check
  check (status in ('new', 'reviewing', 'planned', 'done', 'dismissed'));

create index if not exists help_feedback_board_idx
  on public.help_feedback (kind, status, created_at desc);
create index if not exists help_feedback_tenant_idx
  on public.help_feedback (tenant_id, created_at desc);

alter table public.help_feedback enable row level security;

-- 열람: 자사 상담 + 플랫폼관리자 전체
drop policy if exists help_feedback_select on public.help_feedback;
create policy help_feedback_select on public.help_feedback
  for select using (
    tenant_id = app.tenant_id() or app.is_platform_admin()
  );

-- 작성: 자사 사용자 (챗봇이 서버에서 기록한다)
drop policy if exists help_feedback_insert on public.help_feedback;
create policy help_feedback_insert on public.help_feedback
  for insert with check (tenant_id = app.tenant_id());

-- 처리 상태·메모는 플랫폼관리자만 — 제품을 고치는 주체가 관리하는 값이다
drop policy if exists help_feedback_update on public.help_feedback;
create policy help_feedback_update on public.help_feedback
  for update using (app.is_platform_admin())
  with check (app.is_platform_admin());

drop trigger if exists set_updated_at on public.help_feedback;
create trigger set_updated_at before update on public.help_feedback
  for each row execute function app.set_updated_at();

-- 연습모드 스탬프 — 연습에서 나온 상담이 운영 통계에 섞이지 않게
create or replace function app.stamp_help_feedback_practice()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.is_practice := coalesce(app.is_practice(), false);
  return new;
end;
$$;

drop trigger if exists a_stamp_help_feedback_practice on public.help_feedback;
create trigger a_stamp_help_feedback_practice
  before insert on public.help_feedback
  for each row execute function app.stamp_help_feedback_practice();

-- 모드 격리 (restrictive — 기존 permissive 정책과 AND).
-- 플랫폼관리자는 테넌트 세션이 아니므로 app.is_practice()가 false다 →
-- 관리모드 게시판에는 실제 상담만 올라온다. 연습에서 나온 소리는 운영 신호가
-- 아니므로 그게 맞다.
drop policy if exists help_feedback_practice_mode on public.help_feedback;
create policy help_feedback_practice_mode on public.help_feedback
  as restrictive
  for select
  using (is_practice = coalesce(app.is_practice(), false));

comment on table public.help_feedback is
  '챗봇 상담에서 걸러낸 건의·오류·이해 실패 기록. 관리모드 상담게시판의 원천.';
