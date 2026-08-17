import Link from "next/link";

import { Button } from "@/components/ui/button";

/**
 * 이미 로그인된 상태로 /login에 들어왔을 때.
 *
 * 예전에는 곧바로 현재 계정의 홈으로 리다이렉트했는데, 랜딩에서 '로그인'을 누른
 * 사용자가 (다른 계정으로 들어가려던 참인데) 영문도 모르고 전문가 포털로
 * 튕기는 문제가 있었다. 어디로 갈지 사용자가 고르게 한다.
 */
export function AlreadySignedIn({
  accountLabel,
  roleLabel,
  continueHref,
}: {
  accountLabel: string;
  roleLabel: string;
  continueHref: string;
}) {
  return (
    <div className="space-y-4">
      <div className="rounded-md border bg-secondary/40 p-3 text-sm">
        <p className="font-medium">{accountLabel}</p>
        <p className="text-xs text-muted-foreground">{roleLabel}(으)로 로그인되어 있습니다.</p>
      </div>

      <Button asChild className="w-full">
        <Link href={continueHref}>이 계정으로 계속하기</Link>
      </Button>

      {/* 로그아웃은 POST 전용(프리페치로 인한 의도치 않은 로그아웃 방지) */}
      <form action="/auth/logout" method="post">
        <input type="hidden" name="redirectTo" value="/login" />
        <Button type="submit" variant="outline" className="w-full">
          다른 계정으로 로그인
        </Button>
      </form>

      <p className="text-center text-xs text-muted-foreground">
        기업 담당자 계정과 전문가 계정은 서로 다른 계정입니다. 두 가지를 함께
        쓰신다면 브라우저 프로필이나 시크릿 창을 나눠 쓰시면 편합니다.
      </p>
    </div>
  );
}
