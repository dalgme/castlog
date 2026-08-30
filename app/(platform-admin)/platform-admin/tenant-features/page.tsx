import { requireRole } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import {
  TENANT_EXTRA_FEATURES,
  TENANT_EXTRA_FEATURE_KEYS,
  parseExtraFeatures,
} from "@/lib/features/tenant-features";
import { PageHeader } from "@/components/layout/header";
import { EmptyState } from "@/components/layout/empty-state";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

import { FeatureToggle } from "./feature-toggle";

export const metadata = { title: "기업별 기능 추가 — 캐스트로그 관리모드" };
export const dynamic = "force-dynamic";

/**
 * 기업별 추가 기능 스위치 (기획 확정 2026-08-30 — 17번).
 * 예외 기능(정식 절차 우회 경로 등)을 회사 단위로 켜고 끈다 — 기본은 전부 꺼짐.
 */
export default async function TenantFeaturesPage() {
  await requireRole(["platform_admin"]);

  const backButton = (
    <Button asChild variant="outline" size="sm">
      <a href="/platform-admin">← 캐스트로그 관리모드</a>
    </Button>
  );

  if (!hasSupabaseEnv()) {
    return (
      <div className="min-h-screen bg-secondary/50">
        <PageHeader title="기업별 기능 추가" actions={backButton} />
        <main className="mx-auto max-w-4xl p-4 sm:p-6">
          <EmptyState title="서버 설정 대기 중" />
        </main>
      </div>
    );
  }

  const admin = createAdminClient();
  const { data: tenants } = await admin
    .from("tenants")
    .select("id, name, slug, status, feature_flags")
    .neq("status", "terminated")
    .order("name");

  const rows = (tenants ?? []).map((t) => ({
    id: t.id,
    name: t.name,
    slug: t.slug,
    features: parseExtraFeatures(t.feature_flags),
  }));

  return (
    <div className="min-h-screen bg-secondary/50">
      <PageHeader title="기업별 기능 추가" actions={backButton} />
      <main className="mx-auto max-w-4xl space-y-4 p-4 sm:p-6">
        <p className="text-sm text-muted-foreground">
          정식 절차를 우회하는 예외 기능들입니다. 기본은 전부 꺼짐 — 필요를
          확인한 회사에만 켜 주세요. 켜고 끈 기록은 감사로그에 남습니다.
        </p>

        {TENANT_EXTRA_FEATURE_KEYS.map((featureKey) => {
          const def = TENANT_EXTRA_FEATURES[featureKey];
          return (
            <Card key={featureKey}>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">{def.label}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="rounded-md bg-secondary/50 p-3 text-sm leading-relaxed text-muted-foreground">
                  {def.description}
                </p>
                <ul className="divide-y">
                  {rows.map((t) => (
                    <li
                      key={t.id}
                      className="flex flex-wrap items-center gap-2 py-2"
                    >
                      <span className="font-medium">{t.name}</span>
                      <span className="text-xs text-muted-foreground">
                        /{t.slug}
                      </span>
                      <span className="ml-auto">
                        <FeatureToggle
                          tenantId={t.id}
                          feature={featureKey}
                          enabled={t.features[featureKey]}
                        />
                      </span>
                    </li>
                  ))}
                  {rows.length === 0 && (
                    <li className="py-6 text-center text-sm text-muted-foreground">
                      표시할 테넌트가 없습니다.
                    </li>
                  )}
                </ul>
              </CardContent>
            </Card>
          );
        })}
      </main>
    </div>
  );
}
