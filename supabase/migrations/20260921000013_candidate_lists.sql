-- 섭외 프로세스 고도화 2단계 (기획 승인 2026-11-07 — docs/decisions/engagement-review-flow.md 01·04·07)
--
-- '리스트 작성' 탭: 섭외후보 등록 탭의 후보(자리)를 문서로 묶어 상무·대표의 **내부 검토**를 받는다.
--  - candidate_lists           리스트 문서(프로젝트별 리비전). 검토 요청 시점의 스냅샷 머리.
--  - candidate_list_entries    리스트 행(세션 × 후보) 스냅샷 — 검토자가 본 것과 이후 수정이 섞이지 않게.
--  - candidate_list_reviews    내부 검토 요청(검토자별 1행) — requested → done.
--  - candidate_list_review_comments  검토 의견 (후보별 또는 전체).
-- 3단계(발주처 검토)·4단계(후보 조정·품의)는 같은 리스트 표에 상태를 이어 붙인다.
-- RLS: 자사 임직원 + 그 프로젝트 열람 범위(app.can_view_project). 쓰기는 프로젝트 팀(app.is_project_team).
-- 멱등. 코드는 표 부재(42P01·PGRST205)를 '준비 중'으로 폴백한다.

create table if not exists public.candidate_lists (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  revision integer not null default 1,
  -- internal_requested(내부 검토 중) → internal_done(내부 검토 완료)
  -- → client_sent(발주처 검토 중, 3단계) → client_replied(발주처 회신 받음)
  -- → adjusting(후보 조정 중, 4단계) → submitted(품의 상신됨) / superseded(다시 작성으로 대체)
  status text not null default 'internal_requested'
    check (status in ('internal_requested', 'internal_done', 'client_sent', 'client_replied', 'adjusting', 'submitted', 'superseded')),
  title text not null,
  note text,
  created_by uuid references public.users (id) on delete set null,
  internal_requested_at timestamptz,
  internal_done_at timestamptz,
  is_practice boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists candidate_lists_project_idx
  on public.candidate_lists (tenant_id, project_id, revision desc);
-- 프로젝트당 살아 있는 리스트는 하나
create unique index if not exists candidate_lists_live_uniq
  on public.candidate_lists (project_id)
  where status not in ('submitted', 'superseded');

drop trigger if exists set_updated_at on public.candidate_lists;
create trigger set_updated_at before update on public.candidate_lists
  for each row execute function app.set_updated_at();

create table if not exists public.candidate_list_entries (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  list_id uuid not null references public.candidate_lists (id) on delete cascade,
  slot_id uuid references public.engagement_slots (id) on delete set null,
  position_id uuid references public.engagement_slot_positions (id) on delete set null,
  expert_id uuid not null references public.experts (id) on delete cascade,
  rank integer not null default 1,
  code text not null,
  -- 스냅샷 표기 — 세션이 바뀌어도 검토 당시 문서는 그대로
  session_label text not null,
  role_label text,
  unit_fee_online integer,
  unit_fee_offline integer,
  total_fee_min integer,
  total_fee_max integer,
  memo_count integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists candidate_list_entries_list_idx
  on public.candidate_list_entries (list_id, slot_id, rank);

create table if not exists public.candidate_list_reviews (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  list_id uuid not null references public.candidate_lists (id) on delete cascade,
  reviewer_user_id uuid not null references public.users (id) on delete cascade,
  status text not null default 'requested' check (status in ('requested', 'done')),
  requested_by uuid references public.users (id) on delete set null,
  requested_at timestamptz not null default now(),
  done_at timestamptz,
  unique (list_id, reviewer_user_id)
);

create index if not exists candidate_list_reviews_reviewer_idx
  on public.candidate_list_reviews (reviewer_user_id, status);

create table if not exists public.candidate_list_review_comments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  list_id uuid not null references public.candidate_lists (id) on delete cascade,
  -- 어느 후보 행에 대한 의견인지 (null = 리스트 전체 의견)
  entry_id uuid references public.candidate_list_entries (id) on delete set null,
  author_user_id uuid not null references public.users (id) on delete cascade,
  body text not null check (length(body) between 1 and 1000),
  created_at timestamptz not null default now()
);

create index if not exists candidate_list_review_comments_list_idx
  on public.candidate_list_review_comments (list_id, created_at);

-- ---- RLS ----------------------------------------------------------------------
alter table public.candidate_lists enable row level security;
alter table public.candidate_list_entries enable row level security;
alter table public.candidate_list_reviews enable row level security;
alter table public.candidate_list_review_comments enable row level security;

drop policy if exists candidate_lists_select on public.candidate_lists;
create policy candidate_lists_select on public.candidate_lists
  for select using (
    tenant_id = app.tenant_id()
    and app.user_role() <> 'expert'
    and app.can_view_project(project_id)
  );
drop policy if exists candidate_lists_insert on public.candidate_lists;
create policy candidate_lists_insert on public.candidate_lists
  for insert with check (tenant_id = app.tenant_id() and app.is_project_team(project_id));
drop policy if exists candidate_lists_update on public.candidate_lists;
create policy candidate_lists_update on public.candidate_lists
  for update using (tenant_id = app.tenant_id() and app.is_project_team(project_id))
  with check (tenant_id = app.tenant_id() and app.is_project_team(project_id));
drop policy if exists candidate_lists_practice on public.candidate_lists;
create policy candidate_lists_practice on public.candidate_lists
  as restrictive for select using (is_practice = app.is_practice());

drop policy if exists candidate_list_entries_select on public.candidate_list_entries;
create policy candidate_list_entries_select on public.candidate_list_entries
  for select using (
    tenant_id = app.tenant_id()
    and exists (select 1 from public.candidate_lists l where l.id = list_id)
  );
drop policy if exists candidate_list_entries_insert on public.candidate_list_entries;
create policy candidate_list_entries_insert on public.candidate_list_entries
  for insert with check (
    tenant_id = app.tenant_id()
    and exists (select 1 from public.candidate_lists l where l.id = list_id and app.is_project_team(l.project_id))
  );

drop policy if exists candidate_list_reviews_select on public.candidate_list_reviews;
create policy candidate_list_reviews_select on public.candidate_list_reviews
  for select using (
    tenant_id = app.tenant_id()
    and exists (select 1 from public.candidate_lists l where l.id = list_id)
  );
drop policy if exists candidate_list_reviews_insert on public.candidate_list_reviews;
create policy candidate_list_reviews_insert on public.candidate_list_reviews
  for insert with check (
    tenant_id = app.tenant_id()
    and exists (select 1 from public.candidate_lists l where l.id = list_id and app.is_project_team(l.project_id))
  );
-- 검토 완료는 검토자 본인, 마감(강제 완료)은 프로젝트 팀
drop policy if exists candidate_list_reviews_update on public.candidate_list_reviews;
create policy candidate_list_reviews_update on public.candidate_list_reviews
  for update using (
    tenant_id = app.tenant_id()
    and (reviewer_user_id = auth.uid()
         or exists (select 1 from public.candidate_lists l where l.id = list_id and app.is_project_team(l.project_id)))
  )
  with check (tenant_id = app.tenant_id());

drop policy if exists candidate_list_review_comments_select on public.candidate_list_review_comments;
create policy candidate_list_review_comments_select on public.candidate_list_review_comments
  for select using (
    tenant_id = app.tenant_id()
    and exists (select 1 from public.candidate_lists l where l.id = list_id)
  );
-- 의견은 리스트를 볼 수 있는 자사 임직원 누구나(검토자·담당자 답글) — 본인 명의로만
drop policy if exists candidate_list_review_comments_insert on public.candidate_list_review_comments;
create policy candidate_list_review_comments_insert on public.candidate_list_review_comments
  for insert with check (
    tenant_id = app.tenant_id()
    and author_user_id = auth.uid()
    and exists (select 1 from public.candidate_lists l where l.id = list_id)
  );

comment on table public.candidate_lists is
  '섭외 후보 리스트 문서 — 프로젝트별 리비전, 내부 검토 → 발주처 검토 → 후보 조정 → 품의 (기획 2026-11-07)';
comment on table public.candidate_list_entries is
  '후보 리스트 행 스냅샷 (세션 × 후보) — 검토 당시 문서 보존';
comment on table public.candidate_list_reviews is
  '내부 검토 요청 — 검토자(상무·대표)별 requested → done';
comment on table public.candidate_list_review_comments is
  '내부 검토 의견 — 후보별(entry_id) 또는 리스트 전체(null)';
