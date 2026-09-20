-- ============================================================================
-- 온오프라인 병행 세션의 회차 분리 (기획 지시 2026-09-21 보완)
--  병행이면 "온라인 OO회, 오프라인 OO회"를 따로 적는다 → 총액 = 온라인단가×온라인회차
--  + 오프라인단가×오프라인회차. 비워 두면 "전부 온라인 ~ 전부 오프라인" 범위로 표시.
--  추가 전용·멱등.
-- ============================================================================
alter table public.engagement_slots
  add column if not exists session_count_online int
    constraint engagement_slots_session_count_online_check
    check (session_count_online is null or session_count_online between 0 and 999),
  add column if not exists session_count_offline int
    constraint engagement_slots_session_count_offline_check
    check (session_count_offline is null or session_count_offline between 0 and 999);

-- 확인: select count(*) from information_schema.columns where table_name='engagement_slots'
--   and column_name in ('session_count_online','session_count_offline');  -- 2
