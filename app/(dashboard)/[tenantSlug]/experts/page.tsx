import Link from "next/link";

import { requireRole, getSessionUser } from "@/lib/auth/session";
import { roleFromUser } from "@/lib/auth/tenant";
import { getTenantModules, requireModule } from "@/lib/modules/server";
import { createClient } from "@/lib/supabase/server";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { formatKrMobile } from "@/lib/auth/phone";
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

import { EngagementDialog } from "@/components/integrations/engagement-dialog";

import { InviteExpertDialog } from "./invite-dialog";
import { ExpertRecommendDialog } from "./recommend-dialog";
import { RevokeInvitationButton } from "./revoke-button";
import { ExpertTagCell } from "./expert-tag-cell";

export const metadata = { title: "전문가" };

/** 연결 상태 표기 */
const LINK_STATUS_LABEL: Record<string, { label: string; variant: "default" | "secondary" | "destructive" }> = {
  active: { label: "연결됨", variant: "default" },
  pending: { label: "대기중", variant: "secondary" },
  revoked: { label: "해제됨", variant: "destructive" },
};

/**
 * 기업 전문가 목록 — 연결(expert_tenant_links)이 있는 전문가만 보인다 (RLS,
 * 플랫폼 전체 풀 검색 금지 — 설계문서 3.2). 섭외이력·비용은 테넌트 격리 데이터로
 * 이후 단계에서 이 화면에 연결된다.
 *
 */
export default async function TenantExpertsPage({
  params,
}: {
  params: { tenantSlug: string };
}) {
  await requireRole(["platform_admin", "org_admin", "manager", "staff"]);
  await requireModule("experts");

  if (!hasSupabaseEnv()) {
    return (
      <div>
        <PageHeader title="전문가" />
        <main className="p-5">
          <EmptyState
            title="서버 설정 대기 중"
            description="Supabase 환경변수가 설정되면 전문가 목록이 표시됩니다."
          />
        </main>
      </div>
    );
  }

  const supabase = createClient();
  const modules = await getTenantModules();

  const [{ data: links }, { data: invitations }] = await Promise.all([
    supabase
      .from("expert_tenant_links")
      .select(
        "id, status, accepted_at, requested_at, experts (id, name, phone, email, specialty, region, career_years)"
      )
      .order("created_at", { ascending: false }),
    supabase
      .from("expert_invitations")
      .select("id, invited_name, invited_phone, status, expires_at, created_at")
      .eq("status", "pending")
      .order("created_at", { ascending: false }),
  ]);

  const linkRows = links ?? [];
  const pendingInvitations = invitations ?? [];

  // 자사 등급 태그 (테넌트 격리 — 전문가 본인에게는 노출하지 않는다)
  const linkedExpertIds = linkRows
    .map((l) => l.experts?.id)
    .filter((id): id is string => Boolean(id));
  const { data: tagRows } = linkedExpertIds.length
    ? await supabase
        .from("expert_tenant_tags")
        .select("expert_id, tag, note")
        .in("expert_id", linkedExpertIds)
    : { data: null };
  const tagByExpert = new Map(
    (tagRows ?? []).map((t) => [t.expert_id, { tag: t.tag, note: t.note }])
  );

  const sessionUser = await getSessionUser();
  const canManageTags = ["org_admin", "manager"].includes(
    roleFromUser(sessionUser) ?? ""
  );

  const activeExpertOptions = linkRows
    .filter((l) => l.status === "active" && l.experts)
    .map((l) => ({ id: l.experts!.id, name: l.experts!.name }));

  // 프로젝트 연결 옵션은 operations 모듈 활성 시에만 (CLAUDE.md 1-2-6)
  const { data: projects } = modules.operations
    ? await supabase
        .from("projects")
        .select("id, name")
        .in("status", ["planned", "active"])
        .order("created_at", { ascending: false })
    : { data: null };

  return (
    <div>
      <PageHeader
        title="전문가"
        actions={
          <div className="flex items-center gap-2">
            <Button asChild variant="outline" size="sm">
              <a href={`/${params.tenantSlug}/experts/export`}>엑셀</a>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href={`/${params.tenantSlug}/experts/import`}>일괄 등록</Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href={`/${params.tenantSlug}/experts/cancellations`}>
                취소 내역
              </Link>
            </Button>
            <ExpertRecommendDialog />
            <EngagementDialog
              experts={activeExpertOptions}
              projects={projects}
            />
            <InviteExpertDialog />
          </div>
        }
      />
      <main className="space-y-5 p-5">
        {pendingInvitations.length > 0 && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">
                대기중 등록 요청 ({pendingInvitations.length})
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>이름</TableHead>
                      <TableHead>휴대폰</TableHead>
                      <TableHead>만료일</TableHead>
                      <TableHead className="w-20" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pendingInvitations.map((inv) => (
                      <TableRow key={inv.id}>
                        <TableCell>{inv.invited_name ?? "-"}</TableCell>
                        <TableCell>
                          {inv.invited_phone
                            ? formatKrMobile(inv.invited_phone)
                            : "-"}
                        </TableCell>
                        <TableCell>
                          {new Date(inv.expires_at).toLocaleDateString("ko-KR")}
                        </TableCell>
                        <TableCell>
                          <RevokeInvitationButton invitationId={inv.id} />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        )}

        {linkRows.length === 0 ? (
          <EmptyState
            title="아직 연결된 전문가가 없습니다"
            description="우측 상단 ‘전문가 등록 요청’으로 등록 링크를 만들어 전문가에게 전달하세요."
          />
        ) : (
          <Card>
            <CardContent className="pt-6">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>이름</TableHead>
                      <TableHead>휴대폰</TableHead>
                      <TableHead>전문분야</TableHead>
                      <TableHead>지역</TableHead>
                      <TableHead>경력</TableHead>
                      <TableHead>등급</TableHead>
                      <TableHead>상태</TableHead>
                      <TableHead className="w-20" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {linkRows.map((link) => {
                      const expert = link.experts;
                      if (!expert) return null;
                      const status = LINK_STATUS_LABEL[link.status] ?? {
                        label: "대기중",
                        variant: "secondary" as const,
                      };
                      return (
                        <TableRow key={link.id}>
                          <TableCell className="font-medium">
                            {expert.name}
                          </TableCell>
                          <TableCell>{formatKrMobile(expert.phone)}</TableCell>
                          <TableCell>{expert.specialty ?? "-"}</TableCell>
                          <TableCell>{expert.region ?? "-"}</TableCell>
                          <TableCell>
                            {expert.career_years != null
                              ? `${expert.career_years}년`
                              : "-"}
                          </TableCell>
                          <TableCell>
                            <ExpertTagCell
                              expertId={expert.id}
                              tag={tagByExpert.get(expert.id)?.tag ?? null}
                              note={tagByExpert.get(expert.id)?.note ?? null}
                              canManage={canManageTags}
                            />
                          </TableCell>
                          <TableCell>
                            <Badge variant={status.variant}>{status.label}</Badge>
                          </TableCell>
                          <TableCell>
                            <Link
                              href={`/${params.tenantSlug}/experts/${expert.id}/documents`}
                              className="text-sm font-medium text-brand underline-offset-4 hover:underline"
                            >
                              서류
                            </Link>
                          </TableCell>
                        </TableRow>
                      );
                    })}
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
