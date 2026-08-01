import Link from "next/link";

import { requireRole } from "@/lib/auth/session";
import { getTenantModules, requireModule } from "@/lib/modules/server";
import { createClient } from "@/lib/supabase/server";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { formatKrw } from "@/lib/approvals/constants";
import { calculateWithholding, isPaymentType } from "@/lib/payments/tax";
import { PageHeader } from "@/components/layout/header";
import { EmptyState } from "@/components/layout/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

import { BatchCreator, type PayableRow } from "./batch-creator";
import { BatchActions } from "./batch-actions";

export const metadata = { title: "비용·지급" };

const BATCH_STATUS_LABELS: Record<string, string> = {
  pending: "결재 대기",
  approval_in_progress: "결재 진행중",
  confirmed: "지급 확정",
  paid: "지급 완료",
  canceled: "취소",
};

const BATCH_STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  pending: "outline",
  approval_in_progress: "default",
  confirmed: "secondary",
  paid: "secondary",
  canceled: "destructive",
};

/**
 * 비용·지급 (experts ↔ approvals 연동 — 기획 확정: 프로젝트별 일괄 리스트·일괄 품의)
 */
export default async function PaymentsPage({
  params,
}: {
  params: { tenantSlug: string };
}) {
  await requireRole(["platform_admin", "org_admin", "manager", "staff"]);
  await requireModule("experts");

  if (!hasSupabaseEnv()) {
    return (
      <div>
        <PageHeader title="비용·지급" />
        <main className="p-5">
          <EmptyState
            title="서버 설정 대기 중"
            description="Supabase 환경변수가 설정되면 표시됩니다."
          />
        </main>
      </div>
    );
  }

  const supabase = createClient();
  const modules = await getTenantModules();

  const [
    { data: acceptedEngagements },
    { data: activeItems },
    { data: batches },
  ] = await Promise.all([
    supabase
      .from("expert_engagements")
      .select(
        "id, expert_id, project_id, fee_amount, role_description, experts (name), projects (name)"
      )
      .eq("status", "accepted")
      .not("fee_amount", "is", null)
      .order("created_at", { ascending: true }),
    supabase
      .from("expert_payment_items")
      .select("engagement_id, expert_payment_batches!inner (status)")
      .neq("expert_payment_batches.status", "canceled"),
    supabase
      .from("expert_payment_batches")
      .select(
        "id, title, status, total_gross, total_withholding, total_net, last_rejection_note, approval_id, created_at, projects (name)"
      )
      .order("created_at", { ascending: false })
      .limit(50),
  ]);

  const batchedEngagementIds = new Set(
    (activeItems ?? []).map((item) => item.engagement_id)
  );
  const payable = (acceptedEngagements ?? []).filter(
    (e) => !batchedEngagementIds.has(e.id)
  );

  // 소득유형 조회 (미설정 전문가는 선택 불가로 표시)
  const expertIds = Array.from(new Set(payable.map((e) => e.expert_id)));
  const { data: taxProfiles } =
    expertIds.length > 0
      ? await supabase
          .from("expert_tax_profiles")
          .select("expert_id, payment_type")
          .in("expert_id", expertIds)
      : { data: [] };

  const typeByExpert = new Map(
    (taxProfiles ?? [])
      .filter((p) => isPaymentType(p.payment_type))
      .map((p) => [p.expert_id, p.payment_type as string])
  );

  // 프로젝트별 그룹 (기획 확정 — 프로젝트 귀속 전문가 일괄 확인)
  const groups = new Map<
    string,
    { projectName: string | null; rows: PayableRow[] }
  >();
  for (const engagement of payable) {
    const key = engagement.project_id ?? "";
    if (!groups.has(key)) {
      groups.set(key, {
        projectName: engagement.projects?.name ?? null,
        rows: [],
      });
    }
    const paymentType = typeByExpert.get(engagement.expert_id) ?? null;
    const gross = engagement.fee_amount ?? 0;
    const calc =
      paymentType && isPaymentType(paymentType)
        ? calculateWithholding(paymentType, gross)
        : { gross, withholding: 0, net: gross };
    groups.get(key)!.rows.push({
      engagementId: engagement.id,
      expertName: engagement.experts?.name ?? "-",
      roleDescription: engagement.role_description,
      paymentType,
      gross: calc.gross,
      withholding: calc.withholding,
      net: calc.net,
    });
  }

  const batchRows = batches ?? [];

  return (
    <div>
      <PageHeader
        title="비용·지급"
        actions={
          <Button asChild variant="outline" size="sm">
            <a href={`/${params.tenantSlug}/payments/export`}>엑셀</a>
          </Button>
        }
      />
      <main className="space-y-5 p-5">
        {groups.size === 0 ? (
          <EmptyState
            title="지급 대기 중인 섭외가 없습니다"
            description="전문가가 섭외를 수락(계약 성립)하면 프로젝트별 지급 대상 리스트가 여기에 표시됩니다."
          />
        ) : (
          Array.from(groups.entries()).map(([projectId, group]) => (
            <Card key={projectId || "no-project"}>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">
                  {group.projectName ?? "프로젝트 미지정"} — 지급 대상{" "}
                  {group.rows.length}명
                </CardTitle>
              </CardHeader>
              <CardContent>
                <BatchCreator
                  projectId={projectId}
                  projectName={group.projectName}
                  rows={group.rows}
                  approvalsActive={modules.approvals}
                />
              </CardContent>
            </Card>
          ))
        )}

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">지급 건 이력 ({batchRows.length})</CardTitle>
          </CardHeader>
          <CardContent>
            {batchRows.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                생성된 지급 건이 없습니다.
              </p>
            ) : (
              <ul className="space-y-2">
                {batchRows.map((batch) => (
                  <li key={batch.id} className="rounded-md border p-3 text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link
                        href={`/${params.tenantSlug}/payments/${batch.id}`}
                        className="font-medium text-brand underline-offset-4 hover:underline"
                      >
                        {batch.title}
                      </Link>
                      {batch.projects?.name && (
                        <span className="text-xs text-muted-foreground">
                          {batch.projects.name}
                        </span>
                      )}
                      <Badge
                        className="ml-auto"
                        variant={BATCH_STATUS_VARIANT[batch.status] ?? "secondary"}
                      >
                        {BATCH_STATUS_LABELS[batch.status] ?? batch.status}
                      </Badge>
                      <BatchActions
                        batchId={batch.id}
                        status={batch.status}
                        approvalsActive={modules.approvals}
                      />
                    </div>
                    <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                      <span>총비용 {formatKrw(batch.total_gross)}</span>
                      <span>원천징수 {formatKrw(batch.total_withholding)}</span>
                      <span className="font-medium text-foreground">
                        실지급 {formatKrw(batch.total_net)}
                      </span>
                      {batch.approval_id && (
                        <Link
                          href={`/${params.tenantSlug}/approvals/${batch.approval_id}`}
                          className="text-brand underline-offset-4 hover:underline"
                        >
                          연결 품의 보기
                        </Link>
                      )}
                    </div>
                    {batch.last_rejection_note && batch.status === "pending" && (
                      <p className="mt-1 text-xs text-destructive">
                        반려 사유: {batch.last_rejection_note}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
