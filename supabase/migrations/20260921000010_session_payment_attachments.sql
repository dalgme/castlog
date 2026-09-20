-- 지급 품의 탭 · 세션별 파일 첨부 (기획 지시 2026-09-21)
--
-- '지급 품의 대상 세션' 표의 세션마다 '파일 첨부' 버튼 → 팝업에서 드래그로 여러 파일을
-- 한 번에 올린다 (결과보고서·강의확인서·사진 등 지급 증빙). 세션당 여러 파일.
-- 종전 참여 건(전문가×세션)당 1파일 표(settlement_line_attachments)는 그대로 두고,
-- 세션 단위 다중 첨부는 별도 표로 둔다 (도메인별 첨부 표 + 단일 버킷 expert-documents 패턴).
-- 멱등: create if not exists / drop-and-create. 코드는 표 부재(42P01)를 안내 문구로 폴백한다.

create table if not exists public.session_payment_attachments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  slot_id uuid not null references public.engagement_slots (id) on delete cascade,
  file_name text not null,
  storage_path text not null,
  mime_type text,
  file_size_bytes bigint,
  uploaded_by uuid references public.users (id) on delete set null,
  is_practice boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists session_payment_attachments_slot_idx
  on public.session_payment_attachments (slot_id, created_at);
create index if not exists session_payment_attachments_project_idx
  on public.session_payment_attachments (tenant_id, project_id);

alter table public.session_payment_attachments enable row level security;

-- 열람: 자사 직원 중 그 프로젝트를 볼 수 있는 사람 (전문가 세션 제외 — 내부 증빙)
drop policy if exists session_payment_attachments_select on public.session_payment_attachments;
create policy session_payment_attachments_select on public.session_payment_attachments
  for select using (
    tenant_id = app.tenant_id()
    and app.user_role() <> 'expert'
    and app.can_view_project(project_id)
  );

-- 등록·삭제: 프로젝트 팀(대표·이사 전원, 배정된 팀원, 개설자) — 지급 품의 상신 주체와 같은 범위
drop policy if exists session_payment_attachments_insert on public.session_payment_attachments;
create policy session_payment_attachments_insert on public.session_payment_attachments
  for insert with check (
    tenant_id = app.tenant_id() and app.is_project_team(project_id)
  );
drop policy if exists session_payment_attachments_delete on public.session_payment_attachments;
create policy session_payment_attachments_delete on public.session_payment_attachments
  for delete using (
    tenant_id = app.tenant_id() and app.is_project_team(project_id)
  );

-- 연습모드 격리 — 자매 첨부 표들과 동일한 restrictive 정책
drop policy if exists session_payment_attachments_practice on public.session_payment_attachments;
create policy session_payment_attachments_practice on public.session_payment_attachments
  as restrictive for select using (is_practice = app.is_practice());

comment on table public.session_payment_attachments is
  '지급 품의 세션별 첨부 — 세션당 여러 파일, 드래그 일괄 업로드 (기획 2026-09-21)';
