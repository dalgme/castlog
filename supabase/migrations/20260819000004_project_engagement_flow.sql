-- ============================================================================
-- 프로젝트 단위 섭외 프로세스 (기획 확정)
--
-- 지금까지 섭외는 코드넘버 한 자리씩 따로 나갔다. 실제 일은 그렇게 굴러가지
-- 않는다: 자리를 **전부** 채워 놓고 → 그 명단으로 품의를 올리고 → 결재가
-- 떨어지면 → 전원에게 한 번에 요청을 보내고 → 전원이 수락하면 → 수락서를
-- 한 번에 보낸다. 프로젝트가 한 덩어리로 움직인다.
--
-- 그래서 프로젝트에 **단계(engagement_stage)** 를 둔다. 버튼이 언제 열리는지가
-- 이 단계 하나로 정해진다 — 화면마다 조건을 따로 계산하면 어긋난다.
--
-- 이 파일은 **몇 번을 다시 실행해도 안전하다**. 이름 붙은 제약·정책은 전부
-- 'drop if exists' 뒤에 다시 만든다. 중간에 실패했으면 그냥 처음부터 다시
-- 돌리면 된다 (create table 안에 이름 붙인 제약을 두면 재실행이 깨진다).
-- ============================================================================

-- ---- 1. 코드넘버: '임의 배정' 단계 추가 ------------------------------------
-- 배정과 요청을 구분한다. 배정은 아직 아무에게도 나가지 않은 내부 결정이고,
-- 요청은 전문가에게 실제로 나간 것이다. 이 둘을 한 상태로 묶으면 "누구를
-- 넣을지 정하는 중"과 "회신을 기다리는 중"을 구별할 수 없다.
alter table public.engagement_slot_positions
  drop constraint if exists engagement_slot_positions_status_check;
alter table public.engagement_slot_positions
  add constraint engagement_slot_positions_status_check
  check (status in ('open', 'assigned', 'requested', 'filled', 'canceled'));

alter table public.engagement_slot_positions
  add column if not exists assigned_expert_id uuid
    references public.experts (id) on delete set null,
  add column if not exists assigned_at timestamptz,
  add column if not exists assigned_by uuid references public.users (id) on delete set null;

comment on column public.engagement_slot_positions.assigned_expert_id is
  '임의 배정된 전문가. 아직 요청이 나가지 않은 내부 결정이다.';

-- ---- 2. 프로젝트 섭외 단계 --------------------------------------------------
alter table public.projects
  add column if not exists engagement_stage text not null default 'assigning',
  add column if not exists engagement_plan_approval_id uuid
    references public.approvals (id) on delete set null,
  add column if not exists engagement_requested_at timestamptz,
  add column if not exists engagement_channel text,
  add column if not exists engagement_deadline timestamptz,
  add column if not exists acceptance_sent_at timestamptz,
  add column if not exists acceptance_channel text,
  add column if not exists settlement_approval_id uuid
    references public.approvals (id) on delete set null,
  add column if not exists settlement_reviewed_by uuid
    references public.users (id) on delete set null,
  add column if not exists settlement_reviewed_at timestamptz,
  add column if not exists settlement_note text;

alter table public.projects
  drop constraint if exists projects_engagement_stage_check;
alter table public.projects
  add constraint projects_engagement_stage_check
  check (engagement_stage in (
    'assigning',         -- 임의 배정 중 (자리를 채우는 단계)
    'plan_review',       -- 섭외 품의 결재 중
    'plan_approved',     -- 결재 완료 — 섭외 진행 가능
    'requesting',        -- 전문가에게 섭외 요청 발송됨 (회신 대기)
    'accepted_all',      -- 전원 수락 — 수락서 송신 가능
    'letters_sent',      -- 수락서 송신됨 (전문가 확인 대기)
    'confirmed',         -- 전원 확정
    'closing',           -- 종료 진행 (기여도·만족도 입력)
    'settlement_review', -- 지급 품의 검토 (회계담당자)
    'settled'            -- 종료 및 지급 품의 완료
  ));

alter table public.projects
  drop constraint if exists projects_engagement_channel_check;
alter table public.projects
  add constraint projects_engagement_channel_check
  check (engagement_channel is null
     or engagement_channel in ('sms', 'email', 'both'));

alter table public.projects
  drop constraint if exists projects_acceptance_channel_check;
alter table public.projects
  add constraint projects_acceptance_channel_check
  check (acceptance_channel is null
     or acceptance_channel in ('sms', 'email', 'both'));

comment on column public.projects.engagement_stage is
  '프로젝트 섭외 진행 단계. 화면의 버튼 활성 조건은 전부 이 값 하나로 정해진다.';

create index if not exists projects_engagement_stage_idx
  on public.projects (tenant_id, engagement_stage);

-- ---- 3. 섭외·수락서 첨부파일 (공통 / 개별) ----------------------------------
-- 공통 = 전원에게 같은 파일(사업 안내문·약도), 개별 = 전문가 한 명에게만.
-- 민감서류가 아니므로 리사이즈 대상이 아니지만, 용량·확장자는 서버에서 검증한다.
--
-- 제약은 표 안에 이름 붙여 넣지 않는다. 'create table if not exists'는 표가
-- 이미 있으면 통째로 건너뛰지만, 표가 없을 때는 제약까지 새로 만들어 이름이
-- 겹치는 순간 재실행이 깨진다. 아래에서 따로 붙인다.
create table if not exists public.project_engagement_attachments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  -- engagement = 섭외요청에 동봉 / acceptance = 수락서에 귀속
  purpose text not null,
  scope text not null,
  -- scope='individual'일 때만 채운다
  expert_id uuid references public.experts (id) on delete cascade,
  file_name text not null,
  storage_path text not null,
  mime_type text,
  file_size_bytes bigint,
  uploaded_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  is_practice boolean not null default false
);

-- 이전 버전에서 표를 먼저 만든 경우에도 컬럼이 빠지지 않게 한다
alter table public.project_engagement_attachments
  add column if not exists is_practice boolean not null default false;

alter table public.project_engagement_attachments
  drop constraint if exists project_engagement_attachments_purpose_check;
alter table public.project_engagement_attachments
  add constraint project_engagement_attachments_purpose_check
  check (purpose in ('engagement', 'acceptance'));

alter table public.project_engagement_attachments
  drop constraint if exists project_engagement_attachments_scope_kind_check;
alter table public.project_engagement_attachments
  add constraint project_engagement_attachments_scope_kind_check
  check (scope in ('common', 'individual'));

-- 개별 파일에는 전문가가 반드시 있고, 공통 파일에는 없어야 한다
alter table public.project_engagement_attachments
  drop constraint if exists project_engagement_attachments_scope_check;
alter table public.project_engagement_attachments
  add constraint project_engagement_attachments_scope_check
  check ((scope = 'individual') = (expert_id is not null));

create index if not exists project_engagement_attachments_idx
  on public.project_engagement_attachments (project_id, purpose, scope);

alter table public.project_engagement_attachments enable row level security;

drop policy if exists project_engagement_attachments_select
  on public.project_engagement_attachments;
create policy project_engagement_attachments_select
  on public.project_engagement_attachments
  for select using (tenant_id = app.tenant_id());

drop policy if exists project_engagement_attachments_write
  on public.project_engagement_attachments;
create policy project_engagement_attachments_write
  on public.project_engagement_attachments
  for all using (
    tenant_id = app.tenant_id() and app.user_role() in ('org_admin', 'manager')
  )
  with check (
    tenant_id = app.tenant_id() and app.user_role() in ('org_admin', 'manager')
  );

-- ---- 4. 만족도 평가 (세션별 0~100, 5점 단위) --------------------------------
-- 기존 score(1~10)는 남긴다. 평판 집계·지급 게이트가 이미 그 값을 본다.
-- 새 화면은 satisfaction을 입력받고 score를 함께 채워 두 값을 어긋나지 않게 한다.
alter table public.expert_evaluations
  add column if not exists slot_id uuid
    references public.engagement_slots (id) on delete cascade,
  add column if not exists satisfaction smallint,
  add column if not exists memo text;

alter table public.expert_evaluations
  drop constraint if exists expert_evaluations_satisfaction_check;
alter table public.expert_evaluations
  add constraint expert_evaluations_satisfaction_check
  check (satisfaction is null
     or (satisfaction between 0 and 100 and satisfaction % 5 = 0));

-- 세션별로 여러 건이 생기므로 기존 (테넌트·프로젝트·전문가) unique를 푼다.
-- 세션이 없는 옛 행과 섞여도 충돌하지 않도록 coalesce로 키를 만든다.
alter table public.expert_evaluations
  drop constraint if exists expert_evaluations_tenant_id_project_id_expert_id_key;
create unique index if not exists expert_evaluations_unique_idx
  on public.expert_evaluations (
    tenant_id, project_id, expert_id,
    coalesce(slot_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );

comment on column public.expert_evaluations.satisfaction is
  '세션별 만족도 0~100 (5점 단위). 프로젝트 마감 시 입력한다.';

-- ---- 5. 연습모드 스탬프 ------------------------------------------------------
-- 첨부는 프로젝트에 속하므로 모드도 프로젝트에서 물려받는다.
create or replace function app.stamp_project_attachment_practice()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_practice boolean;
begin
  select is_practice into v_practice
  from public.projects where id = new.project_id;
  new.is_practice := coalesce(v_practice, false);
  return new;
end;
$$;

drop trigger if exists a_stamp_project_attachment_practice
  on public.project_engagement_attachments;
create trigger a_stamp_project_attachment_practice
  before insert or update of project_id
  on public.project_engagement_attachments
  for each row execute function app.stamp_project_attachment_practice();

drop policy if exists project_engagement_attachments_practice_mode
  on public.project_engagement_attachments;
create policy project_engagement_attachments_practice_mode
  on public.project_engagement_attachments
  as restrictive
  for select
  using (is_practice = app.is_practice());
