-- ============================================================================
-- 견적·정산 리뷰 반영 (20260909000001 후속)
--
-- 1) 원본 재동기화를 한 번의 트랜잭션으로 — 종전에는 앱이 전 줄을 DELETE 한 뒤
--    따로 INSERT 해서, 중간에 실패하면 기입한 지출이 통째로 사라졌다.
-- 2) quote_logs INSERT를 조일 것 — 종전 정책은 자사 사용자라면 열람하지 못하는
--    프로젝트에도, 남의 이름으로도 로그를 넣을 수 있었다. 변경 이력이 근거
--    문서인 만큼 위조 경로를 막는다.
--
-- 추가 전용·멱등.
-- ============================================================================

-- 원가시트 줄 재동기화 (security invoker — 호출자 RLS가 그대로 걸린다)
create or replace function public.resync_project_cost_lines(
  p_sheet_id uuid,
  p_lines jsonb
)
returns integer
language plpgsql
volatile
set search_path = public
as $$
declare
  v_tenant uuid;
  v_count integer;
begin
  -- RLS 밖의 시트라면 여기서 아무것도 보이지 않는다 → 예외로 끝난다
  select tenant_id into v_tenant
  from public.project_cost_sheets
  where id = p_sheet_id;
  if v_tenant is null then
    raise exception 'cost sheet not found or not visible';
  end if;

  delete from public.project_cost_lines where sheet_id = p_sheet_id;

  insert into public.project_cost_lines (
    tenant_id, sheet_id, sort_order,
    base_section, base_name, base_amount,
    compare_note, compare_spend,
    note, spend, vat_refundable
  )
  select
    v_tenant,
    p_sheet_id,
    (t.ordinality * 10)::integer,
    nullif(t.l ->> 'base_section', ''),
    nullif(t.l ->> 'base_name', ''),
    coalesce((t.l ->> 'base_amount')::numeric, 0),
    nullif(t.l ->> 'compare_note', ''),
    (nullif(t.l ->> 'compare_spend', ''))::numeric,
    nullif(t.l ->> 'note', ''),
    coalesce((t.l ->> 'spend')::numeric, 0),
    coalesce((t.l ->> 'vat_refundable')::boolean, false)
  from jsonb_array_elements(p_lines) with ordinality as t(l, ordinality);

  get diagnostics v_count = row_count;
  return v_count;
end $$;
revoke all on function public.resync_project_cost_lines(uuid, jsonb) from public;
grant execute on function public.resync_project_cost_lines(uuid, jsonb) to authenticated;

-- 로그 위조 차단 — 본인 이름으로, 열람 가능한 프로젝트에만
drop policy if exists quote_logs_insert on public.quote_logs;
create policy quote_logs_insert on public.quote_logs
  for insert with check (
    tenant_id = app.tenant_id()
    and app.user_role() <> 'expert'
    and actor_user_id = auth.uid()
    and (project_id is null or app.can_view_project(project_id))
  );
