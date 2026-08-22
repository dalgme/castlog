import { requireRole } from "@/lib/auth/session";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { createAdminClient } from "@/lib/supabase/admin";
import { PageHeader } from "@/components/layout/header";
import { EmptyState } from "@/components/layout/empty-state";
import { Button } from "@/components/ui/button";

import {
  ExpertiseFieldsPanel,
  type ExpertiseFieldAdminRow,
} from "./fields-panel";

export const metadata = { title: "강의(멘토링) 분야 관리" };

/**
 * 강의(멘토링) 분야 전역 마스터 (기획 확정 2026-08-22).
 * 전문가 프로필의 중복 선택지 — 보유자료 일괄등록의 엑셀 값도 여기로
 * 자동 승격되므로, 운영자는 이 화면에서 오타·중복을 정리한다.
 */
export default async function ExpertiseFieldsPage() {
  await requireRole(["platform_admin"]);

  const headerActions = (
    <Button asChild variant="outline" size="sm">
      <a href="/platform-admin">← 캐스트로그 관리모드</a>
    </Button>
  );

  if (!hasSupabaseEnv()) {
    return (
      <div className="min-h-screen bg-secondary/50">
        <PageHeader title="강의(멘토링) 분야" actions={headerActions} />
        <main className="p-5">
          <EmptyState
            title="서버 설정 대기 중"
            description="Supabase 환경변수가 설정되면 표시됩니다."
          />
        </main>
      </div>
    );
  }

  const admin = createAdminClient();
  const [{ data: fields }, { data: selections }] = await Promise.all([
    admin
      .from("expertise_fields")
      .select("id, name, is_active")
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true }),
    admin.from("expert_expertise_fields").select("field_id"),
  ]);

  const countByField = new Map<string, number>();
  for (const row of selections ?? []) {
    countByField.set(row.field_id, (countByField.get(row.field_id) ?? 0) + 1);
  }
  const rows: ExpertiseFieldAdminRow[] = (fields ?? []).map((f) => ({
    id: f.id,
    name: f.name,
    isActive: f.is_active,
    expertCount: countByField.get(f.id) ?? 0,
  }));

  return (
    <div className="min-h-screen bg-secondary/50">
      <PageHeader title="강의(멘토링) 분야" actions={headerActions} />
      <main className="mx-auto max-w-3xl p-4 sm:p-6">
        {rows.length === 0 ? (
          <div className="space-y-4">
            <EmptyState
              title="등록된 분야가 없습니다"
              description="아래에서 분야를 추가하거나, 기업의 보유자료 일괄등록에서 자동 등록되기를 기다릴 수 있습니다."
            />
            <ExpertiseFieldsPanel fields={rows} />
          </div>
        ) : (
          <ExpertiseFieldsPanel fields={rows} />
        )}
      </main>
    </div>
  );
}
