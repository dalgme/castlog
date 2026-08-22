-- ============================================================================
-- 섭외 후보 순위 모델 (기획 확정 2026-08-22)
--
-- 코드넘버(engagement_slot_positions)의 의미가 '확정 자리'에서 **임시후보**로
-- 바뀐다: 세션당 기본 후보 3명(필요시 추가), 후보별 섭외 순위(rank)와
-- 개별 예정가(expected_fee)를 기록한다. 세션의 1인 비용(fee_amount)은
-- 입력을 없애고 레거시 폴백으로만 남긴다.
--
-- 결재권자는 결재 화면에서 순위 변경·후보 삭제·금액 수정을 할 수 있고,
-- 그 변경은 plan_review_changes에 결재권자별로 기록되어 담당자가 본다.
--
-- 추가 전용·멱등 (docs/ops/release-playbook.md §3).
-- ============================================================================

-- 1) 후보 순위·개별 예정가
alter table public.engagement_slot_positions
  add column if not exists rank int,
  add column if not exists expected_fee bigint check (expected_fee is null or expected_fee >= 0);

comment on column public.engagement_slot_positions.rank is
  '세션 내 섭외 순위 (1=최우선). 드래그로 조정.';
comment on column public.engagement_slot_positions.expected_fee is
  '후보별 예정가(원). 없으면 세션 fee_amount 폴백(레거시).';

-- 기존 행 백필: 순번을 순위로
update public.engagement_slot_positions set rank = position_no where rank is null;

-- 2) 결재권자 변경 내역
create table if not exists public.plan_review_changes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  approval_id uuid not null references public.approvals (id) on delete cascade,
  actor_user_id uuid not null references public.users (id) on delete restrict,
  change_kind text not null check (change_kind in ('reorder', 'remove', 'fee')),
  position_code text,
  expert_name text,
  before_text text,
  after_text text,
  created_at timestamptz not null default now()
);

create index if not exists plan_review_changes_approval_idx
  on public.plan_review_changes (approval_id, created_at);

alter table public.plan_review_changes enable row level security;

-- 열람: 자사 전원(담당자가 봐야 한다). 기록: 본인 행위만.
drop policy if exists plan_review_changes_select on public.plan_review_changes;
create policy plan_review_changes_select on public.plan_review_changes
  for select using (
    tenant_id = app.tenant_id() and app.user_role() <> 'expert'
  );

drop policy if exists plan_review_changes_insert on public.plan_review_changes;
create policy plan_review_changes_insert on public.plan_review_changes
  for insert with check (
    tenant_id = app.tenant_id() and actor_user_id = auth.uid()
  );

-- 3) 전문가 프로필 확장 (기획 확정 2026-08-22 — 최종학위 선택형 + 전공)
alter table public.experts
  add column if not exists degree_level text,
  add column if not exists degree_major text;

comment on column public.experts.degree_level is '최종학위 (학사/석사 수료/석사/박사 수료/박사/기타)';
comment on column public.experts.degree_major is '전공명';
