import { requireRole } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { MODULE_KEYS, MODULE_LABELS, parseModuleFlags } from "@/lib/modules/modules";
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

import { CreateTenantDialog } from "./create-tenant-dialog";
import { TenantModulesDialog } from "./modules-dialog";

export const metadata = { title: "플랫폼 관리" };

const TENANT_STATUS_LABEL: Record<string, string> = {
  active: "활성",
  suspended: "중지",
  terminated: "해지",
};

/**
 * 플랫폼관리자 전역 경로 (테넌트 슬러그 없음) — 테넌트 수동 생성·모듈 조합 관리.
 * 주의: 플랫폼관리자도 전문가 세무정보 조회 권한은 없다 (설계문서 4.4).
 */
export default async function PlatformAdminPage() {
  await requireRole(["platform_admin"]);

  const headerActions = (
    <div className="flex items-center gap-2">
      <CreateTenantDialog />
      <form method="post" action="/auth/logout">
        <Button type="submit" variant="ghost" size="sm">
          로그아웃
        </Button>
      </form>
    </div>
  );

  if (!hasSupabaseEnv()) {
    return (
      <div className="min-h-screen bg-secondary/50">
        <PageHeader title="플랫폼 관리" />
        <main className="p-5">
          <EmptyState
            title="서버 설정 대기 중"
            description="Supabase 환경변수가 설정되면 테넌트 목록이 표시됩니다."
          />
        </main>
      </div>
    );
  }

  const supabase = createClient();
  const { data: tenants } = await supabase
    .from("tenants")
    .select("id, slug, name, status, plan_name, feature_flags, created_at")
    .order("created_at", { ascending: false });

  const rows = tenants ?? [];

  return (
    <div className="min-h-screen bg-secondary/50">
      <PageHeader title="플랫폼 관리" actions={headerActions} />
      <main className="p-5">
        {rows.length === 0 ? (
          <EmptyState
            title="테넌트가 없습니다"
            description="우측 상단 ‘테넌트 생성’으로 첫 기업을 등록하세요."
          />
        ) : (
          <Card>
            <CardContent className="pt-6">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>기업명</TableHead>
                      <TableHead>슬러그</TableHead>
                      <TableHead>플랜</TableHead>
                      <TableHead>모듈</TableHead>
                      <TableHead>상태</TableHead>
                      <TableHead>생성일</TableHead>
                      <TableHead className="w-16" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((tenant) => {
                      const modules = parseModuleFlags(tenant.feature_flags);
                      const enabledLabels = MODULE_KEYS.filter(
                        (key) => modules[key]
                      ).map((key) => MODULE_LABELS[key]);
                      return (
                        <TableRow key={tenant.id}>
                          <TableCell className="font-medium">{tenant.name}</TableCell>
                          <TableCell className="font-mono text-xs">
                            {tenant.slug}
                          </TableCell>
                          <TableCell>{tenant.plan_name ?? "-"}</TableCell>
                          <TableCell>
                            <div className="flex flex-wrap gap-1">
                              {enabledLabels.length === 0 ? (
                                <span className="text-xs text-muted-foreground">
                                  공통 기반만
                                </span>
                              ) : (
                                enabledLabels.map((label) => (
                                  <Badge
                                    key={label}
                                    variant="secondary"
                                    className="text-[10px]"
                                  >
                                    {label}
                                  </Badge>
                                ))
                              )}
                            </div>
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant={
                                tenant.status === "active" ? "default" : "destructive"
                              }
                            >
                              {TENANT_STATUS_LABEL[tenant.status] ?? tenant.status}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            {new Date(tenant.created_at).toLocaleDateString("ko-KR")}
                          </TableCell>
                          <TableCell>
                            <TenantModulesDialog
                              tenantId={tenant.id}
                              tenantName={tenant.name}
                              modules={modules}
                            />
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        )}
      </main>
    </div>
  );
}
