-- ============================================================================
-- 프로젝트 가시성에 '만든 사람' 추가 — 팀장 프로젝트 생성 불능 수정
--
-- 결함: projects의 INSERT 정책은 role 기준(org_admin·manager — 팀장 포함)인데
-- SELECT 정책은 grade 기준(대표·이사 전체 or 배정자)이다. 앱이
-- `insert(...).select("id")`(RETURNING)로 생성하므로 PostgreSQL이 반환 행에
-- SELECT 정책을 적용하고, 방금 만든 프로젝트에는 배정 행이 없어서
-- **팀장(team_lead)은 프로젝트 생성이 무조건 실패**했다
-- ("new row violates row-level security policy"). 등급을 나중에 올린 계정도
-- JWT가 갱신되기 전까지(액세스 토큰 만료·재로그인 전) 같은 증상을 겪는다.
--
-- 앱은 RETURNING 의존을 제거해(id 사전 생성) 생성 자체는 마이그레이션 없이도
-- 통과하게 고쳤다. 이 마이그레이션은 남은 반쪽을 고친다: **만든 사람이 자기
-- 프로젝트를 볼 수 있어야 한다.** 팀장은 배정 권한이 없으므로(배정은 대표·이사)
-- 이것이 없으면 팀장이 만든 프로젝트는 배정 전까지 본인에게도 보이지 않는다.
--
-- 열람 범위 원칙(대표·이사=전체, 이하=배정분)은 유지된다 — 여기서 여는 것은
-- '남의 프로젝트'가 아니라 '자기가 만든 프로젝트'뿐이다.
-- ============================================================================

-- ---- 1. 프로젝트 가시성 헬퍼 — creator 포함 --------------------------------
create or replace function app.can_view_project(p_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.projects p
    where p.id = p_project_id
      and p.tenant_id = app.tenant_id()
      and p.is_practice = app.is_practice()
      and (
        app.can_view_all_projects()
        or p.created_by = auth.uid()
        or exists (
          select 1
          from public.project_assignments pa
          where pa.project_id = p.id
            and pa.user_id = auth.uid()
        )
      )
  )
$$;

revoke all on function app.can_view_project(uuid) from public;
grant execute on function app.can_view_project(uuid) to authenticated;

comment on function app.can_view_project(uuid) is
  '프로젝트 열람 가능 여부: 대표·이사 전체 / 만든 사람 / 배정자. 스텝·기여도 등 하위 테이블 RLS가 공유한다.';

-- ---- 2. projects SELECT 정책 — creator 포함 --------------------------------
drop policy if exists projects_select on public.projects;
create policy projects_select on public.projects
  for select using (
    tenant_id = app.tenant_id()
    and is_practice = app.is_practice()
    and (
      app.can_view_all_projects()
      or projects.created_by = auth.uid()
      or exists (
        select 1
        from public.project_assignments pa
        where pa.project_id = projects.id
          and pa.user_id = auth.uid()
      )
    )
  );
