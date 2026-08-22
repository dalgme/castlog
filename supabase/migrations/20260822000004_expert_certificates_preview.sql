-- ============================================================================
-- 자격증 사본 다건 업로드 + 서류 형식 확장 (기획 확정 2026-08-22)
--
-- 1) expert_documents.document_type에 'certificate'(자격증 사본) 추가.
--    자격증은 표준 슬롯(유형당 1건 교체)과 달리 여러 건을 동시에 보유한다.
-- 2) expert_certificates: 자격증 사본별 정보 (자격증명·급수 / 발급일 /
--    발급기관 / 기타 — 전문가 본인이 직접 작성). 파일은 expert_documents 행을
--    참조하고, 파일 교체 시 document_id만 새 행으로 바뀐다.
-- 3) expert_document_grants.document_type check를 문서 유형과 정렬
--    (certificate 추가 + 기존에 빠져 있던 seal·attachment 정합 — 잠재 결함 보정).
-- 4) 스토리지 버킷 허용 MIME 확장: 오피스(doc/docx/xls/xlsx/ppt/pptx)·
--    한글(hwp/hwpx) 첨부 허용. 앱 서버가 확장자↔MIME을 검증하고 정규 MIME으로
--    저장하므로 버킷 목록은 정규 MIME만 둔다 (lib/experts/documents.ts).
--
-- 추가 전용·멱등 (docs/ops/release-playbook.md §3).
-- ============================================================================

-- 1) 문서 유형 확장
alter table public.expert_documents
  drop constraint if exists expert_documents_document_type_check;

alter table public.expert_documents
  add constraint expert_documents_document_type_check
  check (document_type in (
    'resume',
    'bank_account_copy',
    'id_card_copy',
    'business_card',
    'business_registration',
    'signature',
    'seal',
    'attachment',
    'certificate'          -- 자격증 사본 (다건)
  ));

-- 3) grants 유형 정렬 (문서 check의 부분집합 유지가 깨져 있던 것 보정)
alter table public.expert_document_grants
  drop constraint if exists expert_document_grants_document_type_check;

alter table public.expert_document_grants
  add constraint expert_document_grants_document_type_check
  check (document_type in (
    'resume', 'bank_account_copy', 'id_card_copy',
    'business_card', 'business_registration', 'signature',
    'seal', 'attachment', 'certificate'
  ));

-- 2) 자격증 사본별 정보
create table if not exists public.expert_certificates (
  id uuid primary key default gen_random_uuid(),
  expert_id uuid not null references public.experts (id) on delete cascade,
  document_id uuid not null references public.expert_documents (id) on delete cascade,
  cert_name text,  -- 자격증명 및 급수
  issued_on text,  -- 발급일 (자유 표기)
  issuer text,     -- 발급기관
  note text,       -- 기타
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists expert_certificates_expert_idx
  on public.expert_certificates (expert_id, created_at);

alter table public.expert_certificates enable row level security;

-- 열람: 본인 + (자격증 열람을 허용받은) 연결 기업 + 플랫폼관리자
drop policy if exists expert_certificates_select on public.expert_certificates;
create policy expert_certificates_select on public.expert_certificates
  for select using (
    app.is_expert_self(expert_id)
    or app.tenant_can_view_document(expert_id, 'certificate')
    or app.is_platform_admin()
  );

-- 작성·수정·삭제: 서류 소유자인 전문가 본인만
drop policy if exists expert_certificates_write on public.expert_certificates;
create policy expert_certificates_write on public.expert_certificates
  for all using (app.is_expert_self(expert_id))
  with check (app.is_expert_self(expert_id));

do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgname = 'set_updated_at' and tgrelid = 'public.expert_certificates'::regclass
  ) then
    create trigger set_updated_at before update on public.expert_certificates
      for each row execute function app.set_updated_at();
  end if;
end $$;

-- 4) 버킷 허용 MIME 확장 (파일 크기 상한 10MB는 유지)
update storage.buckets
set allowed_mime_types = array[
  'application/pdf',
  'image/jpeg',
  'image/png',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/x-hwp',
  'application/hwp+zip'
]
where id = 'expert-documents';
