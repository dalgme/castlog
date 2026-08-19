import { requireRole } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { getRrnLockdown } from "@/lib/integrations/rrn-lockdown";
import { MODULE_KEYS, MODULE_LABELS, parseModuleFlags } from "@/lib/modules/modules";
import { PageHeader } from "@/components/layout/header";
import { PlatformModeButton } from "@/components/layout/platform-mode-button";
import { readPriorContext } from "@/lib/auth/platform-mode";
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
import { LockdownPanel } from "./lockdown-panel";

export const metadata = { title: "캐스트로그 관리모드" };

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
  const user = await requireRole(["platform_admin"]);
  // 기업 계정에서 올라온 세션이면 되돌아갈 자리가 보관돼 있다
  const backToTenant = readPriorContext(user) !== null;

  const lockdown = await getRrnLockdown();

  // 미처리 건수 — 접수된 신청·요청이 조용히 묻히지 않도록 헤더에 노출한다.
  let newInquiryCount = 0;
  let pendingModuleRequests = 0;
  if (hasSupabaseEnv()) {
    const supabase = createClient();
    const [inquiries, moduleRequests] = await Promise.all([
      supabase
        .from("platform_inquiries")
        .select("id", { count: "exact", head: true })
        .eq("status", "new"),
      supabase
        .from("tenant_module_requests")
        .select("id", { count: "exact", head: true })
        .eq("status", "pending"),
    ]);
    newInquiryCount = inquiries.count ?? 0;
    pendingModuleRequests = moduleRequests.count ?? 0;
  }

  const headerActions = (
    <div className="flex items-center gap-2">
      {/* 원래 회사 화면으로 — 관리모드에서 나가는 문이 없으면 로그아웃밖에 없다 */}
      {backToTenant && <PlatformModeButton mode="exit" />}
      <Button asChild variant="outline" size="sm">
        <a href="/platform-admin/help-board">챗봇 상담게시판</a>
      </Button>
      <Button asChild variant="outline" size="sm">
        <a href="/platform-admin/usage">사용 현황</a>
      </Button>
      <Button asChild variant="outline" size="sm">
        <a href="/platform-admin/inquiries">
          도입 문의
          {newInquiryCount > 0 && (
            <Badge className="ml-1.5 h-5 px-1.5 text-[10px]">
              {newInquiryCount}
            </Badge>
          )}
        </a>
      </Button>
      <Button asChild variant="outline" size="sm">
        <a href="/platform-admin/module-requests">
          모듈 요청
          {pendingModuleRequests > 0 && (
            <Badge className="ml-1.5 h-5 px-1.5 text-[10px]">
              {pendingModuleRequests}
            </Badge>
          )}
        </a>
      </Button>
      <Button asChild variant="outline" size="sm">
        <a href="/platform-admin/support">전문가 문의</a>
      </Button>
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
        <PageHeader title="캐스트로그 관리모드" />
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
      <PageHeader title="캐스트로그 관리모드" actions={headerActions} />
      <main className="space-y-4 p-5">
        <LockdownPanel
          locked={lockdown.locked}
          reason={lockdown.reason}
          triggeredAt={lockdown.triggeredAt}
        />
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
