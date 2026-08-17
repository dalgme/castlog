-- ============================================================================
-- Phase A-3: 수락서 수정 → 송부 → 전문가 확인·서명 → 기업담당자 확인
-- 근거: 사용자 요청 워크플로우 + 제공 수락서 양식
--
--  * 기존 수락서는 수락 즉시 생성되는 불변 스냅샷이었다. 여기에 기업이 보완하는
--    안내 정보(상세 설명·찾아오는길 이미지·첨부파일)와 진행 상태를 추가한다.
--  * 수락 조건 스냅샷(역할·비용·일정 등)은 계속 불변으로 둔다 — 보완 필드만 편집 가능.
--  * 첨부·약도 이미지는 암호화 버킷(expert-documents)에 저장하고 서명 URL로만 열람.
-- ============================================================================
alter table public.engagement_acceptances
  add column if not exists status text not null default 'issued',
  add column if not exists guide_note text,          -- 상세 설명(기업 보완)
  add column if not exists map_image_path text,      -- 찾아오는 길 이미지
  add column if not exists sent_at timestamptz,      -- 기업 → 전문가 송부
  add column if not exists signed_at timestamptz,    -- 전문가 확인·전자서명
  add column if not exists confirmed_at timestamptz, -- 기업담당자 최종 확인
  add column if not exists confirmed_by uuid;

alter table public.engagement_acceptances
  drop constraint if exists engagement_acceptances_status_check;
alter table public.engagement_acceptances
  add constraint engagement_acceptances_status_check
  check (status in ('issued', 'sent', 'signed', 'confirmed'));

-- 첨부파일 (수락서에 동봉) -----------------------------------------------------
create table if not exists public.engagement_acceptance_attachments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  acceptance_id uuid not null
    references public.engagement_acceptances(id) on delete cascade,
  file_name text not null,
  storage_path text not null,
  mime_type text,
  file_size_bytes bigint,
  uploaded_by uuid,
  created_at timestamptz not null default now()
);
create index if not exists engagement_acceptance_attachments_idx
  on public.engagement_acceptance_attachments (acceptance_id, created_at);

alter table public.engagement_acceptance_attachments enable row level security;

-- 자사 직원은 조회, 관리자 이상만 추가·삭제. 전문가 열람은 서버(service_role) 경유.
create policy acceptance_attachments_select on public.engagement_acceptance_attachments
  for select using (tenant_id = app.tenant_id());
create policy acceptance_attachments_insert on public.engagement_acceptance_attachments
  for insert with check (
    tenant_id = app.tenant_id() and app.user_role() in ('org_admin', 'manager')
  );
create policy acceptance_attachments_delete on public.engagement_acceptance_attachments
  for delete using (
    tenant_id = app.tenant_id() and app.user_role() in ('org_admin', 'manager')
  );

-- 기업 측 수락서 보완 편집 허용 (조건 스냅샷 컬럼은 애플리케이션에서 갱신하지 않는다)
drop policy if exists engagement_acceptances_update on public.engagement_acceptances;
create policy engagement_acceptances_update on public.engagement_acceptances
  for update using (
    tenant_id = app.tenant_id() and app.user_role() in ('org_admin', 'manager')
  )
  with check (
    tenant_id = app.tenant_id() and app.user_role() in ('org_admin', 'manager')
  );
