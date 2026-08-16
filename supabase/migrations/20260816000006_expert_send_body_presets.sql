-- ============================================================================
-- 외부 송신 이메일 본문 사용자 프리셋
-- 설계: docs/decisions/expert-utility-features.md §A (본문 저장 옵션)
--
--  * 전역 테이블(전문가 소유, RLS 본인). 기본 프리셋(본문 1·2·3)은 코드 상수이고,
--    전문가가 수정한 본문을 '사용자 옵션'으로 저장하면 여기에 쌓인다.
-- ============================================================================
create table if not exists public.expert_send_body_presets (
  id uuid primary key default gen_random_uuid(),
  expert_id uuid not null references public.experts(id) on delete cascade,
  label text not null,
  body text not null,
  created_at timestamptz not null default now()
);

create index if not exists expert_send_body_presets_expert_idx
  on public.expert_send_body_presets (expert_id, created_at desc);

alter table public.expert_send_body_presets enable row level security;

create policy expert_send_body_presets_self_select on public.expert_send_body_presets
  for select using (app.is_expert_self(expert_id));
create policy expert_send_body_presets_self_insert on public.expert_send_body_presets
  for insert with check (app.is_expert_self(expert_id));
create policy expert_send_body_presets_self_delete on public.expert_send_body_presets
  for delete using (app.is_expert_self(expert_id));
