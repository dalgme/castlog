-- ============================================================================
-- 종료 품의 — 세션·전문가별 증빙 첨부 (기획 확정 2026-08-30)
--
-- "프로젝트 종료 및 지급 품의" 안에서 각 세션×전문가(참여 건) 단위로 파일
-- 1개를 선택 첨부한다 (결과보고서·강의확인서 등 지급 증빙). 필수가 아니다.
--
-- 왜 신설 테이블인가: project_engagement_attachments는 purpose/scope CHECK가
-- 섭외·수락서 용도에 묶여 있고 수락서 복사 로직이 그 테이블 전체를 훑는다 —
-- 값을 끼워 넣으면 제약 3개 재작성 + 소비자 회귀가 따라온다. 이 프로젝트는
-- 도메인별 첨부 테이블 + 단일 버킷(expert-documents) 패턴을 쓴다.
--
-- 파일 1개 규칙은 engagement_id 유니크 인덱스로 강제한다.
-- 멱등: create if not exists / drop-and-create.
-- ============================================================================

create table if not exists public.settlement_line_attachments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  engagement_id uuid not null references public.expert_engagements (id) on delete cascade,
  file_name text not null,
  storage_path text not null,
  mime_type text,
  file_size_bytes bigint,
  uploaded_by uuid references public.users (id) on delete set null,
  is_practice boolean not null default false,
  created_at timestamptz not null default now()
);

-- 참여 건당 파일 1개 (기획 확정 — 교체는 삭제 후 재업로드)
create unique index if not exists settlement_line_attachments_engagement_uidx
  on public.settlement_line_attachments (engagement_id);
create index if not exists settlement_line_attachments_project_idx
  on public.settlement_line_attachments (project_id);

alter table public.settlement_line_attachments enable row level security;

-- 열람: 자사 직원(전문가 세션 제외 — 내부 증빙이다)
drop policy if exists settlement_line_attachments_select on public.settlement_line_attachments;
create policy settlement_line_attachments_select on public.settlement_line_attachments
  for select using (
    tenant_id = app.tenant_id() and app.user_role() <> 'expert'
  );

-- 등록·삭제: 만족도 입력과 같은 축 (expertRecord — 기본 레벨 4, 회사 조정 반영)
drop policy if exists settlement_line_attachments_insert on public.settlement_line_attachments;
create policy settlement_line_attachments_insert on public.settlement_line_attachments
  for insert with check (
    tenant_id = app.tenant_id() and app.can_exec('expertRecord')
  );
drop policy if exists settlement_line_attachments_update on public.settlement_line_attachments;
create policy settlement_line_attachments_update on public.settlement_line_attachments
  for update using (
    tenant_id = app.tenant_id() and app.can_exec('expertRecord')
  )
  with check (
    tenant_id = app.tenant_id() and app.can_exec('expertRecord')
  );
drop policy if exists settlement_line_attachments_delete on public.settlement_line_attachments;
create policy settlement_line_attachments_delete on public.settlement_line_attachments
  for delete using (
    tenant_id = app.tenant_id() and app.can_exec('expertRecord')
  );

-- 연습모드 격리 — 자매 첨부 테이블들과 동일한 restrictive 정책 (리뷰 C-5)
drop policy if exists settlement_line_attachments_practice on public.settlement_line_attachments;
create policy settlement_line_attachments_practice on public.settlement_line_attachments
  as restrictive for select using (is_practice = app.is_practice());

comment on table public.settlement_line_attachments is
  '종료 품의 증빙 — 참여 건(전문가×세션)당 파일 1개, 선택 (기획 2026-08-30)';
