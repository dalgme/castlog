-- ============================================================================
-- sms_logs ↔ 섭외 건 연결 (기획 지시 2026-09-05 — 세션별·멘토별 섭외 문자
-- 재발송 + 발송 상황·이력 표시)
--
-- 발송 로그에 어떤 섭외 건의 문자였는지가 없어 "이 멘토에게 문자가 몇 번,
-- 언제, 성공했는지"를 화면에서 정확히 보여 줄 수 없었다(전문가·시간 창으로
-- 추정만 했다). 묶음 발송은 문자 1건이 여러 섭외 건을 담으므로 배열로 둔다.
--
-- 추가 전용·멱등 (docs/ops/release-playbook.md §3 — SQL 먼저). 코드는 컬럼
-- 부재 시(PGRST204) 연결 없이 기록하는 폴백을 둔다.
-- ============================================================================

alter table public.sms_logs
  add column if not exists engagement_ids uuid[];

create index if not exists sms_logs_engagement_ids_gin
  on public.sms_logs using gin (engagement_ids);
