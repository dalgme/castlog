-- ============================================================================
-- 프로젝트 체크리스트 — 리뷰 반영 (2026-09-05, 20260905000004 후속)
--
-- 1) app.is_project_team: 열람 범위(app.can_view_project — 테넌트·연습모드·
--    대표/이사/작성자/배정) 안에서만 참. 종전에는 role=manager(팀장 포함)가
--    배정 없는 프로젝트까지 통과했다 (CLAUDE.md §3-1: 팀장 이하는 배정 프로젝트만).
-- 2) checklist_logs 조회를 프로젝트 열람 범위로 좁힌다.
-- 3) 공통·유형별 표준시트는 테넌트당 1개 — 동시 첫 진입 시 이중 시드 방지.
-- 4) 순서 저장을 한 번의 UPDATE로 (건별 왕복 제거). 호출자 RLS가 그대로 적용된다.
-- 5) checklist_logs (project_id, created_at) 인덱스 — 프로젝트 전체 로그 조회용.
--
-- 추가 전용·멱등.
-- ============================================================================

create or replace function app.is_project_team(p_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    p_project_id is not null
    and app.can_view_project(p_project_id)
    and (
      app.can_view_all_projects()
      or exists (
        select 1
        from public.project_assignments pa
        where pa.project_id = p_project_id
          and pa.user_id = auth.uid()
      )
      or exists (
        select 1
        from public.projects pr
        where pr.id = p_project_id
          and pr.created_by = auth.uid()
      )
    )
$$;
revoke all on function app.is_project_team(uuid) from public;
grant execute on function app.is_project_team(uuid) to authenticated;

drop policy if exists checklist_logs_select on public.checklist_logs;
create policy checklist_logs_select on public.checklist_logs
  for select using (
    tenant_id = app.tenant_id()
    and is_practice = app.is_practice()
    and app.user_role() <> 'expert'
    and (scope = 'template' or app.can_view_project(project_id))
  );

create unique index if not exists checklist_templates_single_kind_uniq
  on public.checklist_templates (tenant_id, kind)
  where kind in ('common', 'typed');

create index if not exists checklist_logs_project_idx
  on public.checklist_logs (project_id, created_at desc);

-- 순서 일괄 저장 — security invoker: 호출자의 RLS(update 정책)가 그대로 걸린다
create or replace function public.reorder_checklist_template_items(p_ids uuid[])
returns integer
language sql
volatile
set search_path = public
as $$
  with ord as (
    select id, ordinality from unnest(p_ids) with ordinality as u(id, ordinality)
  ),
  upd as (
    update public.checklist_template_items i
    set sort_order = (ord.ordinality * 10)::integer
    from ord
    where i.id = ord.id
    returning 1
  )
  select count(*)::integer from upd
$$;
revoke all on function public.reorder_checklist_template_items(uuid[]) from public;
grant execute on function public.reorder_checklist_template_items(uuid[]) to authenticated;

create or replace function public.reorder_project_checklist_items(p_ids uuid[])
returns integer
language sql
volatile
set search_path = public
as $$
  with ord as (
    select id, ordinality from unnest(p_ids) with ordinality as u(id, ordinality)
  ),
  upd as (
    update public.project_checklist_items i
    set sort_order = (ord.ordinality * 10)::integer
    from ord
    where i.id = ord.id
    returning 1
  )
  select count(*)::integer from upd
$$;
revoke all on function public.reorder_project_checklist_items(uuid[]) from public;
grant execute on function public.reorder_project_checklist_items(uuid[]) to authenticated;
