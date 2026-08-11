import Link from "next/link";

import { requireRole } from "@/lib/auth/session";
import { requireModule } from "@/lib/modules/server";
import { createClient } from "@/lib/supabase/server";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { PageHeader } from "@/components/layout/header";
import { EmptyState } from "@/components/layout/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const metadata = { title: "섭외 취소 내역" };

/**
 * 단계 29: 섭외 취소 내역 (테넌트 격리 — RLS).
 * 회수(응답 전)와 긴급 취소(계약 성립 후)를 구분해 기록한다.
 */
export default async function EngagementCancellationsPage({
  params,
}: {
  params: { tenantSlug: string };
}) {
  await requireRole(["platform_admin", "org_admin", "manager", "staff"]);
  await requireModule("experts");

  const headerActions = (
    <Button asChild variant="ghost" size="sm">
      <Link href={`/${params.tenantSlug}/experts`}>전문가 목록</Link>
    </Button>
  );

  if (!hasSupabaseEnv()) {
    return (
      <div>
        <PageHeader title="섭외 취소 내역" actions={headerActions} />
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
  const { data: rows } = await supabase
    .from("engagement_cancellations")
    .select(
      "id, prior_status, is_urgent, reason, canceled_at, experts (name), projects (name), users (name)"
    )
    .order("canceled_at", { ascending: false })
    .limit(200);

  const cancellations = rows ?? [];

  return (
    <div>
      <PageHeader title="섭외 취소 내역" actions={headerActions} />
      <main className="p-5">
        {cancellations.length === 0 ? (
          <EmptyState
            title="취소 내역이 없습니다"
            description="섭외를 회수하거나 긴급 취소하면 여기에 기록됩니다."
          />
        ) : (
          <div className="overflow-x-auto rounded-md border bg-white">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>구분</TableHead>
                  <TableHead>전문가</TableHead>
                  <TableHead>프로젝트</TableHead>
                  <TableHead>사유</TableHead>
                  <TableHead>취소자</TableHead>
                  <TableHead className="whitespace-nowrap">취소일시</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {cancellations.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell>
                      {row.is_urgent ? (
                        <Badge variant="destructive">긴급 취소</Badge>
                      ) : (
                        <Badge variant="secondary">회수</Badge>
                      )}
                    </TableCell>
                    <TableCell className="font-medium">
                      {row.experts?.name ?? "-"}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {row.projects?.name ?? "-"}
                    </TableCell>
                    <TableCell className="max-w-xs whitespace-pre-wrap break-words text-muted-foreground">
                      {row.reason ?? "-"}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {row.users?.name ?? "-"}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {new Date(row.canceled_at).toLocaleString("ko-KR")}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </main>
    </div>
  );
}
