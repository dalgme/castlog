/**
 * DB 오류를 사용자 문구로 옮긴다.
 *
 * "저장에 실패했습니다"만 보여 주면 관리자는 아무것도 할 수 없고, 우리는
 * 스크린샷을 받아도 원인을 모른다 — 실제로 그 일이 있었다(렛츠 SMS 설정).
 * 이 화면들은 관리 권한자 전용이므로 DB 사유를 그대로 보여 주는 편이 낫다.
 * 특히 두 가지는 사람이 읽을 수 있는 말로 바꾼다:
 *  - 컬럼 없음 = 마이그레이션 미적용 (운영 조치 대상이 명확해진다)
 *  - RLS 거부 = 권한 문제 (키·값 문제와 구분된다)
 */
export function describeDbError(message: string | undefined, fallback: string): string {
  if (!message) return fallback;
  if (/column .* does not exist|schema cache/i.test(message)) {
    return (
      fallback +
      " 서버 데이터베이스가 최신 버전이 아닙니다(마이그레이션 미적용). 캐스트로그에 알려 주세요."
    );
  }
  if (/row-level security|violates.*policy/i.test(message)) {
    return fallback + " 권한이 거부되었습니다. 계정의 권한단계·위임을 확인하세요.";
  }
  return `${fallback} (${message.slice(0, 160)})`;
}

/**
 * '컬럼이 없다' 계열 오류인가 — 마이그레이션 미적용 DB에서 새 컬럼을 참조하면
 * PostgREST가 "Could not find the ... column ... in the schema cache" 또는
 * "column ... does not exist"를 돌려준다. 보류 중인 기능의 컬럼이 현행 기능을
 * 인질로 잡지 않도록, 이 오류에 한해 구버전 경로로 물러날 때 쓴다.
 */
export function isMissingColumnError(message: string | undefined): boolean {
  return /column .* does not exist|schema cache/i.test(message ?? "");
}
