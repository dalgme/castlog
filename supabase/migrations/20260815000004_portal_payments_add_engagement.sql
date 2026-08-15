-- expert_portal_payments 안전 뷰에 engagement_id 추가.
-- 목적: 전문가 포털 '프로젝트별 관리'에서 지급 건을 섭외→프로젝트로 연결해
-- 지급일을 프로젝트 단위로 표시하기 위함. engagement_id는 민감정보 아님.
-- security_invoker 유지(전문가 RLS로 자기 지급 건만 조회).
create or replace view public.expert_portal_payments
  with (security_invoker = true) as
 SELECT i.id,
    i.gross_amount,
    i.withholding_amount,
    i.net_amount,
    i.created_at,
    m.status,
    m.paid_at,
    m.confirmed_at,
    t.name AS tenant_name,
    i.engagement_id
   FROM expert_payment_items i
     CROSS JOIN LATERAL app.expert_batch_meta(i.batch_id) m(status, paid_at, confirmed_at)
     JOIN tenants t ON t.id = i.tenant_id
  WHERE m.status = ANY (ARRAY['confirmed'::text, 'paid'::text]);
