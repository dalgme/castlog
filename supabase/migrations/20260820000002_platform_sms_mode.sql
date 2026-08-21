-- ============================================================================
-- SMS 발송 방식 이원화 — 자사 공급자(byo) / 캐스트로그 계정(platform)
--
-- 지금까지는 각 기업이 자사 솔라피 계정을 만들어 API 키를 등록해야만 문자를
-- 보낼 수 있었다(BYO 단일). 그런데 작은 기업에게는 "솔라피 가입 → 키 발급 →
-- 발신번호 등록"이 도입의 첫 관문에서 그대로 이탈 지점이 된다.
--
-- 그래서 둘 중 선택하게 한다:
--   byo      — 자사 공급자 계정·자사 키 (기존 방식, 기본값)
--   platform — 캐스트로그(넥스트랩) 솔라피 계정으로 발송.
--              자격증명은 서버 환경변수에만 있고 DB에는 저장하지 않는다.
--              발신번호는 여전히 **그 기업의 번호**다 — 단, 발신번호 사전등록제
--              (전기통신사업법 제84조의2) 때문에 그 번호를 캐스트로그 솔라피
--              계정에 등록(인증)하는 절차가 기업마다 한 번 필요하다. 이것은
--              법·통신사 규제라 코드로 우회할 수 없다.
--
-- platform 모드 진입은 캐스트로그 담당자가 알려준 이용코드로 한 번 인증한다.
-- 코드 자체는 저장하지 않고 승인 시각(platform_access_granted_at)만 남긴다 —
-- 코드를 나중에 바꿔도 이미 승인된 기업은 계속 쓴다.
-- ============================================================================

alter table public.tenant_sms_configs
  add column if not exists mode text not null default 'byo',
  add column if not exists platform_access_granted_at timestamptz;

alter table public.tenant_sms_configs
  drop constraint if exists tenant_sms_configs_mode_check;
alter table public.tenant_sms_configs
  add constraint tenant_sms_configs_mode_check
  check (mode in ('byo', 'platform'));

-- platform 모드는 자사 키가 없다 — not null을 푼다
alter table public.tenant_sms_configs
  alter column api_key_encrypted drop not null;

-- 모드별 필수 조건을 DB에서도 강제한다:
--   byo      → 자사 API 키가 있어야 한다
--   platform → 이용코드 승인 흔적이 있어야 한다
alter table public.tenant_sms_configs
  drop constraint if exists tenant_sms_configs_mode_requirements;
alter table public.tenant_sms_configs
  add constraint tenant_sms_configs_mode_requirements
  check (
    (mode = 'byo' and api_key_encrypted is not null)
    or (mode = 'platform' and platform_access_granted_at is not null)
  );

comment on column public.tenant_sms_configs.mode is
  '발송 방식: byo=자사 공급자 계정 / platform=캐스트로그 솔라피 계정(자격증명은 환경변수).';
comment on column public.tenant_sms_configs.platform_access_granted_at is
  'platform 모드 이용코드 승인 시각. 코드는 저장하지 않는다 — 이후 코드가 바뀌어도 승인은 유지.';
