-- 시간당 비용·회차당 시간 / 계획 섭외비 범위 / 체크리스트 영역 색상 (기획 지시 2026-09-21)
--
-- 1) 세션에 '회차당 시간'(hours_per_session)과 '시간당 비용'(hourly_fee_online/offline)을 둔다.
--    회당 단가(unit_fee_*)는 시간당 비용 × 회차당 시간으로 계산해 함께 저장한다 —
--    총액 = 총회차 × 회차당 시간 × 시간당 비용. 후보에도 시간당 비용(개별 수정)을 둔다.
-- 2) 섭외계획의 금액이 범위(최소~최대)일 수 있다 — planned_amount(최소) 옆에 최대를 둔다.
-- 3) 체크리스트 영역 머리행 색상 — 항목 행에 색 키를 저장(영역의 모든 항목이 같은 값).
--
-- 추가 전용·멱등 (§14-10). null이면 앱이 옛 동작(회당 단가 직접 입력·단일 금액·자동 음영)으로 폴백.

alter table public.engagement_slots
  add column if not exists hours_per_session numeric(5,2),
  add column if not exists hourly_fee_online integer,
  add column if not exists hourly_fee_offline integer;
comment on column public.engagement_slots.hours_per_session is '회차당 진행 시간(시간). 총액 = 총회차 × 회차당 시간 × 시간당 비용';
comment on column public.engagement_slots.hourly_fee_online is '온라인 시간당 비용(원) — 일괄 등록 기준값';
comment on column public.engagement_slots.hourly_fee_offline is '오프라인 시간당 비용(원) — 일괄 등록 기준값';

alter table public.engagement_slot_positions
  add column if not exists hourly_fee_online integer,
  add column if not exists hourly_fee_offline integer;
comment on column public.engagement_slot_positions.hourly_fee_online is '후보별 온라인 시간당 비용(원). 세션 일괄값과 다르면 fee_custom';
comment on column public.engagement_slot_positions.hourly_fee_offline is '후보별 오프라인 시간당 비용(원)';

alter table public.engagement_plans
  add column if not exists planned_amount_max integer;
comment on column public.engagement_plans.planned_amount_max is '계획 섭외비 최대(원). null = 단일 금액(planned_amount)';

alter table public.project_checklist_items
  add column if not exists color text;
comment on column public.project_checklist_items.color is '영역 머리행 색상 키(lib/checklists/groups GROUP_COLORS). null = 분류명 해시 자동 음영';
