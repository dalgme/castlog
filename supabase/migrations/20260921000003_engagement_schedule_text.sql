-- 섭외 건·수락서 일정 문구 스냅샷 (기획 지시 2026-09-21 후속)
--
-- 세션이 날짜 유형(연속형/개별선택형)·회차·진행 방식을 갖게 되면서(20260921000001)
-- '첫 날 ~ 마지막 날'만 담는 starts_on/ends_on으로는 섭외요청·수락서·재안내·
-- 전문가 포털의 일정 표기가 부족해졌다 (개별선택형 5일은 "9/1 ~ 9/29"가 아니라
-- 날짜 다섯 개다). 섭외 요청 시점의 세션 일정을 문장으로 스냅샷해 둔다 —
-- 수락서는 계약 문서라 나중에 세션이 바뀌어도 수락 당시 문구를 지켜야 한다.
--
-- 추가 전용·멱등 (§14-10). null이면 앱이 starts_on/ends_on으로 옛 표기로 폴백한다.
-- 단일 날짜 세션은 계속 null로 두어(옛 표기 유지) 기존 고객 화면이 바뀌지 않는다.

alter table public.expert_engagements
  add column if not exists schedule_text text;
comment on column public.expert_engagements.schedule_text is
  '섭외 요청 시점 세션 일정 문구 스냅샷(날짜 유형·회차·진행 방식). null = 단일 날짜(starts_on/ends_on 표기)';

alter table public.engagement_acceptances
  add column if not exists schedule_text text;
comment on column public.engagement_acceptances.schedule_text is
  '수락 시점 섭외 건의 schedule_text 복사본 — 계약 문서 스냅샷';
