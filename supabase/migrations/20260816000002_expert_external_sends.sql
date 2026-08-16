-- ============================================================================
-- 외부 송신 (전문가 → 캐스트로그 비가입 기업/기관 담당자 이메일)
-- 설계: docs/decisions/expert-utility-features.md §A
-- 첨부가 아니라 서명된 만료 다운로드 링크로 발송(§5: 공개 URL 금지·서명 만료만).
-- 전문가 소유 데이터(RLS 본인). 수신자는 토큰 링크로 만료 전까지 다운로드.
-- ============================================================================
create table if not exists public.expert_external_sends (
  id uuid primary key default gen_random_uuid(),
  expert_id uuid not null references public.experts(id) on delete cascade,
  token_hash text not null unique,          -- 공개 다운로드 링크 토큰 해시
  recipient_email text not null,
  recipient_name text,
  document_ids uuid[] not null,             -- 발송 시점 스냅샷(정확한 파일)
  document_types text[] not null,           -- 표시용
  event_name text,                          -- 행사명
  org_name text,                            -- 의뢰기관/기업
  memo text,                                -- 기타 메모
  sent_at timestamptz not null default now(),
  expires_at timestamptz not null,
  status text not null default 'sent',      -- sent | revoked | expired
  opened_at timestamptz,                    -- 수신자 최초 열람
  created_at timestamptz not null default now()
);
create index if not exists expert_external_sends_expert_idx
  on public.expert_external_sends (expert_id, sent_at desc);

alter table public.expert_external_sends enable row level security;

-- 전문가 본인만 조회·생성·수정(회수/메모). 공개 다운로드는 service_role 경유(토큰 검증).
create policy expert_external_sends_self_select on public.expert_external_sends
  for select using (app.is_expert_self(expert_id));
create policy expert_external_sends_self_insert on public.expert_external_sends
  for insert with check (app.is_expert_self(expert_id));
create policy expert_external_sends_self_update on public.expert_external_sends
  for update using (app.is_expert_self(expert_id))
  with check (app.is_expert_self(expert_id));
