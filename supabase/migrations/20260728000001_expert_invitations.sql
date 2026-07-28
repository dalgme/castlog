-- ============================================================================
-- 단계 6: 전문가 소유 신원 모델 — 등록 요청(expert_invitations)
--
-- 흐름 (설계문서 3.2):
--   기업이 등록 요청 생성 → /j/{token} 링크 발급 → 전문가가 휴대폰 인증 후
--   본인 소유 계정(experts) 생성 + 해당 기업과 연결(expert_tenant_links, active)
--
-- 보안:
--   * 원문 토큰은 저장하지 않는다 — SHA-256 해시만 보관 (DB 유출 시 링크 재구성 불가)
--   * 공개 페이지의 토큰 검증·등록 처리는 서버(service_role) 전용 — anon 정책 없음
-- ============================================================================

create table public.expert_invitations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  token_hash text not null unique,
  invited_name text,
  invited_phone text, -- E.164. 있으면 인증 휴대폰과 일치해야 등록 완료 가능
  status text not null default 'pending'
    check (status in ('pending', 'completed', 'expired', 'revoked')),
  expires_at timestamptz not null,
  completed_expert_id uuid references public.experts (id) on delete set null,
  completed_at timestamptz,
  created_by uuid, -- 요청 생성 직원 (users.id)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index expert_invitations_tenant_idx
  on public.expert_invitations (tenant_id, created_at desc);

create trigger set_updated_at before update on public.expert_invitations
  for each row execute function app.set_updated_at();

alter table public.expert_invitations enable row level security;

-- 기업: 자사 요청 조회 (전 직원) / 생성·회수는 관리자 이상
create policy expert_invitations_select on public.expert_invitations
  for select using (tenant_id = app.tenant_id());

create policy expert_invitations_insert on public.expert_invitations
  for insert with check (
    tenant_id = app.tenant_id()
    and app.user_role() in ('org_admin', 'manager')
  );

create policy expert_invitations_update on public.expert_invitations
  for update using (
    tenant_id = app.tenant_id()
    and app.user_role() in ('org_admin', 'manager')
  )
  with check (
    tenant_id = app.tenant_id()
    and app.user_role() in ('org_admin', 'manager')
  );

-- ----------------------------------------------------------------------------
-- 전문가 포털: 연결(pending·active)된 기업의 기본 정보 조회 허용
-- (전문가는 자신이 어느 기업과 연결됐는지 볼 수 있어야 한다 — 설계문서 3.2)
-- ----------------------------------------------------------------------------
create policy tenants_select_linked_expert on public.tenants
  for select using (
    exists (
      select 1 from public.expert_tenant_links l
      where l.tenant_id = tenants.id
        and l.status in ('pending', 'active')
        and app.is_expert_self(l.expert_id)
    )
  );
