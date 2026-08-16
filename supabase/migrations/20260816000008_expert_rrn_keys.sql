-- ============================================================================
-- 주민등록번호 봉투 암호 — 전문가 보유 키 모델 (재래핑 설계 §2.1)
-- 설계: docs/decisions/rrn-rewrap-key-custody.md (권장안 B 승인)
--
--  * 수집은 계약 이전에 일어나므로 '서비스 키'가 아니라 **전문가 본인 키페어**로
--    봉투를 암호화한다. 개인키는 전문가의 '보관 비밀번호(passphrase)'에서 유도한
--    키(Argon2id)로 래핑해 저장한다. passphrase는 어디에도 저장하지 않는다.
--  * 전역 테이블(전문가 소유, RLS 본인). 공개키/래핑된 개인키는 전문가만 접근.
--    플랫폼은 개인키를 풀 수단(=passphrase)이 없으므로 마스터키가 존재하지 않는다(§11-4).
--  * 재래핑(섭외 승인 시): 전문가 브라우저에서 passphrase로 개인키 언래핑 → DEK만
--    풀어 테넌트 키로 다시 래핑(tax_project_grants). 평문 주민번호는 관여하지 않음.
-- ============================================================================
create table if not exists public.expert_rrn_keys (
  expert_id uuid primary key references public.experts(id) on delete cascade,
  public_key_jwk jsonb not null,          -- 봉투 암호용(비밀 아님)
  wrapped_private_key text not null,       -- passphrase 유도키로 래핑된 개인키
  kdf_salt text not null,
  kdf_params jsonb not null,
  wrap_iv text not null,
  alg text not null default 'RSA-OAEP-256/AES-256-GCM/argon2id',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger set_updated_at before update on public.expert_rrn_keys
  for each row execute function app.set_updated_at();

alter table public.expert_rrn_keys enable row level security;

-- 본인만 조회·생성. 회전(교체)은 기존 봉투 무효화를 수반하므로 delete 후 재생성으로만.
create policy expert_rrn_keys_self_select on public.expert_rrn_keys
  for select using (app.is_expert_self(expert_id));
create policy expert_rrn_keys_self_insert on public.expert_rrn_keys
  for insert with check (app.is_expert_self(expert_id));
create policy expert_rrn_keys_self_delete on public.expert_rrn_keys
  for delete using (app.is_expert_self(expert_id));
