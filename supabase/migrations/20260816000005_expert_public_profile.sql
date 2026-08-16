-- ============================================================================
-- 공개 프로필/미니 이력서(#1) + 경력·실적 아카이브(#5)
-- 설계: docs/decisions/expert-utility-features.md §B-1, §B-5
--
--  * 전역 테이블(전문가 소유). 공개 여부·항목은 전문가가 직접 통제.
--  * 민감정보(주민번호·연락처·서류)는 절대 포함하지 않는다(§5).
--  * 공개 페이지(/p/{handle})는 service_role로 읽어 is_public + visible_fields만 노출.
--    산출물 원본은 저장하지 않고 외부 링크만 보관(§6).
-- ============================================================================

-- 공개 프로필 --------------------------------------------------------------
create table if not exists public.expert_public_profiles (
  id uuid primary key default gen_random_uuid(),
  expert_id uuid not null unique references public.experts(id) on delete cascade,
  handle text not null unique,          -- 공개 URL 세그먼트(kebab, 소문자)
  is_public boolean not null default false,
  headline text,                        -- 한 줄 소개
  intro text,                           -- 자기소개
  visible_fields jsonb not null default
    '{"specialty":true,"region":true,"career_years":true,"bio":true,"portfolio":true}'::jsonb,
  view_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint expert_public_profiles_handle_format
    check (handle ~ '^[a-z0-9]([a-z0-9-]{1,38}[a-z0-9])$')
);

create trigger set_updated_at before update on public.expert_public_profiles
  for each row execute function app.set_updated_at();

alter table public.expert_public_profiles enable row level security;

-- 본인만 조회·생성·수정. 공개 페이지는 service_role 경유(RLS 우회).
create policy expert_public_profiles_self_select on public.expert_public_profiles
  for select using (app.is_expert_self(expert_id));
create policy expert_public_profiles_self_insert on public.expert_public_profiles
  for insert with check (app.is_expert_self(expert_id));
create policy expert_public_profiles_self_update on public.expert_public_profiles
  for update using (app.is_expert_self(expert_id))
  with check (app.is_expert_self(expert_id));

-- 경력·실적 아카이브 -------------------------------------------------------
create table if not exists public.expert_portfolio_items (
  id uuid primary key default gen_random_uuid(),
  expert_id uuid not null references public.experts(id) on delete cascade,
  title text not null,
  role text,
  org_name text,
  period text,                          -- 자유 형식(예: 2023.03–2023.09)
  summary text,
  links text[] not null default '{}',   -- 외부 산출물 링크(원본 미보관)
  is_public boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists expert_portfolio_items_expert_idx
  on public.expert_portfolio_items (expert_id, sort_order, created_at desc);

create trigger set_updated_at before update on public.expert_portfolio_items
  for each row execute function app.set_updated_at();

alter table public.expert_portfolio_items enable row level security;

create policy expert_portfolio_items_self_select on public.expert_portfolio_items
  for select using (app.is_expert_self(expert_id));
create policy expert_portfolio_items_self_insert on public.expert_portfolio_items
  for insert with check (app.is_expert_self(expert_id));
create policy expert_portfolio_items_self_update on public.expert_portfolio_items
  for update using (app.is_expert_self(expert_id))
  with check (app.is_expert_self(expert_id));
create policy expert_portfolio_items_self_delete on public.expert_portfolio_items
  for delete using (app.is_expert_self(expert_id));
