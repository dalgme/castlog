"use client";

import { useEffect } from "react";

/**
 * 루트 레이아웃까지 무너진 경우의 최종 방어선. 자체 <html>/<body>를 렌더한다.
 * 여기서는 앱 컴포넌트·폰트에 의존하지 않고 인라인 스타일만 쓴다.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="ko">
      <body
        style={{
          display: "flex",
          minHeight: "100vh",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: "1rem",
          padding: "1.5rem",
          textAlign: "center",
          fontFamily: "system-ui, sans-serif",
          color: "#0f172a",
          background: "#f8fafc",
        }}
      >
        <h1 style={{ fontSize: "1.25rem", fontWeight: 600 }}>
          문제가 발생했습니다
        </h1>
        <p style={{ maxWidth: "24rem", fontSize: "0.875rem", color: "#64748b" }}>
          페이지를 표시할 수 없습니다. 잠시 후 다시 시도해 주세요.
        </p>
        <button
          onClick={reset}
          style={{
            borderRadius: "0.5rem",
            border: "1px solid #cbd5e1",
            padding: "0.5rem 1rem",
            fontSize: "0.875rem",
            cursor: "pointer",
          }}
        >
          다시 시도
        </button>
      </body>
    </html>
  );
}
