import Link from "next/link";
import { redirect } from "next/navigation";

import { requireRole, postLoginPath } from "@/lib/auth/session";
import { getAdminScopes } from "@/lib/auth/admin-scopes";
import { roleFromUser } from "@/lib/auth/tenant";
import { requireModule } from "@/lib/modules/server";
import { createClient } from "@/lib/supabase/server";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import {
  APPROVAL_TYPE_LABELS,
  STEP_KIND_LABELS,
  formatKrw,
} from "@/lib/approvals/constants";
import { PageHeader } from "@/components/layout/header";
import { EmptyState } from "@/components/layout/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

import { SettingsTabs } from "@/components/layout/settings-tabs";
import { PermissionLevelGuide } from "@/components/org/permission-level-guide";

import { RuleDialog, type RulePrefill } from "./rule-dialog";
import { RuleDeactivateButton } from "./rule-deactivate-button";

export const metadata = { title: "전결규정" };

/**
 * 전결규정 관리 (기업총괄관리자) — 금액 구간·유형 조건 → 결재라인 자동 결정.
 * 개정은 새 버전 생성 + 구 버전 이력 보존 (CLAUDE.md 14-5).
 */
export default async function ApprovalRulesPage({
  params,
}: {
  params: { tenantSlug: string };
}) {
  // 대표 또는 '전결규정' 위임자 — 결재선을 실제로 설계하는 사람은 대개
  // 경영지원·기획 담당이다. 대표만 열어 두면 대표 계정을 빌려 쓰게 된다.
  const gateUser = await requireRole([
    "platform_admin",
    "org_admin",
    "manager",
    "staff",
  ]);
  const scopes = await getAdminScopes();
  if (gateUser && !scopes.approvals) redirect(postLoginPath(gateUser));
  const isCeoHere =
    gateUser !== null &&
    ["org_admin", "platform_admin"].includes(roleFromUser(gateUser) ?? "");
  await requireModule("approvals");

  if (!hasSupabaseEnv()) {
    return (
      <div>
        <PageHeader title="전결규정" />
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

  const [{ data: rules }, { data: users }] = await Promise.all([
    supabase
      .from("approval_rules")
      .select(
        `id, name, approval_type, min_amount, max_amount, priority, version, is_active, created_at,
         approval_rule_steps (step_order, step_kind, approver_user_id, users (name))`
      )
      .order("is_active", { ascending: false })
      .order("priority", { ascending: false })
      .order("created_at", { ascending: false }),
    supabase.from("users").select("id, name").eq("is_active", true).order("name"),
  ]);

  const userOptions = users ?? [];
  const activeRules = (rules ?? []).filter((r) => r.is_active);
  const inactiveRules = (rules ?? []).filter((r) => !r.is_active);

  const renderRule = (rule: NonNullable<typeof rules>[number]) => {
    const sortedSteps = [...(rule.approval_rule_steps ?? [])].sort(
      (a, b) => a.step_order - b.step_order
    );
    const prefill: RulePrefill = {
      baseRuleId: rule.id,
      name: rule.name,
      approvalType: rule.approval_type ?? "",
      minAmount: rule.min_amount !== null ? String(rule.min_amount) : "",
      maxAmount: rule.max_amount !== null ? String(rule.max_amount) : "",
      priority: String(rule.priority),
      steps: sortedSteps.map((s) => ({
        stepOrder: String(s.step_order),
        stepKind: s.step_kind === "agreement" ? "agreement" : "approval",
        approverUserId: s.approver_user_id,
      })),
    };

    return (
      <li key={rule.id} className="rounded-md border p-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold">{rule.name}</span>
          <Badge variant="outline" className="text-[10px]">
            v{rule.version}
          </Badge>
          <Badge variant="secondary" className="text-[10px]">
            {rule.approval_type
              ? APPROVAL_TYPE_LABELS[rule.approval_type]
              : "전체 유형"}
          </Badge>
          <span className="text-xs text-muted-foreground">
            {rule.min_amount !== null || rule.max_amount !== null
              ? `${rule.min_amount !== null ? formatKrw(rule.min_amount) : "0원"} ~ ${
                  rule.max_amount !== null ? formatKrw(rule.max_amount) : "상한 없음"
                }`
              : "금액 무관"}
          </span>
          <span className="text-xs text-muted-foreground">
            우선순위 {rule.priority}
          </span>
          {rule.is_active && (
            <div className="ml-auto flex items-center gap-1">
              <RuleDialog
                users={userOptions}
                prefill={prefill}
                trigger={
                  <Button variant="outline" size="sm">
                    개정
                  </Button>
                }
              />
              <RuleDeactivateButton ruleId={rule.id} />
            </div>
          )}
        </div>
        <p className="mt-1.5 text-xs text-muted-foreground">
          {sortedSteps
            .map(
              (s) =>
                `${s.step_order}차 ${STEP_KIND_LABELS[s.step_kind] ?? s.step_kind} ${
                  s.users?.name ?? "-"
                }`
            )
            .join(" → ")}
        </p>
      </li>
    );
  };

  return (
    <div>
      <PageHeader
        title="전결규정"
        actions={
          <div className="flex items-center gap-2">
            <Button asChild variant="ghost" size="sm">
              <Link href={`/${params.tenantSlug}/approvals`}>결재 목록</Link>
            </Button>
            <RuleDialog
              users={userOptions}
              trigger={<Button size="sm">규정 등록</Button>}
            />
          </div>
        }
      />
      <SettingsTabs
        tenantSlug={params.tenantSlug}
        showStaff={isCeoHere || scopes.staff}
        showSms={isCeoHere || scopes.sending}
        showOrg={isCeoHere || Object.values(scopes).some(Boolean)}
        showRules
      />
      <main className="space-y-5 p-5">
        {/* 처음 쓰는 회사용 — 직급/권한 레벨/프로젝트 역할 관계 안내 (기획 확정 2026-08-23) */}
        <PermissionLevelGuide />
        {activeRules.length === 0 ? (
          <EmptyState
            title="등록된 전결규정이 없습니다"
            description="규정을 등록하면 품의 상신 시 결재라인이 자동 결정됩니다. 규정이 없으면 상신자가 결재라인을 직접 지정합니다."
          />
        ) : (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">
                활성 규정 ({activeRules.length})
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2">{activeRules.map(renderRule)}</ul>
            </CardContent>
          </Card>
        )}

        {inactiveRules.length > 0 && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm text-muted-foreground">
                이력 (폐지·개정 전 버전, {inactiveRules.length})
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2 opacity-70">
                {inactiveRules.map(renderRule)}
              </ul>
            </CardContent>
          </Card>
        )}
      </main>
    </div>
  );
}
