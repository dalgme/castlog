import { redirect } from "next/navigation";

import { requireUser, getSessionUser, postLoginPath } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { PageHeader } from "@/components/layout/header";
import { EmptyState } from "@/components/layout/empty-state";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { createAdminClient } from "@/lib/supabase/admin";
import { tenantIdFromUser, roleFromUser } from "@/lib/auth/tenant";
import { getAdminScopes } from "@/lib/auth/admin-scopes";
import { getTenantModules } from "@/lib/modules/server";
import { MODULE_KEYS, MODULE_LABELS } from "@/lib/modules/modules";
import {
  isModuleRequestStatus,
  parseRequestedModules,
  requestableModules,
} from "@/lib/modules/requests";

import {
  ModuleRequestPanel,
  type OpenRequest,
} from "@/app/(dashboard)/[tenantSlug]/settings/module-request-panel";

import { SettingsTabs } from "@/components/layout/settings-tabs";
import { PermissionLevelGuide } from "@/components/org/permission-level-guide";

import { CompanyProfileForm } from "./company-profile-form";
import {
  CategoriesPanel,
  type CategoryRow,
} from "./categories-panel";
import {
  RecruitFieldsPanel,
  type RecruitFieldRow,
} from "./recruit-fields-panel";
import { TaxAccessGrantsPanel } from "./tax-access-grants-panel";
import { RrnKeySetupPanel } from "./rrn-key-setup-panel";
import { RrnRevealPanel } from "./rrn-reveal-panel";

export const metadata = { title: "기업 관리" };

/**
 * 기업총괄관리자 — 직원 계정·직급 관리 (실행계획서 단계 8, 공통 기반).
 * 결재라인·전결규정은 approvals 모듈 화면(단계 10)에서 다룬다.
 */
export default async function OrgAdminPage({
  params,
}: {
  params: { tenantSlug: string };
}) {
  // 대표(org_admin)·플랫폼관리자 또는 관리 스코프를 위임받은 직원만 진입
  const gateUser = await requireUser();
  const scopeSet = await getAdminScopes();
  if (gateUser) {
    const role = roleFromUser(gateUser);
    const allowed =
      role === "org_admin" ||
      role === "platform_admin" ||
      Object.values(scopeSet).some(Boolean);
    if (!allowed) redirect(postLoginPath(gateUser));
  }
  const modules = await getTenantModules();

  if (!hasSupabaseEnv()) {
    return (
      <div className="min-h-screen bg-secondary/50">
        <PageHeader title="기업 관리" />
        <main className="p-5">
          <EmptyState
            title="서버 설정 대기 중"
            description="Supabase 환경변수가 설정되면 표시됩니다."
          />
        </main>
      </div>
    );
  }

  const sessionUser = await getSessionUser();
  const supabase = createClient();

  // 세무 조회 지정자는 '누구를 지정했나'를 보여야 하므로 직원 이름이 필요하다.
  // 직원 관리 자체는 '임직원 설정' 탭으로 옮겼다 — 여기서는 조회만 한다.
  const [{ data: staff }, { data: positions }, { data: grants }] =
    await Promise.all([
      supabase
        .from("users")
        .select("id, name, email, grade, is_active")
        .order("created_at", { ascending: true }),
      supabase
        .from("positions")
        .select("id, name")
        .order("sort_order", { ascending: true }),
      supabase
        .from("tax_access_grants")
        .select("id, user_id, role_label")
        .is("revoked_at", null),
    ]);

  const staffRows = staff ?? [];
  const positionRows = positions ?? [];

  const staffNameById = new Map(staffRows.map((s) => [s.id, s.name]));
  const grantRows = (grants ?? []).map((g) => ({
    id: g.id,
    user_id: g.user_id,
    role_label: g.role_label,
    userName: staffNameById.get(g.user_id) ?? "(직원)",
  }));
  const staffOptions = staffRows
    .filter((s) => s.is_active)
    .map((s) => ({ id: s.id, name: s.name, email: s.email }));

  const isCeo = roleFromUser(sessionUser) === "org_admin";
  // 카드마다 필요한 위임이 다르다 — 못 쓰는 카드는 아예 그리지 않는다
  const canRequestModules = isCeo || scopeSet.modules;
  const canEditCompany = isCeo || scopeSet.settings;
  const canViewAudit = isCeo || scopeSet.audit;
  const canBackup = isCeo || scopeSet.backup;

  // 주민번호 열람 키 설정 여부 (deny-all 테이블 — admin client로 존재만 확인)
  const rrnTenantId = tenantIdFromUser(sessionUser);
  let rrnKeySet = false;
  if (rrnTenantId) {
    const admin = createAdminClient();
    const { count } = await admin
      .from("tenant_rrn_keys")
      .select("tenant_id", { count: "exact", head: true })
      .eq("tenant_id", rrnTenantId);
    rrnKeySet = (count ?? 0) > 0;
  }

  // 기업 가입정보
  const { data: tenantRow } = await supabase
    .from("tenants")
    .select(
      "business_registration_number, representative_name, address, contact_phone, industry, privacy_officer_name, privacy_officer_email, privacy_officer_phone"
    )
    .maybeSingle();
  const companyProfile = {
    businessRegistrationNumber: tenantRow?.business_registration_number ?? "",
    representativeName: tenantRow?.representative_name ?? "",
    address: tenantRow?.address ?? "",
    contactPhone: tenantRow?.contact_phone ?? "",
    industry: tenantRow?.industry ?? "",
    privacyOfficerName: tenantRow?.privacy_officer_name ?? "",
    privacyOfficerEmail: tenantRow?.privacy_officer_email ?? "",
    privacyOfficerPhone: tenantRow?.privacy_officer_phone ?? "",
  };

  // 사용 기능(모듈) 현황 + 추가 요청 — SMS 설정에 있을 이유가 없다.
  // 계약·기능 조합은 '이 회사가 무엇을 쓰는가'이므로 기업관리에 속한다.
  const { data: requestRows } = await supabase
    .from("tenant_module_requests")
    .select("id, requested_modules, status, decision_note, created_at")
    .order("created_at", { ascending: false })
    .limit(5);
  const moduleRequests: OpenRequest[] = (requestRows ?? []).map((r) => ({
    id: r.id,
    requested: parseRequestedModules(r.requested_modules),
    status: isModuleRequestStatus(r.status) ? r.status : "pending",
    decisionNote: r.decision_note,
    createdAt: r.created_at,
  }));
  const openModuleRequest =
    moduleRequests.find((r) => r.status === "pending") ?? null;
  const lastModuleDecision =
    moduleRequests.find((r) => r.status !== "pending") ?? null;

  // 프로젝트 분야 카테고리 + 카테고리별 프로젝트 수(비활성화 판단 근거)
  const [{ data: categoryRecords }, { data: categorizedProjects }] =
    await Promise.all([
      supabase
        .from("project_categories")
        .select("id, name, description, is_active")
        .order("sort_order", { ascending: true })
        .order("name", { ascending: true }),
      supabase.from("projects").select("category_id").not("category_id", "is", null),
    ]);
  const projectCountByCategory = new Map<string, number>();
  for (const row of categorizedProjects ?? []) {
    if (!row.category_id) continue;
    projectCountByCategory.set(
      row.category_id,
      (projectCountByCategory.get(row.category_id) ?? 0) + 1
    );
  }
  const categoryRows: CategoryRow[] = (categoryRecords ?? []).map((c) => ({
    id: c.id,
    name: c.name,
    description: c.description,
    isActive: c.is_active,
    projectCount: projectCountByCategory.get(c.id) ?? 0,
  }));

  // 섭외분야 사전 + 분야별 배정 전문가 수 (삭제 영향 표시용).
  // 마이그레이션 미적용 DB에서는 조용히 빈 목록 — 화면이 죽으면 안 된다.
  let recruitFieldRows: RecruitFieldRow[] = [];
  {
    const [{ data: fieldRecords }, { data: assignments }] = await Promise.all([
      supabase
        .from("tenant_recruit_fields")
        .select("id, name")
        .order("sort_order", { ascending: true })
        .order("name", { ascending: true }),
      supabase.from("expert_tenant_recruit_fields").select("field_id"),
    ]);
    const expertCountByField = new Map<string, number>();
    for (const row of assignments ?? []) {
      expertCountByField.set(
        row.field_id,
        (expertCountByField.get(row.field_id) ?? 0) + 1
      );
    }
    recruitFieldRows = (fieldRecords ?? []).map((f) => ({
      id: f.id,
      name: f.name,
      expertCount: expertCountByField.get(f.id) ?? 0,
    }));
  }

  return (
    <div className="min-h-screen bg-secondary/50">
      <PageHeader
        title="기업 관리"
        actions={
          /* 버튼은 위임 스코프에 맞춰 나온다 — 눌러도 막히는 버튼을 보여 주면
             사용자는 자기 권한이 아니라 시스템을 의심한다 */
          <div className="flex items-center gap-2">
            <Button asChild variant="outline" size="sm">
              <a href={`/${params.tenantSlug}/admin/org/export`}>엑셀</a>
            </Button>
            {canViewAudit && (
              <>
                <Button asChild variant="outline" size="sm">
                  <a href={`/${params.tenantSlug}/admin/org/security`}>보안 현황</a>
                </Button>
                <Button asChild variant="outline" size="sm">
                  <a href={`/${params.tenantSlug}/admin/org/audit`}>감사로그</a>
                </Button>
              </>
            )}
            {canBackup && (
              <Button asChild variant="outline" size="sm">
                <a href={`/${params.tenantSlug}/admin/org/backup`}>데이터 반출</a>
              </Button>
            )}
          </div>
        }
      />
      <SettingsTabs
        tenantSlug={params.tenantSlug}
        showStaff={isCeo || scopeSet.staff}
        showSms={isCeo || scopeSet.sending}
        showOrg
        showRules={modules.approvals && (isCeo || scopeSet.approvals)}
      />
      <main className="space-y-5 p-5">
        {/* 처음 쓰는 회사용 — 직급/권한 레벨/프로젝트 역할 관계 안내 (기획 확정 2026-08-23) */}
        <PermissionLevelGuide />
        {canRequestModules && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">사용 기능 · 추가 요청</CardTitle>
          </CardHeader>
          <CardContent>
            <ModuleRequestPanel
              available={requestableModules(modules)}
              activeLabels={MODULE_KEYS.filter((k) => modules[k]).map(
                (k) => MODULE_LABELS[k]
              )}
              openRequest={openModuleRequest}
              lastDecision={lastModuleDecision}
              canRequest={canRequestModules}
            />
          </CardContent>
        </Card>
        )}

        {canEditCompany && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">프로젝트 분야 카테고리</CardTitle>
          </CardHeader>
          <CardContent>
            <CategoriesPanel categories={categoryRows} />
          </CardContent>
        </Card>
        )}

        {canEditCompany && modules.experts && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">섭외분야 (전문가 관리)</CardTitle>
          </CardHeader>
          <CardContent>
            <RecruitFieldsPanel fields={recruitFieldRows} />
          </CardContent>
        </Card>
        )}

        {canEditCompany && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">
              기업 정보 · 개인정보 보호책임자
            </CardTitle>
          </CardHeader>
          <CardContent>
            <CompanyProfileForm initial={companyProfile} />
          </CardContent>
        </Card>
        )}


        {isCeo && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">
              주민등록번호 조회 지정자 (지급명세서·세무)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <TaxAccessGrantsPanel
              staff={staffOptions}
              grants={grantRows}
              positionNames={positionRows.map((p) => p.name)}
            />
          </CardContent>
        </Card>
        )}

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">
              주민등록번호 열람 키 (조회 비밀번호)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <RrnKeySetupPanel alreadySet={rrnKeySet} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">주민등록번호 조회 (지급명세서)</CardTitle>
          </CardHeader>
          <CardContent>
            <RrnRevealPanel accessorHint={sessionUser?.email ?? "조회자"} />
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
