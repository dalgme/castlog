-- ============================================================================
-- 전문가 목록 개선 — 평가(점수·등급) 변경 로그 + 회사 메모 스레드
-- (기획 확정 2026-08-23)
--
--  * expert_rating_logs — 자사 평점(expert_tenant_profiles.rating)·등급
--    (expert_tenant_tags.tag) 변경을 건별로 기록한다. 누가 언제 어떤 값으로
--    바꿨는지가 남아야 '회사의 주관적 기록'을 나중에 신뢰할 수 있다.
--  * expert_tenant_notes — 전문가별 회사 내부 메모(댓글식 스레드).
--    수정·삭제 없이 쌓기만 한다 — 기록 성격 (CLAUDE.md 14-4).
--  * 둘 다 테넌트 격리 + 전문가 본인 비노출 (§4 — 평가·메모는 테넌트 격리).
-- ============================================================================

create table if not exists public.expert_rating_logs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  expert_id uuid not null references public.experts (id) on delete cascade,
  kind text not null check (kind in ('rating', 'grade')),
  value text not null,          -- 점수(1~10) 또는 등급 표기. '해제'도 값이다
  note text,                    -- 변경 사유(선택)
  created_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists expert_rating_logs_expert_idx
  on public.expert_rating_logs (tenant_id, expert_id, created_at desc);

alter table public.expert_rating_logs enable row level security;

drop policy if exists expert_rating_logs_select on public.expert_rating_logs;
create policy expert_rating_logs_select on public.expert_rating_logs
  for select using (
    tenant_id = app.tenant_id() and app.user_role() <> 'expert'
  );

drop policy if exists expert_rating_logs_insert on public.expert_rating_logs;
create policy expert_rating_logs_insert on public.expert_rating_logs
  for insert with check (
    tenant_id = app.tenant_id()
    and app.user_role() in ('org_admin', 'manager')
  );

create table if not exists public.expert_tenant_notes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  expert_id uuid not null references public.experts (id) on delete cascade,
  body text not null,
  created_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists expert_tenant_notes_expert_idx
  on public.expert_tenant_notes (tenant_id, expert_id, created_at desc);

alter table public.expert_tenant_notes enable row level security;

drop policy if exists expert_tenant_notes_select on public.expert_tenant_notes;
create policy expert_tenant_notes_select on public.expert_tenant_notes
  for select using (
    tenant_id = app.tenant_id() and app.user_role() <> 'expert'
  );

drop policy if exists expert_tenant_notes_insert on public.expert_tenant_notes;
create policy expert_tenant_notes_insert on public.expert_tenant_notes
  for insert with check (
    tenant_id = app.tenant_id()
    and app.user_role() in ('org_admin', 'manager')
  );

comment on table public.expert_rating_logs is
  '자사 평점·등급 변경 로그 (테넌트 격리 · 전문가 비노출)';
comment on table public.expert_tenant_notes is
  '전문가별 회사 내부 메모 스레드 — 추가 전용 (테넌트 격리 · 전문가 비노출)';
