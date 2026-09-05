/**
 * 업로드 파일명 보전 (기획 지시 2026-09-05 — 한글 파일명 깨짐).
 *
 * 브라우저·런타임에 따라 multipart의 filename이 UTF-8 바이트를 Latin-1로
 * 읽은 형태("ì°¸ê°ì…")로 도착하는 경우가 있다. 렛츠 실데이터에서 수락서
 * 첨부·프로젝트 첨부·전문가 서류 5건이 그렇게 저장됐다.
 *
 * 두 겹으로 막는다:
 *  1) 클라이언트가 문자열 필드(fileName)로 원본 이름을 함께 보내면 그것을 쓴다
 *     — 문자열 필드는 깨지지 않는다.
 *  2) 없으면 file.name을 검사해 mojibake 패턴이면 Latin-1 → UTF-8로 되돌린다.
 * 마지막으로 NFC 정규화 — macOS는 한글을 자모 분리(NFD)로 보내 Windows에서
 * "ㅎㅏㄴㄱㅡㄹ"처럼 보인다.
 */

/** UTF-8 다바이트 선두(0xC2–0xF4) 뒤에 연속 바이트(0x80–0xBF)가 오는 Latin-1 표기 */
const MOJIBAKE_PATTERN = /[\u00C2-\u00F4][\u0080-\u00BF]/;

export function repairMojibake(name: string): string {
  if (!name) return name;
  let out = name;
  if (MOJIBAKE_PATTERN.test(out)) {
    // Latin-1 로 잘못 읽힌 문자열은 각 문자가 곧 원래 바이트다
    const decoded = Buffer.from(out, "latin1").toString("utf8");
    // 되돌린 결과에 대체 문자가 없으면 성공 — 있으면 원래부터 그런 이름이다
    if (!decoded.includes("�")) out = decoded;
  }
  return out.normalize("NFC");
}

/**
 * 표시·저장용 파일명 정리 — 경로 구분자·제어문자 제거, 길이 상한. 이 값은
 * DB의 file_name과 내려받기 Content-Disposition에 그대로 쓰인다.
 */
export function sanitizeFileName(name: string): string {
  const cleaned = name
    .replace(/[\\/]/g, "_")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001F\u007F]/g, "")
    .trim();
  return cleaned.length > 255 ? cleaned.slice(-255) : cleaned;
}

/**
 * 서버 액션에서 쓰는 업로드 파일명 결정 — 클라이언트 fileName 필드 우선
 * (문자열 필드는 깨지지 않으므로 복원하지 않는다 — "Â©2026.pdf" 같은 진짜
 * Latin-1 이름을 오판하지 않기 위해), 없으면 file.name을 복원한다.
 * 확장자 검증·저장 표시 이름 모두 이 값을 쓴다.
 */
export function readUploadFileName(formData: FormData, file: File): string {
  const explicit = formData.get("fileName");
  const candidate =
    typeof explicit === "string" && explicit.trim()
      ? explicit.trim().normalize("NFC")
      : repairMojibake(file.name);
  return sanitizeFileName(candidate) || file.name;
}
