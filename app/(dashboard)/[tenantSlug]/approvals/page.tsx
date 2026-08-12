import Link from "next/link";

import { getSessionUser, requireRole } from "@/lib/auth/session";
import { getTenantModules, requireModule } from "@/lib/modules/server";
import { createClient } from "@/lib/supabase/server";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import {
  APPROVAL_STATUS_LABELS,
  APPROVAL_TYPE_LABELS,
  formatKrw,
} from "@/lib/approvals/constants";
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

import { SubmitApprovalDialog } from "./submit-dialog";

export const metadata = { title: "전자결재" };

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  in_progress: "default",
  approved: "secondary",
  rejected: "destructive",
  canceled: "outline",
};

type ApprovalRow = {
  id: string;
  title: string;
  approval_type: string;
  amount: number | null;
  status: string;
  created_at: string;
  requester_user_id: string;
  users: { name: string } | null;
  approval_steps: {
    step_order: number;
    status: string;
    approver_user_id: string;
  }[];
};

function currentPendingApprovers(approval: ApprovalRow): Set<string> {
  const pending = approval.approval_steps.filter((s) => s.status === "pending");
  if (approval.status !== "in_progress" || pending.length === 0) {
    return new Set();
  }
  const currentOrder = Math.min(...pending.map((s) => s.step_order));
  return new Set(
    pending
      .filter((s) => s.step_order === currentOrder)
      .map((s) => s.approver_user_id)
  );
}

/**
 * 전자결재 목록 (approvals 모듈) — 결재 승인·반려는 모바일 완전 대응 대상.
 */
export default async function ApprovalsPage({
  params,
}: {
  params: { tenantSlug: string };
}) {
  await requireRole(["platform_admin", "org_admin", "manager", "staff"]);
  await requireModule("approvals");

  if (!hasSupabaseEnv()) {
    return (
      <div>
        <PageHeader title="전자결재" />
        <main className="p-5">
          <EmptyState
            title="서버 설정 대기 중"
            description="Supabase 환경변수가 설정되면 표시됩니다."
          />
        </main>
      </div>
    );
  }

  const user = await getSessionUser();
  const supabase = createClient();
  const modules = await getTenantModules();

  const [{ data: approvals }, { data: users }, { data: myDelegations }] =
    await Promise.all([
      supabase
        .from("approvals")
        .select(
          "id, title, approval_type, amount, status, created_at, requester_user_id, users!approvals_requester_user_id_fkey (name), approval_steps (step_order, status, approver_user_id)"
        )
        .order("created_at", { ascending: false })
        .limit(100),
      supabase
        .from("users")
        .select("id, name")
        .eq("is_active", true)
        .order("name"),
      user
        ? supabase
            .from("approval_delegations")
            .select("delegator_user_id, starts_on, ends_on")
            .eq("delegate_user_id", user.id)
            .eq("is_active", true)
        : Promise.resolve({ data: [] as { delegator_user_id: string; starts_on: string; ends_on: string }[] }),
    ]);

  // operations 모듈 활성 시에만 프로젝트 연결 옵션 제공 (연동 규칙)
  const { data: projects } = modules.operations
    ? await supabase
        .from("projects")
        .select("id, name")
        .in("status", ["planned", "active"])
        .order("created_at", { ascending: false })
    : { data: null };

  const rows = (approvals ?? []) as ApprovalRow[];
  const today = new Date().toISOString().slice(0, 10);
  const myDelegatorIds = new Set(
    (myDelegations ?? [])
      .filter((d) => d.starts_on <= today && today <= d.ends_on)
      .map((d) => d.delegator_user_id)
  );

  const myTurn = rows.filter((a) => {
    const current = currentPendingApprovers(a);
    if (!user) return false;
    if (current.has(user.id)) return true;
    return Array.from(current).some((approverId) => myDelegatorIds.has(approverId));
  });
  const mySubmitted = rows.filter((a) => a.requester_user_id === user?.id);

  const renderTable = (list: ApprovalRow[]) => (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>제목</TableHead>
            <TableHead>유형</TableHead>
            <TableHead>금액</TableHead>
            <TableHead>상신자</TableHead>
            <TableHead>상신일</TableHead>
            <TableHead>상태</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {list.map((approval) => (
            <TableRow key={approval.id}>
              <TableCell className="max-w-64 truncate font-medium">
                <Link
                  href={`/${params.tenantSlug}/approvals/${approval.id}`}
                  className="text-brand underline-offset-4 hover:underline"
                >
                  {approval.title}
                </Link>
              </TableCell>
              <TableCell>
                {APPROVAL_TYPE_LABELS[approval.approval_type] ??
                  approval.approval_type}
              </TableCell>
              <TableCell>{formatKrw(approval.amount)}</TableCell>
              <TableCell>{approval.users?.name ?? "-"}</TableCell>
              <TableCell>
                {new Date(approval.created_at).toLocaleDateString("ko-KR")}
              </TableCell>
              <TableCell>
                <Badge variant={STATUS_VARIANT[approval.status] ?? "secondary"}>
                  {APPROVAL_STATUS_LABELS[approval.status] ?? approval.status}
                </Badge>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );

  return (
    <div>
      <PageHeader
        title="전자결재"
        actions={
          <div className="flex items-center gap-2">
            <Button asChild variant="outline" size="sm">
              <a href={`/${params.tenantSlug}/approvals/export`}>엑셀</a>
            </Button>
            <Button asChild variant="ghost" size="sm">
              <Link href={`/${params.tenantSlug}/approvals/delegations`}>대결 설정</Link>
            </Button>
            <Button asChild variant="ghost" size="sm">
              <Link href={`/${params.tenantSlug}/approvals/rules`}>전결규정</Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href={`/${params.tenantSlug}/approvals/travel`}>출장품의</Link>
            </Button>
            <SubmitApprovalDialog
              tenantSlug={params.tenantSlug}
              users={users ?? []}
              projects={projects}
            />
          </div>
        }
      />
      <main className="space-y-5 p-5">
        {myTurn.length > 0 && (
          <Card className="border-brand/40">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">
                내 결재 차례 ({myTurn.length})
              </CardTitle>
            </CardHeader>
            <CardContent>{renderTable(myTurn)}</CardContent>
          </Card>
        )}

        {rows.length === 0 ? (
          <EmptyState
            title="결재건이 없습니다"
            description="우측 상단 ‘새 품의’로 첫 품의를 상신하세요. 전결규정은 ‘전결규정’ 메뉴에서 관리합니다."
          />
        ) : (
          <>
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">
                  내가 상신한 문서 ({mySubmitted.length})
                </CardTitle>
              </CardHeader>
              <CardContent>
                {mySubmitted.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    상신한 문서가 없습니다.
                  </p>
                ) : (
                  renderTable(mySubmitted)
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">전체 문서 ({rows.length})</CardTitle>
              </CardHeader>
              <CardContent>{renderTable(rows)}</CardContent>
            </Card>
          </>
        )}
      </main>
    </div>
  );
}
