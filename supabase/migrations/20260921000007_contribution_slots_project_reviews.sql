-- 참여율 배분 가로 표 + 프로젝트 리뷰 탭 (기획 지시 2026-09-21)
--
-- 1) project_contributions — 가로 표의 '열'을 기록한다.
--    slot_key: ceo / director / pl / pm / deputy_pm / member / extra1 / extra2
--    role_label: 열 머리 표기(빈칸 2개는 회사가 직접 적는다). 한 사람이 두 열
--    (예: 대표가 PL 겸임)에 설 수 있으므로 (project_id, user_id) 유일 제약을 풀고
--    (project_id, slot_key) 유일 인덱스로 바꾼다. 옛 행(slot_key null)은 그대로 남는다.
-- 2) projects.contribution_confirmed_at/by — '확정' 잠금. 값이 있으면 수정 불가,
--    '수정' 버튼이 풀면 null. 삭제·상태 전환이 아니라 시각 기록이다 (§14-4).
-- 3) project_reviews — 프로젝트당 1행. 완료 사업 결과 요약표의 체크·수기 항목.
--    (사업코드·사업명·발주처·사업비·PL/PM/부PM·기간은 projects·배정에서 자동으로 채운다)
-- 4) project_review_items — 전문가 평가 행(section=expert)·운영 특이사항 행(section=ops).
--    '+'로 행을 늘리고 행마다 등록/수정한다. 업무 데이터는 정규화 테이블 (§8).
--
-- 추가 전용·멱등 (§14-10 "SQL 먼저"). 코드는 컬럼·테이블 부재를 폴백한다.

-- ---- 1) 참여율 배분 열 ------------------------------------------------------
alter table public.project_contributions
  add column if not exists slot_key text,
  add column if not exists role_label text;

alter table public.project_contributions
  drop constraint if exists project_contributions_project_id_user_id_key;

alter table public.project_contributions
  drop constraint if exists project_contributions_slot_key_check;
alter table public.project_contributions
  add constraint project_contributions_slot_key_check
  check (
    slot_key is null
    or slot_key in ('ceo', 'director', 'pl', 'pm', 'deputy_pm', 'member', 'extra1', 'extra2')
  );

create unique index if not exists project_contributions_project_slot_key
  on public.project_contributions (project_id, slot_key)
  where slot_key is not null;

comment on column public.project_contributions.slot_key is
  '참여율 가로 표의 열 (기획 2026-09-21). null = 가로 표 도입 전 저장분';
comment on column public.project_contributions.role_label is
  '열 머리 표기 — 빈칸 열(extra1/extra2)은 회사가 적는다';

-- ---- 2) 참여율 확정 잠금 ----------------------------------------------------
alter table public.projects
  add column if not exists contribution_confirmed_at timestamptz,
  add column if not exists contribution_confirmed_by uuid;

comment on column public.projects.contribution_confirmed_at is
  '참여율 배분 확정 시각 (기획 2026-09-21). null = 수정 가능';
comment on column public.projects.contribution_confirmed_by is
  '확정한 직원(auth user id)';

-- ---- 3) 프로젝트 리뷰 (프로젝트당 1행) -------------------------------------
create table if not exists public.project_reviews (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  -- 계약 처리 구분: private(수의) / bid(입찰) / null(미선택)
  contract_type text check (contract_type is null or contract_type in ('private', 'bid')),
  -- 모집/홍보 진행 여부: null(미선택) / true(여) / false(부) + 부연
  recruit_done boolean,
  recruit_note text,
  -- 사업비 입금 완료 여부
  deposit_done boolean not null default false,
  -- 모아폼/구글폼 소유권 이전 여부 + 부연(계정 등)
  form_transfer_done boolean not null default false,
  form_transfer_note text,
  -- 수기 보완 칸 (자동값이 없거나 다르게 적어야 할 때)
  client_contact text,        -- 발주처 담당자
  event_dates_text text,      -- 행사일 표기
  venue_text text,            -- 행사 장소
  created_by uuid references public.users (id) on delete set null,
  updated_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id)
);

create index if not exists project_reviews_tenant_idx
  on public.project_reviews (tenant_id, project_id);

drop trigger if exists set_updated_at on public.project_reviews;
create trigger set_updated_at before update on public.project_reviews
  for each row execute function app.set_updated_at();

alter table public.project_reviews enable row level security;

drop policy if exists project_reviews_select on public.project_reviews;
create policy project_reviews_select on public.project_reviews
  for select using (
    tenant_id = app.tenant_id() and app.can_view_project(project_id)
  );
drop policy if exists project_reviews_write on public.project_reviews;
create policy project_reviews_write on public.project_reviews
  for all using (
    tenant_id = app.tenant_id() and app.is_project_team(project_id)
  )
  with check (
    tenant_id = app.tenant_id() and app.is_project_team(project_id)
  );

comment on table public.project_reviews is
  '프로젝트 리뷰 — 완료 사업 결과 요약표의 체크·수기 항목 (프로젝트당 1행, 테넌트 격리)';

-- ---- 4) 리뷰 행 (전문가 평가 · 운영 특이사항) --------------------------------
create table if not exists public.project_review_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  section text not null check (section in ('expert', 'ops')),
  sort_order integer not null default 0,
  -- expert: 참여 전문가명 (자동 행은 expert_id로 연결) / ops: 구분(발주처 담당자 등)
  subject text not null default '',
  expert_id uuid references public.experts (id) on delete set null,
  -- expert: 참여 형태 (강의·컨설팅 등 + 주제)
  form text,
  -- 내용
  body text not null default '',
  created_by uuid references public.users (id) on delete set null,
  updated_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists project_review_items_project_idx
  on public.project_review_items (tenant_id, project_id, section, sort_order);

-- 자동 전문가 행은 프로젝트당 전문가 한 명에 한 행
create unique index if not exists project_review_items_expert_key
  on public.project_review_items (project_id, expert_id)
  where expert_id is not null;

drop trigger if exists set_updated_at on public.project_review_items;
create trigger set_updated_at before update on public.project_review_items
  for each row execute function app.set_updated_at();

alter table public.project_review_items enable row level security;

drop policy if exists project_review_items_select on public.project_review_items;
create policy project_review_items_select on public.project_review_items
  for select using (
    tenant_id = app.tenant_id() and app.can_view_project(project_id)
  );
drop policy if exists project_review_items_write on public.project_review_items;
create policy project_review_items_write on public.project_review_items
  for all using (
    tenant_id = app.tenant_id() and app.is_project_team(project_id)
  )
  with check (
    tenant_id = app.tenant_id() and app.is_project_team(project_id)
  );

comment on table public.project_review_items is
  '프로젝트 리뷰 행 — expert(전문가 평가) · ops(운영 특이사항). 행 단위 등록/수정 (테넌트 격리)';
