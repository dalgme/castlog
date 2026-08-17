-- ============================================================================
-- 권한 6단계(직위) + 관리권한 위임  — 기획 확정
--
-- 1) 권한단계 6단계: ceo(대표) > director(이사) > team_lead(팀장)
--                   > deputy(대리) > senior(주임) > staff(사원)
--    users.grade 에 저장하고, 기존 users.role(org_admin/manager/staff)은
--    **파생값**으로 트리거가 자동 동기화한다. 기존 RLS 정책을 건드리지 않기 위한
--    호환 계층이며, 앞으로 권한 판정의 원본은 grade 다.
--
-- 2) 프로젝트 전체 가시성은 '권한자(대표·이사)'만 — 팀장 이하는 배정된 프로젝트만.
--    실행 권한(섭외요청·수락서 등)은 팀장까지 허용해야 하므로 role 매핑과
--    가시성 판정을 분리한다:
--      - role  : ceo→org_admin, director·team_lead→manager, 그 외→staff  (실행 권한)
--      - 가시성: app.can_view_all_projects() = grade in (ceo, director)   (열람 범위)
--
-- 3) CEO는 'CEO 업무기능 + 시스템 설정/관리기능'을 모두 갖는다. 이 중
--    **설정/관리기능만** 임원 등에게 스코프 단위로 위임할 수 있다(tenant_admin_grants).
--    ** 세무(주민등록번호) 조회 권한은 위임 대상이 아니다 (CLAUDE.md §5).
--       tax_access_grants 는 계속 app.is_org_admin()(=CEO/플랫폼관리자)만 다룬다. **
-- ============================================================================

-- ---- 1. users.grade ---------------------------------------------------------
alter table public.users
  add column if not exists grade text not null default 'staff';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'users_grade_check'
  ) then
    alter table public.users
      add constraint users_grade_check check (
        grade in ('ceo', 'director', 'team_lead', 'deputy', 'senior', 'staff')
      );
  end if;
end $$;

-- 기존 계정 백필 (org_admin→ceo, manager→director, staff→staff)
update public.users
set grade = case role
  when 'org_admin' then 'ceo'
  when 'manager' then 'director'
  else 'staff'
end
where grade = 'staff' and role <> 'staff';

-- ---- 2. grade → role 파생 ---------------------------------------------------
create or replace function app.role_from_grade(p_grade text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_grade
    when 'ceo' then 'org_admin'
    when 'director' then 'manager'
    when 'team_lead' then 'manager'
    else 'staff'
  end
$$;

create or replace function app.sync_role_from_grade()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.role := app.role_from_grade(new.grade);
  return new;
end;
$$;

drop trigger if exists sync_role_from_grade on public.users;
create trigger sync_role_from_grade
  before insert or update of grade on public.users
  for each row execute function app.sync_role_from_grade();

-- 백필된 grade 기준으로 role 재정렬 (team_lead 승격 등 대비)
update public.users set role = app.role_from_grade(grade) where role <> app.role_from_grade(grade);

-- ---- 3. JWT 클레임 헬퍼 -----------------------------------------------------
-- grade 클레임이 아직 없는 기존 세션은 role에서 역산해 기존 동작을 그대로 유지한다.
create or replace function app.user_grade()
returns text
language sql
stable
set search_path = ''
as $$
  select coalesce(
    nullif(auth.jwt() -> 'app_metadata' ->> 'grade', ''),
    case app.user_role()
      when 'org_admin' then 'ceo'
      when 'manager' then 'director'
      else 'staff'
    end
  )
$$;

-- 높을수록 상위 권한 (비교 연산용)
create or replace function app.grade_rank(p_grade text)
returns int
language sql
immutable
set search_path = ''
as $$
  select case p_grade
    when 'ceo' then 60
    when 'director' then 50
    when 'team_lead' then 40
    when 'deputy' then 30
    when 'senior' then 20
    when 'staff' then 10
    else 0
  end
$$;

-- 전사 프로젝트 열람 권한자 = 대표·이사 (+ 플랫폼관리자 지원 경로)
create or replace function app.can_view_all_projects()
returns boolean
language sql
stable
set search_path = ''
as $$
  select app.user_role() = 'platform_admin'
      or app.grade_rank(app.user_grade()) >= app.grade_rank('director')
$$;

-- ---- 4. 관리권한 위임 -------------------------------------------------------
-- scope: settings(테넌트 설정·모듈) / staff(직원 계정·권한) /
--        sending(발송 설정·템플릿) / audit(감사로그·사용량·백업)
create table if not exists public.tenant_admin_grants (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  user_id uuid not null references public.users (id) on delete cascade,
  scope text not null check (scope in ('settings', 'staff', 'sending', 'audit')),
  note text,
  granted_by uuid,
  granted_at timestamptz not null default now(),
  revoked_by uuid,
  revoked_at timestamptz
);

-- 활성 위임은 (사용자, 스코프)당 1건
create unique index if not exists tenant_admin_grants_active_idx
  on public.tenant_admin_grants (tenant_id, user_id, scope)
  where revoked_at is null;
create index if not exists tenant_admin_grants_user_idx
  on public.tenant_admin_grants (user_id) where revoked_at is null;

alter table public.tenant_admin_grants enable row level security;

-- 조회: 자사 CEO(=org_admin)는 전체, 그 외는 본인 위임분만
drop policy if exists tenant_admin_grants_select on public.tenant_admin_grants;
create policy tenant_admin_grants_select on public.tenant_admin_grants
  for select using (
    tenant_id = app.tenant_id()
    and (app.is_org_admin() or user_id = auth.uid())
  );

-- 부여·회수는 CEO만 (위임받은 사람이 다시 위임할 수 없다 — 권한 분리 §14-3)
drop policy if exists tenant_admin_grants_insert on public.tenant_admin_grants;
create policy tenant_admin_grants_insert on public.tenant_admin_grants
  for insert with check (tenant_id = app.tenant_id() and app.is_org_admin());

drop policy if exists tenant_admin_grants_update on public.tenant_admin_grants;
create policy tenant_admin_grants_update on public.tenant_admin_grants
  for update using (tenant_id = app.tenant_id() and app.is_org_admin())
  with check (tenant_id = app.tenant_id() and app.is_org_admin());
-- 삭제 없음 — 회수는 revoked_at 기록으로 (§14-4 삭제보다 비활성화)

-- 스코프 보유 여부 (CEO는 항상 보유). SECURITY DEFINER — 정책 재귀 방지.
create or replace function app.has_admin_scope(p_scope text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.is_org_admin()
      or exists (
        select 1
        from public.tenant_admin_grants g
        where g.tenant_id = app.tenant_id()
          and g.user_id = auth.uid()
          and g.scope = p_scope
          and g.revoked_at is null
      )
$$;

revoke all on function app.has_admin_scope(text) from public;
grant execute on function app.has_admin_scope(text) to authenticated;

-- ---- 5. 프로젝트 가시성 정책을 grade 기준으로 재정의 -------------------------
-- 기존: app.user_role() in ('org_admin','manager')  → team_lead 승격 시 전체가 열림
-- 변경: app.can_view_all_projects()                 → 대표·이사만 전체
drop policy if exists projects_select on public.projects;
create policy projects_select on public.projects
  for select using (
    tenant_id = app.tenant_id()
    and (
      app.can_view_all_projects()
      or exists (
        select 1
        from public.project_assignments pa
        where pa.project_id = projects.id
          and pa.user_id = auth.uid()
      )
    )
  );

drop policy if exists project_assignments_select on public.project_assignments;
create policy project_assignments_select on public.project_assignments
  for select using (
    tenant_id = app.tenant_id()
    and (app.can_view_all_projects() or user_id = auth.uid())
  );

-- 배정·해제는 권한자(대표·이사)만
drop policy if exists project_assignments_insert on public.project_assignments;
create policy project_assignments_insert on public.project_assignments
  for insert with check (
    tenant_id = app.tenant_id() and app.can_view_all_projects()
  );

drop policy if exists project_assignments_delete on public.project_assignments;
create policy project_assignments_delete on public.project_assignments
  for delete using (
    tenant_id = app.tenant_id() and app.can_view_all_projects()
  );

-- 하위 리소스 가시성 헬퍼도 동일 기준으로 갱신
create or replace function app.can_view_project(p_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_project_id is null then app.can_view_all_projects()
    when app.can_view_all_projects() then true
    else exists (
      select 1
      from public.project_assignments pa
      where pa.project_id = p_project_id
        and pa.user_id = auth.uid()
    )
  end
$$;

revoke all on function app.can_view_project(uuid) from public;
grant execute on function app.can_view_project(uuid) to authenticated;

-- ---- 6. 기존 계정 JWT app_metadata.grade 백필 -------------------------------
-- 토큰 갱신 시점부터 반영된다. 갱신 전에는 app.user_grade()의 role 역산이 받쳐준다.
update auth.users au
set raw_app_meta_data =
  coalesce(au.raw_app_meta_data, '{}'::jsonb) || jsonb_build_object('grade', u.grade)
from public.users u
where u.id = au.id
  and coalesce(au.raw_app_meta_data ->> 'grade', '') is distinct from u.grade;

comment on column public.users.grade is
  '권한 6단계: ceo/director/team_lead/deputy/senior/staff. role은 이 값에서 트리거로 파생된다.';
comment on table public.tenant_admin_grants is
  'CEO가 보유한 시스템 설정/관리 권한의 스코프 단위 위임. 세무(주민등록번호) 권한은 위임 대상이 아니다.';

-- ---- 7. 위임된 관리자도 직원·직급을 다룰 수 있게 -----------------------------
-- (세무 지정자(tax_access_grants)는 계속 app.is_org_admin() = CEO 전용으로 남긴다)
drop policy if exists positions_write on public.positions;
create policy positions_write on public.positions
  for all using (tenant_id = app.tenant_id() and app.has_admin_scope('staff'))
  with check (tenant_id = app.tenant_id() and app.has_admin_scope('staff'));

drop policy if exists users_write on public.users;
create policy users_write on public.users
  for all using (tenant_id = app.tenant_id() and app.has_admin_scope('staff'))
  with check (tenant_id = app.tenant_id() and app.has_admin_scope('staff'));
