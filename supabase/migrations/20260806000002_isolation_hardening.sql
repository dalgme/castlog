-- ============================================================================
-- 단계 18 격리·권한 점검 후속 RLS 하드닝
--   설계문서 13.4 / CLAUDE.md 3·5·11
--   감사에서 확인된 다음 결함을 DB 레벨에서 봉쇄한다:
--   (1) 전문가가 자기 섭외의 fee_amount 등 금전 항목 직접 수정 → 지급액 조작
--   (2) 전문가에게 지급 배치 전체 행(타 전문가 합계·내부 반려사유) 노출
--   (3) 전문가가 expert_tenant_links의 tenant_id/expert_id 변경 → 임의 테넌트 이전
--   (4) sms_logs/email_logs 전문(수신번호·본문)이 자사 전 직원(staff)에게 열람
-- ============================================================================

-- ----------------------------------------------------------------------------
-- (1) expert_engagements — 전문가 본인 UPDATE 시 응답 컬럼만 허용
--     기업 관리자(자사) 세션은 제약 없음. 전문가 세션은 status/responded_at/
--     response_note 외 컬럼(특히 fee_amount) 변경을 차단한다.
-- ----------------------------------------------------------------------------
create or replace function app.guard_engagement_expert_update()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  -- 자사 관리자 세션이면 전체 수정 허용
  if new.tenant_id = app.tenant_id()
     and app.user_role() in ('org_admin', 'manager') then
    return new;
  end if;

  -- 그 외(전문가 본인) — 응답 관련 컬럼만 변경 허용, 나머지는 불변
  if new.tenant_id       is distinct from old.tenant_id
     or new.expert_id    is distinct from old.expert_id
     or new.project_id   is distinct from old.project_id
     or new.role_description is distinct from old.role_description
     or new.message      is distinct from old.message
     or new.fee_amount   is distinct from old.fee_amount
     or new.starts_on    is distinct from old.starts_on
     or new.ends_on      is distinct from old.ends_on
     or new.requested_by is distinct from old.requested_by
     or new.token_hash   is distinct from old.token_hash then
    raise exception '전문가는 섭외 응답(수락·거절) 외 항목을 변경할 수 없습니다.';
  end if;
  return new;
end;
$$;

drop trigger if exists guard_engagement_expert_update on public.expert_engagements;
create trigger guard_engagement_expert_update
  before update on public.expert_engagements
  for each row execute function app.guard_engagement_expert_update();

-- ----------------------------------------------------------------------------
-- (2) expert_payment_batches — 전문가 직접 열람 정책 철회.
--     배치 행에는 타 전문가 합계(total_*)·내부 반려사유가 있어 통째로 노출하면 안 된다.
--     전문가 포털은 아래 정의 뷰(안전 컬럼만)로 조회한다.
-- ----------------------------------------------------------------------------
drop policy if exists expert_payment_batches_select_expert on public.expert_payment_batches;

-- 소유자(supabase_admin) 권한으로 실행되는 뷰 — 밑단 RLS를 우회하되
-- 노출 컬럼을 안전 항목으로 제한하고 app.is_expert_self()로 호출자 본인 라인만 반환.
create or replace view public.expert_portal_payments
with (security_invoker = false) as
select
  i.id,
  i.gross_amount,
  i.withholding_amount,
  i.net_amount,
  i.created_at,
  b.status,
  b.paid_at,
  b.confirmed_at,
  t.name as tenant_name
from public.expert_payment_items i
join public.expert_payment_batches b on b.id = i.batch_id
join public.tenants t on t.id = b.tenant_id
where b.status in ('confirmed', 'paid')
  and app.is_expert_self(i.expert_id);

revoke all on public.expert_portal_payments from anon;
grant select on public.expert_portal_payments to authenticated;

-- ----------------------------------------------------------------------------
-- (3) expert_tenant_links — tenant_id/expert_id 불변 강제.
--     전문가 본인 UPDATE 정책이 있으나, 연결 대상(tenant_id)이나 소유자(expert_id)를
--     바꾸는 것은 어떤 주체도 허용하지 않는다(임의 테넌트 이전·소유권 탈취 차단).
-- ----------------------------------------------------------------------------
create or replace function app.guard_link_immutable_keys()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.tenant_id is distinct from old.tenant_id
     or new.expert_id is distinct from old.expert_id then
    raise exception '연결의 소속 테넌트·전문가는 변경할 수 없습니다.';
  end if;
  return new;
end;
$$;

drop trigger if exists guard_link_immutable_keys on public.expert_tenant_links;
create trigger guard_link_immutable_keys
  before update on public.expert_tenant_links
  for each row execute function app.guard_link_immutable_keys();

-- ----------------------------------------------------------------------------
-- (4) sms_logs / email_logs — SELECT에 역할 게이트 추가.
--     수신번호·메시지 본문은 발송 권한자(관리자 이상)만 열람. staff 제외.
--     (INSERT는 이미 org_admin/manager 한정이라 SELECT만 비대칭이었음)
-- ----------------------------------------------------------------------------
drop policy if exists sms_logs_select on public.sms_logs;
create policy sms_logs_select on public.sms_logs
  for select using (
    (
      tenant_id is not null
      and tenant_id = app.tenant_id()
      and app.user_role() in ('org_admin', 'manager')
    )
    or app.is_platform_admin()
  );

drop policy if exists email_logs_select on public.email_logs;
create policy email_logs_select on public.email_logs
  for select using (
    (
      tenant_id is not null
      and tenant_id = app.tenant_id()
      and app.user_role() in ('org_admin', 'manager')
    )
    or app.is_platform_admin()
  );
