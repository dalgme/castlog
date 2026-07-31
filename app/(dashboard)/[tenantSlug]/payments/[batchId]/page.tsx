import Link from "next/link";
import { notFound } from "next/navigation";

import { requireRole } from "@/lib/auth/session";
import { requireModule } from "@/lib/modules/server";
import { createClient } from "@/lib/supabase/server";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { formatKrw } from "@/lib/approvals/constants";
import { PAYMENT_TYPE_LABELS } from "@/lib/payments/tax";
import { PageHeader } from "@/components/layout/header";
import { EmptyState } from "@/components/layout/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const metadata = { title: "지급 건 상세" };

const BATCH_STATUS_LABELS: Record<string, string> = {
  pending: "결재 대기",
  approval_in_progress: "결재 진행중",
  confirmed: "지급 확정",
  paid: "지급 완료",
  canceled: "취소",
};

/** 지급 건 상세 — 전문가별 지급 라인(소득유형 스냅샷·세액 참고 계산) */
export default async function PaymentBatchDetailPage({
  params,
}: {
  params: { tenantSlug: string; batchId: string };
}) {
  await requireRole(["platform_admin", "org_admin", "manager", "staff"]);
  await requireModule("experts");

  if (!hasSupabaseEnv()) {
    return (
      <div>
        <PageHeader title="지급 건 상세" />
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

  const { data: batch } = await supabase
    .from("expert_payment_batches")
    .select(
      `id, title, status, total_gross, total_withholding, total_net,
       last_rejection_note, approval_id, confirmed_at, paid_at, created_at,
       projects (name)`
    )
    .eq("id", params.batchId)
    .maybeSingle();

  if (!batch) notFound();

  const { data: items } = await supabase
    .from("expert_payment_items")
    .select(
      "id, payment_type, gross_amount, withholding_amount, net_amount, experts (name), expert_engagements (role_description)"
    )
    .eq("batch_id", batch.id);

  const itemRows = items ?? [];

  return (
    <div>
      <PageHeader
        title={batch.title}
        actions={
          <Button asChild variant="ghost" size="sm">
            <Link href={`/${params.tenantSlug}/payments`}>목록으로</Link>
          </Button>
        }
      />
      <main className="mx-auto max-w-3xl space-y-4 p-4 sm:p-5">
        <Card>
          <CardContent className="flex flex-wrap items-center gap-x-5 gap-y-2 pt-6 text-sm">
            <Badge>{BATCH_STATUS_LABELS[batch.status] ?? batch.status}</Badge>
            {batch.projects?.name && <span>{batch.projects.name}</span>}
            <span className="text-muted-foreground">
              생성 {new Date(batch.created_at).toLocaleDateString("ko-KR")}
            </span>
            {batch.confirmed_at && (
              <span className="text-muted-foreground">
                확정 {new Date(batch.confirmed_at).toLocaleDateString("ko-KR")}
              </span>
            )}
            {batch.paid_at && (
              <span className="text-muted-foreground">
                지급 {new Date(batch.paid_at).toLocaleDateString("ko-KR")}
              </span>
            )}
            {batch.approval_id && (
              <Link
                href={`/${params.tenantSlug}/approvals/${batch.approval_id}`}
                className="ml-auto text-brand underline-offset-4 hover:underline"
              >
                연결 품의 보기
              </Link>
            )}
          </CardContent>
        </Card>

        {batch.last_rejection_note && batch.status === "pending" && (
          <Card className="border-destructive/50">
            <CardContent className="pt-6 text-sm text-destructive">
              반려 사유: {batch.last_rejection_note}
            </CardContent>
          </Card>
        )}

        <Card>
          <CardContent className="pt-6">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>전문가</TableHead>
                    <TableHead>역할</TableHead>
                    <TableHead>소득유형</TableHead>
                    <TableHead className="text-right">총비용</TableHead>
                    <TableHead className="text-right">원천징수</TableHead>
                    <TableHead className="text-right">실지급</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {itemRows.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell className="font-medium">
                        {item.experts?.name ?? "-"}
                      </TableCell>
                      <TableCell>
                        {item.expert_engagements?.role_description ?? "-"}
                      </TableCell>
                      <TableCell className="text-xs">
                        {PAYMENT_TYPE_LABELS[item.payment_type] ?? item.payment_type}
                      </TableCell>
                      <TableCell className="text-right">
                        {formatKrw(item.gross_amount)}
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground">
                        {formatKrw(item.withholding_amount)}
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        {formatKrw(item.net_amount)}
                      </TableCell>
                    </TableRow>
                  ))}
                  <TableRow className="bg-secondary/50 font-semibold">
                    <TableCell colSpan={3}>합계 ({itemRows.length}명)</TableCell>
                    <TableCell className="text-right">
                      {formatKrw(batch.total_gross)}
                    </TableCell>
                    <TableCell className="text-right">
                      {formatKrw(batch.total_withholding)}
                    </TableCell>
                    <TableCell className="text-right">
                      {formatKrw(batch.total_net)}
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              소득유형은 품의 시점 스냅샷이며, 원천징수액은 참고 계산입니다.
              지급 전 세무 확인이 필요합니다.
            </p>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
