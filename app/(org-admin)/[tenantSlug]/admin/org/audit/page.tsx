import Link from "next/link";
import { redirect } from "next/navigation";

import { requireUser, postLoginPath } from "@/lib/auth/session";
import { canViewSecurity } from "@/lib/auth/admin-scopes";
import { createClient } from "@/lib/supabase/server";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { PageHeader } from "@/components/layout/header";
import { EmptyState } from "@/components/layout/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  ACTION_CATEGORIES,
  auditActionLabel,
  auditRoleLabel,
} from "@/lib/audit/labels";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const metadata = { title: "감사로그" };

/**
 * 감사로그 조회 — 대표 또는 audit 위임을 받은 보안책임자 (설계문서 7.5).
 * audit_logs는 INSERT 전용이며 RLS가 자사 범위로 제한한다.
 */
export default async function AuditLogPage({
  params,
  searchParams,
}: {
  params: { tenantSlug: string };
  searchParams: { category?: string; from?: string; to?: string; q?: string };
}) {
  const gateUser = await requireUser();
  if (!gateUser) return null;
  if (!(await canViewSecurity())) redirect(postLoginPath(gateUser));

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
          <div className="flex items-center gap-2">
            <Button asChild variant="outline" size="sm">
              <a
                href={`/${params.tenantSlug}/admin/org/audit/export?category=${category}&from=${from}&to=${to}&q=${encodeURIComponent(q)}`}
              >
                엑셀
              </a>
            </Button>
            <Button asChild variant="ghost" size="sm">
              <Link href={`/${params.tenantSlug}/admin/org/security`}>보안 현황</Link>
            </Button>
            <Button asChild variant="ghost" size="sm">
              <Link href={`/${params.tenantSlug}/admin/org`}>기업 관리로</Link>
            </Button>
          </div>
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
                              auditRoleLabel(log.actor_role)}
                          </span>
                          {log.actor_role && (
                            <Badge variant="secondary" className="ml-1.5">
                              {auditRoleLabel(log.actor_role)}
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-sm">
                          {auditActionLabel(log.action)}
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
