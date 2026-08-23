-- ============================================================================
-- 회사별 권한 문턱 조정 (기획 확정 2026-08-23 — 차등화 다음 단계)
--
-- EXEC_FEATURES(lib/auth/exec-permissions.ts)의 기본 최소 레벨 위에 두 겹:
--   1. tenant_exec_overrides — 회사가 기능별 최소 레벨을 올리거나 내림
--   2. tenant_exec_grants    — 레벨과 무관하게 특정 직원에게 기능을 열어줌
--
-- 판정: 개인 지정 > 회사 조정 레벨 > 기본 레벨.  DB 판정 함수는 app.can_exec.
-- 이전 마이그레이션(20260823000006)의 고정 문턱 정책(has_exec_grade)을
-- can_exec(기능키) 기준으로 재작성해 오버라이드가 RLS까지 관통하게 한다.
-- 레벨 3 고정이던 정책(개설·취소·자유발송·문구)도 같은 방식으로 전환한다.
--
-- 주의: 보유자료 일괄 등록(bulkImport)은 service_role 경로라 RLS가 아니라
-- 앱 게이트(canExecTenant)가 강제한다 — 코드와 함께 배포된다.
-- ============================================================================

-- ---- 0. 설정 테이블 ----------------------------------------------------------

create table if not exists public.tenant_exec_overrides (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  feature text not null,
  min_grade text not null,
  updated_by uuid references public.users(id),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, feature),
  constraint tenant_exec_overrides_feature_check check (feature in (
    'projectCreate', 'bulkImport', 'engagementCancel', 'freeMessageSend',
    'projectBudget', 'sendTemplate',
    'engagementRequest', 'sessionNotice', 'acceptanceSend', 'planSubmit',
    'paymentBatchCreate', 'expertInvite', 'expertRecord',
    'planInput'
  )),
  constraint tenant_exec_overrides_grade_check check (min_grade in (
    'ceo', 'director', 'team_lead', 'deputy', 'senior', 'staff'
  ))
);

create table if not exists public.tenant_exec_grants (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  feature text not null,
  user_id uuid not null references public.users(id) on delete cascade,
  created_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  primary key (tenant_id, feature, user_id),
  constraint tenant_exec_grants_feature_check check (feature in (
    'projectCreate', 'bulkImport', 'engagementCancel', 'freeMessageSend',
    'projectBudget', 'sendTemplate',
    'engagementRequest', 'sessionNotice', 'acceptanceSend', 'planSubmit',
    'paymentBatchCreate', 'expertInvite', 'expertRecord',
    'planInput'
  ))
);

alter table public.tenant_exec_overrides enable row level security;
alter table public.tenant_exec_grants enable row level security;

-- 조회: 테넌트 전 직원 (판정·화면 표시에 필요) / 쓰기: staff 스코프 (임직원 권한 관리)
drop policy if exists tenant_exec_overrides_select on public.tenant_exec_overrides;
create policy tenant_exec_overrides_select on public.tenant_exec_overrides
  for select using (tenant_id = app.tenant_id());

drop policy if exists tenant_exec_overrides_write on public.tenant_exec_overrides;
create policy tenant_exec_overrides_write on public.tenant_exec_overrides
  for all using (tenant_id = app.tenant_id() and app.has_admin_scope('staff'))
  with check (tenant_id = app.tenant_id() and app.has_admin_scope('staff'));

drop policy if exists tenant_exec_grants_select on public.tenant_exec_grants;
create policy tenant_exec_grants_select on public.tenant_exec_grants
  for select using (tenant_id = app.tenant_id());

drop policy if exists tenant_exec_grants_write on public.tenant_exec_grants;
create policy tenant_exec_grants_write on public.tenant_exec_grants
  for all using (tenant_id = app.tenant_id() and app.has_admin_scope('staff'))
  with check (tenant_id = app.tenant_id() and app.has_admin_scope('staff'));

comment on table public.tenant_exec_overrides is
  '기능별 최소 실행 레벨의 회사 조정값 — 미설정 기능은 기본값(app.exec_default_min).';
comment on table public.tenant_exec_grants is
  '특정 직원에게 특정 기능을 레벨과 무관하게 열어주는 개인 지정.';

-- ---- 1. 판정 함수 ------------------------------------------------------------

-- 기본 최소 레벨 — lib/auth/exec-permissions.ts EXEC_FEATURES와 반드시 동일 유지
create or replace function app.exec_default_min(p_feature text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_feature
    when 'projectCreate'      then 'team_lead'
    when 'bulkImport'         then 'team_lead'
    when 'engagementCancel'   then 'team_lead'
    when 'freeMessageSend'    then 'team_lead'
    when 'projectBudget'      then 'team_lead'
    when 'sendTemplate'       then 'team_lead'
    when 'engagementRequest'  then 'deputy'
    when 'sessionNotice'      then 'deputy'
    when 'acceptanceSend'     then 'deputy'
    when 'planSubmit'         then 'deputy'
    when 'paymentBatchCreate' then 'deputy'
    when 'expertInvite'       then 'deputy'
    when 'expertRecord'       then 'deputy'
    when 'planInput'          then 'senior'
    else 'ceo' -- 모르는 키는 가장 좁게
  end
$$;

-- 유효 최소 레벨 = 회사 조정값 ?? 기본값
create or replace function app.exec_min_grade(p_feature text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select o.min_grade
       from public.tenant_exec_overrides o
      where o.tenant_id = app.tenant_id()
        and o.feature = p_feature),
    app.exec_default_min(p_feature)
  )
$$;

-- 기능 실행 판정 — 개인 지정 > 레벨 판정. platform_admin은 통과(기존과 동일).
create or replace function app.can_exec(p_feature text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.user_role() = 'platform_admin'
      or app.grade_rank(app.user_grade())
         >= app.grade_rank(app.exec_min_grade(p_feature))
      or exists (
        select 1 from public.tenant_exec_grants g
        where g.tenant_id = app.tenant_id()
          and g.feature = p_feature
          and g.user_id = auth.uid()
      )
$$;

revoke all on function app.exec_default_min(text) from public;
revoke all on function app.exec_min_grade(text) from public;
revoke all on function app.can_exec(text) from public;
grant execute on function app.exec_default_min(text) to authenticated;
grant execute on function app.exec_min_grade(text) to authenticated;
grant execute on function app.can_exec(text) to authenticated;

comment on function app.can_exec(text) is
  '기능 실행 판정 — 개인 지정 > 회사 조정 레벨 > 기본 레벨 (회사별 문턱 조정).';

-- ---- 2. 레벨 4 정책 재작성 — 고정 문턱 → 기능키 판정 -------------------------

drop policy if exists expert_engagements_insert on public.expert_engagements;
create policy expert_engagements_insert on public.expert_engagements
  for insert with check (
    tenant_id = app.tenant_id() and app.can_exec('engagementRequest')
  );

drop policy if exists expert_engagements_update on public.expert_engagements;
create policy expert_engagements_update on public.expert_engagements
  for update using (
    (tenant_id = app.tenant_id() and app.can_exec('engagementRequest'))
    or app.is_expert_self(expert_id)
  )
  with check (
    (tenant_id = app.tenant_id() and app.can_exec('engagementRequest'))
    or app.is_expert_self(expert_id)
  );

-- 전문가 수정 가드 — 전체 수정 허용 분기를 같은 판정으로
create or replace function app.guard_engagement_expert_update()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  -- 자사 직원(섭외 실행 권한자) 세션이면 전체 수정 허용
  if new.tenant_id = app.tenant_id()
     and app.can_exec('engagementRequest') then
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
     or new.token_hash   is distinct from old.token_hash
     or new.session_name  is distinct from old.session_name
     or new.position_code is distinct from old.position_code
     or new.is_practice   is distinct from old.is_practice then
    raise exception '전문가는 섭외 응답(수락·거절) 외 항목을 변경할 수 없습니다.';
  end if;
  return new;
end;
$$;

-- 프로젝트 갱신 — 실행 흐름(계획 상신·섭외요청·수락서 송신) 권한자
drop policy if exists projects_update on public.projects;
create policy projects_update on public.projects
  for update using (
    tenant_id = app.tenant_id()
    and (app.can_exec('planSubmit') or app.can_exec('engagementRequest')
         or app.can_exec('acceptanceSend'))
  )
  with check (
    tenant_id = app.tenant_id()
    and (app.can_exec('planSubmit') or app.can_exec('engagementRequest')
         or app.can_exec('acceptanceSend'))
  );

-- projects 컬럼 경계 — 기초정보(예산·기간·상태 등)는 projectBudget 권한자 전용
create or replace function app.guard_project_update_grade()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  -- 실행 흐름(계획 상신·섭외요청·수락서 송신)이 갱신하는 컬럼
  v_open text[] := array[
    'engagement_stage', 'engagement_plan_approval_id',
    'engagement_channel', 'engagement_deadline', 'engagement_requested_at',
    'acceptance_channel', 'acceptance_sent_at', 'updated_at'
  ];
begin
  -- 서버 관리 경로(service_role)와 기초정보 수정 권한자는 전 컬럼 수정 가능
  if auth.role() = 'service_role' or app.can_exec('projectBudget') then
    return new;
  end if;
  if (to_jsonb(new) - v_open) is distinct from (to_jsonb(old) - v_open) then
    raise exception '프로젝트 기본정보(예산·기간·상태 등) 수정 권한이 없습니다 (권한 규칙).'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop policy if exists engagement_plans_write on public.engagement_plans;
create policy engagement_plans_write on public.engagement_plans
  for all using (
    tenant_id = app.tenant_id()
    and app.can_exec('planSubmit')
    and app.can_view_project(project_id)
  )
  with check (
    tenant_id = app.tenant_id()
    and app.can_exec('planSubmit')
    and app.can_view_project(project_id)
  );

drop policy if exists engagement_plan_lines_write on public.engagement_plan_lines;
create policy engagement_plan_lines_write on public.engagement_plan_lines
  for all using (
    tenant_id = app.tenant_id()
    and app.can_exec('planSubmit')
    and exists (select 1 from public.engagement_plans p where p.id = plan_id)
  )
  with check (
    tenant_id = app.tenant_id()
    and app.can_exec('planSubmit')
    and exists (select 1 from public.engagement_plans p where p.id = plan_id)
  );

drop policy if exists session_notices_write on public.session_notices;
create policy session_notices_write on public.session_notices
  for all using (
    tenant_id = app.tenant_id()
    and app.can_exec('sessionNotice')
    and app.can_view_project(project_id)
  )
  with check (
    tenant_id = app.tenant_id()
    and app.can_exec('sessionNotice')
    and app.can_view_project(project_id)
  );

drop policy if exists engagement_acceptances_update on public.engagement_acceptances;
create policy engagement_acceptances_update on public.engagement_acceptances
  for update using (
    tenant_id = app.tenant_id() and app.can_exec('acceptanceSend')
  )
  with check (
    tenant_id = app.tenant_id() and app.can_exec('acceptanceSend')
  );

drop policy if exists acceptance_attachments_insert on public.engagement_acceptance_attachments;
create policy acceptance_attachments_insert on public.engagement_acceptance_attachments
  for insert with check (
    tenant_id = app.tenant_id() and app.can_exec('acceptanceSend')
  );

drop policy if exists acceptance_attachments_delete on public.engagement_acceptance_attachments;
create policy acceptance_attachments_delete on public.engagement_acceptance_attachments
  for delete using (
    tenant_id = app.tenant_id() and app.can_exec('acceptanceSend')
  );

drop policy if exists expert_invitations_insert on public.expert_invitations;
create policy expert_invitations_insert on public.expert_invitations
  for insert with check (
    tenant_id = app.tenant_id() and app.can_exec('expertInvite')
  );

drop policy if exists expert_invitations_update on public.expert_invitations;
create policy expert_invitations_update on public.expert_invitations
  for update using (
    tenant_id = app.tenant_id() and app.can_exec('expertInvite')
  )
  with check (
    tenant_id = app.tenant_id() and app.can_exec('expertInvite')
  );

drop policy if exists document_requests_write on public.document_requests;
create policy document_requests_write on public.document_requests
  for all using (
    tenant_id = app.tenant_id() and app.can_exec('expertInvite')
  )
  with check (
    tenant_id = app.tenant_id() and app.can_exec('expertInvite')
  );

drop policy if exists expert_tenant_tags_write on public.expert_tenant_tags;
create policy expert_tenant_tags_write on public.expert_tenant_tags
  for all using (
    tenant_id = app.tenant_id() and app.can_exec('expertRecord')
  )
  with check (
    tenant_id = app.tenant_id() and app.can_exec('expertRecord')
  );

drop policy if exists expert_reviews_insert on public.expert_reviews;
create policy expert_reviews_insert on public.expert_reviews
  for insert with check (
    tenant_id = app.tenant_id() and app.can_exec('expertRecord')
  );

drop policy if exists expert_reviews_update on public.expert_reviews;
create policy expert_reviews_update on public.expert_reviews
  for update using (
    tenant_id = app.tenant_id() and app.can_exec('expertRecord')
  )
  with check (
    tenant_id = app.tenant_id() and app.can_exec('expertRecord')
  );

drop policy if exists expert_tenant_profiles_write on public.expert_tenant_profiles;
create policy expert_tenant_profiles_write on public.expert_tenant_profiles
  for all using (
    tenant_id = app.tenant_id() and app.can_exec('expertRecord')
  )
  with check (
    tenant_id = app.tenant_id() and app.can_exec('expertRecord')
  );

drop policy if exists expert_tenant_recruit_fields_write on public.expert_tenant_recruit_fields;
create policy expert_tenant_recruit_fields_write on public.expert_tenant_recruit_fields
  for all using (
    tenant_id = app.tenant_id() and app.can_exec('expertRecord')
  )
  with check (
    tenant_id = app.tenant_id() and app.can_exec('expertRecord')
  );

drop policy if exists expert_rating_logs_insert on public.expert_rating_logs;
create policy expert_rating_logs_insert on public.expert_rating_logs
  for insert with check (
    tenant_id = app.tenant_id() and app.can_exec('expertRecord')
  );

drop policy if exists expert_tenant_notes_insert on public.expert_tenant_notes;
create policy expert_tenant_notes_insert on public.expert_tenant_notes
  for insert with check (
    tenant_id = app.tenant_id() and app.can_exec('expertRecord')
  );

drop policy if exists expert_evaluations_insert on public.expert_evaluations;
create policy expert_evaluations_insert on public.expert_evaluations
  for insert with check (
    tenant_id = app.tenant_id() and app.can_exec('expertRecord')
  );

drop policy if exists expert_evaluations_update on public.expert_evaluations;
create policy expert_evaluations_update on public.expert_evaluations
  for update using (
    tenant_id = app.tenant_id() and app.can_exec('expertRecord')
  )
  with check (
    tenant_id = app.tenant_id() and app.can_exec('expertRecord')
  );

-- 발송 로그 — 발송을 실행할 수 있는 어느 기능이든 있으면 기록 가능
drop policy if exists sms_logs_insert on public.sms_logs;
create policy sms_logs_insert on public.sms_logs
  for insert with check (
    tenant_id = app.tenant_id()
    and (app.can_exec('engagementRequest') or app.can_exec('sessionNotice')
         or app.can_exec('acceptanceSend') or app.can_exec('expertInvite')
         or app.can_exec('freeMessageSend'))
  );

drop policy if exists email_logs_insert on public.email_logs;
create policy email_logs_insert on public.email_logs
  for insert with check (
    tenant_id = app.tenant_id()
    and (app.can_exec('engagementRequest') or app.can_exec('sessionNotice')
         or app.can_exec('acceptanceSend') or app.can_exec('expertInvite')
         or app.can_exec('freeMessageSend'))
  );

-- ---- 3. 레벨 5 정책 재작성 ----------------------------------------------------

drop policy if exists engagement_slots_insert on public.engagement_slots;
create policy engagement_slots_insert on public.engagement_slots
  for insert with check (
    tenant_id = app.tenant_id()
    and app.can_exec('planInput')
    and app.can_view_project(project_id)
  );

drop policy if exists engagement_slots_update on public.engagement_slots;
create policy engagement_slots_update on public.engagement_slots
  for update using (
    tenant_id = app.tenant_id()
    and app.can_exec('planInput')
    and app.can_view_project(project_id)
  )
  with check (
    tenant_id = app.tenant_id()
    and app.can_exec('planInput')
    and app.can_view_project(project_id)
  );

drop policy if exists engagement_slots_delete on public.engagement_slots;
create policy engagement_slots_delete on public.engagement_slots
  for delete using (
    tenant_id = app.tenant_id()
    and app.can_exec('planInput')
    and app.can_view_project(project_id)
  );

drop policy if exists engagement_slot_positions_insert on public.engagement_slot_positions;
create policy engagement_slot_positions_insert on public.engagement_slot_positions
  for insert with check (
    tenant_id = app.tenant_id()
    and app.can_exec('planInput')
    and exists (
      select 1 from public.engagement_slots s
      where s.id = slot_id and app.can_view_project(s.project_id)
    )
  );

drop policy if exists engagement_slot_positions_update on public.engagement_slot_positions;
create policy engagement_slot_positions_update on public.engagement_slot_positions
  for update using (
    tenant_id = app.tenant_id()
    and app.can_exec('planInput')
    and exists (
      select 1 from public.engagement_slots s
      where s.id = slot_id and app.can_view_project(s.project_id)
    )
  )
  with check (
    tenant_id = app.tenant_id()
    and app.can_exec('planInput')
    and exists (
      select 1 from public.engagement_slots s
      where s.id = slot_id and app.can_view_project(s.project_id)
    )
  );

drop policy if exists engagement_slot_positions_delete on public.engagement_slot_positions;
create policy engagement_slot_positions_delete on public.engagement_slot_positions
  for delete using (
    tenant_id = app.tenant_id()
    and app.can_exec('planInput')
    and exists (
      select 1 from public.engagement_slots s
      where s.id = slot_id and app.can_view_project(s.project_id)
    )
  );

drop policy if exists project_engagement_attachments_write on public.project_engagement_attachments;
create policy project_engagement_attachments_write on public.project_engagement_attachments
  for all using (
    tenant_id = app.tenant_id()
    and app.can_exec('planInput')
    and app.can_view_project(project_id)
  )
  with check (
    tenant_id = app.tenant_id()
    and app.can_exec('planInput')
    and app.can_view_project(project_id)
  );

-- ---- 4. 레벨 3 고정이던 정책도 기능키 판정으로 (오버라이드 관통) --------------

drop policy if exists projects_insert on public.projects;
create policy projects_insert on public.projects
  for insert with check (
    tenant_id = app.tenant_id() and app.can_exec('projectCreate')
  );

drop policy if exists engagement_cancellations_insert on public.engagement_cancellations;
create policy engagement_cancellations_insert on public.engagement_cancellations
  for insert with check (
    tenant_id = app.tenant_id() and app.can_exec('engagementCancel')
  );

drop policy if exists sms_send_batches_insert on public.sms_send_batches;
create policy sms_send_batches_insert on public.sms_send_batches
  for insert with check (
    tenant_id = app.tenant_id() and app.can_exec('freeMessageSend')
  );

-- 취소(scheduled → canceled)만 세션에서 일어난다. 발송 진행 갱신은 service_role.
drop policy if exists sms_send_batches_update on public.sms_send_batches;
create policy sms_send_batches_update on public.sms_send_batches
  for update using (
    tenant_id = app.tenant_id() and app.can_exec('freeMessageSend')
  )
  with check (
    tenant_id = app.tenant_id() and app.can_exec('freeMessageSend')
  );

drop policy if exists sms_send_batch_recipients_insert on public.sms_send_batch_recipients;
create policy sms_send_batch_recipients_insert on public.sms_send_batch_recipients
  for insert with check (
    tenant_id = app.tenant_id() and app.can_exec('freeMessageSend')
  );

drop policy if exists session_notice_templates_write on public.session_notice_templates;
create policy session_notice_templates_write on public.session_notice_templates
  for all using (
    tenant_id = app.tenant_id() and app.can_exec('sendTemplate')
  )
  with check (
    tenant_id = app.tenant_id() and app.can_exec('sendTemplate')
  );
