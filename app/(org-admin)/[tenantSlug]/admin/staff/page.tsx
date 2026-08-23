import { redirect } from "next/navigation";
import { UserCheck, UserPlus, Users } from "lucide-react";

import { requireUser, getSessionUser, postLoginPath } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { PageHeader } from "@/components/layout/header";
import { EmptyState } from "@/components/layout/empty-state";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import { roleFromUser } from "@/lib/auth/tenant";
import { GRADE_LABELS, gradeLabel, isUserGrade, type UserGrade } from "@/lib/auth/grades";
import { EXEC_FEATURES, type ExecFeature } from "@/lib/auth/exec-permissions";
import { isAdminScope } from "@/lib/auth/admin-scope-keys";
import { getAdminScopes } from "@/lib/auth/admin-scopes";
import { getTenantModules } from "@/lib/modules/server";
import { buildStaffJoinLink } from "@/lib/routing/links";

import { SettingsTabs } from "@/components/layout/settings-tabs";

import { CreateStaffDialog } from "../org/staff-dialog";
import {
  JoinRequestsPanel,
  type JoinRequestRow,
} from "../org/join-requests-panel";
import { StaffActiveToggle } from "../org/staff-active-toggle";
import { StaffEditDialog } from "../org/staff-edit-dialog";
import { StaffGradeSelect } from "../org/staff-grade-select";
import { LevelGuideDialog } from "../org/level-guide-dialog";
import { PositionsPanel } from "../org/positions-panel";
import { ExecThresholdPanel } from "../org/exec-threshold-panel";
import {
  AdminDelegationPanel,
  type DelegationRow,
} from "../org/admin-delegation-panel";

export const metadata = { title: "임직원 설정" };

/** DB 문자열 → UserGrade (제약이 걸려 있지만 타입 경계에서 한 번 좁힌다) */
function gradeOf(value: string): UserGrade {
  return isUserGrade(value) ? value : "staff";
}

/**
 * 임직원 설정 — 사람에 관한 설정을 한 화면에 모은다.
 *
 * 원래는 '기업관리' 한 화면에 회사 정보·카테고리·세무 지정·직원 계정이 모두
 * 쌓여 있어서, 직원 하나 추가하려면 관계없는 카드 다섯 개를 지나야 했다.
 * 축을 사람/회사로 갈랐다 — 여기는 사람, 기업관리는 회사.
 *
 * 사람을 들이는 길은 둘이고, 둘을 같은 화면 위아래에 둔다:
 *  ① 본인이 신청 → 여기서 승인하면 계정이 만들어진다 (가입 신청 링크)
 *  ② 관리자가 직접 만든다 → '직원 추가' (신청을 기다릴 수 없는 경우)
 * 그리고 이미 있는 계정의 활성/비활성은 아래 목록에서 바로 전환한다.
 */
export default async function StaffSettingsPage({
  params,
}: {
  params: { tenantSlug: string };
}) {
  // 대표(org_admin)·플랫폼관리자 또는 '직원·직급 관리'를 위임받은 직원
  const gateUser = await requireUser();
  const scopeSet = await getAdminScopes();
  let isCeo = false;
  if (gateUser) {
    const role = roleFromUser(gateUser);
    isCeo = role === "org_admin" || role === "platform_admin";
    if (!isCeo && !scopeSet.staff) redirect(postLoginPath(gateUser));
  }
  const modules = await getTenantModules();

  if (!hasSupabaseEnv()) {
    return (
      <div className="min-h-screen bg-secondary/50">
        <PageHeader title="임직원 설정" />
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

  // '레벨 설정 이해하기' 확인 여부 (기획 확정 2026-08-23 — 최초 1회 강제)
  const { data: levelGuideAck } = sessionUser
    ? await supabase
        .from("user_tour_acks")
        .select("tour_key")
        .eq("user_id", sessionUser.id)
        .eq("tour_key", "level_guide")
        .maybeSingle()
    : { data: null };
  const levelGuideAcked = Boolean(levelGuideAck);

  const [{ data: staff }, { data: positions }, { data: joinRecords }] =
    await Promise.all([
      supabase
        .from("users")
        .select(
          "id, name, email, phone, role, grade, department, position_id, is_active, positions (name)"
        )
        .order("created_at", { ascending: true }),
      supabase
        .from("positions")
        .select("id, name")
        .order("sort_order", { ascending: true }),
      supabase
        .from("staff_join_requests")
        .select("id, name, email, phone, department, note, created_at")
        .eq("status", "pending")
        .order("created_at", { ascending: true }),
    ]);

  const { data: adminGrants } = await supabase
    .from("tenant_admin_grants")
    .select("id, user_id, scope, note, granted_at")
    .is("revoked_at", null)
    .order("granted_at", { ascending: true });

  const staffRows = staff ?? [];
  const positionRows = positions ?? [];
  const staffNameById = new Map(staffRows.map((s) => [s.id, s.name]));

  // 기능별 권한 문턱 조정 — 회사 조정값 + 개인 지정 (테이블 미생성 시 빈 목록 폴백)
  const [{ data: execOverrides }, { data: execGrants }] = await Promise.all([
    supabase.from("tenant_exec_overrides").select("feature, min_grade"),
    supabase.from("tenant_exec_grants").select("feature, user_id"),
  ]);
  const overrideByFeature = new Map(
    (execOverrides ?? []).map((o) => [o.feature, o.min_grade])
  );
  const grantsByFeature = new Map<string, { userId: string; name: string }[]>();
  for (const g of execGrants ?? []) {
    const list = grantsByFeature.get(g.feature) ?? [];
    list.push({ userId: g.user_id, name: staffNameById.get(g.user_id) ?? "(직원)" });
    grantsByFeature.set(g.feature, list);
  }
  const execPolicyRows = (Object.keys(EXEC_FEATURES) as ExecFeature[])
    // 지급건 생성은 레벨 축이 아니라 지급 위임(finance 스위치)으로 관리 — 표에서 제외
    .filter((f) => f !== "paymentBatchCreate")
    .map((f) => ({
      feature: f,
      label: EXEC_FEATURES[f].label,
      defaultLabel: GRADE_LABELS[EXEC_FEATURES[f].minGrade],
      overrideGrade: overrideByFeature.get(f) ?? null,
      grants: grantsByFeature.get(f) ?? [],
    }));
  const execStaff = staffRows
    .filter((s) => s.is_active)
    .map((s) => ({ id: s.id, name: s.name, gradeLabel: gradeLabel(s.grade) }));

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

  const joinRequests: JoinRequestRow[] = (joinRecords ?? []).map((r) => ({
    id: r.id,
    name: r.name,
    email: r.email,
    phone: r.phone,
    department: r.department,
    note: r.note,
    createdAt: r.created_at,
  }));
  const joinUrl = buildStaffJoinLink(params.tenantSlug);

  const activeCount = staffRows.filter((s) => s.is_active).length;
  const inactiveCount = staffRows.length - activeCount;

  return (
    <div className="min-h-screen bg-secondary/50">
      <PageHeader
        title="임직원 설정"
        actions={<CreateStaffDialog positions={positionRows} />}
      />
      <SettingsTabs
        tenantSlug={params.tenantSlug}
        showStaff
        showSms={isCeo || scopeSet.sending}
        showOrg={isCeo || Object.values(scopeSet).some(Boolean)}
        showRules={modules.approvals && (isCeo || scopeSet.approvals)}
      />
      <main className="space-y-5 p-5">
        {/* 요약 — 지금 몇 명이고 무엇이 밀려 있는지가 첫 줄이어야 한다 */}
        <div className="grid gap-3 sm:grid-cols-3">
          <SummaryTile
            icon={<Users className="h-4 w-4" aria-hidden />}
            label="활성 계정"
            value={`${activeCount}명`}
            hint={inactiveCount > 0 ? `비활성 ${inactiveCount}명` : "전원 활성"}
          />
          <SummaryTile
            icon={<UserCheck className="h-4 w-4" aria-hidden />}
            label="대기 중인 가입 신청"
            value={`${joinRequests.length}건`}
            hint={
              joinRequests.length > 0
                ? "승인하면 계정이 만들어집니다"
                : "밀린 신청이 없습니다"
            }
            highlight={joinRequests.length > 0}
          />
          <SummaryTile
            icon={<UserPlus className="h-4 w-4" aria-hidden />}
            label="직접 등록"
            value="직원 추가"
            hint="신청을 기다릴 수 없을 때 (우측 상단)"
          />
        </div>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">
              ① 가입 신청 승인 ({joinRequests.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <JoinRequestsPanel
              joinUrl={joinUrl}
              requests={joinRequests}
              positions={positionRows}
              canGrantCeo={isCeo}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle className="text-sm">
                ② 직원 계정 ({staffRows.length})
              </CardTitle>
              {/* 권한 레벨 조정 전 최초 1회 확인 (기획 확정 2026-08-23) */}
              <LevelGuideDialog acked={levelGuideAcked} />
            </div>
          </CardHeader>
          <CardContent>
            {staffRows.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                등록된 직원이 없습니다. 우측 상단 ‘직원 추가’로 시작하거나, 위
                가입 신청 링크를 임직원에게 전달하세요.
              </p>
            ) : (
              <>
                <p className="mb-3 text-xs text-muted-foreground">
                  권한단계를 바꾸면 볼 수 있는 화면과 할 수 있는 일이 함께
                  바뀝니다. <b>변경은 본인이 다시 로그인할 때(늦어도 1시간 안에)
                  적용됩니다</b> — 바꾼 직후 본인 화면에서 권한 오류가 보이면
                  로그아웃 후 다시 로그인하도록 안내하세요. 퇴사·휴직은 삭제가
                  아니라 <b>비활성</b>으로 처리합니다 — 그 사람이 남긴 결재·섭외
                  이력이 그대로 남아야 합니다.
                </p>
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
                        <TableHead className="w-32">관리</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {staffRows.map((member) => (
                        <TableRow key={member.id}>
                          <TableCell className="font-medium">
                            {member.name}
                          </TableCell>
                          <TableCell>{member.email}</TableCell>
                          <TableCell>
                            <StaffGradeSelect
                              userId={member.id}
                              grade={gradeOf(member.grade)}
                              disabled={member.id === sessionUser?.id}
                              disabledReason="본인 권한단계는 변경할 수 없습니다."
                              guideAcked={levelGuideAcked}
                            />
                          </TableCell>
                          <TableCell>{member.department ?? "-"}</TableCell>
                          <TableCell>{member.positions?.name ?? "-"}</TableCell>
                          <TableCell>
                            <Badge
                              variant={member.is_active ? "default" : "destructive"}
                            >
                              {member.is_active ? "활성" : "비활성"}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <span className="flex items-center gap-1">
                              {/* 정보 수정은 본인 것도 연다 — 이름·부서를 고치는
                                  일에 위험이 없다. 등급은 위 선택 상자에서만 */}
                              <StaffEditDialog
                                target={{
                                  id: member.id,
                                  name: member.name,
                                  email: member.email,
                                  phone: member.phone,
                                  department: member.department,
                                  positionId: member.position_id,
                                }}
                                positions={positionRows}
                                isSelf={member.id === sessionUser?.id}
                                isCeoTarget={member.grade === "ceo"}
                              />
                              <StaffActiveToggle
                                userId={member.id}
                                isActive={member.is_active}
                                isSelf={member.id === sessionUser?.id}
                              />
                            </span>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        <ExecThresholdPanel rows={execPolicyRows} staff={execStaff} />

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">③ 직급 관리</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="mb-3 text-xs text-muted-foreground">
              권한단계(대표~사원)와 별개로, 회사가 실제로 쓰는 직급 표기입니다.
              여기 등록한 직급은 결재선·명부와 주민등록번호 조회 지정자의 역할
              표기에 그대로 쓰입니다.
            </p>
            <PositionsPanel positions={positionRows} />
          </CardContent>
        </Card>

        <AdminDelegationPanel
          candidates={delegationCandidates}
          grants={delegationRows}
          canManage={isCeo}
        />
      </main>
    </div>
  );
}

function SummaryTile({
  icon,
  label,
  value,
  hint,
  highlight,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  hint: string;
  highlight?: boolean;
}) {
  return (
    <div
      className={
        "rounded-xl border bg-white p-3.5 " +
        (highlight ? "border-brand/50 bg-[#F2F6FF]" : "")
      }
    >
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <span className="text-brand">{icon}</span>
        {label}
      </p>
      <p className="mt-1 text-lg font-bold text-brand-navy">{value}</p>
      <p className="text-[11px] text-muted-foreground">{hint}</p>
    </div>
  );
}
