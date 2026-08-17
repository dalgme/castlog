-- ============================================================================
-- 전문가 태그(즐겨찾기·VIP·주의) + 후기 — 기획 확정
--
--  * 태그·후기는 **테넌트 격리 데이터**다 (CLAUDE.md §4).
--    전문가 본인에게 노출하지 않는다 — SELECT 정책에 is_expert_self를 넣지 않는다.
--    (특히 '주의' 등급이 본인에게 보이면 관계가 파탄난다. 코드로 막는다.)
--  * 태그는 전문가 1명당 1개 등급 + 즐겨찾기 별도 플래그로 두지 않고,
--    '등급 1개'로 단순화한다 — favorite / vip / caution 중 하나.
--    (즐겨찾기와 VIP를 동시에 켜는 조합은 실무에서 의미가 없다)
--  * 후기는 정성 평가다. 기존 expert_evaluations(프로젝트당 1건, 10점 정량)와
--    별개로, 프로젝트에 매이지 않는 자유 메모를 여러 건 남길 수 있다.
--  * 삭제 대신 상태 전환(§14-4) — 태그 해제는 행 삭제가 아니라 등급 제거로 처리하되,
--    태그는 값 자체가 상태이므로 해제 시 행을 지운다. 후기는 지우지 않는다.
-- ============================================================================

create table if not exists public.expert_tenant_tags (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  expert_id uuid not null references public.experts (id) on delete cascade,
  tag text not null check (tag in ('favorite', 'vip', 'caution')),
  note text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, expert_id)
);

create index if not exists expert_tenant_tags_lookup_idx
  on public.expert_tenant_tags (tenant_id, tag);

create trigger set_updated_at before update on public.expert_tenant_tags
  for each row execute function app.set_updated_at();

create table if not exists public.expert_reviews (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  expert_id uuid not null references public.experts (id) on delete cascade,
  project_id uuid references public.projects (id) on delete set null,
  body text not null,
  author_user_id uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists expert_reviews_expert_idx
  on public.expert_reviews (tenant_id, expert_id, created_at desc);

create trigger set_updated_at before update on public.expert_reviews
  for each row execute function app.set_updated_at();

-- ---- RLS: 테넌트 격리. 전문가 본인 조회 경로 없음(비공개) ---------------------
alter table public.expert_tenant_tags enable row level security;
alter table public.expert_reviews enable row level security;

-- 조회: 자사 직원 전체 (후보군 화면에서 참고해야 하므로 담당자도 본다)
drop policy if exists expert_tenant_tags_select on public.expert_tenant_tags;
create policy expert_tenant_tags_select on public.expert_tenant_tags
  for select using (tenant_id = app.tenant_id());

-- 지정·해제: 관리자 이상
drop policy if exists expert_tenant_tags_write on public.expert_tenant_tags;
create policy expert_tenant_tags_write on public.expert_tenant_tags
  for all using (
    tenant_id = app.tenant_id() and app.user_role() in ('org_admin', 'manager')
  )
  with check (
    tenant_id = app.tenant_id() and app.user_role() in ('org_admin', 'manager')
  );

drop policy if exists expert_reviews_select on public.expert_reviews;
create policy expert_reviews_select on public.expert_reviews
  for select using (tenant_id = app.tenant_id());

-- 작성·정정: 관리자 이상. 삭제 정책 없음 — 후기는 지우지 않고 정정한다(§14-4).
drop policy if exists expert_reviews_insert on public.expert_reviews;
create policy expert_reviews_insert on public.expert_reviews
  for insert with check (
    tenant_id = app.tenant_id() and app.user_role() in ('org_admin', 'manager')
  );

drop policy if exists expert_reviews_update on public.expert_reviews;
create policy expert_reviews_update on public.expert_reviews
  for update using (
    tenant_id = app.tenant_id() and app.user_role() in ('org_admin', 'manager')
  )
  with check (
    tenant_id = app.tenant_id() and app.user_role() in ('org_admin', 'manager')
  );

comment on table public.expert_tenant_tags is
  '자사 전문가 등급(즐겨찾기/VIP/주의). 테넌트 격리 — 전문가 본인에게 노출 금지.';
comment on table public.expert_reviews is
  '자사 전문가 후기(정성). 테넌트 격리 — 전문가 본인에게 노출 금지.';

-- ---- 전문가 세션 차단 (§4) --------------------------------------------------
-- 전문가 계정도 활성 테넌트 전환 시 app_metadata.tenant_id를 갖는다. tenant_id만
-- 비교하는 SELECT 정책은 회사 내부 평가·태그·후기를 본인에게 노출할 수 있으므로
-- 역할로 명시 차단한다. (특히 '주의' 등급과 사유가 본인에게 보여선 안 된다)
drop policy if exists expert_tenant_tags_select on public.expert_tenant_tags;
create policy expert_tenant_tags_select on public.expert_tenant_tags
  for select using (
    tenant_id = app.tenant_id() and app.user_role() <> 'expert'
  );

drop policy if exists expert_reviews_select on public.expert_reviews;
create policy expert_reviews_select on public.expert_reviews
  for select using (
    tenant_id = app.tenant_id() and app.user_role() <> 'expert'
  );

-- 기존 정량평가(단계 27)도 같은 종류의 노출 경로를 갖고 있어 함께 막는다
drop policy if exists expert_evaluations_select on public.expert_evaluations;
create policy expert_evaluations_select on public.expert_evaluations
  for select using (
    tenant_id = app.tenant_id() and app.user_role() <> 'expert'
  );
