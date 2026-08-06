import Link from "next/link";

import { Button } from "@/components/ui/button";

export const metadata = { title: "페이지를 찾을 수 없습니다" };

/** 전역 404 — 존재하지 않는 경로 또는 접근 권한이 없어 조회되지 않는 리소스 */
export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-secondary/50 px-6 text-center">
      <p className="text-5xl font-bold text-muted-foreground">404</p>
      <h1 className="text-xl font-semibold">페이지를 찾을 수 없습니다</h1>
      <p className="max-w-sm text-sm text-muted-foreground">
        주소가 바뀌었거나 접근 권한이 없는 페이지입니다. 링크가 오래되었을 수 있어요.
      </p>
      <Button asChild variant="outline" size="sm">
        <Link href="/">처음으로</Link>
      </Button>
    </main>
  );
}
