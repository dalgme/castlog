import { requireRole, getSessionUser } from "@/lib/auth/session";
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

import { CreateStaffDialog } from "./staff-dialog";
import { StaffActiveToggle } from "./staff-active-toggle";
import { PositionsPanel } from "./positions-panel";

export const metadata = { title: "기업 관리" };

const ROLE_LABELS: Record<string, string> = {
  org_admin: "기업총괄관리자",
  manager: "관리자",
  staff: "직원",
};

/**
 * 기업총괄관리자 — 직원 계정·직급 관리 (실행계획서 단계 8, 공통 기반).
 * 결재라인·전결규정은 approvals 모듈 화면(단계 10)에서 다룬다.
 */
export default async function OrgAdminPage({
  params,
}: {
  params: { tenantSlug: string };
}) {
  await requireRole(["org_admin", "platform_admin"]);

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

  const [{ data: staff }, { data: positions }] = await Promise.all([
    supabase
      .from("users")
      .select(
        "id, name, email, role, department, is_active, positions (name)"
      )
      .order("created_at", { ascending: true }),
    supabase
      .from("positions")
      .select("id, name")
      .order("sort_order", { ascending: true }),
  ]);

  const staffRows = staff ?? [];
  const positionRows = positions ?? [];

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
                      <TableHead>역할</TableHead>
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
                          {ROLE_LABELS[member.role] ?? member.role}
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

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">직급 관리</CardTitle>
          </CardHeader>
          <CardContent>
            <PositionsPanel positions={positionRows} />
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
