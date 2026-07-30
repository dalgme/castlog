/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverActions: {
      // 서류 업로드(서버 액션 FormData) 상한 — 파일별 상한은 서버에서 별도 검증
      bodySizeLimit: "12mb",
    },
  },
};

export default nextConfig;
