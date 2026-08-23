import Link from "next/link";
import { notFound } from "next/navigation";

import { requireRole } from "@/lib/auth/session";
import { gradeFromUser, roleFromUser } from "@/lib/auth/tenant";
import { canExec } from "@/lib/auth/exec-permissions";
import { requireModule, getTenantModules } from "@/lib/modules/server";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";
import { formatKrw } from "@/lib/approvals/constants";
import {
  getPositionContext,
  getSlotCandidates,
} from "@/lib/integrations/slot-candidates";
import {
  ENGAGEMENT_ROLE_TYPES,
  formatEventSchedule,
} from "@/lib/integrations/engagement-roles";
import { POSITION_STATUS_LABELS } from "@/lib/integrations/slot-codes";
import { evaluatePlanGate } from "@/lib/integrations/engagement-plans";
import { PageHeader } from "@/components/layout/header";
import { EmptyState } from "@/components/layout/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

import { CandidatePicker } from "./candidate-picker";

export const metadata = { title: "섭외 후보군" };

/**
 * 넘버링코드 상세 — 코드별 섭외 후보군 조회(일정 중복 자동 검증) 후 섭외요청.
 * 가시성은 프로젝트를 따른다(권한자=전체, 담당자=배정분만).
 */
export default async function PositionPage({
  params,
}: {
  params: { tenantSlug: string; projectId: string; positionId: string };
}) {
  const user = await requireRole([
    "platform_admin",
    "org_admin",
    "manager",
    "staff",
  ]);
  await requireModule("experts");

  if (!hasSupabaseEnv()) {
    return (
      <div>
        <PageHeader title="섭외 후보군" />
        <main className="p-5">
          <EmptyState
            title="서버 설정 대기 중"
            description="Supabase 환경변수가 설정되면 표시됩니다."
          />
        </main>
      </div>
    );
  }

  const ctx = await getPositionContext(params.positionId);
  if (!ctx) notFound();

  // 프로젝트 설명 — 섭외요청의 '주제/행사 내용' 자동 채움 (기획 확정 2026-08-23)
  const { data: projectRow } = await createClient()
    .from("projects")
    .select("description")
    .eq("id", ctx.projectId)
    .maybeSingle();

  const role = roleFromUser(user);
  // 후보·섭외 실행은 레벨 4(대리)부터 — 서버 게이트와 같은 기준
  const canManage = canExec("engagementRequest", gradeFromUser(user), role);
  const modules = await getTenantModules();
  const planGate = await evaluatePlanGate(ctx.projectId, modules.approvals);
  const candidates = canManage && ctx.status === "open" ? await getSlotCandidates(ctx) : [];

  const schedule = formatEventSchedule(
    ctx.slotDate,
    ctx.slotDate,
    ctx.startsTime,
    ctx.endsTime
  );

  return (
    <div>
      <PageHeader
        title={`섭외 코드 ${ctx.code}`}
        actions={
          <Button asChild variant="ghost" size="sm">
            <Link href={`/${params.tenantSlug}/projects/${params.projectId}`}>
              프로젝트로
            </Link>
          </Button>
        }
      />
      <main className="mx-auto max-w-2xl space-y-4 p-5">
        <Card>
          <CardContent className="space-y-1.5 pt-6 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-base font-bold">{ctx.code}</span>
              <Badge variant="secondary">
                {ENGAGEMENT_ROLE_TYPES[
                  ctx.roleType as keyof typeof ENGAGEMENT_ROLE_TYPES
                ] ?? ctx.roleType}
              </Badge>
              <Badge variant={ctx.status === "open" ? "outline" : "default"}>
                {POSITION_STATUS_LABELS[ctx.status] ?? ctx.status}
              </Badge>
            </div>
            <p>
              <span className="text-muted-foreground">프로젝트</span>{" "}
              {ctx.projectName}
            </p>
            {ctx.sessionName && (
              <p>
                <span className="text-muted-foreground">세션</span>{" "}
                {ctx.sessionName}
              </p>
            )}
            {schedule && (
              <p>
                <span className="text-muted-foreground">일정</span> {schedule}
              </p>
            )}
            {ctx.roleDescription && (
              <p>
                <span className="text-muted-foreground">세부 역할</span>{" "}
                {ctx.roleDescription}
              </p>
            )}
            {ctx.locationName && (
              <p>
                <span className="text-muted-foreground">장소</span> {ctx.locationName}
                {ctx.locationAddress ? ` (${ctx.locationAddress})` : ""}
              </p>
            )}
            {ctx.feeAmount !== null && (
              <p>
                <span className="text-muted-foreground">1인 비용</span>{" "}
                {formatKrw(ctx.feeAmount)}
              </p>
            )}
          </CardContent>
        </Card>

        {ctx.status !== "open" ? (
          <Card>
            <CardContent className="pt-6 text-sm text-muted-foreground">
              이 인원은 이미 섭외가 진행되었습니다.
              {ctx.engagementId && (
                <>
                  {" "}
                  <Link
                    href={`/${params.tenantSlug}/experts/acceptances/${ctx.engagementId}`}
                    className="text-brand underline"
                  >
                    수락서 보기
                  </Link>
                </>
              )}
            </CardContent>
          </Card>
        ) : !canManage ? (
          <Card>
            <CardContent className="pt-6 text-sm text-muted-foreground">
              섭외 요청은 관리자 이상만 보낼 수 있습니다.
            </CardContent>
          </Card>
        ) : planGate.required && !planGate.allowed ? (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">섭외계획 승인 필요</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <p className="text-muted-foreground">{planGate.message}</p>
              <Button asChild variant="outline" size="sm">
                <Link href={`/${params.tenantSlug}/projects/${params.projectId}`}>
                  프로젝트에서 계획 품의 진행
                </Link>
              </Button>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">섭외 후보군 (일정 중복 자동 검증)</CardTitle>
              {/* 한 화면에서 네 단계가 이어진다는 것을 먼저 말해 준다 —
                  절차를 모르면 후보 목록이 그냥 명단으로만 보인다 */}
              <ol className="flex flex-wrap gap-x-2 gap-y-1 pt-1 text-xs text-muted-foreground">
                <li>① 전문가 조회</li>
                <li aria-hidden>›</li>
                <li>② 일정 겹침 확인</li>
                <li aria-hidden>›</li>
                <li>③ 요청서 작성</li>
                <li aria-hidden>›</li>
                <li>④ 섭외 요청 발송</li>
              </ol>
            </CardHeader>
            <CardContent>
              <CandidatePicker
                positionId={ctx.positionId}
                candidates={candidates}
                defaultProgramName={ctx.projectName}
                defaultSummary={projectRow?.description ?? null}
                tenantSlug={params.tenantSlug}
                projectId={params.projectId}
              />
            </CardContent>
          </Card>
        )}

        {/* 코드넘버 상세는 프로젝트에서 들어와 프로젝트로 돌아가는 자리다.
            돌아가는 문을 화면 맨 아래 전체 폭으로 크게 둔다 (기획 지시) */}
        <Button asChild variant="outline" className="h-12 w-full text-base">
          <Link href={`/${params.tenantSlug}/projects/${params.projectId}`}>
            프로젝트로
          </Link>
        </Button>
      </main>
    </div>
  );
}
