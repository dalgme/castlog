-- ============================================================================
-- 다중 섭외계획 품의 (기획 지시 2026-09-05, 렛츠 보고)
--
-- 이전: 프로젝트당 살아 있는 계획(draft/in_progress/approved) 1건만
--   (engagement_plans_open_idx). 세션 일부를 상신하면 나머지 세션은 결재가
--   끝날 때까지 상신할 수 없었다.
-- 이후: 한 프로젝트에 계획 여러 건이 동시에 살아 있을 수 있다. 제약은
--   **같은 세션이 두 살아 있는 계획(in_progress/approved)에 동시에 담기지
--   않는다**로 바뀐다 — 계획 명세(engagement_plan_lines.slot_id) 기준 트리거.
--   draft(반려 뒤 수정 대기)는 자리를 점유하지 않는다 — 재상신 시 앱이 겹치는
--   draft를 재사용·정리한다.
--
-- 멱등·추가 전용 (§14-10). 코드 병합 전에 실행한다.
-- ============================================================================

drop index if exists public.engagement_plans_open_idx;

create index if not exists engagement_plan_lines_slot_idx
  on public.engagement_plan_lines (slot_id)
  where slot_id is not null;

-- 옛 계획(22번 이전 — 명세에 slot_id가 없는 전체 상신)의 세션 연결 보정 --------
-- slot_id가 없으면 '전체'로 해석돼 그 프로젝트에 다른 계획을 올릴 수 없다.
-- 일자·시간·역할이 정확히 하나의 세션과 맞는 행만 잇는다 (추측 연결 금지).
update public.engagement_plan_lines l
set slot_id = m.slot_id
from (
  select l2.id as line_id, min(s.id::text)::uuid as slot_id
  from public.engagement_plan_lines l2
  join public.engagement_plans p on p.id = l2.plan_id
  join public.engagement_slots s
    on s.project_id = p.project_id
   and s.slot_date = l2.slot_date
   and s.role_type = l2.role_type
   and s.starts_time is not distinct from l2.starts_time
   and s.ends_time is not distinct from l2.ends_time
  where l2.slot_id is null
  group by l2.id
  having count(*) = 1
) m
where l.id = m.line_id
  and l.slot_id is null;

-- 살아 있는 계획끼리 세션 겹침 금지 --------------------------------------------
create or replace function app.guard_engagement_plan_slot_overlap()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_conflict uuid;
  v_has_slot_lines boolean;
begin
  if new.status not in ('in_progress', 'approved') then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.status in ('in_progress', 'approved') then
    -- 살아 있는 계획끼리의 상태 전이(in_progress → approved)는 겹침이 새로
    -- 생기지 않는다
    return new;
  end if;

  -- 같은 프로젝트의 동시 상신 직렬화 — READ COMMITTED에서는 서로의 미커밋 행을
  -- 못 보므로 잠금 없이는 두 건이 함께 통과한다 (리뷰 H1)
  perform pg_advisory_xact_lock(hashtext(new.project_id::text));

  select exists (
    select 1 from public.engagement_plan_lines l
    where l.plan_id = new.id and l.slot_id is not null
  ) into v_has_slot_lines;

  if v_has_slot_lines then
    select p2.id into v_conflict
    from public.engagement_plans p2
    where p2.project_id = new.project_id
      and p2.id <> new.id
      and p2.status in ('in_progress', 'approved')
      and (
        exists (
          select 1
          from public.engagement_plan_lines l1
          join public.engagement_plan_lines l2 on l2.slot_id = l1.slot_id
          where l1.plan_id = new.id
            and l2.plan_id = p2.id
            and l1.slot_id is not null
        )
        -- 상대가 세션 구분 없는 옛 전체 계획이면 어느 세션이든 겹친다 (리뷰 M1)
        or not exists (
          select 1 from public.engagement_plan_lines l
          where l.plan_id = p2.id and l.slot_id is not null
        )
      )
    limit 1;
  else
    -- 세션 구분이 없는 옛 계획(전체 상신)은 다른 살아 있는 계획과 공존할 수 없다
    select p2.id into v_conflict
    from public.engagement_plans p2
    where p2.project_id = new.project_id
      and p2.id <> new.id
      and p2.status in ('in_progress', 'approved')
    limit 1;
  end if;

  if v_conflict is not null then
    raise exception 'engagement_plan_slot_overlap: plan % overlaps live plan %', new.id, v_conflict
      using errcode = '23P01';
  end if;
  return new;
end;
$$;

drop trigger if exists guard_engagement_plan_slot_overlap on public.engagement_plans;
create trigger guard_engagement_plan_slot_overlap
  before insert or update of status on public.engagement_plans
  for each row execute function app.guard_engagement_plan_slot_overlap();

comment on function app.guard_engagement_plan_slot_overlap() is
  '살아 있는(in_progress/approved) 섭외계획끼리 같은 세션을 담지 못하게 한다 — 다중 계획 품의(2026-09-05). errcode 23P01.';
