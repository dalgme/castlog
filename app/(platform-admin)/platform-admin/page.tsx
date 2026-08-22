import { requireRole } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { getRrnLockdown } from "@/lib/integrations/rrn-lockdown";
import { parseModuleFlags } from "@/lib/modules/modules";
import { PageHeader } from "@/components/layout/header";
import { PlatformModeButton } from "@/components/layout/platform-mode-button";
import { readPriorContext } from "@/lib/auth/platform-mode";
import { EmptyState } from "@/components/layout/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

import { CreateTenantDialog } from "./create-tenant-dialog";
import { LockdownPanel } from "./lockdown-panel";
import { TenantList, type TenantAdminRow } from "./tenant-list";

export const metadata = { title: "캐스트로그 관리모드" };

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
        <a href="/platform-admin/integrations">연동 점검</a>
      </Button>
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
      <Button asChild variant="outline" size="sm">
        <a href="/platform-admin/expertise-fields">강의 분야</a>
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
    .select(
      "id, slug, name, status, plan_name, feature_flags, created_at, representative_name, business_registration_number, contact_phone, industry, address, terms_agreed_at"
    )
    .order("created_at", { ascending: false });

  const tenantRows = tenants ?? [];

  // 대표(org_admin) 계정 — users는 테넌트 RLS라 관리모드 세션으로는 남의 회사
  // 직원을 읽을 수 없다. 지원 문의에 답하려면 '누구에게 연락하나'가 필요하므로
  // service_role로 읽되, 가져오는 것은 이름·이메일·연락처뿐이다.
  const admin = createAdminClient();
  const { data: ceoRows } = tenantRows.length
    ? await admin
        .from("users")
        .select("tenant_id, name, email, phone, is_active, created_at")
        .eq("role", "org_admin")
        .in(
          "tenant_id",
          tenantRows.map((t) => t.id)
        )
        .order("created_at", { ascending: true })
    : { data: [] };

  // 한 회사에 대표가 여럿일 수 있다 — 가장 먼저 만들어진 계정을 대표로 본다
  type CeoRow = {
    tenant_id: string | null;
    name: string;
    email: string;
    phone: string | null;
    is_active: boolean;
  };
  const ceoByTenant = new Map<string, CeoRow>();
  for (const row of (ceoRows ?? []) as CeoRow[]) {
    if (row.tenant_id && !ceoByTenant.has(row.tenant_id)) {
      ceoByTenant.set(row.tenant_id, row);
    }
  }

  const rows: TenantAdminRow[] = tenantRows.map((t) => {
    const ceo = ceoByTenant.get(t.id);
    return {
      id: t.id,
      name: t.name,
      slug: t.slug,
      status: t.status,
      planName: t.plan_name,
      modules: parseModuleFlags(t.feature_flags),
      createdAt: t.created_at,
      representativeName: t.representative_name,
      businessRegistrationNumber: t.business_registration_number,
      contactPhone: t.contact_phone,
      industry: t.industry,
      address: t.address,
      termsAgreedAt: t.terms_agreed_at,
      ceoName: ceo?.name ?? null,
      ceoEmail: ceo?.email ?? null,
      ceoPhone: ceo?.phone ?? null,
      ceoActive: ceo ? ceo.is_active : null,
    };
  });

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
          <TenantList rows={rows} />
        )}
      </main>
    </div>
  );
}
