-- ============================================================================
-- 관리 권한 위임 스코프 세분화 + 주민등록번호 조회 지정자 3인 상한
--
-- 문제 1: 위임 스코프 하나가 너무 넓었다.
--   * 'sending'을 주면 문자 **문구**만 고칠 사람에게 **API 키**까지 열렸다.
--   * 'audit'을 주면 로그를 **읽을** 사람에게 회사 데이터 **전체 반출**까지 열렸다.
--   * 'settings'에 계약 사항(사용 기능 요청)과 회사 정보 수정이 섞여 있었다.
--   위험도가 다른 일이 한 스위치에 묶이면, 필요한 권한을 주려다 필요 없는
--   권한까지 준다. 위험도가 갈리는 지점에서 자른다.
--
--   settings → settings + modules      (회사 설정 / 계약 요청)
--   sending  → sending  + templates    (자격증명 / 문구)
--   audit    → audit    + backup       (읽기 / 반출)
--   approvals 신설                     (전결규정 = 결재 흐름 자체를 바꾸는 권한)
--
--   **기존 위임은 끊기지 않는다.** 넓은 스코프는 갈라져 나온 스코프를 포함한다
--   (app.has_admin_scope에서 판정). 앱 코드도 같은 규칙을 쓴다
--   (lib/auth/admin-scope-keys.ts SCOPE_IMPLIES).
--
-- 문제 2: 주민등록번호 조회 지정자에 인원 상한이 없었다. 조회 가능한 사람이
--   늘어날수록 유출면이 그대로 넓어진다. 회사가 실제로 필요한 수(대표·임원·
--   회계담당)를 감안해 **활성 3명**으로 묶는다. 앱에서도 막지만, 앱을 우회한
--   경로가 생기면 상한이 무의미해지므로 DB 트리거로 강제한다.
-- ============================================================================

-- ---- 1. 위임 스코프 확장 ---------------------------------------------------
alter table public.tenant_admin_grants
  drop constraint if exists tenant_admin_grants_scope_check;
alter table public.tenant_admin_grants
  add constraint tenant_admin_grants_scope_check
  check (
    scope in (
      'settings', 'modules',
      'staff',
      'sending', 'templates',
      'approvals',
      'audit', 'backup',
      'finance'
    )
  );

/**
 * 스코프 보유 여부 (CEO는 항상 보유).
 *
 * 넓은 스코프가 하위 스코프를 포함한다 — 세분화 이전에 부여해 둔 위임이
 * 어느 날 갑자기 끊기면 그건 우리가 만든 사고다.
 *   settings ⊃ modules · sending ⊃ templates · audit ⊃ backup
 */
create or replace function app.has_admin_scope(p_scope text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.is_org_admin()
      or exists (
        select 1
        from public.tenant_admin_grants g
        where g.tenant_id = app.tenant_id()
          and g.user_id = auth.uid()
          and g.revoked_at is null
          and (
            g.scope = p_scope
            or (g.scope = 'settings' and p_scope = 'modules')
            or (g.scope = 'sending'  and p_scope = 'templates')
            or (g.scope = 'audit'    and p_scope = 'backup')
          )
      )
$$;

revoke all on function app.has_admin_scope(text) from public;
grant execute on function app.has_admin_scope(text) to authenticated;

comment on function app.has_admin_scope(text) is
  '관리 권한 위임 스코프 보유 여부. 대표는 항상 true. 넓은 스코프는 하위 스코프를 포함한다.';

-- ---- 2. 주민등록번호 조회 지정자 3인 상한 ----------------------------------
/**
 * 지정자는 활성 기준 최대 3명.
 *
 * 왜 3명인가: 실무에서 필요한 자리는 대표·임원(전결)·회계담당 정도다. 그
 * 이상은 "혹시 몰라서"로 늘어나고, 조회 가능한 사람이 늘어난 만큼 유출면이
 * 넓어진다. 해제(revoke)는 언제든 가능하므로 3명이 부족한 상황은 교체로 푼다.
 */
create or replace function app.enforce_tax_grant_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  -- 해제(revoked_at 설정)는 상한과 무관하다
  if tg_op = 'UPDATE' and new.revoked_at is not null then
    return new;
  end if;
  if new.revoked_at is not null then
    return new;
  end if;

  select count(*)
    into v_count
    from public.tax_access_grants g
   where g.tenant_id = new.tenant_id
     and g.revoked_at is null
     and g.id <> new.id;

  if v_count >= 3 then
    raise exception
      '주민등록번호 조회 지정자는 최대 3명까지입니다. 기존 지정자를 해제한 뒤 지정하세요.'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

-- BEFORE 트리거는 이름 알파벳순으로 실행된다. 다른 stamp 트리거보다 뒤에
-- 돌도록 z_ 접두사를 쓴다 (테넌트 스탬프가 먼저 찍혀야 카운트가 맞는다).
drop trigger if exists z_enforce_tax_grant_limit on public.tax_access_grants;
create trigger z_enforce_tax_grant_limit
  before insert or update on public.tax_access_grants
  for each row
  execute function app.enforce_tax_grant_limit();

comment on function app.enforce_tax_grant_limit() is
  '주민등록번호 조회 지정자 활성 3명 상한 (CLAUDE.md §5 — 조회 가능 인원을 좁게 유지).';

-- ---- 3. 제품 소개서 판(edition) 보관 ---------------------------------------
/**
 * 랜딩의 '제품 소개 다운로드'가 메일 요청(mailto:)이라 사실상 자료가 없었다.
 * 소개서를 사람이 따로 써 두면 제품과 반드시 어긋나므로, 본문은 제품 코드에서
 * 생성하고(lib/marketing/product-brief.ts) 그 결과를 매월 1일 02시(KST)에
 * 여기 저장한다. 한 달 동안 같은 판을 보여 주기 위한 보관이다 —
 * 보는 시점마다 문구가 바뀌면 영업 자료로 쓸 수 없다.
 *
 * 테넌트 데이터가 아니다(플랫폼 전역). 읽기는 공개 페이지가 service_role로
 * 하고, 쓰기는 크론만 한다. 그래서 RLS는 켜 두되 정책을 만들지 않는다
 * (= 일반 세션에서는 아무것도 보이지 않는다).
 */
create table if not exists public.product_brief_editions (
  edition text primary key,            -- 'YYYY-MM'
  content jsonb not null,
  generated_at timestamptz not null default now()
);

alter table public.product_brief_editions enable row level security;

comment on table public.product_brief_editions is
  '제품 소개서 월간 판 보관 (플랫폼 전역, 크론 생성 · service_role 전용).';

-- ---- 4. 전결규정 쓰기 권한을 approvals 위임까지 연다 ------------------------
/**
 * 전결규정은 지금까지 대표(is_org_admin)만 고칠 수 있었다. 그런데 결재선을
 * 실제로 설계하는 사람은 대개 경영지원·기획 담당이고, 대표가 매번 직접 손대는
 * 구조는 현실에서 지켜지지 않는다(대표 계정을 빌려 쓰게 된다 — 그게 더 나쁘다).
 *
 * app.has_admin_scope('approvals')는 대표를 항상 포함하므로 대표 권한은 그대로다.
 */
drop policy if exists approval_rules_write on public.approval_rules;
create policy approval_rules_write on public.approval_rules
  for all using (tenant_id = app.tenant_id() and app.has_admin_scope('approvals'))
  with check (tenant_id = app.tenant_id() and app.has_admin_scope('approvals'));

drop policy if exists approval_rule_steps_write on public.approval_rule_steps;
create policy approval_rule_steps_write on public.approval_rule_steps
  for all using (tenant_id = app.tenant_id() and app.has_admin_scope('approvals'))
  with check (tenant_id = app.tenant_id() and app.has_admin_scope('approvals'));
