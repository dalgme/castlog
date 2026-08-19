import Link from "next/link";

import { requireUser } from "@/lib/auth/session";
import { roleFromUser, tenantIdFromUser } from "@/lib/auth/tenant";
import {
  canEnterPlatformMode,
  readPriorContext,
} from "@/lib/auth/platform-mode";
import { PageHeader } from "@/components/layout/header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { PlatformModeButton } from "@/components/layout/platform-mode-button";

export const metadata = { title: "관리자 모드 진단" };

function Row({
  label,
  value,
  ok,
}: {
  label: string;
  value: string;
  /** 판정이 있는 항목만 색을 준다 */
  ok?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 border-b py-2 last:border-b-0">
      <dt className="w-40 shrink-0 text-xs text-muted-foreground">{label}</dt>
      <dd
        className={
          ok === undefined
            ? "min-w-0 flex-1 break-all text-sm"
            : ok
              ? "min-w-0 flex-1 break-all text-sm font-semibold text-emerald-700"
              : "min-w-0 flex-1 break-all text-sm font-semibold text-destructive"
        }
      >
        {value}
      </dd>
    </div>
  );
}

/**
 * 관리자 모드 진단.
 *
 * 전환이 안 될 때 원인은 셋 중 하나다 — 명단에 없거나, 환경변수를 못 읽거나,
 * 이미 전환되어 있거나. 그런데 지금까지는 어느 쪽인지 알 방법이 없었다.
 * 이 화면은 판정에 쓰이는 값을 그대로 보여 준다.
 *
 * 로그인한 사람이면 누구나 열 수 있다 — 보여 주는 것은 **자기 자신의** 계정
 * 정보뿐이고, 명단 자체(다른 사람의 이메일)는 노출하지 않는다.
 */
export default async function AdminModeDiagnosticPage() {
  const user = await requireUser();
  const allowed = canEnterPlatformMode(user);
  const role = roleFromUser(user);
  const prior = readPriorContext(user);
  const isAdminNow = role === "platform_admin";

  return (
    <div className="min-h-screen bg-secondary/50">
      <PageHeader
        title="관리자 모드 진단"
        actions={
          <Button asChild variant="ghost" size="sm">
            <Link href="/">돌아가기</Link>
          </Button>
        }
      />
      <main className="mx-auto max-w-lg space-y-4 p-4 sm:p-6">
        <Card>
          <CardContent className="pt-5">
            <dl>
              <Row label="로그인 이메일" value={user?.email ?? "(확인 불가)"} />
              <Row
                label="관리자 모드 명단"
                value={allowed ? "등록됨" : "등록되지 않음"}
                ok={allowed}
              />
              <Row label="현재 역할" value={role ?? "(없음)"} />
              <Row
                label="현재 테넌트"
                value={
                  (user?.app_metadata?.tenant_slug as string | undefined) ??
                  tenantIdFromUser(user) ??
                  "(없음)"
                }
              />
              <Row
                label="복귀 정보"
                value={
                  prior
                    ? `보관됨 (${prior.tenant_slug ?? prior.role})`
                    : "없음 — 관리모드로 전환한 적이 없습니다"
                }
              />
            </dl>
          </CardContent>
        </Card>

        {isAdminNow ? (
          <Card className="border-brand">
            <CardContent className="space-y-3 pt-5">
              <p className="text-sm font-semibold text-brand-navy">
                이미 관리자 모드입니다.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button asChild size="sm">
                  <Link href="/platform-admin">관리모드로 이동</Link>
                </Button>
                <PlatformModeButton mode="exit" />
              </div>
            </CardContent>
          </Card>
        ) : allowed ? (
          <Card className="border-brand">
            <CardContent className="space-y-3 pt-5">
              <p className="text-sm font-semibold text-brand-navy">
                전환할 수 있습니다.
              </p>
              <p className="text-xs leading-relaxed text-muted-foreground">
                아래 버튼을 누르면 관리자 모드로 올라갑니다. 실패하면 그 자리에
                이유가 표시됩니다.
              </p>
              <PlatformModeButton mode="enter" />
            </CardContent>
          </Card>
        ) : (
          <Card className="border-destructive/40">
            <CardContent className="space-y-2 pt-5">
              <p className="text-sm font-semibold text-destructive">
                이 계정은 관리자 모드로 전환할 수 없습니다.
              </p>
              <ul className="list-disc space-y-1 pl-4 text-xs leading-relaxed text-muted-foreground">
                <li>
                  배포 환경변수 <code>PLATFORM_ADMIN_EMAILS</code> 에 위
                  <strong> 로그인 이메일</strong>이 정확히 들어 있는지 확인하세요
                  (오타·공백·대문자는 무시되지만 다른 주소면 통과하지 않습니다).
                </li>
                <li>
                  값을 넣은 뒤 <strong>Redeploy</strong> 를 했는지 확인하세요.
                  환경변수는 배포 시점에 주입됩니다.
                </li>
                <li>
                  Vercel에서 적용 범위(Environments)에 <strong>Production</strong>{" "}
                  이 체크되어 있는지 확인하세요.
                </li>
              </ul>
            </CardContent>
          </Card>
        )}
      </main>
    </div>
  );
}
