-- ============================================================================
-- 묶음 섭외 (기획 확정 2026-08-30 — 20번)
--
-- 한 프로젝트에서 여러 세션에 참여하는 전문가에게는 섭외 요청 문자를 1건만
-- 보내고, 승인 URL 1개(/b/{token})에 각 섭외 건이 리스트업되어 건별로
-- 수락/거절을 고른 뒤 한 번에 회신한다.
--
-- 왜 신설 테이블인가: 섭외 건(expert_engagements)은 세션·자리 단위 계약의
-- 원본이라 그대로 둔다(건별 토큰·상태·수락서 전부 유지). 묶음은 그 위의
-- '발송·응답 단위'일 뿐이므로 전용 연결 테이블로 표현한다 — 도메인 테이블
-- 직접 오염 금지(CLAUDE.md 1-2-6)와 같은 원칙.
--
-- 멱등: create if not exists / drop-and-create. 추가 전용("SQL 먼저").
-- ============================================================================

create table if not exists public.engagement_bundles (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  project_id uuid references public.projects (id) on delete cascade,
  expert_id uuid not null references public.experts (id) on delete cascade,
  -- 원문 토큰은 저장하지 않는다 — 해시만 (기존 섭외 토큰과 같은 규칙)
  token_hash text not null,
  token_expires_at timestamptz not null,
  -- requested → responded(전 건 응답 완료) / canceled / expired
  status text not null default 'requested',
  is_practice boolean not null default false,
  created_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  constraint engagement_bundles_status_check
    check (status in ('requested', 'responded', 'canceled', 'expired'))
);

create unique index if not exists engagement_bundles_token_hash_uidx
  on public.engagement_bundles (token_hash);
create index if not exists engagement_bundles_project_idx
  on public.engagement_bundles (project_id);
create index if not exists engagement_bundles_expert_idx
  on public.engagement_bundles (expert_id);

alter table public.engagement_bundles enable row level security;

-- 열람: 자사 직원(전문가 세션 제외 — 공개 /b 접근은 service_role 전용이다)
drop policy if exists engagement_bundles_select on public.engagement_bundles;
create policy engagement_bundles_select on public.engagement_bundles
  for select using (
    tenant_id = app.tenant_id() and app.user_role() <> 'expert'
  );

-- 생성: 섭외요청 실행권과 같은 축 (일괄 발송에서 만들어진다)
drop policy if exists engagement_bundles_insert on public.engagement_bundles;
create policy engagement_bundles_insert on public.engagement_bundles
  for insert with check (
    tenant_id = app.tenant_id() and app.can_exec('engagementRequest')
  );

-- 상태 전환(responded/expired)은 service_role 경로에서만 일어난다 —
-- 직원용 update 정책은 두지 않는다.

-- 연습모드 격리 — 자매 테이블들과 동일한 restrictive 정책
drop policy if exists engagement_bundles_practice on public.engagement_bundles;
create policy engagement_bundles_practice on public.engagement_bundles
  as restrictive for select using (is_practice = app.is_practice());

comment on table public.engagement_bundles is
  '묶음 섭외 — 같은 프로젝트에서 한 전문가에게 가는 여러 섭외 건을 문자 1건·승인 URL 1개로 묶는 발송·응답 단위 (기획 확정 2026-08-30). 건별 계약 원본은 expert_engagements 그대로.';

-- 섭외 건 → 소속 묶음 (없으면 단건 발송)
alter table public.expert_engagements
  add column if not exists bundle_id uuid references public.engagement_bundles (id) on delete set null;
create index if not exists expert_engagements_bundle_idx
  on public.expert_engagements (bundle_id);

comment on column public.expert_engagements.bundle_id is
  '묶음 섭외 소속 (nullable — 단건 발송이면 없음). 건별 토큰·상태는 묶음과 무관하게 유지된다.';
