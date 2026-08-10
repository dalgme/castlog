-- ============================================================================
-- 단계 28-B: 섭외수락서 자동 서명·발송 (대표 피드백 ②, 비-AI)
--
-- 설계:
--  * 전문가가 섭외를 수락(계약 성립)하는 순간, 등록된 서명·날인을 스냅샷하여
--    섭외수락서를 자동 생성한다. 수락 시점의 서명이 법적 스냅샷 — 이후 전문가가
--    서명을 교체해도 이 수락서의 서명은 불변.
--  * 수락 조건(역할·비용·기간·프로젝트)도 스냅샷 컬럼으로 정규화 저장
--    (JSON 블롭 금지 — CLAUDE.md 8).
--  * 서명 이미지는 암호화 버킷의 별도 경로에 스냅샷 복사(expert-documents/acceptances/…),
--    열람은 서명된 만료 URL로만 (공개 URL 금지).
--  * 생성은 service_role(수락 처리 훅)만 — 클라이언트 INSERT 정책 없음.
--  * 열람: 자사 테넌트 + 전문가 본인(전 기업 통합 이력).
-- ============================================================================

create table public.engagement_acceptances (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  engagement_id uuid not null unique
    references public.expert_engagements (id) on delete cascade,
  expert_id uuid not null references public.experts (id) on delete cascade,
  letter_no text not null,               -- 사람이 읽는 문서번호
  -- 수락 조건 스냅샷 (정규화)
  role_description text not null,
  fee_amount bigint check (fee_amount is null or fee_amount >= 0),
  starts_on date,
  ends_on date,
  project_name text,
  tenant_name text not null,
  expert_name text not null,
  -- 서명·날인 스냅샷 (버킷 경로 — 공개 URL 금지)
  signature_path text,
  seal_path text,
  has_signature boolean not null default false,
  signed_via text not null check (signed_via in ('public_link', 'portal')),
  signer_ip text,
  accepted_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index engagement_acceptances_tenant_idx
  on public.engagement_acceptances (tenant_id, accepted_at desc);
create index engagement_acceptances_expert_idx
  on public.engagement_acceptances (expert_id, accepted_at desc);

-- ============================================================================
-- RLS — 자사 테넌트 + 전문가 본인 열람. 생성·수정은 service_role 전용(정책 없음).
-- ============================================================================
alter table public.engagement_acceptances enable row level security;

create policy engagement_acceptances_select on public.engagement_acceptances
  for select using (
    tenant_id = app.tenant_id()
    or app.is_expert_self(expert_id)
  );
