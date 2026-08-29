import Link from "next/link";
import { redirect } from "next/navigation";
import { CircleCheck, Circle, ShieldAlert, Info } from "lucide-react";

import { requireUser, postLoginPath } from "@/lib/auth/session";
import { roleFromUser, tenantIdFromUser } from "@/lib/auth/tenant";
import { getAdminScopes } from "@/lib/auth/admin-scopes";
import { getTenantModules } from "@/lib/modules/server";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { PageHeader } from "@/components/layout/header";
import { EmptyState } from "@/components/layout/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { getSetupStatus, type SetupItem } from "@/lib/onboarding/setup-checklist";

export const metadata = { title: "최초 설정" };

/**
 * 대표 최초 설정 안내 (/{tenant}/setup)
 *
 * 가입 직후 반드시 잡아야 하는 설정을 한 화면에 모은다. 남은 필수 항목이 있으면
 * 대시보드 상단 띠가 계속 이 화면을 가리킨다.
 */
export default async function SetupPage({
  params,
}: {
  params: { tenantSlug: string };
}) {
  const user = await requireUser();
  if (!user) return null;

  const role = roleFromUser(user);
  const scopes = await getAdminScopes();
  const allowed =
    role === "org_admin" ||
    role === "platform_admin" ||
    Object.values(scopes).some(Boolean);
  if (!allowed) redirect(postLoginPath(user));

  const tenantId = tenantIdFromUser(user);
  if (!hasSupabaseEnv() || !tenantId) {
    return (
      <div>
        <PageHeader title="최초 설정" />
        <main className="p-5">
          <EmptyState
            title="서버 설정 대기 중"
            description="Supabase 환경변수가 설정되면 표시됩니다."
          />
        </main>
      </div>
    );
  }

  const modules = await getTenantModules();
  const status = await getSetupStatus(tenantId, params.tenantSlug, modules);
  const isCeo = role === "org_admin";

  const required = status.items.filter((i) => i.required);
  const recommended = status.items.filter((i) => !i.required);

  return (
    <div>
      <PageHeader
        title="최초 설정"
        actions={
          <Button asChild variant="ghost" size="sm">
            <Link href={`/${params.tenantSlug}/dashboard`}>대시보드로</Link>
          </Button>
        }
      />
      <main className="space-y-5 p-5">
        <Card>
          <CardContent className="pt-6">
            {status.requiredRemaining > 0 ? (
              <div className="flex items-start gap-2">
                <ShieldAlert
                  className="mt-0.5 h-5 w-5 flex-none text-amber-700"
                  aria-hidden
                />
                <div>
                  <p className="font-semibold text-brand-navy">
                    꼭 필요한 설정 {status.requiredRemaining}건이 남아 있습니다
                  </p>
                  <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                    아래 항목을 마치기 전에는 문자 발송·결재 상신 같은 핵심 업무가
                    실제로 막히거나, 법적 의무를 채우지 못한 상태로 운영됩니다.
                    지금 한 번에 끝내 두는 편이 낫습니다.
                  </p>
                </div>
              </div>
            ) : (
              <div className="flex items-start gap-2">
                <CircleCheck
                  className="mt-0.5 h-5 w-5 flex-none text-green-700"
                  aria-hidden
                />
                <div className="min-w-0">
                  <p className="font-semibold text-brand-navy">
                    필수 설정이 모두 끝났습니다
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {status.recommendedRemaining > 0
                      ? `권장 항목 ${status.recommendedRemaining}건이 남아 있습니다. 실무에서 곧 필요해지는 것들입니다.`
                      : "권장 항목까지 모두 마쳤습니다."}
                  </p>
                  {/* 설정이 끝난 다음의 길 — "이제 뭘 하지?"에서 끊기지 않게
                      업무 준비 순서로 이어 준다 (검수 3c). experts 모듈을 쓰는
                      회사에만 — 안 쓰는 회사에 링크를 주면 게이트에 튕긴다 */}
                  {modules.experts && (
                  <div className="mt-3 rounded-md border bg-secondary/30 p-3">
                    <p className="text-sm font-semibold">
                      다음은 섭외 업무 준비입니다
                    </p>
                    <ol className="mt-1 list-decimal space-y-0.5 pl-5 text-xs leading-relaxed text-muted-foreground">
                      <li>전문가 등록 — 보유 명단 엑셀·파일로 한 번에</li>
                      <li>프로젝트 개설 → 세션(코드넘버) 등록</li>
                      <li>섭외 후보 구성 → 섭외 요청</li>
                    </ol>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Button asChild size="sm">
                        <Link href={`/${params.tenantSlug}/experts`}>
                          전문가 등록 시작
                        </Link>
                      </Button>
                      <Button asChild size="sm" variant="outline">
                        <Link href={`/${params.tenantSlug}/guide`}>
                          섭외 절차 안내 보기
                        </Link>
                      </Button>
                      <Button asChild size="sm" variant="outline">
                        <Link href={`/${params.tenantSlug}/dashboard`}>
                          연습모드로 먼저 익히기 (대시보드 우측 상단)
                        </Link>
                      </Button>
                    </div>
                  </div>
                  )}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <SetupGroup
          title="꼭 필요한 설정"
          items={required}
          isCeo={isCeo}
        />
        <SetupGroup
          title="권장 설정"
          items={recommended}
          isCeo={isCeo}
        />

        {!isCeo && (
          <p className="flex items-start gap-1.5 rounded-md bg-secondary/50 p-3 text-xs text-muted-foreground">
            <Info className="mt-0.5 h-3.5 w-3.5 flex-none" aria-hidden />
            ‘대표 전용’ 표시가 붙은 항목은 대표 계정만 처리할 수 있습니다. 위임받은
            권한으로는 열리지 않습니다.
          </p>
        )}
      </main>
    </div>
  );
}

/**
 * 설정 화면으로 갈 때 '최초 설정에서 왔다'는 사실을 들려 보낸다.
 *
 * 이 표식이 있으면 도착한 화면 위에 복귀 띠가 뜬다(SetupReturnBar). 예전에는
 * 한 항목을 처리하러 떠나면 돌아올 길이 없어서, 사용자가 사이드바를 뒤지거나
 * 그냥 포기했다. 체크리스트는 한 번에 끝내라고 만든 것인데 항목마다 길을
 * 잃으면 그 목적이 무너진다.
 */
function setupHref(item: SetupItem): string {
  const join = item.href.includes("?") ? "&" : "?";
  return `${item.href}${join}from=setup&item=${encodeURIComponent(item.title)}`;
}

function SetupGroup({
  title,
  items,
  isCeo,
}: {
  title: string;
  items: SetupItem[];
  isCeo: boolean;
}) {
  if (items.length === 0) return null;
  const remaining = items.filter((i) => !i.done).length;
  return (
    <Card>
      <CardContent className="pt-6">
        <p className="mb-3 text-sm font-semibold">
          {title}{" "}
          <span className="font-normal text-muted-foreground">
            ({items.length - remaining}/{items.length} 완료)
          </span>
        </p>
        <ul className="space-y-2.5">
          {items.map((item) => (
            <li
              key={item.key}
              className={
                "rounded-lg border p-3 " +
                (item.done ? "bg-secondary/30" : "border-brand/30")
              }
            >
              <div className="flex flex-wrap items-center gap-2">
                {item.done ? (
                  <CircleCheck
                    className="h-4 w-4 flex-none text-green-700"
                    aria-hidden
                  />
                ) : (
                  <Circle
                    className="h-4 w-4 flex-none text-muted-foreground"
                    aria-hidden
                  />
                )}
                <span className="text-sm font-semibold">{item.title}</span>
                {item.ceoOnly && (
                  <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">
                    대표 전용
                  </Badge>
                )}
                {!item.done &&
                  !item.note &&
                  (item.ceoOnly && !isCeo ? (
                    // asChild+Link에는 disabled가 듣지 않는다 — 눌리는 링크를
                    // 두면 도착한 화면에 해당 카드가 없어 '눌렀는데 아무것도
                    // 없음'이 된다. 진짜 비활성 버튼으로 그린다.
                    <Button
                      size="sm"
                      variant="outline"
                      className="ml-auto"
                      disabled
                    >
                      대표만 가능
                    </Button>
                  ) : (
                    <Button
                      asChild
                      size="sm"
                      variant={item.required ? "default" : "outline"}
                      className="ml-auto"
                    >
                      <Link href={setupHref(item)}>설정하기</Link>
                    </Button>
                  ))}
              </div>
              <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
                {item.why}
              </p>
              {item.note && (
                <p className="mt-1.5 rounded-md bg-secondary/50 p-2 text-xs text-muted-foreground">
                  {item.note}
                </p>
              )}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
