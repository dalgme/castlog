-- 로그인 가능한 데모 기업관리자(org_admin) 만들기 — 무(無)터미널 방법
--
-- 전제: 먼저 Supabase 대시보드 → Authentication → Users → "Add user"로
--       이메일 jinkidi@hanmail.net + 비밀번호 계정을 만든다(Auto Confirm 체크).
--       (auth 계정 생성은 UI가 비밀번호 해시·identity까지 정확히 처리한다.)
-- 그런 다음 이 SQL을 Supabase 대시보드 → SQL Editor에서 실행한다.
--
-- 다른 이메일/회사로 바꾸려면 아래 3곳의 값만 수정한다:
--   이메일: 'jinkidi@hanmail.net'
--   회사 slug: 'demo'  /  회사명: '데모 컨설팅'

-- (1) 데모 회사(테넌트) 생성 — 없으면. feature_flags {} = 전 모듈 활성.
insert into public.tenants (slug, name, status, plan_name, feature_flags)
values ('demo', '데모 컨설팅', 'active', 'demo', '{}'::jsonb)
on conflict (slug) do nothing;

-- (2) 계정에 권한 스탬핑 — tenant_id·role은 app_metadata에만(CLAUDE.md 3·Hard NO 1).
update auth.users
   set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || jsonb_build_object(
     'role', 'org_admin',
     'tenant_id', (select id from public.tenants where slug = 'demo')::text,
     'tenant_slug', 'demo',
     'provider', 'email',
     'providers', jsonb_build_array('email'))
 where email = 'jinkidi@hanmail.net';

-- (3) 직원 프로필 행(public.users) 생성.
insert into public.users (id, tenant_id, name, email, role, is_active)
select u.id, (select id from public.tenants where slug = 'demo'), '데모 관리자', u.email, 'org_admin', true
  from auth.users u
 where u.email = 'jinkidi@hanmail.net'
on conflict (id) do update
   set tenant_id = excluded.tenant_id, role = 'org_admin', is_active = true;

-- 확인용(선택): 아래로 스탬핑이 됐는지 볼 수 있다.
-- select email, raw_app_meta_data from auth.users where email = 'jinkidi@hanmail.net';
