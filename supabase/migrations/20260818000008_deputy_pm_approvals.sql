-- ============================================================================
-- 부PM 실행 → PM 승인 (기획 확정)
--
-- 요구: "PM과 부PM은 별도 업무의 구분은 두지 않지만, 부PM이 실행하려는 작업은
--        반드시 PM의 승인(결재)을 받아서 진행되는 권한 관계만 만든다."
--
-- 설계 판단
--  1) 업무를 나누지 않는다. 부PM이 할 수 있는 일 = PM이 할 수 있는 일. 화면·메뉴를
--     역할로 가르지 않는다. 갈리는 것은 '실행 직전에 PM 승인이 필요한가'뿐이다.
--  2) 사전 승인 방식이다. 부PM이 실행할 작업을 지목해 승인을 요청하고, PM이 승인한
--     뒤 부PM이 직접 실행한다. 승인 1건 = 실행 1회(consumed_at으로 소진).
--     PM이 대신 실행해 주는 구조가 아니다 — 그러면 업무 구분이 생긴다.
--  3) **작업 내용을 JSON 블롭으로 저장하지 않는다** (CLAUDE.md §8). 승인 대상은
--     'action_type + 대상 레코드'로 정규화해 지목한다. 실제 입력값은 실행 시점에
--     부PM이 평소처럼 입력한다.
--  4) 전자결재(approvals) 모듈에 얹지 않는다. PM/부PM 배정은 공통 기반이므로
--     approvals를 끈 테넌트에서도 이 관계는 성립해야 한다 (CLAUDE.md §1-2).
--     결재선·전결규정이 필요한 품의는 기존 approvals 경로를 그대로 쓴다.
-- ============================================================================

-- ---- PM 판정 헬퍼 -----------------------------------------------------------
create or replace function app.project_assignment_role(p_project_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select pa.assignment_role
  from public.project_assignments pa
  where pa.project_id = p_project_id
    and pa.user_id = auth.uid()
  limit 1
$$;

revoke all on function app.project_assignment_role(uuid) from public;
grant execute on function app.project_assignment_role(uuid) to authenticated;

create or replace function app.is_project_pm(p_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select app.project_assignment_role(p_project_id) = 'pm'
$$;

revoke all on function app.is_project_pm(uuid) from public;
grant execute on function app.is_project_pm(uuid) to authenticated;

comment on function app.is_project_pm(uuid) is
  '현재 세션이 해당 프로젝트의 PM인가. 부PM 실행 요청의 승인 주체 판정에 쓴다.';

-- ---- 부PM 실행 승인 요청 ----------------------------------------------------
create table if not exists public.project_action_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  -- 실행하려는 작업 종류 (예: engagement.request · engagement.cancel · message.send)
  action_type text not null,
  -- 승인 대상 레코드 — 무엇에 대한 실행인지 지목한다 (JSON 블롭 금지, §8)
  target_type text not null,
  target_id uuid,
  -- 부PM이 남기는 요청 사유(무엇을 왜 하려는지). 실행 입력값이 아니다.
  request_note text,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'denied')),
  requested_by uuid not null,
  decided_by uuid,
  decided_at timestamptz,
  decision_note text,
  -- 승인 1건 = 실행 1회. 실행 성사 시 소진되어 재사용되지 않는다.
  consumed_at timestamptz,
  is_practice boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists project_action_requests_project_idx
  on public.project_action_requests (project_id, status, created_at desc);
create index if not exists project_action_requests_open_idx
  on public.project_action_requests (project_id, action_type, target_id)
  where consumed_at is null and status = 'approved';
create index if not exists project_action_requests_requester_idx
  on public.project_action_requests (requested_by, status);

alter table public.project_action_requests enable row level security;

-- 열람: 프로젝트를 볼 수 있는 사람 (배정자 + 대표·이사)
drop policy if exists project_action_requests_select on public.project_action_requests;
create policy project_action_requests_select on public.project_action_requests
  for select using (
    tenant_id = app.tenant_id() and app.can_view_project(project_id)
  );

-- 요청: 본인 명의로만. 대상 프로젝트를 볼 수 있어야 한다.
drop policy if exists project_action_requests_insert on public.project_action_requests;
create policy project_action_requests_insert on public.project_action_requests
  for insert with check (
    tenant_id = app.tenant_id()
    and requested_by = auth.uid()
    and app.can_view_project(project_id)
  );

-- 승인·반려·소진: PM 또는 대표·이사. **요청자 본인은 자기 요청을 승인할 수 없다.**
-- (소진 표시는 실행자가 해야 하므로 요청자 본인도 허용하되, 승인 상태 전환은
--  아래 트리거가 막는다.)
drop policy if exists project_action_requests_update on public.project_action_requests;
create policy project_action_requests_update on public.project_action_requests
  for update using (
    tenant_id = app.tenant_id()
    and (
      app.is_project_pm(project_id)
      or app.can_view_all_projects()
      or requested_by = auth.uid()
    )
  );

/**
 * 자기 승인 금지 + 결정 권한 확인.
 * 상태를 pending에서 옮기는 것은 PM(또는 대표·이사)만 할 수 있고, 요청자 본인은
 * 자기 요청을 승인·반려할 수 없다. 요청자에게 허용된 UPDATE는 소진 표시뿐이다.
 */
create or replace function public.enforce_action_request_decision()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status is distinct from old.status then
    if old.status <> 'pending' then
      raise exception '이미 처리된 요청입니다.';
    end if;
    if new.requested_by = auth.uid() then
      raise exception '자기 요청은 스스로 승인할 수 없습니다.';
    end if;
    if not (app.is_project_pm(new.project_id) or app.can_view_all_projects()) then
      raise exception 'PM 또는 대표·이사만 승인·반려할 수 있습니다.';
    end if;
  end if;
  -- 요청 사실 자체는 고쳐 쓸 수 없다(기록 보존)
  new.project_id := old.project_id;
  new.action_type := old.action_type;
  new.target_type := old.target_type;
  new.target_id := old.target_id;
  new.requested_by := old.requested_by;
  new.request_note := old.request_note;
  return new;
end $$;

drop trigger if exists z_enforce_action_request_decision on public.project_action_requests;
create trigger z_enforce_action_request_decision
  before update on public.project_action_requests
  for each row execute function public.enforce_action_request_decision();

-- 연습모드 스탬프 + 양방향 차단 (20260818000001과 같은 방식)
drop trigger if exists a_stamp_practice on public.project_action_requests;
create trigger a_stamp_practice
  before insert on public.project_action_requests
  for each row execute function app.stamp_practice();

drop policy if exists project_action_requests_practice on public.project_action_requests;
create policy project_action_requests_practice on public.project_action_requests
  as restrictive
  for all
  using (is_practice = app.is_practice())
  with check (is_practice = app.is_practice());

comment on table public.project_action_requests is
  '부PM이 실행할 작업에 대한 PM 사전 승인. 승인 1건 = 실행 1회. 업무 구분이 아니라 실행 게이트다.';
