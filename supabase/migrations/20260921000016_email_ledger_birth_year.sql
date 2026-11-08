-- 이메일 대장 · 수신 상태 · 출생연도 (기획 지시 2026-11-08)
--
-- 1) email_logs 확장 — 프로젝트별 '이메일 대장'(PL이 담당자들이 보낸 메일의 발송 내용·수신 여부 확인):
--    project_id(어느 프로젝트의 메일인가) · engagement_ids(섭외 건) · purpose(섭외 요청/수락서/…) ·
--    body_html(강조 표시가 있는 실제 발송 본문) · provider_message_id(공급자 메시지 id — 웹훅 매칭) ·
--    delivery_status/delivered_at/opened_at/bounced_at/delivery_detail(공급자 웹훅으로 갱신되는 수신 상태).
-- 2) experts.birth_year — 출생연도(섭외 후보 검색·등록 화면 표기). 전문가 공개 프로필 항목(§4).
-- 멱등·추가 전용. 코드는 컬럼 부재(42703/PGRST204)를 폴백한다.

-- ---- 1) email_logs ------------------------------------------------------------------
alter table public.email_logs add column if not exists project_id uuid references public.projects (id) on delete set null;
alter table public.email_logs add column if not exists engagement_ids uuid[];
alter table public.email_logs add column if not exists purpose text;
alter table public.email_logs add column if not exists body_html text;
alter table public.email_logs add column if not exists provider text;
alter table public.email_logs add column if not exists provider_message_id text;
-- queued(공급자 접수) / delivered(수신 서버 전달) / delayed(지연) / bounced(반송) / complained(스팸 신고) / opened(열람)
alter table public.email_logs add column if not exists delivery_status text;
alter table public.email_logs add column if not exists delivered_at timestamptz;
alter table public.email_logs add column if not exists opened_at timestamptz;
alter table public.email_logs add column if not exists bounced_at timestamptz;
alter table public.email_logs add column if not exists delivery_detail text;
alter table public.email_logs add column if not exists delivery_updated_at timestamptz;

create index if not exists email_logs_project_idx on public.email_logs (project_id, created_at desc);
create index if not exists email_logs_provider_message_idx on public.email_logs (provider_message_id);

comment on column public.email_logs.project_id is '이 메일이 속한 프로젝트 — 프로젝트별 이메일 대장 (2026-11-08)';
comment on column public.email_logs.purpose is 'engagement_request / engagement_bundle / acceptance_letter / acceptance_reminder / direct_engagement / general';
comment on column public.email_logs.delivery_status is '공급자 웹훅 수신 상태 — queued/delivered/delayed/bounced/complained/opened';

-- 임직원(전문가 제외)은 자사 메일 기록을 쓸 수 있어야 한다 — 종전 정책은 org_admin·manager만 허용해
-- 담당(staff 등급)이 섭외 메일을 보내면 기록이 남지 않았다. 열람 정책(자사 전체)은 그대로.
drop policy if exists email_logs_insert on public.email_logs;
create policy email_logs_insert on public.email_logs
  for insert with check (
    tenant_id = app.tenant_id()
    and app.user_role() <> 'expert'
  );

-- ---- 2) experts.birth_year ------------------------------------------------------------
alter table public.experts
  add column if not exists birth_year smallint check (birth_year is null or (birth_year between 1900 and 2100));

comment on column public.experts.birth_year is '출생연도 (전문가 공개 프로필 — 섭외 후보 검색·등록 표기, 2026-11-08)';
