import { Users } from "lucide-react";

import { requireRole } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { PageHeader } from "@/components/layout/header";
import { EmptyState } from "@/components/layout/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export const metadata = { title: "기업 이용자 — 캐스트로그 관리모드" };
export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, string> = {
  active: "활성",
  suspended: "중지",
  terminated: "해지",
};

/**
 * 기업별 이용자 관리 진입 (기획 지시 2026-09-11) — 회사를 고르면 그 회사의
 * 계정 목록으로 간다. 회사마다 계정이 몇 개인지, 그중 아직 못 들어온(임시
 * 비밀번호 상태) 계정이 몇 개인지를 여기서 먼저 보여 준다.
 */
export default async function PlatformUsersPage() {
  await requireRole(["platform_admin"]);

  const backButton = (
    <Button asChild variant="outline" size="sm">
      <a href="/platform-admin">← 캐스트로그 관리모드</a>
    </Button>
  );

  if (!hasSupabaseEnv()) {
    return (
      <main className="p-6">
        <PageHeader title="기업 이용자" actions={backButton} />
        <EmptyState title="서버 설정이 완료되지 않았습니다" />
      </main>
    );
  }

  // users는 테넌트 RLS라 관리모드 세션으로는 남의 회사 계정이 읽히지 않는다 —
  // service_role로 읽되 가져오는 것은 건수뿐이다.
  const admin = createAdminClient();
  const [{ data: tenants }, { data: users }] = await Promise.all([
    admin.from("tenants").select("id, name, slug, status").order("name"),
    admin.from("users").select("tenant_id, is_active"),
  ]);

  const counts = new Map<string, { total: number; active: number }>();
  for (const u of users ?? []) {
    const c = counts.get(u.tenant_id) ?? { total: 0, active: 0 };
    c.total += 1;
    if (u.is_active) c.active += 1;
    counts.set(u.tenant_id, c);
  }

  const rows = tenants ?? [];

  return (
    <div className="min-h-screen bg-secondary/50">
      <PageHeader title="기업 이용자" actions={backButton} />
      <main className="space-y-3 p-5">
        <p className="text-xs text-muted-foreground">
          회사를 고르면 계정(아이디·이름·직급·활성 여부)을 확인하고 비밀번호 지원을 할 수 있습니다.
          비밀번호는 운영자가 정해 주지 않습니다 — 재설정 메일 또는 1회용 임시 비밀번호로만 처리합니다.
        </p>
        {rows.length === 0 ? (
          <EmptyState title="테넌트가 없습니다" />
        ) : (
          <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            {rows.map((t) => {
              const c = counts.get(t.id) ?? { total: 0, active: 0 };
              return (
                <Card key={t.id} className={t.status !== "active" ? "border-destructive/40" : undefined}>
                  <CardContent className="flex items-center gap-3 py-3">
                    <Users className="h-4 w-4 shrink-0 text-brand" aria-hidden />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-brand-navy">
                        {t.name}
                        <span className="ml-1.5 font-mono text-[11px] font-normal text-muted-foreground">/{t.slug}</span>
                      </p>
                      <p className="text-xs text-muted-foreground">
                        계정 {c.total}명 · 활성 {c.active}명
                      </p>
                    </div>
                    {t.status !== "active" && (
                      <Badge variant="destructive">{STATUS_LABEL[t.status] ?? t.status}</Badge>
                    )}
                    <Button asChild size="sm" variant="outline">
                      <a href={`/platform-admin/users/${t.id}`}>이용자 보기</a>
                    </Button>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
