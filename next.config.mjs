/** @type {import('next').NextConfig} */

// 전역 보안 헤더 — 결재·서명·서류 등 민감 화면의 클릭재킹·스니핑 차단.
// CSP는 서명 캔버스·Supabase·지도 등 실측 튜닝이 필요해 별도 단계에서 도입(배포 런북 참조).
const securityHeaders = [
  // HTTPS 강제(Vercel은 HTTPS 종단). 서브도메인 포함, 프리로드 대상.
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  // iframe 임베드 전면 차단(결재 승인·서명 페이지 클릭재킹 방지).
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // 불필요 권한 차단(카메라·마이크). 위치는 지도(Phase 2) 대비 self 허용.
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(self), interest-cohort=()",
  },
];

const nextConfig = {
  // X-Powered-By 노출 제거(스택 핑거프린팅 축소).
  poweredByHeader: false,
  experimental: {
    serverActions: {
      // 서류 업로드(서버 액션 FormData) 상한 — 파일별 상한은 서버에서 별도 검증
      bodySizeLimit: "12mb",
    },
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
