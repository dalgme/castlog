import Link from "next/link";
import { ArrowRight, Check, GraduationCap, Lock } from "lucide-react";

import { requireRole } from "@/lib/auth/session";
import { gradeFromUser, practiceFromUser } from "@/lib/auth/tenant";
import { GRADE_LABELS, gradeAtLeast } from "@/lib/auth/grades";
import { getTenantModules } from "@/lib/modules/server";
import {
  COMMON_BASELINE_FEATURES,
  MODULE_LABELS,
} from "@/lib/modules/modules";
import {
  ENGAGEMENT_GUIDE_STEPS,
  GUIDE_PERMISSION_NOTES,
} from "@/lib/integrations/engagement-guide";
import { buildTenantPath } from "@/lib/routing/links";
import { PageHeader } from "@/components/layout/header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export const metadata = { title: "전문가 섭외 관리 안내" };

/**
 * 전문가 섭외 관리 — 기능·프로세스 안내.
 *
 * 매뉴얼을 따로 두면 아무도 안 읽는다. 각 단계에서 실제 화면으로 바로 갈 수 있게
 * 하고, 지금 로그인한 사람의 등급·모듈 조합에 맞춰 '내가 할 수 있는 단계'를
 * 표시한다. 못 하는 단계도 숨기지 않고 왜 잠겼는지 보여준다 — 흐름 전체를
 * 이해해야 자기 단계에서 뭘 넘겨야 하는지 안다.
 */
export default async function EngagementGuidePage({
  params,
}: {
  params: { tenantSlug: string };
}) {
  const user = await requireRole([
    "platform_admin",
    "org_admin",
    "manager",
    "staff",
  ]);
  const modules = await getTenantModules();
  const grade = gradeFromUser(user);
  const practice = practiceFromUser(user);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader title="전문가 섭외 관리 안내" />
      <main className="mx-auto w-full max-w-4xl space-y-5 p-4 sm:p-6">
        <Card>
          <CardContent className="space-y-3 pt-6">
            <p className="text-sm leading-relaxed">
              프로젝트를 열고, 필요한 전문가 자리를 만들고, 승인을 받아 섭외하고,
              수행 후 평가하고 지급하기까지의 전체 흐름입니다. 회사가 쓰는 모듈에
              따라 일부 단계는 건너뜁니다.
            </p>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="text-muted-foreground">현재 설정</span>
              {(["experts", "approvals", "operations"] as const).map((key) => (
                <Badge
                  key={key}
                  variant={modules[key] ? "secondary" : "outline"}
                  className="text-[10px]"
                >
                  {MODULE_LABELS[key]} {modules[key] ? "사용" : "미사용"}
                </Badge>
              ))}
              {grade && (
                <Badge className="text-[10px]">내 권한: {GRADE_LABELS[grade]}</Badge>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="space-y-2 pt-6">
            <h2 className="text-sm font-bold">
              모듈과 무관하게 항상 쓰는 기능 (공통)
            </h2>
            <p className="text-xs leading-relaxed text-muted-foreground">
              어떤 조합을 쓰든 일은 프로젝트를 여는 데서 시작합니다. 아래는 사용
              모듈과 관계없이 항상 제공됩니다.
            </p>
            <ul className="grid gap-1 sm:grid-cols-2">
              {COMMON_BASELINE_FEATURES.map((feature) => (
                <li key={feature} className="flex items-start gap-1.5 text-sm">
                  <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand" />
                  <span>{feature}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        {!practice && (
          <Card className="border-amber-300 bg-amber-50/60">
            <CardContent className="flex flex-wrap items-center gap-3 pt-6">
              <GraduationCap className="h-5 w-5 shrink-0 text-amber-700" />
              <p className="min-w-0 flex-1 text-sm text-amber-950">
                실제 데이터를 건드리지 않고 이 흐름을 처음부터 끝까지 해볼 수
                있습니다. 화면 상단의 <strong>연습모드</strong>로 들어가면 가상
                전문가 5명과 진행 중인 가상 프로젝트가 준비된 상태로 시작합니다.
                문자·이메일은 실제로 발송되지 않습니다.
              </p>
            </CardContent>
          </Card>
        )}

        <ol className="space-y-3">
          {ENGAGEMENT_GUIDE_STEPS.map((step) => {
            const missingModules = step.modules.filter((m) => !modules[m]);
            const moduleOff = missingModules.length > 0;
            const gradeOk = grade ? gradeAtLeast(grade, step.minGrade) : true;
            const locked = moduleOff || !gradeOk;

            return (
              <li key={step.no}>
                <Card className={locked ? "opacity-70" : undefined}>
                  <CardContent className="space-y-2 pt-6">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={
                          "flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold " +
                          (locked
                            ? "bg-muted text-muted-foreground"
                            : "bg-brand text-white")
                        }
                      >
                        {step.no}
                      </span>
                      <h2 className="text-sm font-bold">{step.title}</h2>
                      {locked ? (
                        <Badge variant="outline" className="gap-1 text-[10px]">
                          <Lock className="h-3 w-3" />
                          {moduleOff
                            ? `${missingModules
                                .map((m) => MODULE_LABELS[m])
                                .join("·")} 미사용`
                            : `${GRADE_LABELS[step.minGrade]} 이상 필요`}
                        </Badge>
                      ) : (
                        <Badge variant="secondary" className="gap-1 text-[10px]">
                          <Check className="h-3 w-3" />
                          내 권한으로 가능
                        </Badge>
                      )}
                      {step.href && !locked && (
                        <Button
                          asChild
                          size="sm"
                          variant="ghost"
                          className="ml-auto h-7 gap-1 text-xs"
                        >
                          <Link href={buildTenantPath(params.tenantSlug, step.href)}>
                            바로 가기
                            <ArrowRight className="h-3.5 w-3.5" />
                          </Link>
                        </Button>
                      )}
                    </div>

                    <p className="text-sm leading-relaxed text-muted-foreground">
                      {step.summary}
                    </p>
                    {step.caution && (
                      <p className="rounded-md bg-secondary/60 p-2.5 text-xs leading-relaxed">
                        {step.caution}
                      </p>
                    )}
                  </CardContent>
                </Card>
              </li>
            );
          })}
        </ol>

        <Card>
          <CardContent className="space-y-3 pt-6">
            <h2 className="text-sm font-bold">권한을 헷갈리기 쉬운 지점</h2>
            {GUIDE_PERMISSION_NOTES.map((note) => (
              <div key={note.title} className="space-y-0.5">
                <p className="text-sm font-semibold">{note.title}</p>
                <p className="text-sm leading-relaxed text-muted-foreground">
                  {note.body}
                </p>
              </div>
            ))}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
