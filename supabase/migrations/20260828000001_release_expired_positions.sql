-- ============================================================================
-- 만료 섭외에 잠긴 코드넘버 자리 정리 (검수 B1 후속 — 리뷰 8)
--
-- 과거 '링크 열람 만료' 경로는 섭외 상태만 expired로 바꾸고 자리를 풀지
-- 않았다. 그렇게 남은 자리는 requested/filled 상태 + expired 섭외로 영구
-- 잠겨, 화면에 '요청 만료'로 보이면서 아무 버튼도 없다(재요청 불가).
-- 코드 수정으로 신규 발생은 막았으므로, 기존 잠긴 행만 한 번 풀어 준다.
--
-- 멱등: 조건에 맞는 행이 없으면 아무것도 하지 않는다.
-- 크론 만료(releasePositionsForEngagement)와 동일한 결과 상태로 되돌린다.
-- ============================================================================

update public.engagement_slot_positions p
set status = 'open',
    engagement_id = null,
    expert_id = null
from public.expert_engagements e
where e.id = p.engagement_id
  and e.status = 'expired'
  and p.status <> 'open';
