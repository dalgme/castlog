-- ============================================================================
-- 단계 7: 전문가 서류 스토리지 (설계문서 10.1 / CLAUDE.md 5)
--
-- 보안 원칙:
--  * 비공개 버킷. 공개 URL 금지 — 열람은 서버가 발급하는 만료 서명 URL로만.
--  * storage.objects에 클라이언트 정책을 만들지 않는다 = service_role 전용.
--    업로드·다운로드 전부 서버 액션/라우트 핸들러 경유 (권한 검사 + 감사로그).
--  * 민감 서류는 리사이즈하지 않는다 (원본 판독 필요).
-- ============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'expert-documents',
  'expert-documents',
  false,
  10485760, -- 10MB
  array['application/pdf', 'image/jpeg', 'image/png']
)
on conflict (id) do nothing;
