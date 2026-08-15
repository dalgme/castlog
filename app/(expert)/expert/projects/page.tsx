import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { ENGAGEMENT_STATUS_LABELS } from "@/lib/integrations/engagements";
import { PortalHeader } from "@/components/expert/portal-header";
import { EmptyState } from "@/components/layout/empty-state";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export const metadata = { title: "프로젝트별 관리" };

const won = (value: number | null | undefined) =>
  `${(value ?? 0).toLocaleString("ko-KR")}원`;

const STATUS_VARIANT: Record<
  string,
  "default" | "secondary" | "destructive" | "outline"
> = {
  requested: "default",
  accepted: "secondary",
  declined: "destructive",
  canceled: "outline",
  expired: "outline",
};

type EngagementRow = {
  id: string;
  role_description: string;
  fee_amount: number | null;
  status: string;
  starts_on: string | null;
  ends_on: string | null;
  created_at: string;
  project_id: string | null;
  tenants: { name: string } | null;
  projects: { name: string } | null;
};

type ProjectGroup = {
  key: string;
  projectName: string;
  tenantName: string;
  engagements: EngagementRow[];
  totalFee: number;
  latestAt: number;
};

/**
 * 전문가 포털 — 프로젝트별 관리 (설계문서 3.2 전 기업 통합 이력).
 * 섭외 이력을 프로젝트 단위로 묶어 역할·기간·비용·상태를 한눈에 본다.
 * 테넌트 격리: 각 건은 소속 기업이 명시되며 교차 합산하지 않는다.
 */
export default async function ExpertProjectsPage() {
  const user = await requireUser("/expert/login");

  if (!hasSupabaseEnv() || !user) {
    return (
      <div className="min-h-screen bg-muted">
        <PortalHeader />
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
  const { data: expert } = await supabase
    .from("experts")
    .select("id")
    .eq("auth_user_id", user.id)
    .maybeSingle();

  if (!expert) {
    return (
      <div className="min-h-screen bg-muted">
        <PortalHeader />
        <main className="p-5">
          <EmptyState
            title="전문가 프로필이 없습니다"
            description="등록 링크로 등록을 완료하면 프로젝트 이력이 표시됩니다."
          />
        </main>
      </div>
    );
  }

  const { data: engagements } = await supabase
    .from("expert_engagements")
    .select(
      `id, role_description, fee_amount, status, starts_on, ends_on, created_at,
       project_id, tenants (name), projects (name)`
    )
    .eq("expert_id", expert.id)
    .order("created_at", { ascending: false });

  const rows = (engagements ?? []) as EngagementRow[];

  const groups = new Map<string, ProjectGroup>();
  for (const row of rows) {
    // 프로젝트 미지정(단독 섭외)은 건별로 분리해 서로 뒤섞지 않는다.
    const key = row.project_id ?? `solo-${row.id}`;
    const createdAt = new Date(row.created_at).getTime();
    const existing = groups.get(key);
    if (existing) {
      existing.engagements.push(row);
      existing.totalFee += row.fee_amount ?? 0;
      existing.latestAt = Math.max(existing.latestAt, createdAt);
    } else {
      groups.set(key, {
        key,
        projectName: row.projects?.name ?? "단독 섭외",
        tenantName: row.tenants?.name ?? "(기업)",
        engagements: [row],
        totalFee: row.fee_amount ?? 0,
        latestAt: createdAt,
      });
    }
  }

  const groupList = Array.from(groups.values()).sort(
    (a, b) => b.latestAt - a.latestAt
  );

  return (
    <div className="min-h-screen bg-muted">
      <PortalHeader />
      <main className="mx-auto max-w-4xl space-y-3 p-4 sm:p-5">
        {groupList.length === 0 ? (
          <EmptyState
            title="프로젝트 이력이 없습니다"
            description="섭외를 수락하면 프로젝트 단위로 여기에 정리됩니다."
          />
        ) : (
          groupList.map((group) => (
            <Card key={group.key}>
              <CardHeader className="pb-2">
                <div className="flex flex-wrap items-center gap-2">
                  <CardTitle className="text-sm">{group.projectName}</CardTitle>
                  <span className="text-xs text-muted-foreground">
                    {group.tenantName}
                  </span>
                  {group.totalFee > 0 && (
                    <span className="ml-auto text-xs text-muted-foreground">
                      의뢰비용 합계{" "}
                      <span className="font-semibold text-foreground">
                        {won(group.totalFee)}
                      </span>
                    </span>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                <ul className="divide-y">
                  {group.engagements.map((e) => (
                    <li
                      key={e.id}
                      className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm"
                    >
                      <span className="font-medium">{e.role_description}</span>
                      {(e.starts_on || e.ends_on) && (
                        <span className="text-xs text-muted-foreground">
                          {e.starts_on ?? "?"} ~ {e.ends_on ?? "?"}
                        </span>
                      )}
                      {e.fee_amount != null && (
                        <span className="text-xs text-muted-foreground">
                          {won(e.fee_amount)}
                        </span>
                      )}
                      <Badge
                        className="ml-auto"
                        variant={STATUS_VARIANT[e.status] ?? "secondary"}
                      >
                        {ENGAGEMENT_STATUS_LABELS[e.status] ?? e.status}
                      </Badge>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ))
        )}
      </main>
    </div>
  );
}
