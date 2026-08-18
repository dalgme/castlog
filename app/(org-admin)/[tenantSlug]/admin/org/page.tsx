import { redirect } from "next/navigation";

import { requireUser, getSessionUser, postLoginPath } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { PageHeader } from "@/components/layout/header";
import { EmptyState } from "@/components/layout/empty-state";
import { Badge } from "@/components/ui/badge";
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

import { createAdminClient } from "@/lib/supabase/admin";
import { tenantIdFromUser, roleFromUser } from "@/lib/auth/tenant";
import { isUserGrade, type UserGrade } from "@/lib/auth/grades";
import { isAdminScope } from "@/lib/auth/admin-scope-keys";
import { getAdminScopes } from "@/lib/auth/admin-scopes";

import { CreateStaffDialog } from "./staff-dialog";
import { StaffActiveToggle } from "./staff-active-toggle";
import { PositionsPanel } from "./positions-panel";
import { TaxAccessGrantsPanel } from "./tax-access-grants-panel";
import { RrnKeySetupPanel } from "./rrn-key-setup-panel";
import { RrnRevealPanel } from "./rrn-reveal-panel";
import { StaffGradeSelect } from "./staff-grade-select";
import {
  AdminDelegationPanel,
  type DelegationRow,
} from "./admin-delegation-panel";

export const metadata = { title: "기업 관리" };

/** DB 문자열 → UserGrade (제약이 걸려 있지만 타입 경계에서 한 번 좁힌다) */
function gradeOf(value: string): UserGrade {
  return isUserGrade(value) ? value : "staff";
}

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
  if (gateUser) {
    const role = roleFromUser(gateUser);
    const scopes = await getAdminScopes();
    const allowed =
      role === "org_admin" ||
      role === "platform_admin" ||
      Object.values(scopes).some(Boolean);
    if (!allowed) redirect(postLoginPath(gateUser));
  }

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

  const [{ data: staff }, { data: positions }, { data: grants }] =
    await Promise.all([
      supabase
        .from("users")
        .select(
          "id, name, email, role, grade, department, is_active, positions (name)"
        )
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

  const { data: adminGrants } = await supabase
    .from("tenant_admin_grants")
    .select("id, user_id, scope, note, granted_at")
    .is("revoked_at", null)
    .order("granted_at", { ascending: true });

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
  const delegationCandidates = staffRows
    .filter((s) => s.is_active && s.grade !== "ceo")
    .map((s) => ({ id: s.id, name: s.name, grade: gradeOf(s.grade) }));
  const delegationRows: DelegationRow[] = (adminGrants ?? [])
    .filter((g) => isAdminScope(g.scope))
    .map((g) => ({
      id: g.id,
      userId: g.user_id,
      userName: staffNameById.get(g.user_id) ?? "(직원)",
      scope: g.scope as DelegationRow["scope"],
      note: g.note,
      grantedAt: g.granted_at,
    }));

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

  return (
    <div className="min-h-screen bg-secondary/50">
      <PageHeader
        title="기업 관리"
        actions={
          <div className="flex items-center gap-2">
            <Button asChild variant="outline" size="sm">
              <a href={`/${params.tenantSlug}/admin/org/export`}>엑셀</a>
            </Button>
            <Button asChild variant="outline" size="sm">
              <a href={`/${params.tenantSlug}/admin/org/security`}>보안 현황</a>
            </Button>
            <Button asChild variant="outline" size="sm">
              <a href={`/${params.tenantSlug}/admin/org/audit`}>감사로그</a>
            </Button>
            <Button asChild variant="outline" size="sm">
              <a href={`/${params.tenantSlug}/admin/org/backup`}>데이터 반출</a>
            </Button>
            <CreateStaffDialog positions={positionRows} />
          </div>
        }
      />
      <main className="space-y-5 p-5">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">직원 계정 ({staffRows.length})</CardTitle>
          </CardHeader>
          <CardContent>
            {staffRows.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                등록된 직원이 없습니다. 우측 상단 ‘직원 추가’로 시작하세요.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>이름</TableHead>
                      <TableHead>이메일</TableHead>
                      <TableHead>권한단계</TableHead>
                      <TableHead>부서</TableHead>
                      <TableHead>직급</TableHead>
                      <TableHead>상태</TableHead>
                      <TableHead className="w-24" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {staffRows.map((member) => (
                      <TableRow key={member.id}>
                        <TableCell className="font-medium">{member.name}</TableCell>
                        <TableCell>{member.email}</TableCell>
                        <TableCell>
                          <StaffGradeSelect
                            userId={member.id}
                            grade={gradeOf(member.grade)}
                            disabled={member.id === sessionUser?.id}
                            disabledReason="본인 권한단계는 변경할 수 없습니다."
                          />
                        </TableCell>
                        <TableCell>{member.department ?? "-"}</TableCell>
                        <TableCell>{member.positions?.name ?? "-"}</TableCell>
                        <TableCell>
                          <Badge variant={member.is_active ? "default" : "destructive"}>
                            {member.is_active ? "활성" : "비활성"}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <StaffActiveToggle
                            userId={member.id}
                            isActive={member.is_active}
                            isSelf={member.id === sessionUser?.id}
                          />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        <AdminDelegationPanel
          candidates={delegationCandidates}
          grants={delegationRows}
          canManage={isCeo}
        />

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">직급 관리</CardTitle>
          </CardHeader>
          <CardContent>
            <PositionsPanel positions={positionRows} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">
              주민등록번호 조회 지정자 (지급명세서·세무)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <TaxAccessGrantsPanel staff={staffOptions} grants={grantRows} />
          </CardContent>
        </Card>

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
