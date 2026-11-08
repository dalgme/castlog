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
    // AI 이력 요약(기획 2026-11-07): HWP 파서(rhwp, Rust+WASM)와 DOCX 추출(mammoth)은 번들하지 않고
    // Node가 node_modules에서 그대로 읽는다 — WASM 11MB를 웹팩에 넣지 않기 위해서다.
    serverComponentsExternalPackages: ["@rhwp/core", "mammoth", "nodemailer"],
    // 서버리스 번들에 WASM 파일이 따라가도록 명시 (import.meta.url 참조만으로는 누락될 수 있다)
    outputFileTracingIncludes: {
      "/[tenantSlug]/experts": ["./node_modules/@rhwp/core/rhwp_bg.wasm"],
      "/[tenantSlug]/projects/[projectId]": ["./node_modules/@rhwp/core/rhwp_bg.wasm"],
      "/expert/documents": ["./node_modules/@rhwp/core/rhwp_bg.wasm"],
    },
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
