-- ============================================================================
-- 수락서: 찾아오시는 길 URL + 첨부 형식(GIF) 확장 (기획 지시 2026-09-05)
--
-- 1) engagement_acceptances.map_url — 지도 링크(네이버·카카오 지도 등).
--    전문가 화면에서 '찾아오시는 길' 버튼으로 팝업 열람. 약도 이미지
--    (map_image_path)와 별개로 둘 다 쓸 수 있다.
-- 2) expert-documents 버킷 허용 MIME에 image/gif 추가 — 수락서 첨부에
--    xls/xlsx/hwp/hwpx/pdf/jpeg/jpg/gif/png/ppt/pptx를 허용한다. 오피스·한글은
--    20260822000004에서 이미 열려 있고 gif만 없었다. 앱 서버가 확장자↔MIME을
--    검증하고 정규 MIME으로 저장하므로 버킷 목록은 정규 MIME만 둔다
--    (lib/experts/documents.ts와 동일 목록).
--
-- 추가 전용·멱등 (docs/ops/release-playbook.md §3 — SQL 먼저).
-- ============================================================================

alter table public.engagement_acceptances
  add column if not exists map_url text;

update storage.buckets
set allowed_mime_types = array[
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/gif',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/x-hwp',
  'application/hwp+zip'
]
where id = 'expert-documents';
