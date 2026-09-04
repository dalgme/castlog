-- ============================================================================
-- 섭외 사후보고 모드 (기획 확정 2026-08-30 — 38번, docs/decisions/engagement-post-report.md)
--
-- 소규모 회사는 팀장·대리급이 후보를 정리한 뒤 승인 없이 섭외를 진행하고
-- 사후에 상급자에게 보고(확인·피드백)한다. 승인을 없애는 대신 **같은 결재
-- 엔진에 '보고' 성격의 문서**를 태운다:
--   · approvals.approval_kind — 'decision'(기존 결재) | 'report'(사후보고: 승인=확인,
--     반려=피드백. 계획·단계를 되돌리지 않는다)
--   · engagement_plans.flow — 'pre_approval' | 'post_report' (통계·감사용)
--   · engagement_plans.feedback_note — 상급자 피드백(보고 문서의 반려 사유)
-- 설정은 tenants.feature_flags.engagement_post_report(JSON) — 앱에서 관리.
-- RLS 변경 없음(approvals 정책이 그대로 적용). 추가 전용·멱등(§14-10).
-- ============================================================================

alter table public.approvals
  add column if not exists approval_kind text not null default 'decision';

alter table public.approvals
  drop constraint if exists approvals_approval_kind_check;
alter table public.approvals
  add constraint approvals_approval_kind_check
  check (approval_kind in ('decision', 'report'));

comment on column public.approvals.approval_kind is
  '문서 성격 — decision: 결재(승인/반려가 상태를 움직임) / report: 사후보고(확인/피드백만, 되돌리지 않음). 38번.';

alter table public.engagement_plans
  add column if not exists flow text not null default 'pre_approval';

alter table public.engagement_plans
  drop constraint if exists engagement_plans_flow_check;
alter table public.engagement_plans
  add constraint engagement_plans_flow_check
  check (flow in ('pre_approval', 'post_report'));

alter table public.engagement_plans
  add column if not exists feedback_note text;

comment on column public.engagement_plans.flow is
  '계획이 어떤 흐름으로 고정됐나 — pre_approval: 사전 품의 승인 / post_report: 사후보고(즉시 확정). 38번.';
comment on column public.engagement_plans.feedback_note is
  '사후보고 문서에 상급자가 남긴 피드백 — 계획은 되돌리지 않고 문구만 기록·표시한다. 38번.';
