-- ============================================================================
-- 전문가 열람 범위 — 연결 상태가 active가 아니어도 '자사가 만든 연결'은 보인다
--
-- 문제: app.tenant_linked_to_expert()가 status='active'만 통과시켜서, 기업이
--       초대해 둔(pending) 전문가나 연결을 해제한(revoked) 전문가의 이름조차
--       조회되지 않았다. 전문가 목록 화면에는 '대기중'·'해제됨' 상태 배지가
--       있지만 그 행들은 experts 조인이 비어 화면에 그려질 수 없었다 —
--       사실상 죽은 코드였다.
--
-- 판단: 노출 확대가 아니다. pending 링크는 기업이 초대하며 이름·휴대폰을 직접
--       입력한 대상이고(expert_invitations), revoked는 과거에 실제로 연결돼
--       있던 대상이다. 자사가 만든 연결의 상대를 자사가 못 보는 게 오히려 결함이다.
--       다른 기업의 전문가는 여전히 보이지 않는다 — 판정 기준은 '자사 링크 존재'다.
--
-- 섭외이력·의뢰비용·평판·태그는 이 변경과 무관하게 테넌트 격리를 유지한다(§4).
-- 실제 섭외 실행은 별도로 status='active'를 다시 확인하므로 이 변경이
-- '해제된 전문가를 섭외할 수 있게' 만들지 않는다.
-- ============================================================================

create or replace function app.tenant_linked_to_expert(p_expert_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.expert_tenant_links l
    where l.expert_id = p_expert_id
      and l.tenant_id = app.tenant_id()
  )
$$;

comment on function app.tenant_linked_to_expert(uuid) is
  '자사와 연결(active/pending/revoked)이 있는 전문가인지. 섭외 실행 가능 여부는 별도로 status=active를 확인한다.';
