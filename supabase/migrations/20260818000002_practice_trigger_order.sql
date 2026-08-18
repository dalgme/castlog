-- ============================================================================
-- 연습모드 후속 — 트리거 실행 순서 교정 + 스탬프 대상 확대
--
-- 1) PostgreSQL은 같은 시점(BEFORE INSERT)의 트리거를 **이름 알파벳순**으로 실행한다.
--    'enforce_engagement_practice' < 'stamp_practice' 이므로, 연습모드 사용자가
--    is_practice를 명시하지 않고 섭외를 만들면 스탬프가 찍히기 전에 무결성 검사가
--    돌아 "연습 전문가와 실제 전문가를 섞을 수 없습니다"로 거부됐다.
--    스탬프가 항상 먼저 오도록 이름을 바꾼다 (a_ / z_ 접두).
--
-- 2) experts·expert_tenant_links에도 스탬프를 단다.
--    연습모드에서 전문가를 새로 초대하면 실제 전문가 행이 만들어져 연습 활동이
--    실데이터로 새어 나갔다. 연습 세션이 만든 전문가는 연습 전문가여야 한다.
-- ============================================================================

-- ---- 1. 스탬프를 앞으로 (a_ 접두) -------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'projects', 'expert_engagements', 'approvals', 'expert_payment_batches',
    'expert_evaluations', 'expert_reviews', 'expert_tenant_tags',
    'experts', 'expert_tenant_links'
  ] loop
    execute format('drop trigger if exists stamp_practice on public.%I', t);
    execute format('drop trigger if exists a_stamp_practice on public.%I', t);
    execute format(
      'create trigger a_stamp_practice before insert on public.%I
         for each row execute function app.stamp_practice()', t
    );
  end loop;
end $$;

-- ---- 2. 무결성 검사를 뒤로 (z_ 접두) ----------------------------------------
drop trigger if exists enforce_engagement_practice on public.expert_engagements;
drop trigger if exists z_enforce_engagement_practice on public.expert_engagements;
create trigger z_enforce_engagement_practice
  before insert or update of expert_id, project_id, is_practice
  on public.expert_engagements
  for each row execute function app.enforce_engagement_practice();

drop trigger if exists enforce_link_practice on public.expert_tenant_links;
drop trigger if exists z_enforce_link_practice on public.expert_tenant_links;
create trigger z_enforce_link_practice
  before insert or update of expert_id, is_practice
  on public.expert_tenant_links
  for each row execute function app.enforce_link_practice();
