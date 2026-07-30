import Link from "next/link";

import { getSessionUser, requireRole } from "@/lib/auth/session";
import { requireModule } from "@/lib/modules/server";
import { createClient } from "@/lib/supabase/server";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { PageHeader } from "@/components/layout/header";
import { EmptyState } from "@/components/layout/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

import { DelegationForm, EndDelegationButton } from "./delegation-form";

export const metadata = { title: "대결 설정" };

/**
 * 대결·위임 설정 — 내가 위임한 것과 나에게 위임된 것을 함께 표시.
 * 대결 처리 건은 결재 상세에서 원 결재자와 병기된다 (CLAUDE.md 7).
 */
export default async function DelegationsPage({
  params,
}: {
  params: { tenantSlug: string };
}) {
  await requireRole(["platform_admin", "org_admin", "manager", "staff"]);
  await requireModule("approvals");

  if (!hasSupabaseEnv()) {
    return (
      <div>
        <PageHeader title="대결 설정" />
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

  const [{ data: delegations }, { data: users }] = await Promise.all([
    supabase
      .from("approval_delegations")
      .select(
        `id, delegator_user_id, delegate_user_id, starts_on, ends_on, reason, is_active,
         delegator:users!approval_delegations_delegator_user_id_fkey (name),
         delegate:users!approval_delegations_delegate_user_id_fkey (name)`
      )
      .eq("is_active", true)
      .order("starts_on", { ascending: false }),
    supabase.from("users").select("id, name").eq("is_active", true).order("name"),
  ]);

  const rows = delegations ?? [];
  const myGiven = rows.filter((d) => d.delegator_user_id === user?.id);
  const myReceived = rows.filter((d) => d.delegate_user_id === user?.id);
  const today = new Date().toISOString().slice(0, 10);

  const renderRow = (
    row: NonNullable<typeof delegations>[number],
    canEnd: boolean
  ) => {
    const active = row.starts_on <= today && today <= row.ends_on;
    return (
      <li
        key={row.id}
        className="flex flex-wrap items-center gap-2 rounded-md border p-3 text-sm"
      >
        <span className="font-medium">{row.delegator?.name ?? "-"}</span>
        <span className="text-muted-foreground">→</span>
        <span className="font-medium">{row.delegate?.name ?? "-"}</span>
        <span className="text-xs text-muted-foreground">
          {row.starts_on} ~ {row.ends_on}
        </span>
        {row.reason && (
          <span className="text-xs text-muted-foreground">({row.reason})</span>
        )}
        <Badge variant={active ? "default" : "secondary"} className="ml-auto">
          {active ? "적용중" : "예정/만료"}
        </Badge>
        {canEnd && <EndDelegationButton delegationId={row.id} />}
      </li>
    );
  };

  return (
    <div>
      <PageHeader
        title="대결 설정"
        actions={
          <Button asChild variant="ghost" size="sm">
            <Link href={`/${params.tenantSlug}/approvals`}>결재 목록</Link>
          </Button>
        }
      />
      <main className="mx-auto max-w-2xl space-y-4 p-4 sm:p-5">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">새 대결 설정</CardTitle>
          </CardHeader>
          <CardContent>
            <DelegationForm
              users={(users ?? []).filter((u) => u.id !== user?.id)}
            />
            <p className="mt-3 text-xs text-muted-foreground">
              기간 내 대결자가 내 결재 차례를 대신 처리할 수 있습니다. 대결
              처리 건은 원 결재자와 대결자가 함께 기록됩니다. 민감정보 조회
              권한은 대결 대상에 포함되지 않습니다.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">
              내가 위임한 대결 ({myGiven.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            {myGiven.length === 0 ? (
              <p className="text-sm text-muted-foreground">위임한 대결이 없습니다.</p>
            ) : (
              <ul className="space-y-2">{myGiven.map((d) => renderRow(d, true))}</ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">
              나에게 위임된 대결 ({myReceived.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            {myReceived.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                위임받은 대결이 없습니다.
              </p>
            ) : (
              <ul className="space-y-2">
                {myReceived.map((d) => renderRow(d, false))}
              </ul>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
