import Link from "next/link";

import { requireRole } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { PageHeader } from "@/components/layout/header";
import { EmptyState } from "@/components/layout/empty-state";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import { SnapshotButton } from "./snapshot-button";

export const metadata = { title: "사용 현황" };

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${bytes} B`;
}

/**
 * 플랫폼관리자 전체 사용현황 (설계문서 7.5 — 과금 아님, 계측만).
 * 일 단위 스냅샷은 pg_cron(23:55 KST)이 쌓고, 수동 집계 버튼을 보조로 둔다.
 */
export default async function PlatformUsagePage() {
  await requireRole(["platform_admin"]);

  if (!hasSupabaseEnv()) {
    return (
      <div className="min-h-screen bg-secondary/50">
        <PageHeader title="사용 현황" />
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

  // 테넌트별 최신 스냅샷 + 최근 30일 발송 합계
  const [{ data: tenants }, { data: metrics }] = await Promise.all([
    supabase.from("tenants").select("id, name, slug, status"),
    supabase
      .from("tenant_usage_metrics")
      .select(
        "tenant_id, metric_date, project_count, active_user_count, sms_sent_count, email_sent_count, storage_used_bytes"
      )
      .order("metric_date", { ascending: false })
      .limit(2000),
  ]);

  const tenantRows = tenants ?? [];
  const metricRows = metrics ?? [];

  const latestByTenant = new Map<string, (typeof metricRows)[number]>();
  const sent30ByTenant = new Map<string, number>();
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  for (const metric of metricRows) {
    if (!latestByTenant.has(metric.tenant_id)) {
      latestByTenant.set(metric.tenant_id, metric);
    }
    if (metric.metric_date >= cutoff) {
      sent30ByTenant.set(
        metric.tenant_id,
        (sent30ByTenant.get(metric.tenant_id) ?? 0) +
          metric.sms_sent_count +
          metric.email_sent_count
      );
    }
  }

  return (
    <div className="min-h-screen bg-secondary/50">
      <PageHeader
        title="사용 현황"
        actions={
          <div className="flex items-center gap-2">
            <SnapshotButton />
            <Button asChild variant="ghost" size="sm">
              <Link href="/platform-admin">테넌트 관리로</Link>
            </Button>
          </div>
        }
      />
      <main className="space-y-5 p-5">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">
              테넌트별 사용량 ({tenantRows.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            {tenantRows.length === 0 ? (
              <EmptyState
                title="테넌트가 없습니다"
                description="테넌트를 생성하면 사용량이 집계됩니다."
              />
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>테넌트</TableHead>
                      <TableHead>기준일</TableHead>
                      <TableHead className="text-right">프로젝트</TableHead>
                      <TableHead className="text-right">활성 사용자</TableHead>
                      <TableHead className="text-right">발송(당일)</TableHead>
                      <TableHead className="text-right">발송(30일)</TableHead>
                      <TableHead className="text-right">스토리지</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {tenantRows.map((tenant) => {
                      const latest = latestByTenant.get(tenant.id);
                      return (
                        <TableRow key={tenant.id}>
                          <TableCell className="font-medium">
                            {tenant.name}
                            <span className="ml-1.5 text-xs text-muted-foreground">
                              /{tenant.slug}
                            </span>
                          </TableCell>
                          <TableCell className="text-sm">
                            {latest?.metric_date ?? "미집계"}
                          </TableCell>
                          <TableCell className="text-right">
                            {latest?.project_count ?? "-"}
                          </TableCell>
                          <TableCell className="text-right">
                            {latest?.active_user_count ?? "-"}
                          </TableCell>
                          <TableCell className="text-right">
                            {latest
                              ? latest.sms_sent_count + latest.email_sent_count
                              : "-"}
                          </TableCell>
                          <TableCell className="text-right">
                            {sent30ByTenant.get(tenant.id) ?? 0}
                          </TableCell>
                          <TableCell className="text-right">
                            {latest ? formatBytes(latest.storage_used_bytes) : "-"}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
            <p className="mt-3 text-xs text-muted-foreground">
              매일 23:55(KST) 자동 집계됩니다. 발송(당일)은 기준일의 SMS+이메일
              건수, 스토리지는 활성 연결 전문가의 서류 용량 기준입니다.
            </p>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
