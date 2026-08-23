-- ============================================================================
-- 문자 발송 이미지(MMS) 첨부 (기획 확정 2026-08-23)
-- 예약 발송 건이 발송 시점까지 이미지 참조를 들고 있어야 한다.
-- 이미지 자체는 공급자(솔라피) 저장소에 업로드되고, 여기는 그 id만 저장한다.
-- ============================================================================

alter table public.sms_send_batches
  add column if not exists mms_image_id text,
  add column if not exists mms_image_name text;

comment on column public.sms_send_batches.mms_image_id is
  '공급자(솔라피)에 업로드된 MMS 이미지 id — null이면 텍스트 발송';
