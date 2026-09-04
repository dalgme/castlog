import Link from "next/link";
import { notFound } from "next/navigation";

import { requireRole } from "@/lib/auth/session";
import { canExecTenant } from "@/lib/auth/exec-policy";
import { requireModule, getTenantModules, isExpertsLite } from "@/lib/modules/server";
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
  const expertsLite = await isExpertsLite();

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

  // 전문가 정보 요약 (기획 2026-08-30 — 21번): 이 자리에 배정·진행 중인
  // 전문가를 프로젝트 정보 옆에 나란히 보여 준다. 섭외에 필요한 공개 정보만
  // (§4 전면 공개 범위 — 프로필·연락처·분야).
  const { data: expertRow } = ctx.assignedExpertId
    ? await createClient()
        .from("experts")
        .select(
          "name, phone, email, organization, job_title, specialty, career_years, region"
        )
        .eq("id", ctx.assignedExpertId)
        .maybeSingle()
    : { data: null };

  // 후보·섭외 실행은 레벨 4(대리)부터 — 서버 게이트와 같은 기준
  const canManage = await canExecTenant("engagementRequest", user);
  const modules = await getTenantModules();
  const planGate = await evaluatePlanGate(ctx.projectId, modules.approvals);
  // 요청을 보낼 수 있는 자리 = open(빈 자리) 또는 assigned(배정만 된 자리).
  // 거절·만료 뒤 예비 후보에게 개별 요청하는 정식 경로가 여기다 — 서버
  // (requestEngagementForPosition)도 같은 두 상태를 허용한다 (E2E 검수 P1-3)
  const requestable = ctx.status === "open" || ctx.status === "assigned";
  const candidates = canManage && requestable ? await getSlotCandidates(ctx) : [];

  // 컨설팅 세션(34번)은 수행기간으로 표기 (감사 P3-3)
  const schedule = formatEventSchedule(
    ctx.slotDate,
    ctx.periodEndDate ?? ctx.slotDate,
    ctx.startsTime,
    ctx.endsTime
  );

  return (
    <div>
      <PageHeader
        title={`코드넘버 ${ctx.code}`}
        actions={
          <Button asChild variant="ghost" size="sm">
            <Link href={`/${params.tenantSlug}/projects/${params.projectId}`}>
              프로젝트로
            </Link>
          </Button>
        }
      />
      <main className="mx-auto max-w-2xl space-y-4 p-5">
        <div className={expertRow ? "grid gap-4 sm:grid-cols-2" : undefined}>
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
        {expertRow && (
          <Card>
            <CardHeader className="pb-2 pt-5">
              <CardTitle className="text-sm">전문가 정보 요약</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1.5 text-sm">
              <p className="text-base font-semibold">{expertRow.name}</p>
              {(expertRow.organization || expertRow.job_title) && (
                <p>
                  <span className="text-muted-foreground">소속</span>{" "}
                  {[expertRow.organization, expertRow.job_title]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              )}
              {expertRow.specialty && (
                <p>
                  <span className="text-muted-foreground">분야</span>{" "}
                  {expertRow.specialty}
                </p>
              )}
              {expertRow.career_years !== null && (
                <p>
                  <span className="text-muted-foreground">경력</span>{" "}
                  {expertRow.career_years}년
                </p>
              )}
              {expertRow.region && (
                <p>
                  <span className="text-muted-foreground">지역</span>{" "}
                  {expertRow.region}
                </p>
              )}
              <p>
                <span className="text-muted-foreground">연락처</span>{" "}
                {expertRow.phone}
              </p>
              {expertRow.email && (
                <p>
                  <span className="text-muted-foreground">이메일</span>{" "}
                  {expertRow.email}
                </p>
              )}
            </CardContent>
          </Card>
        )}
        </div>

        {!requestable ? (
          <Card>
            <CardContent className="pt-6 text-sm text-muted-foreground">
              {ctx.status === "requested"
                ? "이 자리는 섭외 요청이 나가 회신을 기다리는 중입니다. 무응답 대응(재안내·회수)은 섭외 현황에서 합니다."
                : ctx.status === "canceled"
                  ? "취소된 자리입니다. 다시 섭외하려면 세션 확인 탭에서 자리를 복구한 뒤 요청하세요."
                  : "이 자리는 섭외가 확정된 인원입니다."}
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
              섭외 요청은 레벨 4 이상만 보낼 수 있습니다 (권한 규칙).
            </CardContent>
          </Card>
        ) : planGate.required &&
          planGate.allowed &&
          planGate.coveredSlotIds &&
          !planGate.coveredSlotIds.includes(ctx.slotId) ? (
          // 부분 상신 계획 밖의 세션 — 요청 폼을 열어 두면 작성 후 서버에서야
          // 거부된다. 여기서 먼저 보완 경로를 안내한다 (리뷰 P3-6)
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">
                이 세션은 승인된 섭외계획에 없습니다
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <p className="text-muted-foreground">
                섭외계획 품의가 세션 일부만 승인된 상태입니다 (규칙). 이 세션을
                섭외하려면 섭외계획 패널의 <b>보완(추가) 품의</b>로 세션을
                추가해 승인받은 뒤 진행해 주세요.
              </p>
              <div className="flex justify-center">
                <Button
                  asChild
                  size="sm"
                  className="bg-brand-coral-dark text-white hover:bg-brand-coral-ink"
                >
                  <Link
                    href={`/${params.tenantSlug}/projects/${params.projectId}?tab=experts`}
                  >
                    프로젝트에서 계획 품의 진행
                  </Link>
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : planGate.required && !planGate.allowed ? (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">섭외계획 승인 필요</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <p className="text-muted-foreground">{planGate.message}</p>
              {/* 계획 품의는 직전 화면(전문가 섭외 탭 워크벤치)에서 진행한다.
                  가운데 정렬 + 코랄색 — 기획 지시 2026-08-30 (21번) */}
              <div className="flex justify-center">
                <Button
                  asChild
                  size="sm"
                  className="bg-brand-coral-dark text-white hover:bg-brand-coral-ink"
                >
                  <Link
                    href={`/${params.tenantSlug}/projects/${params.projectId}?tab=experts`}
                  >
                    프로젝트에서 계획 품의 진행
                  </Link>
                </Button>
              </div>
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
                {/* 라이트 모드는 발송이 없다 — 기록 후 전화 확인·수동 완료 */}
                <li>{expertsLite ? "④ 섭외 요청 기록" : "④ 섭외 요청 발송"}</li>
              </ol>
            </CardHeader>
            <CardContent>
              <CandidatePicker
                positionId={ctx.positionId}
                candidates={candidates}
                defaultExpertId={ctx.assignedExpertId}
                defaultProgramName={ctx.projectName}
                defaultSummary={projectRow?.description ?? null}
                tenantSlug={params.tenantSlug}
                projectId={params.projectId}
                expertsLite={expertsLite}
              />
            </CardContent>
          </Card>
        )}

        {/* 코드넘버 상세는 프로젝트에서 들어와 프로젝트로 돌아가는 자리다.
            돌아가는 문을 화면 맨 아래 전체 폭으로 크게 둔다 (기획 지시) */}
        <Button asChild variant="outline" className="h-12 w-full text-base">
          <Link
            href={`/${params.tenantSlug}/projects/${params.projectId}?tab=overview`}
          >
            프로젝트 현황 대시보드로 가기
          </Link>
        </Button>
      </main>
    </div>
  );
}
