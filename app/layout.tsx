import type { Metadata } from "next";
import "./globals.css";

import { Toaster } from "@/components/ui/toaster";

export const metadata: Metadata = {
  title: {
    default: "CASTLOG 캐스트로그",
    template: "%s | CASTLOG",
  },
  description:
    "창업교육·창업컨설팅 기업을 위한 통합 플랫폼 — 프로젝트 관리부터 전자결재까지, 한 번에.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <head>
        <link rel="preconnect" href="https://cdn.jsdelivr.net" />
        <link
          rel="stylesheet"
          href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.min.css"
        />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Poppins:wght@500;600&display=swap"
        />
      </head>
      <body className="font-sans">
        {children}
        <Toaster />
      </body>
    </html>
  );
}
