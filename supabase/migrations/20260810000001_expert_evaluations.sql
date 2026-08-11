-- ============================================================================
-- 단계 27: 전문가 평가·평판 → 지급품의 게이트 (experts ↔ approvals)
--
-- 기획 확정 (대표 피드백 ①):
--  * 프로젝트 종료 시 책임담당자가 참여 전문가별로 평가를 남긴다.
--    - 점수: 10점 만점, 필수
--    - 사유: 선택
--  * 참여 전문가 전원의 평가가 없으면 수당 지급 품의를 올릴 수 없다 (게이트는 앱 레벨 — payments).
--  * 평가는 섭외이력·평판점수에 해당 — 테넌트 격리 데이터 (설계문서 3.2 / 4장).
--    ** 전문가 본인에게 노출 금지 **, 조회하는 회사(테넌트)만 열람.
--    => is_expert_self 를 SELECT 정책에 절대 포함하지 않는다 (교차/본인 노출 금지).
--  * 평가는 삭제하지 않고 수정으로 정정한다 (CLAUDE.md 14-4). DELETE 정책 없음.
--  * 프로젝트당 전문가 1건 (unique) — 재평가는 upsert.
-- ============================================================================

create table public.expert_evaluations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  expert_id uuid not null references public.experts (id) on delete cascade,
  -- 근거 섭외 (선택 — 배정 이력 추적용, 섭외 삭제돼도 평가는 보존)
  engagement_id uuid references public.expert_engagements (id) on delete set null,
  score int not null check (score between 1 and 10), -- 10점 만점 필수
  reason text,                                        -- 평가 사유 선택
  evaluator_user_id uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, project_id, expert_id)
);

-- 평판 조회(자사 전문가 과거 평가 집계) + 프로젝트별 평가 현황
create index expert_evaluations_reputation_idx
  on public.expert_evaluations (tenant_id, expert_id, created_at desc);
create index expert_evaluations_project_idx
  on public.expert_evaluations (tenant_id, project_id);

create trigger set_updated_at before update on public.expert_evaluations
  for each row execute function app.set_updated_at();

-- ============================================================================
-- RLS — 테넌트 격리. 전문가 본인 조회 경로 없음(비공개).
-- ============================================================================
alter table public.expert_evaluations enable row level security;

-- 조회: 자사 테넌트만 (전문가 본인 SELECT 없음 — 평가 비공개)
create policy expert_evaluations_select on public.expert_evaluations
  for select using (tenant_id = app.tenant_id());

-- 작성: 책임담당자(관리자 이상)
create policy expert_evaluations_insert on public.expert_evaluations
  for insert with check (
    tenant_id = app.tenant_id()
    and app.user_role() in ('org_admin', 'manager')
  );

-- 정정: 관리자 이상 (삭제는 없음 — 상태/값 수정으로만)
create policy expert_evaluations_update on public.expert_evaluations
  for update using (
    tenant_id = app.tenant_id()
    and app.user_role() in ('org_admin', 'manager')
  )
  with check (
    tenant_id = app.tenant_id()
    and app.user_role() in ('org_admin', 'manager')
  );
