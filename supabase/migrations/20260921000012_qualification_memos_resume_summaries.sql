-- 섭외 프로세스 고도화 1단계 (기획 승인 2026-11-07 — docs/decisions/engagement-review-flow.md)
--
-- 1) expert_qualification_memos — 후보별 자격메모 (07·08). 테넌트 격리, 전문가 본인 비노출.
--    프로젝트를 넘어 전문가별로 누적 → '자격메모 이력 보기'.
-- 2) expert_resume_summaries — AI 이력 요약 (08·09). 전문가 소유 전역 표, 이력서 문서 1건당 1요약.
--    쓰기는 서버(service_role)만. 열람은 이력서 열람 규칙과 같다.
-- 3) 이력서 열람 기준 개정 (06): 이력서(resume)는 섭외 목적의 열람을 자사 임직원(전문가 role 제외)
--    누구에게나 허가한다 — 후보 검색·리스트 작성·품의 결재. 통장사본·신분증·서명은 종전 게이트 그대로.
--    모든 열람은 종전처럼 expert_document.view 감사로그(앱) + 전문가 본인 열람 이력 공개.
-- 멱등: create if not exists / drop-and-create. 코드는 표 부재(42P01·PGRST205)를 폴백한다.

-- ---- 1) 자격메모 ----------------------------------------------------------------
create table if not exists public.expert_qualification_memos (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  expert_id uuid not null references public.experts (id) on delete cascade,
  -- 어느 프로젝트의 후보 리스트를 쓰며 남긴 메모인지 (프로젝트가 지워져도 메모는 남긴다)
  project_id uuid references public.projects (id) on delete set null,
  position_id uuid references public.engagement_slot_positions (id) on delete set null,
  body text not null check (length(body) between 1 and 500),
  created_by uuid references public.users (id) on delete set null,
  is_practice boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists expert_qualification_memos_expert_idx
  on public.expert_qualification_memos (tenant_id, expert_id, created_at desc);
create index if not exists expert_qualification_memos_project_idx
  on public.expert_qualification_memos (tenant_id, project_id);

alter table public.expert_qualification_memos enable row level security;

drop policy if exists expert_qualification_memos_select on public.expert_qualification_memos;
create policy expert_qualification_memos_select on public.expert_qualification_memos
  for select using (
    tenant_id = app.tenant_id()
    and app.user_role() <> 'expert'
  );

drop policy if exists expert_qualification_memos_insert on public.expert_qualification_memos;
create policy expert_qualification_memos_insert on public.expert_qualification_memos
  for insert with check (
    tenant_id = app.tenant_id()
    and app.user_role() <> 'expert'
    and created_by = auth.uid()
  );

-- 이력은 지우지 않는다(§14-4). 잘못 쓴 메모는 본인이 10분 안에만 지울 수 있다.
drop policy if exists expert_qualification_memos_delete on public.expert_qualification_memos;
create policy expert_qualification_memos_delete on public.expert_qualification_memos
  for delete using (
    tenant_id = app.tenant_id()
    and created_by = auth.uid()
    and created_at > now() - interval '10 minutes'
  );

drop policy if exists expert_qualification_memos_practice on public.expert_qualification_memos;
create policy expert_qualification_memos_practice on public.expert_qualification_memos
  as restrictive for select using (is_practice = app.is_practice());

comment on table public.expert_qualification_memos is
  '섭외 후보 자격메모 — 후보별 3개 이상, 프로젝트를 넘어 전문가별 누적. 테넌트 격리·전문가 비노출 (기획 2026-11-07)';

-- ---- 2) AI 이력 요약 --------------------------------------------------------------
create table if not exists public.expert_resume_summaries (
  id uuid primary key default gen_random_uuid(),
  expert_id uuid not null references public.experts (id) on delete cascade,
  document_id uuid not null references public.expert_documents (id) on delete cascade,
  status text not null check (status in ('ready', 'failed', 'unsupported')),
  summary text,
  model text,
  prompt_version text,
  -- pdf / image / docx / hwp / hwpx / text
  source_kind text,
  error_note text,
  generated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (document_id)
);

create index if not exists expert_resume_summaries_expert_idx
  on public.expert_resume_summaries (expert_id);

alter table public.expert_resume_summaries enable row level security;

-- 열람: 전문가 본인 또는 자사 임직원(전문가 role 제외) — 이력서 열람 규칙(아래 3)과 같다
drop policy if exists expert_resume_summaries_select on public.expert_resume_summaries;
create policy expert_resume_summaries_select on public.expert_resume_summaries
  for select using (
    app.is_expert_self(expert_id)
    or (app.tenant_id() is not null and app.user_role() <> 'expert')
  );
-- 쓰기 정책 없음 — 생성·갱신은 서버(service_role)만

comment on table public.expert_resume_summaries is
  'AI 이력 요약 — 이력서 문서 1건당 1요약, 서버 전용 생성. 설명용이며 섭외 결정·비용 판정에 쓰지 않는다 (§14-1, 기획 2026-11-07)';

-- ---- 3) 이력서 열람 기준 개정 ---------------------------------------------------------
drop policy if exists expert_documents_select on public.expert_documents;
create policy expert_documents_select on public.expert_documents
  for select using (
    app.is_expert_self(expert_id)
    or app.tenant_can_view_document(expert_id, document_type)
    -- 자기 회사가 제공한 파일은 전문가 허용 없이도 열람 (타사에는 미공개).
    -- 단, 관계가 해제되면 함께 닫힌다 — 다른 열람 규칙과 같은 기준.
    or (uploaded_by_tenant_id is not null
        and uploaded_by_tenant_id = app.tenant_id()
        and exists (
          select 1 from public.expert_tenant_links l
          where l.expert_id = expert_documents.expert_id
            and l.tenant_id = app.tenant_id()
            and l.status = 'active'
        ))
    -- 개정 2026-11-07 (06): 이력서는 섭외 목적의 열람을 자사 임직원 누구에게나 허가한다.
    -- 등록 전문가는 "여러 기업이 나를 찾아 섭외한다"는 기대로 등록하므로 이력서 열람은
    -- 잠재적 멘토의 이익에 부합한다 (§4 전문가 풀 전면 공개와 같은 논리). 활성 문서만.
    or (document_type = 'resume'
        and status = 'active'
        and app.tenant_id() is not null
        and app.user_role() <> 'expert')
  );

comment on policy expert_documents_select on public.expert_documents is
  '전문가 본인 / 허용(grants) 기업 / 자사 업로드 파일 / 이력서는 자사 임직원 누구나(섭외 목적, 기획 2026-11-07)';
