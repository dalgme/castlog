import Link from "next/link";
import { AlertTriangle, Clock, FileCheck, MessageSquareWarning } from "lucide-react";

import { requireRole } from "@/lib/auth/session";
import { getTenantModules } from "@/lib/modules/server";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { PageHeader } from "@/components/layout/header";
import { EmptyState } from "@/components/layout/empty-state";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DUE_SOON_DAYS, getMyWork, type WorkItem } from "@/lib/integrations/my-work";

export const metadata = { title: "내 업무" };

/**
 * 내 업무 — 배정된 모든 프로젝트를 가로지르는 마감 경보.
 *
 * 프로젝트를 하나씩 열어봐야 급한 일을 알 수 있으면, 프로젝트를 여럿 맡은 PM은
 * 반드시 놓친다. 여기서는 지난 것과 임박한 것만 모아 보여준다.
 */
export default async function MyWorkPage({
  params,
}: {
  params: { tenantSlug: string };
}) {
  const user = await requireRole([
    "platform_admin",
    "org_admin",
    "manager",
    "staff",
  ]);

  if (!hasSupabaseEnv() || !user) {
    return (
      <div>
        <PageHeader title="내 업무" />
        <main className="p-5">
          <EmptyState
            title="서버 설정 대기 중"
            description="Supabase 환경변수가 설정되면 표시됩니다."
          />
        </main>
      </div>
    );
  }

  const modules = await getTenantModules();
  const work = await getMyWork(user.id, params.tenantSlug, modules);
  const nothing =
    work.overdue.length === 0 &&
    work.dueSoon.length === 0 &&
    work.awaitingReply.length === 0 &&
    work.needsReengagement.length === 0 &&
    work.myApprovals.length === 0;

  return (
    <div>
      <PageHeader title="내 업무" />
      <main className="space-y-5 p-5">
        <p className="text-sm text-muted-foreground">
          배정된 프로젝트 {work.myProjectCount}건에서 마감이 지났거나 {DUE_SOON_DAYS}
          일 안에 닥치는 일만 모았습니다.
        </p>

        {/* 내 결재 차례 — 배정과 무관하게 결재선 기준이라 배정 0건이어도 보인다 (검수 A3) */}
        <WorkGroup
          title="내 결재 차례"
          tone="warn"
          icon={FileCheck}
          items={work.myApprovals}
        />

        {work.myProjectCount === 0 && work.myApprovals.length === 0 ? (
          <EmptyState
            title="배정된 프로젝트가 없습니다"
            description="프로젝트에 PM·부PM·담당으로 배정되면 여기에 할 일이 모입니다. 배정은 대표·이사가 합니다."
          />
        ) : nothing ? (
          <EmptyState
            title="급한 일이 없습니다"
            description={`마감이 지난 항목도, ${DUE_SOON_DAYS}일 안에 닥치는 항목도 없습니다.`}
          />
        ) : (
          <>
            <WorkGroup
              title="마감이 지났습니다"
              tone="danger"
              icon={AlertTriangle}
              items={work.overdue}
            />
            <WorkGroup
              title={`${DUE_SOON_DAYS}일 안에 닥칩니다`}
              tone="warn"
              icon={Clock}
              items={work.dueSoon}
            />
            <WorkGroup
              title="재섭외 필요 (거절·만료)"
              tone="danger"
              icon={AlertTriangle}
              items={work.needsReengagement}
            />
            <WorkGroup
              title="회신을 기다리는 섭외"
              tone="neutral"
              icon={MessageSquareWarning}
              items={work.awaitingReply}
            />
          </>
        )}
      </main>
    </div>
  );
}

function WorkGroup({
  title,
  items,
  tone,
  icon: Icon,
}: {
  title: string;
  items: WorkItem[];
  tone: "danger" | "warn" | "neutral";
  icon: typeof Clock;
}) {
  if (items.length === 0) return null;
  const toneClass =
    tone === "danger"
      ? "text-destructive"
      : tone === "warn"
        ? "text-amber-700"
        : "text-muted-foreground";

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className={`flex items-center gap-1.5 text-sm ${toneClass}`}>
          <Icon className="h-4 w-4" aria-hidden />
          {title} ({items.length})
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="space-y-1.5">
          {items.map((item, i) => (
            <li key={`${item.kind}-${i}`} className="rounded-md border p-2.5">
              <div className="flex flex-wrap items-center gap-2">
                <Link
                  href={item.href}
                  className="text-sm font-medium text-brand underline-offset-4 hover:underline"
                >
                  {item.title}
                </Link>
                {item.projectName && (
                  <Badge variant="secondary">{item.projectName}</Badge>
                )}
                <span className="ml-auto text-xs tabular-nums text-muted-foreground">
                  {item.dueOn}
                  {" · "}
                  {/* 결재는 마감이 아니라 상신일 기준 — '지남'으로 표기하면
                      기한을 어긴 것처럼 읽힌다 (검수 리뷰 9) */}
                  {item.kind === "approval"
                    ? item.daysLeft >= 0
                      ? "오늘 상신"
                      : `상신 후 ${-item.daysLeft}일`
                    : item.daysLeft < 0
                      ? `${-item.daysLeft}일 지남`
                      : item.daysLeft === 0
                        ? "오늘"
                        : `${item.daysLeft}일 남음`}
                </span>
              </div>
              {item.note && (
                <p className="mt-1 text-xs text-muted-foreground">{item.note}</p>
              )}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
