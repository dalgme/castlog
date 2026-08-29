import { requireRole } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { parseMonitorUntil } from "@/lib/monitoring/flags";
import { PageHeader } from "@/components/layout/header";
import { EmptyState } from "@/components/layout/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

import { MonitorToggle } from "./monitor-toggle";

export const metadata = { title: "실시간 모니터링 — 캐스트로그 관리모드" };
// 실시간 화면 — 빌드 시점 프리렌더(정적 스냅샷) 금지
export const dynamic = "force-dynamic";

/**
 * 기업별 실시간 사용자 테스트 모니터링 세팅 (기획 2026-08-29).
 *
 * 창을 켜면 그 기업의 ① 런타임 에러가 수집되기 시작하고 ② 활동 피드
 * (감사로그·섭외 이력·발송·챗봇 신고)를 실시간으로 볼 수 있으며 ③ 그 기업
 * 챗봇이 테스트 지원 모드로 바뀐다. 창은 시각이 지나면 저절로 닫힌다.
 */
export default async function MonitoringPage() {
  await requireRole(["platform_admin"]);

  const backButton = (
    <Button asChild variant="outline" size="sm">
      <a href="/platform-admin">← 캐스트로그 관리모드</a>
    </Button>
  );

  if (!hasSupabaseEnv()) {
    return (
      <main className="p-6">
        <PageHeader title="실시간 모니터링" actions={backButton} />
        <EmptyState title="서버 설정이 완료되지 않았습니다" />
      </main>
    );
  }

  const admin = createAdminClient();
  const { data: tenants } = await admin
    .from("tenants")
    .select("id, name, slug, status, feature_flags")
    .neq("status", "terminated")
    .order("name");

  const now = Date.now();
  const rows = (tenants ?? []).map((t) => {
    const until = parseMonitorUntil(t.feature_flags);
    return {
      id: t.id,
      name: t.name,
      slug: t.slug,
      status: t.status,
      until,
      active: until !== null && Date.parse(until) > now,
    };
  });

  return (
    <main className="space-y-6 p-6">
      <PageHeader title="실시간 모니터링" actions={backButton} />

      <p className="max-w-2xl text-sm text-muted-foreground">
        기업별로 모니터링 창을 열면 사용자 테스트 동안의 활동·에러가 수집되고,
        그 기업의 챗봇이 테스트 지원 모드로 바뀝니다. 창은 설정한 시간이 지나면
        저절로 닫히므로 끄는 것을 잊어도 상시 수집이 되지 않습니다.
      </p>

      <div className="overflow-x-auto rounded-xl border bg-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-xs text-muted-foreground">
              <th className="px-4 py-2.5 font-medium">기업</th>
              <th className="px-4 py-2.5 font-medium">상태</th>
              <th className="px-4 py-2.5 font-medium">모니터링</th>
              <th className="px-4 py-2.5 font-medium">조작</th>
              <th className="px-4 py-2.5 font-medium">피드</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-b last:border-b-0">
                <td className="px-4 py-2.5">
                  <span className="font-medium">{row.name}</span>{" "}
                  <span className="text-xs text-muted-foreground">
                    /{row.slug}
                  </span>
                </td>
                <td className="px-4 py-2.5">
                  {row.status === "active" ? (
                    <span className="text-muted-foreground">운영</span>
                  ) : (
                    <span className="text-muted-foreground">{row.status}</span>
                  )}
                </td>
                <td className="px-4 py-2.5">
                  {row.active && row.until ? (
                    <Badge className="bg-emerald-600 hover:bg-emerald-600">
                      켜짐 ·{" "}
                      {new Date(row.until).toLocaleTimeString("ko-KR", {
                        timeZone: "Asia/Seoul",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                      까지
                    </Badge>
                  ) : (
                    <span className="text-xs text-muted-foreground">꺼짐</span>
                  )}
                </td>
                <td className="px-4 py-2.5">
                  <MonitorToggle tenantId={row.id} active={row.active} />
                </td>
                <td className="px-4 py-2.5">
                  <Button asChild variant="outline" size="sm">
                    <a href={`/platform-admin/monitoring/${row.id}`}>
                      활동 피드
                    </a>
                  </Button>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td
                  colSpan={5}
                  className="px-4 py-8 text-center text-sm text-muted-foreground"
                >
                  표시할 테넌트가 없습니다.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </main>
  );
}
