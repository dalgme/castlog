import Link from "next/link";

import { requireRole } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { PageHeader } from "@/components/layout/header";
import { EmptyState } from "@/components/layout/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const metadata = { title: "감사로그" };

/** 행위 카테고리(action 접두어) 필터 */
const ACTION_CATEGORIES: Record<string, string> = {
  approval: "전자결재",
  approval_rule: "전결규정",
  approval_delegation: "대결·위임",
  engagement: "섭외",
  expert: "전문가",
  expert_document: "전문가 서류",
  expert_invitation: "등록 요청",
  document_request: "서류 제출 요청",
  payment_batch: "지급",
  project: "프로젝트",
  project_step: "프로젝트 스텝",
  message: "발송",
  export: "데이터 내보내기",
  user: "계정",
  sms_config: "SMS 설정",
  ad: "수신동의",
};

/** 대표 행위 한글 표기 (미등록 action은 원문 그대로 노출) */
const ACTION_LABELS: Record<string, string> = {
  "approval.submit": "결재 상신",
  "approval.approve": "결재 승인",
  "approval.reject": "결재 반려",
  "approval.cancel": "결재 회수",
  "approval.resubmit": "재상신",
  "approval_rule.deactivate": "전결규정 비활성화",
  "approval_delegation.create": "대결·위임 설정",
  "approval_delegation.end": "대결·위임 종료",
  "engagement.request": "섭외 요청",
  "engagement.cancel": "섭외 취소",
  "expert.register": "전문가 등록",
  "expert_document.upload": "서류 업로드",
  "expert_document.view": "서류 열람",
  "expert_invitation.create": "등록 요청 생성",
  "expert_invitation.bulk_create": "등록 요청 일괄 생성",
  "expert_invitation.revoke": "등록 요청 회수",
  "document_request.create": "서류 제출 요청",
  "document_request.cancel": "서류 제출 요청 회수",
  "payment_batch.create": "지급건 생성",
  "payment_batch.submit_approval": "지급 품의 상신",
  "payment_batch.simple_confirm": "지급 확정(결재 생략)",
  "payment_batch.paid": "지급 완료",
  "payment_batch.cancel": "지급건 취소",
  "project.create": "프로젝트 생성",
  "project_step.status_change": "스텝 상태 변경",
  "message.send": "발송 실행",
  "export.experts": "전문가 목록 내보내기",
  "export.projects": "프로젝트 목록 내보내기",
  "export.approvals": "결재 목록 내보내기",
  "export.payments": "지급 현황 내보내기",
  "export.staff": "직원 목록 내보내기",
  "user.create": "직원 계정 생성",
  "user.activate": "계정 활성화",
  "user.deactivate": "계정 비활성화",
  "sms_config.save": "SMS 설정 저장",
  "ad.unsubscribe": "광고 수신거부",
  "tenant.create": "테넌트 생성",
  "tenant.update_modules": "모듈 조합 변경",
  "usage.snapshot": "사용량 수동 집계",
};

const ROLE_LABELS: Record<string, string> = {
  platform_admin: "플랫폼관리자",
  org_admin: "기업총괄관리자",
  manager: "관리자",
  staff: "직원",
  expert: "전문가",
};

/**
 * 감사로그 조회 — 기업총괄관리자 전용 (설계문서 7.5).
 * audit_logs는 INSERT 전용이며 RLS가 자사 범위로 제한한다.
 */
export default async function AuditLogPage({
  params,
  searchParams,
}: {
  params: { tenantSlug: string };
  searchParams: { category?: string; from?: string; to?: string; q?: string };
}) {
  await requireRole(["org_admin", "platform_admin"]);

  if (!hasSupabaseEnv()) {
    return (
      <div className="min-h-screen bg-secondary/50">
        <PageHeader title="감사로그" />
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
  const category = searchParams.category ?? "";
  const from = searchParams.from ?? "";
  const to = searchParams.to ?? "";
  const q = searchParams.q ?? "";

  let query = supabase
    .from("audit_logs")
    .select(
      "id, action, resource_type, resource_id, actor_auth_user_id, actor_role, after_data, created_at"
    )
    .order("created_at", { ascending: false })
    .limit(100);

  if (category) query = query.like("action", `${category}.%`);
  if (from) query = query.gte("created_at", `${from}T00:00:00+09:00`);
  if (to) query = query.lte("created_at", `${to}T23:59:59+09:00`);
  if (q) query = query.or(`action.ilike.%${q}%,resource_type.ilike.%${q}%`);

  const [{ data: logs }, { data: staff }] = await Promise.all([
    query,
    supabase.from("users").select("id, name"),
  ]);

  const nameByUserId = new Map((staff ?? []).map((u) => [u.id, u.name]));
  const rows = logs ?? [];

  return (
    <div className="min-h-screen bg-secondary/50">
      <PageHeader
        title="감사로그"
        actions={
          <Button asChild variant="ghost" size="sm">
            <Link href={`/${params.tenantSlug}/admin/org`}>기업 관리로</Link>
          </Button>
        }
      />
      <main className="space-y-5 p-5">
        <Card>
          <CardContent className="pt-6">
            <form method="get" className="flex flex-wrap items-end gap-3">
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">
                  행위 유형
                </label>
                <select
                  name="category"
                  defaultValue={category}
                  className="h-9 rounded-md border border-input bg-transparent px-2 text-sm"
                >
                  <option value="">전체</option>
                  {Object.entries(ACTION_CATEGORIES).map(([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">
                  시작일
                </label>
                <Input type="date" name="from" defaultValue={from} className="h-9 w-40" />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">
                  종료일
                </label>
                <Input type="date" name="to" defaultValue={to} className="h-9 w-40" />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">
                  검색 (행위·대상)
                </label>
                <Input name="q" defaultValue={q} placeholder="예: export" className="h-9 w-48" />
              </div>
              <Button type="submit" size="sm">
                조회
              </Button>
              {(category || from || to || q) && (
                <Button asChild variant="ghost" size="sm">
                  <Link href={`/${params.tenantSlug}/admin/org/audit`}>초기화</Link>
                </Button>
              )}
            </form>
          </CardContent>
        </Card>

        {rows.length === 0 ? (
          <EmptyState
            title="기록이 없습니다"
            description="조건을 바꾸어 다시 조회해 보세요."
          />
        ) : (
          <Card>
            <CardContent className="pt-6">
              <p className="mb-3 text-sm text-muted-foreground">
                최근 {rows.length}건 (최대 100건 표시)
              </p>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>시각</TableHead>
                      <TableHead>행위자</TableHead>
                      <TableHead>행위</TableHead>
                      <TableHead>대상</TableHead>
                      <TableHead>내용</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((log) => (
                      <TableRow key={log.id}>
                        <TableCell className="whitespace-nowrap text-sm">
                          {new Date(log.created_at).toLocaleString("ko-KR", {
                            timeZone: "Asia/Seoul",
                            month: "numeric",
                            day: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </TableCell>
                        <TableCell className="whitespace-nowrap">
                          <span className="text-sm font-medium">
                            {(log.actor_auth_user_id &&
                              nameByUserId.get(log.actor_auth_user_id)) ??
                              ROLE_LABELS[log.actor_role ?? ""] ??
                              "-"}
                          </span>
                          {log.actor_role && (
                            <Badge variant="secondary" className="ml-1.5">
                              {ROLE_LABELS[log.actor_role] ?? log.actor_role}
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-sm">
                          {ACTION_LABELS[log.action] ?? log.action}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                          {log.resource_type}
                          {log.resource_id ? ` · ${log.resource_id.slice(0, 8)}` : ""}
                        </TableCell>
                        <TableCell className="max-w-[320px] truncate font-mono text-xs text-muted-foreground">
                          {log.after_data ? JSON.stringify(log.after_data) : "-"}
                        </TableCell>
                      </TableRow>
                    ))}
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
