/**
 * 에러 바운더리 → 계측 엔드포인트 보고 (실시간 모니터링 — 기획 2026-08-29)
 *
 * fire-and-forget: 보고가 실패해도 아무 일도 일어나지 않아야 한다 — 에러
 * 화면에서 또 에러를 내는 것이 최악이다. 서버가 모니터링 창이 닫힌 테넌트의
 * 보고를 조용히 버리므로, 클라이언트는 조건 없이 쏜다.
 *
 * §11-10(useEffect+fetch 금지)은 **데이터 페칭** 패턴 금지다. 이 호출은 화면에
 * 아무 데이터도 가져오지 않는 일방향 계측이라 해당하지 않는다.
 */

export function reportClientError(
  error: Error & { digest?: string },
  source: "client" | "global"
): void {
  try {
    const body = JSON.stringify({
      message: String(error.message || error).slice(0, 500),
      stack: typeof error.stack === "string" ? error.stack.slice(0, 2000) : undefined,
      digest: error.digest,
      path: window.location.pathname,
      source,
    });
    // keepalive: 에러 직후 이동·닫기가 잦다 — 전송이 살아남게 한다
    fetch("/api/client-errors", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      keepalive: true,
    }).catch(() => {});
  } catch {
    // 보고 실패는 삼킨다
  }
}
