-- ============================================================================
-- 권한 레벨 4·5·6 차등화 (기획 확정 2026-08-23 — #102)
--
-- 앱은 lib/auth/exec-permissions.ts 의 기능별 최소 레벨 표를 따르고,
-- DB는 이 파일의 app.has_exec_grade(min)로 같은 기준을 강제한다.
--
--   레벨 3 team_lead — 실행 전부 + 개설·일괄등록·섭외취소·자유발송 (변경 없음)
--   레벨 4 deputy    — 발송·수락서·품의·자사기록 실행 개방 (PM을 맡는 레벨)
--   레벨 5 senior    — 세션 계획·후보·예정가 입력 개방
--   레벨 6 staff     — 조회 전용 (일반 품의 상신은 기존대로 가능)
--
-- 재편 원칙:
--  * 기존 manager(레벨1~3) 고정 쓰기 정책을 기능 축에 맞춰 grade 기준으로 교체.
--  * 프로젝트 귀속 쓰기(슬롯·후보·안내문자·계획)는 app.can_view_project로
--    배정 범위까지 함께 강제 — 레벨 5 개방이 전 프로젝트 개방이 되지 않게.
--  * 금액 축(지급 expert_payment_*)·개설/일괄등록/취소/자유발송(레벨 3)·
--    설정류는 손대지 않는다.
--  * 역할 최소 레벨: PL(pl·pl_pm)은 레벨 3 이상, PM·부PM은 레벨 4 이상 — 트리거.
-- ============================================================================

-- ---- 0. 판정 함수 ------------------------------------------------------------
create or replace function app.has_exec_grade(p_min text)
returns boolean
language sql
stable
set search_path = ''
as $$
  select app.user_role() = 'platform_admin'
      or app.grade_rank(app.user_grade()) >= app.grade_rank(p_min)
$$;

revoke all on function app.has_exec_grade(text) from public;
grant execute on function app.has_exec_grade(text) to authenticated;

comment on function app.has_exec_grade(text) is
  '실행 권한 판정 — 현재 세션 grade가 최소 레벨 이상인가 (레벨 4·5·6 차등화).';

-- ---- 1. 레벨 4(deputy) 개방 — 발송·수락서·품의·자사 기록 ---------------------

-- 섭외 건 (섭외요청 발송·상태 갱신)
drop policy if exists expert_engagements_insert on public.expert_engagements;
create policy expert_engagements_insert on public.expert_engagements
  for insert with check (
    tenant_id = app.tenant_id() and app.has_exec_grade('deputy')
  );

drop policy if exists expert_engagements_update on public.expert_engagements;
create policy expert_engagements_update on public.expert_engagements
  for update using (
    (tenant_id = app.tenant_id() and app.has_exec_grade('deputy'))
    or app.is_expert_self(expert_id)
  )
  with check (
    (tenant_id = app.tenant_id() and app.has_exec_grade('deputy'))
    or app.is_expert_self(expert_id)
  );

-- 전문가 수정 가드 트리거 — RLS와 같은 기준으로 (안 고치면 레벨 4가 여기서 막힌다)
create or replace function app.guard_engagement_expert_update()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  -- 자사 직원(레벨 4 이상) 세션이면 전체 수정 허용
  if new.tenant_id = app.tenant_id()
     and app.has_exec_grade('deputy') then
    return new;
  end if;

  -- 그 외(전문가 본인) — 응답 관련 컬럼만 변경 허용, 나머지는 불변
  if new.tenant_id       is distinct from old.tenant_id
     or new.expert_id    is distinct from old.expert_id
     or new.project_id   is distinct from old.project_id
     or new.role_description is distinct from old.role_description
     or new.message      is distinct from old.message
     or new.fee_amount   is distinct from old.fee_amount
     or new.starts_on    is distinct from old.starts_on
     or new.ends_on      is distinct from old.ends_on
     or new.requested_by is distinct from old.requested_by
     or new.token_hash   is distinct from old.token_hash then
    raise exception '전문가는 섭외 응답(수락·거절) 외 항목을 변경할 수 없습니다.';
  end if;
  return new;
end;
$$;

-- 프로젝트 갱신 (품의 연결·단계 전환 등 레벨 4 실행 흐름이 만진다.
--  개설(insert)은 레벨 3 유지)
drop policy if exists projects_update on public.projects;
create policy projects_update on public.projects
  for update using (
    tenant_id = app.tenant_id() and app.has_exec_grade('deputy')
  )
  with check (
    tenant_id = app.tenant_id() and app.has_exec_grade('deputy')
  );

-- 섭외계획 품의 (배정 범위 조건은 그대로 유지)
drop policy if exists engagement_plans_write on public.engagement_plans;
create policy engagement_plans_write on public.engagement_plans
  for all using (
    tenant_id = app.tenant_id()
    and app.has_exec_grade('deputy')
    and app.can_view_project(project_id)
  )
  with check (
    tenant_id = app.tenant_id()
    and app.has_exec_grade('deputy')
    and app.can_view_project(project_id)
  );

drop policy if exists engagement_plan_lines_write on public.engagement_plan_lines;
create policy engagement_plan_lines_write on public.engagement_plan_lines
  for all using (
    tenant_id = app.tenant_id()
    and app.has_exec_grade('deputy')
    and exists (select 1 from public.engagement_plans p where p.id = plan_id)
  )
  with check (
    tenant_id = app.tenant_id()
    and app.has_exec_grade('deputy')
    and exists (select 1 from public.engagement_plans p where p.id = plan_id)
  );

-- 세션 안내문자 (배정 범위 조건 유지)
drop policy if exists session_notices_write on public.session_notices;
create policy session_notices_write on public.session_notices
  for all using (
    tenant_id = app.tenant_id()
    and app.has_exec_grade('deputy')
    and app.can_view_project(project_id)
  )
  with check (
    tenant_id = app.tenant_id()
    and app.has_exec_grade('deputy')
    and app.can_view_project(project_id)
  );

-- 수락서 (갱신 — 생성은 service_role 전용 유지)
drop policy if exists engagement_acceptances_update on public.engagement_acceptances;
create policy engagement_acceptances_update on public.engagement_acceptances
  for update using (
    tenant_id = app.tenant_id() and app.has_exec_grade('deputy')
  )
  with check (
    tenant_id = app.tenant_id() and app.has_exec_grade('deputy')
  );

drop policy if exists acceptance_attachments_insert on public.engagement_acceptance_attachments;
create policy acceptance_attachments_insert on public.engagement_acceptance_attachments
  for insert with check (
    tenant_id = app.tenant_id() and app.has_exec_grade('deputy')
  );

drop policy if exists acceptance_attachments_delete on public.engagement_acceptance_attachments;
create policy acceptance_attachments_delete on public.engagement_acceptance_attachments
  for delete using (
    tenant_id = app.tenant_id() and app.has_exec_grade('deputy')
  );

-- 전문가 등록요청·서류요청
drop policy if exists expert_invitations_insert on public.expert_invitations;
create policy expert_invitations_insert on public.expert_invitations
  for insert with check (
    tenant_id = app.tenant_id() and app.has_exec_grade('deputy')
  );

drop policy if exists expert_invitations_update on public.expert_invitations;
create policy expert_invitations_update on public.expert_invitations
  for update using (
    tenant_id = app.tenant_id() and app.has_exec_grade('deputy')
  )
  with check (
    tenant_id = app.tenant_id() and app.has_exec_grade('deputy')
  );

drop policy if exists document_requests_write on public.document_requests;
create policy document_requests_write on public.document_requests
  for all using (
    tenant_id = app.tenant_id() and app.has_exec_grade('deputy')
  )
  with check (
    tenant_id = app.tenant_id() and app.has_exec_grade('deputy')
  );

-- 자사 기록 (태그·후기·평점·메모·섭외분야·평가·만족도)
drop policy if exists expert_tenant_tags_write on public.expert_tenant_tags;
create policy expert_tenant_tags_write on public.expert_tenant_tags
  for all using (
    tenant_id = app.tenant_id() and app.has_exec_grade('deputy')
  )
  with check (
    tenant_id = app.tenant_id() and app.has_exec_grade('deputy')
  );

drop policy if exists expert_reviews_insert on public.expert_reviews;
create policy expert_reviews_insert on public.expert_reviews
  for insert with check (
    tenant_id = app.tenant_id() and app.has_exec_grade('deputy')
  );

drop policy if exists expert_reviews_update on public.expert_reviews;
create policy expert_reviews_update on public.expert_reviews
  for update using (
    tenant_id = app.tenant_id() and app.has_exec_grade('deputy')
  )
  with check (
    tenant_id = app.tenant_id() and app.has_exec_grade('deputy')
  );

drop policy if exists expert_tenant_profiles_write on public.expert_tenant_profiles;
create policy expert_tenant_profiles_write on public.expert_tenant_profiles
  for all using (
    tenant_id = app.tenant_id() and app.has_exec_grade('deputy')
  )
  with check (
    tenant_id = app.tenant_id() and app.has_exec_grade('deputy')
  );

drop policy if exists expert_tenant_recruit_fields_write on public.expert_tenant_recruit_fields;
create policy expert_tenant_recruit_fields_write on public.expert_tenant_recruit_fields
  for all using (
    tenant_id = app.tenant_id() and app.has_exec_grade('deputy')
  )
  with check (
    tenant_id = app.tenant_id() and app.has_exec_grade('deputy')
  );

drop policy if exists expert_rating_logs_insert on public.expert_rating_logs;
create policy expert_rating_logs_insert on public.expert_rating_logs
  for insert with check (
    tenant_id = app.tenant_id() and app.has_exec_grade('deputy')
  );

drop policy if exists expert_tenant_notes_insert on public.expert_tenant_notes;
create policy expert_tenant_notes_insert on public.expert_tenant_notes
  for insert with check (
    tenant_id = app.tenant_id() and app.has_exec_grade('deputy')
  );

drop policy if exists expert_evaluations_insert on public.expert_evaluations;
create policy expert_evaluations_insert on public.expert_evaluations
  for insert with check (
    tenant_id = app.tenant_id() and app.has_exec_grade('deputy')
  );

drop policy if exists expert_evaluations_update on public.expert_evaluations;
create policy expert_evaluations_update on public.expert_evaluations
  for update using (
    tenant_id = app.tenant_id() and app.has_exec_grade('deputy')
  )
  with check (
    tenant_id = app.tenant_id() and app.has_exec_grade('deputy')
  );

-- 발송 로그 — 레벨 4 실행 흐름(섭외요청·안내문자·리마인드)이 기록한다.
-- 발송 메뉴(자유 발송)의 목록 조회는 기존대로 레벨 3까지.
drop policy if exists sms_logs_insert on public.sms_logs;
create policy sms_logs_insert on public.sms_logs
  for insert with check (
    tenant_id = app.tenant_id() and app.has_exec_grade('deputy')
  );

drop policy if exists email_logs_insert on public.email_logs;
create policy email_logs_insert on public.email_logs
  for insert with check (
    tenant_id = app.tenant_id() and app.has_exec_grade('deputy')
  );

-- ---- 2. 레벨 5(senior) 개방 — 세션 계획·후보·예정가 입력 ---------------------
-- 배정 범위(can_view_project)까지 함께 강제 — 레벨 5는 배정 프로젝트만 입력한다.

drop policy if exists engagement_slots_insert on public.engagement_slots;
create policy engagement_slots_insert on public.engagement_slots
  for insert with check (
    tenant_id = app.tenant_id()
    and app.has_exec_grade('senior')
    and app.can_view_project(project_id)
  );

drop policy if exists engagement_slots_update on public.engagement_slots;
create policy engagement_slots_update on public.engagement_slots
  for update using (
    tenant_id = app.tenant_id()
    and app.has_exec_grade('senior')
    and app.can_view_project(project_id)
  )
  with check (
    tenant_id = app.tenant_id()
    and app.has_exec_grade('senior')
    and app.can_view_project(project_id)
  );

drop policy if exists engagement_slots_delete on public.engagement_slots;
create policy engagement_slots_delete on public.engagement_slots
  for delete using (
    tenant_id = app.tenant_id()
    and app.has_exec_grade('senior')
    and app.can_view_project(project_id)
  );

drop policy if exists engagement_slot_positions_insert on public.engagement_slot_positions;
create policy engagement_slot_positions_insert on public.engagement_slot_positions
  for insert with check (
    tenant_id = app.tenant_id()
    and app.has_exec_grade('senior')
    and exists (
      select 1 from public.engagement_slots s
      where s.id = slot_id and app.can_view_project(s.project_id)
    )
  );

drop policy if exists engagement_slot_positions_update on public.engagement_slot_positions;
create policy engagement_slot_positions_update on public.engagement_slot_positions
  for update using (
    tenant_id = app.tenant_id()
    and app.has_exec_grade('senior')
    and exists (
      select 1 from public.engagement_slots s
      where s.id = slot_id and app.can_view_project(s.project_id)
    )
  )
  with check (
    tenant_id = app.tenant_id()
    and app.has_exec_grade('senior')
    and exists (
      select 1 from public.engagement_slots s
      where s.id = slot_id and app.can_view_project(s.project_id)
    )
  );

drop policy if exists engagement_slot_positions_delete on public.engagement_slot_positions;
create policy engagement_slot_positions_delete on public.engagement_slot_positions
  for delete using (
    tenant_id = app.tenant_id()
    and app.has_exec_grade('senior')
    and exists (
      select 1 from public.engagement_slots s
      where s.id = slot_id and app.can_view_project(s.project_id)
    )
  );

drop policy if exists project_engagement_attachments_write on public.project_engagement_attachments;
create policy project_engagement_attachments_write on public.project_engagement_attachments
  for all using (
    tenant_id = app.tenant_id() and app.has_exec_grade('senior')
  )
  with check (
    tenant_id = app.tenant_id() and app.has_exec_grade('senior')
  );

-- ---- 3. 역할 최소 레벨 — PL은 레벨 3 이상, PM·부PM은 레벨 4 이상 --------------
create or replace function app.enforce_assignment_role_grade()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rank int;
  v_min int;
begin
  if new.assignment_role in ('pl', 'pl_pm') then
    v_min := app.grade_rank('team_lead');
  elsif new.assignment_role in ('pm', 'deputy_pm') then
    v_min := app.grade_rank('deputy');
  else
    return new; -- member는 제한 없음
  end if;

  select app.grade_rank(u.grade) into v_rank
  from public.users u where u.id = new.user_id;

  if coalesce(v_rank, 0) < v_min then
    raise exception 'PL은 레벨 3 이상, PM·부PM은 레벨 4 이상만 지정할 수 있습니다.'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists enforce_assignment_role_grade on public.project_assignments;
create trigger enforce_assignment_role_grade
  before insert or update of assignment_role, user_id
  on public.project_assignments
  for each row execute function app.enforce_assignment_role_grade();
