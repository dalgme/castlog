import Link from "next/link";
import type { ReactNode } from "react";

import { LogoMark, Wordmark } from "@/components/brand/logo";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

/** 로그인 계열 화면 공통 셸 — 모바일 완전 대응 (전문가 로그인이 최우선 대상) */
export function AuthCard({
  title,
  description,
  children,
  footer,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-secondary/50 px-4 py-10">
      <Link href="/" className="mb-8 flex items-center gap-2.5">
        <LogoMark width={24} height={30} />
        <Wordmark className="text-lg" />
      </Link>
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-lg">{title}</CardTitle>
          {description && <CardDescription>{description}</CardDescription>}
        </CardHeader>
        <CardContent>{children}</CardContent>
      </Card>
      {footer && (
        <div className="mt-5 text-center text-sm text-muted-foreground">
          {footer}
        </div>
      )}
    </div>
  );
}
