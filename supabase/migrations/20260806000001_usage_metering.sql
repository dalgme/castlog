-- ============================================================================
-- 단계 17: 사용량 미터링 — 일 단위 스냅샷 (설계문서 4.2, 7.5)
--
-- 과금에 지금 쓰지 않더라도 반드시 쌓아둔다 (소급 불가 — CLAUDE.md 1).
-- 실행 경로:
--   * pg_cron(가능한 환경): 매일 23:55 KST 자동 집계
--   * 플랫폼관리자 화면 "지금 집계" 버튼: service_role rpc 수동 실행
-- ============================================================================

create or replace function public.snapshot_tenant_usage(
  target_date date default (now() at time zone 'Asia/Seoul')::date
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
begin
  insert into public.tenant_usage_metrics as m
    (tenant_id, metric_date, project_count, active_user_count,
     sms_sent_count, email_sent_count, storage_used_bytes)
  select
    t.id,
    target_date,
    (select count(*) from public.projects p where p.tenant_id = t.id),
    (select count(*) from public.users u
      where u.tenant_id = t.id and u.is_active),
    (select count(*) from public.sms_logs s
      where s.tenant_id = t.id
        and (s.created_at at time zone 'Asia/Seoul')::date = target_date),
    (select count(*) from public.email_logs e
      where e.tenant_id = t.id
        and (e.created_at at time zone 'Asia/Seoul')::date = target_date),
    -- 스토리지 근사치: 활성 연결 전문가의 활성 서류 합 (전문가 소유 모델 —
    -- 테넌트 귀속 저장소가 생기면(file_assets) 여기에 합산한다)
    coalesce((
      select sum(d.file_size_bytes)
      from public.expert_documents d
      join public.expert_tenant_links l
        on l.expert_id = d.expert_id
       and l.tenant_id = t.id
       and l.status = 'active'
      where d.status = 'active'
    ), 0)
  from public.tenants t
  on conflict (tenant_id, metric_date) do update set
    project_count = excluded.project_count,
    active_user_count = excluded.active_user_count,
    sms_sent_count = excluded.sms_sent_count,
    email_sent_count = excluded.email_sent_count,
    storage_used_bytes = excluded.storage_used_bytes;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- service_role 전용 — 세션(anon/authenticated)에서 직접 호출 금지
revoke execute on function public.snapshot_tenant_usage(date)
  from public, anon, authenticated;
grant execute on function public.snapshot_tenant_usage(date) to service_role;

-- pg_cron이 있는 환경(Supabase)에서만 스케줄 등록 — 로컬 등은 건너뜀
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    -- 23:55 KST = 14:55 UTC, 당일 스냅샷 (자정 직전 — 온전한 하루에 근사)
    perform cron.schedule(
      'castlog-daily-usage-snapshot',
      '55 14 * * *',
      'select public.snapshot_tenant_usage()'
    );
  end if;
exception
  when others then
    raise notice 'pg_cron 스케줄 등록 생략: %', sqlerrm;
end;
$$;
