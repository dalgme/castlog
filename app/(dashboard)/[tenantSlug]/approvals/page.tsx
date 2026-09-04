import Link from "next/link";

import { getSessionUser, requireRole } from "@/lib/auth/session";
import { gradeFromUser } from "@/lib/auth/tenant";
import { isStepOpenFor, loadTurnContext } from "@/lib/approvals/turn";
import { getTenantModules, requireModule } from "@/lib/modules/server";
import { createClient } from "@/lib/supabase/server";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import {
  APPROVAL_TYPE_LABELS,
  approvalStatusLabel,
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

import { getAdminScopes } from "@/lib/auth/admin-scopes";
import { isPlanRelayEnabled } from "@/lib/approvals/relay";

import { SubmitApprovalDialog } from "./submit-dialog";
import { PlanRelayToggle } from "./relay-toggle";

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
  /** 38번: report = 사후보고(확인·피드백만) */
  approval_kind: string;
  amount: number | null;
  status: string;
  created_at: string;
  requester_user_id: string;
  users: { name: string } | null;
  approval_steps: {
    step_order: number;
    status: string;
    approver_user_id: string | null;
    step_grade: string | null;
  }[];
};

/** 현재 차례 그룹 (진행중 건의 최저 pending 차수) */
function currentPendingGroup(approval: ApprovalRow) {
  const pending = approval.approval_steps.filter((s) => s.status === "pending");
  if (approval.status !== "in_progress" || pending.length === 0) return [];
  const currentOrder = Math.min(...pending.map((s) => s.step_order));
  return pending.filter((s) => s.step_order === currentOrder);
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
  // 상급자 릴레이 결재 (27번) — 스위치 표시·상태
  const adminScopes = await getAdminScopes();
  const canManageRelay = adminScopes.approvals;
  const relayEnabled = await isPlanRelayEnabled();

  const [{ data: approvals }, { data: users }, turnCtx] =
    await Promise.all([
      supabase
        .from("approvals")
        .select(
          "id, title, approval_type, approval_kind, amount, status, created_at, requester_user_id, users!approvals_requester_user_id_fkey (name), approval_steps (step_order, status, approver_user_id, step_grade)"
        )
        .order("created_at", { ascending: false })
        .limit(100),
      supabase
        .from("users")
        .select("id, name")
        .eq("is_active", true)
        .order("name"),
      // 본인·대결(위임자 직급 포함)·릴레이 판정 — 배지·처리 액션과 같은 규칙
      user
        ? loadTurnContext(supabase, user.id, gradeFromUser(user))
        : Promise.resolve(null),
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
  const myTurn = rows.filter((a) => {
    if (!user || !turnCtx) return false;
    return currentPendingGroup(a).some((s) =>
      isStepOpenFor(s, a.requester_user_id, turnCtx)
    );
  });
  const mySubmitted = rows.filter((a) => a.requester_user_id === user?.id);

  // 현황 요약 — 목록만으로는 "지금 회사 결재가 어떤 상태인가"가 안 보인다.
  // 사후보고(38번)는 승인/반려 집계에서 뺀다 — 확인 문서지 결재가 아니다
  const decisions = rows.filter((a) => a.approval_kind !== "report");
  const inProgress = rows.filter((a) => a.status === "in_progress");
  const approved = decisions.filter((a) => a.status === "approved");
  const rejected = decisions.filter((a) => a.status === "rejected");
  const inProgressAmount = inProgress.reduce((sum, a) => sum + (a.amount ?? 0), 0);

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
                {approval.approval_kind === "report" && (
                  <span className="ml-1 rounded-full bg-brand-coral/15 px-1.5 py-0.5 text-[10px] font-semibold text-brand-coral-ink">
                    사후보고
                  </span>
                )}
              </TableCell>
              <TableCell>{formatKrw(approval.amount)}</TableCell>
              <TableCell>{approval.users?.name ?? "-"}</TableCell>
              <TableCell>
                {new Date(approval.created_at).toLocaleDateString("ko-KR")}
              </TableCell>
              <TableCell>
                <Badge
                  variant={
                    approval.approval_kind === "report" && approval.status === "rejected"
                      ? "outline"
                      : (STATUS_VARIANT[approval.status] ?? "secondary")
                  }
                >
                  {approvalStatusLabel(approval.status, approval.approval_kind)}
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
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <StatTile
            label="내 결재 차례"
            value={`${myTurn.length}건`}
            highlight={myTurn.length > 0}
          />
          <StatTile label="진행 중" value={`${inProgress.length}건`} />
          <StatTile label="진행 중 금액" value={formatKrw(inProgressAmount)} />
          <StatTile label="승인 완료" value={`${approved.length}건`} />
          <StatTile label="반려" value={`${rejected.length}건`} />
        </div>

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

        {/* 상급자 릴레이 결재 설정 (기획 2026-08-30 — 27번) —
            대표·'전결규정' 위임자에게만 (서버 액션이 다시 검증) */}
        {canManageRelay && <PlanRelayToggle enabled={relayEnabled} />}
      </main>
    </div>
  );
}

/** 결재 현황 타일 — 최근 100건 기준 (목록과 같은 범위) */
function StatTile({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div
      className={
        "rounded-lg border bg-white p-3 " + (highlight ? "border-brand/50" : "")
      }
    >
      <p className="text-xs text-muted-foreground">{label}</p>
      <p
        className={
          "mt-1 text-lg font-bold tabular-nums " +
          (highlight ? "text-brand" : "text-brand-navy")
        }
      >
        {value}
      </p>
    </div>
  );
}
