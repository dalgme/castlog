-- ============================================================================
-- expert_portal_payments 뷰를 SECURITY INVOKER로 전환 (보안 어드바이저 0010 해소)
-- ----------------------------------------------------------------------------
-- 단계 18에서 만든 뷰는 security_invoker=false(DEFINER)라 밑단 RLS를 우회했다.
-- 안전 컬럼만 노출하고 app.is_expert_self로 자기 라인만 반환하도록 설계했으나,
-- Supabase 린터가 DEFINER 뷰를 ERROR로 플래그한다(RLS 우회 위험 일반 경고).
--
-- 재설계: 뷰를 INVOKER로 돌리고 호출자 RLS에 의존한다.
--   - expert_payment_items : 기존 SELECT 정책(is_expert_self)이 자기 라인으로 스코프
--   - tenants              : 기존 tenants_select_linked_expert 정책으로 소속 테넌트 열람
--   - expert_payment_batches: 전문가 SELECT 정책이 없다(단계 18에서 total_* 누출 때문에
--     의도적으로 제거). 배치의 '비민감 생애주기 필드'(status/paid_at/confirmed_at)만
--     전용 DEFINER 함수로 브리지한다. total_*·last_rejection_note는 절대 노출하지 않는다.
--     함수 자체도 "해당 배치에 본인 라인이 있는 전문가"에게만 값을 반환(이중 방어).
-- ============================================================================

create or replace function app.expert_batch_meta(p_batch uuid)
returns table (status text, paid_at timestamptz, confirmed_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select b.status, b.paid_at, b.confirmed_at
  from public.expert_payment_batches b
  where b.id = p_batch
    and exists (
      select 1
      from public.expert_payment_items i
      where i.batch_id = b.id
        and app.is_expert_self(i.expert_id)
    );
$$;

revoke all on function app.expert_batch_meta(uuid) from public, anon;
grant execute on function app.expert_batch_meta(uuid) to authenticated;

-- 뷰 재정의: INVOKER + 자기 라인 RLS + 배치 메타는 DEFINER 함수 경유.
-- 테넌트명은 items.tenant_id로 직접 조인(배치 행을 읽지 않는다).
create or replace view public.expert_portal_payments
with (security_invoker = true) as
select
  i.id,
  i.gross_amount,
  i.withholding_amount,
  i.net_amount,
  i.created_at,
  m.status,
  m.paid_at,
  m.confirmed_at,
  t.name as tenant_name
from public.expert_payment_items i
cross join lateral app.expert_batch_meta(i.batch_id) m
join public.tenants t on t.id = i.tenant_id
where m.status in ('confirmed', 'paid');

revoke all on public.expert_portal_payments from anon;
grant select on public.expert_portal_payments to authenticated;
