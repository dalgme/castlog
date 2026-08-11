-- ============================================================================
-- platform_inquiries — 도입 문의 · 무료 체험 신청 (플랫폼 리드)
--
--  * 테넌트 생성 이전 단계의 공개 신청서. 특정 테넌트에 귀속되지 않는
--    플랫폼 전역 테이블이므로 tenant_id 컬럼이 없다.
--  * 공개 랜딩페이지의 익명 방문자가 제출(INSERT)한다.
--  * 열람·상태변경은 플랫폼관리자(넥스트랩)만. (CLAUDE.md 3·11)
--  * 삭제 정책 없음 — 상태 전환으로 관리(비활성화 우선, CLAUDE.md 14.4).
-- ============================================================================

create table public.platform_inquiries (
  id            uuid primary key default gen_random_uuid(),
  inquiry_type  text not null default 'trial'
                  check (inquiry_type in ('trial', 'consult')),
  company_name  text not null,
  contact_name  text not null,
  email         text not null,
  phone         text,
  message       text,
  source        text,                       -- 유입 위치(landing-hero, landing-cta 등)
  status        text not null default 'new'
                  check (status in ('new', 'contacted', 'converted', 'closed')),
  handled_by    uuid references auth.users (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table public.platform_inquiries is
  '도입 문의·무료 체험 신청(플랫폼 전역 리드). 익명 제출, 플랫폼관리자만 열람.';

create index platform_inquiries_status_idx
  on public.platform_inquiries (status, created_at desc);

create trigger set_updated_at before update on public.platform_inquiries
  for each row execute function app.set_updated_at();

alter table public.platform_inquiries enable row level security;

-- 공개 폼: 익명·인증 사용자 모두 제출 허용 (INSERT 전용)
create policy platform_inquiries_insert on public.platform_inquiries
  for insert to anon, authenticated
  with check (true);

-- 열람: 플랫폼관리자만
create policy platform_inquiries_select on public.platform_inquiries
  for select to authenticated
  using (app.is_platform_admin());

-- 상태 변경: 플랫폼관리자만
create policy platform_inquiries_update on public.platform_inquiries
  for update to authenticated
  using (app.is_platform_admin())
  with check (app.is_platform_admin());

-- RLS로 게이트되지만 테이블 권한을 명시적으로 부여
grant insert on public.platform_inquiries to anon, authenticated;
grant select, update on public.platform_inquiries to authenticated;
