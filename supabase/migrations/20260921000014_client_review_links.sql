-- 섭외 프로세스 고도화 3단계 (기획 승인 2026-11-07 — docs/decisions/engagement-review-flow.md 02·04 + 보정)
--
-- '발주처 검토' 탭: 내부 검토가 끝난 섭외 후보 리스트를 발주처가 보는 **웹문서(/l/{token})** 로 만들고,
-- 비밀번호로 열어 후보별 의견(적합/교체 요청/보류)과 요청사항을 '요청/회신 하기'로 보낸다.
--  - client_review_links            링크 1건 = 리스트 1라운드. 비밀번호 해시(scrypt), 만료, 잠금, 회수.
--                                   **발주처가 회신하면 자동 회수**(revoked_at, revoke_reason='replied') — 재접속 불가.
--  - client_review_responses        회신 머리(라운드·전체 요청사항). 공개 화면에서 서버(service_role)가 쓴다.
--  - client_review_response_items   후보별 의견.
-- RLS: 자사 임직원 + 프로젝트 열람 범위. 링크 생성·회수는 프로젝트 팀. 회신은 익명 발주처 → 쓰기 정책 없음(service_role만).
-- 멱등. 코드는 표 부재를 '준비 중'으로 폴백한다.

create table if not exists public.client_review_links (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  list_id uuid not null references public.candidate_lists (id) on delete cascade,
  round integer not null default 1,
  token_hash text not null unique,
  -- "scrypt$<salt hex>$<hash hex>" — 비밀번호 원문은 어디에도 저장하지 않는다
  password_hash text not null,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  revoke_reason text check (revoke_reason is null or revoke_reason in ('replied', 'manual', 'superseded')),
  open_count integer not null default 0,
  last_opened_at timestamptz,
  failed_attempts integer not null default 0,
  locked_until timestamptz,
  created_by uuid references public.users (id) on delete set null,
  is_practice boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists client_review_links_list_idx
  on public.client_review_links (list_id, round desc);
create index if not exists client_review_links_project_idx
  on public.client_review_links (tenant_id, project_id);

create table if not exists public.client_review_responses (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  list_id uuid not null references public.candidate_lists (id) on delete cascade,
  link_id uuid not null references public.client_review_links (id) on delete cascade,
  round integer not null default 1,
  respondent_name text check (respondent_name is null or length(respondent_name) <= 60),
  general_comment text check (general_comment is null or length(general_comment) <= 4000),
  submitted_at timestamptz not null default now(),
  -- 회신 IP는 해시로만 (분쟁 시 동일성 확인용)
  ip_hash text
);

create index if not exists client_review_responses_list_idx
  on public.client_review_responses (list_id, submitted_at);

create table if not exists public.client_review_response_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  response_id uuid not null references public.client_review_responses (id) on delete cascade,
  entry_id uuid not null references public.candidate_list_entries (id) on delete cascade,
  -- ok 적합 / replace 교체 요청 / hold 보류
  opinion text not null check (opinion in ('ok', 'replace', 'hold')),
  comment text check (comment is null or length(comment) <= 1000),
  unique (response_id, entry_id)
);

-- ---- RLS ----------------------------------------------------------------------
alter table public.client_review_links enable row level security;
alter table public.client_review_responses enable row level security;
alter table public.client_review_response_items enable row level security;

drop policy if exists client_review_links_select on public.client_review_links;
create policy client_review_links_select on public.client_review_links
  for select using (
    tenant_id = app.tenant_id()
    and app.user_role() <> 'expert'
    and app.can_view_project(project_id)
  );
drop policy if exists client_review_links_insert on public.client_review_links;
create policy client_review_links_insert on public.client_review_links
  for insert with check (tenant_id = app.tenant_id() and app.is_project_team(project_id));
drop policy if exists client_review_links_update on public.client_review_links;
create policy client_review_links_update on public.client_review_links
  for update using (tenant_id = app.tenant_id() and app.is_project_team(project_id))
  with check (tenant_id = app.tenant_id() and app.is_project_team(project_id));
drop policy if exists client_review_links_practice on public.client_review_links;
create policy client_review_links_practice on public.client_review_links
  as restrictive for select using (is_practice = app.is_practice());

drop policy if exists client_review_responses_select on public.client_review_responses;
create policy client_review_responses_select on public.client_review_responses
  for select using (
    tenant_id = app.tenant_id()
    and app.user_role() <> 'expert'
    and app.can_view_project(project_id)
  );

drop policy if exists client_review_response_items_select on public.client_review_response_items;
create policy client_review_response_items_select on public.client_review_response_items
  for select using (
    tenant_id = app.tenant_id()
    and exists (select 1 from public.client_review_responses r where r.id = response_id)
  );

comment on table public.client_review_links is
  '발주처 검토 웹문서 링크(/l) — 비밀번호 해시·만료·잠금, 회신 시 자동 회수 (기획 2026-11-07)';
comment on table public.client_review_responses is
  '발주처 회신 — 라운드별 전체 요청사항. 공개 화면에서 service_role로만 기록';
comment on table public.client_review_response_items is
  '발주처 후보별 의견 — ok 적합 / replace 교체 요청 / hold 보류';
