-- 섭외 프로세스 고도화 4단계 (기획 승인 2026-11-07 — docs/decisions/engagement-review-flow.md 03·05·10)
--
-- 1) projects.engagement_stage에 리스트 단계 3개 추가: list_review(내부 검토 중) · client_review(발주처 검토 중)
--    · adjusting(후보 조정 중). assigning과 plan_review 사이에 끼운다.
-- 2) approval_attachments — 품의 첨부(일반). 발주처 회신·내부 검토 의견을 섭외 품의서에 붙인다(10번).
--    결재 상세가 '첨부' 절로 보여 준다.
-- 3) engagement_plans.candidate_list_id — 어느 후보 리스트에서 올라온 품의인지.
-- 멱등·추가 전용. 코드는 표·컬럼 부재를 폴백한다.

-- ---- 1) 섭외 단계값 ----------------------------------------------------------------
alter table public.projects
  drop constraint if exists projects_engagement_stage_check;
alter table public.projects
  add constraint projects_engagement_stage_check
  check (engagement_stage in (
    'assigning',         -- 임의 배정 중 (자리를 채우는 단계)
    'list_review',       -- 섭외 후보 리스트 내부 검토 중 (2026-11-07)
    'client_review',     -- 발주처 검토 중 (2026-11-07)
    'adjusting',         -- 후보 조정 중 — 품의 직전 (2026-11-07)
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

-- ---- 2) 품의 첨부 ------------------------------------------------------------------
create table if not exists public.approval_attachments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  approval_id uuid not null references public.approvals (id) on delete cascade,
  -- client_review_response(발주처 회신) / internal_review(내부 검토 의견) / candidate_list(후보 리스트) / file(파일)
  kind text not null check (kind in ('client_review_response', 'internal_review', 'candidate_list', 'file')),
  -- 원본 레코드 (후보 리스트 id 등) — 삭제돼도 첨부 본문은 남는다
  ref_id uuid,
  title text not null check (length(title) between 1 and 200),
  body_text text,
  storage_path text,
  created_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists approval_attachments_approval_idx
  on public.approval_attachments (approval_id, created_at);

alter table public.approval_attachments enable row level security;

-- 결재건을 볼 수 있는 자사 임직원이면 첨부도 본다 (approvals 자체의 열람 정책이 1차 관문)
drop policy if exists approval_attachments_select on public.approval_attachments;
create policy approval_attachments_select on public.approval_attachments
  for select using (
    tenant_id = app.tenant_id()
    and app.user_role() <> 'expert'
    and exists (select 1 from public.approvals a where a.id = approval_id)
  );
drop policy if exists approval_attachments_insert on public.approval_attachments;
create policy approval_attachments_insert on public.approval_attachments
  for insert with check (
    tenant_id = app.tenant_id()
    and app.user_role() <> 'expert'
    and created_by = auth.uid()
    and exists (select 1 from public.approvals a where a.id = approval_id)
  );

comment on table public.approval_attachments is
  '품의 첨부 — 발주처 회신·내부 검토 의견 등을 결재 문서에 붙인다 (기획 2026-11-07)';

-- ---- 3) 계획 ↔ 후보 리스트 -------------------------------------------------------------
alter table public.engagement_plans
  add column if not exists candidate_list_id uuid references public.candidate_lists (id) on delete set null;

comment on column public.engagement_plans.candidate_list_id is
  '이 품의가 올라온 섭외 후보 리스트 (기획 2026-11-07). null = 리스트 없이 올린 종전 방식';
