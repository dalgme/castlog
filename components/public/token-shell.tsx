import { LogoMark, Wordmark } from "@/components/brand/logo";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

/**
 * 공개 매직링크 페이지 공통 셸 (로그인 불필요, 모바일 완전 대응).
 * 실제 토큰 검증·처리는 각 단계에서 구현된다:
 *  /e 단계 13 · /j /d 단계 6~7 · /u 단계 14
 */
export function PublicTokenShell({
  title,
  description,
  token,
}: {
  title: string;
  description: string;
  token: string;
}) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-secondary/50 p-4">
      <div className="flex items-center gap-2.5">
        <LogoMark width={26} height={32} />
        <Wordmark className="text-lg" />
      </div>
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          <p>
            이 링크는 아직 준비 중입니다. 문제가 계속되면 안내받은 담당자에게
            문의해주세요.
          </p>
          <p className="mt-3 break-all rounded-md bg-muted p-2 font-mono text-xs">
            token: {token}
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
