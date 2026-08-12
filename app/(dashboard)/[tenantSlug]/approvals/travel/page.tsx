import Link from "next/link";

import { requireRole } from "@/lib/auth/session";
import { requireModule } from "@/lib/modules/server";
import { createClient } from "@/lib/supabase/server";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { APPROVAL_STATUS_LABELS, formatKrw } from "@/lib/approvals/constants";
import {
  FUEL_TYPES,
  FUEL_TYPE_LABELS,
  DEFAULT_EFFICIENCY,
  travelIntegrationStatus,
} from "@/lib/integrations/travel";
import { PageHeader } from "@/components/layout/header";
import { EmptyState } from "@/components/layout/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

import { TravelForm } from "./travel-form";

export const metadata = { title: "출장품의" };

/** 단계 22: 출장품의 — 유류비 자동/수동 계산 후 지출 품의 상신 (approvals). */
export default async function TravelPage({
  params,
}: {
  params: { tenantSlug: string };
}) {
  await requireRole(["platform_admin", "org_admin", "manager", "staff"]);
  await requireModule("approvals");

  const headerActions = (
    <Button asChild variant="ghost" size="sm">
      <Link href={`/${params.tenantSlug}/approvals`}>결재함</Link>
    </Button>
  );

  if (!hasSupabaseEnv()) {
    return (
      <div>
        <PageHeader title="출장품의" actions={headerActions} />
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
  const { data: rows } = await supabase
    .from("travel_requests")
    .select(
      "id, purpose, travel_date, distance_km, round_trip, total_cost, auto_source, created_at, approvals (status)"
    )
    .order("created_at", { ascending: false })
    .limit(50);

  const requests = rows ?? [];
  const integration = travelIntegrationStatus();
  const fuelTypes = FUEL_TYPES.map((v) => ({
    value: v,
    label: FUEL_TYPE_LABELS[v] ?? v,
  }));

  return (
    <div>
      <PageHeader title="출장품의" actions={headerActions} />
      <main className="mx-auto max-w-2xl space-y-5 p-4 sm:p-5">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">새 출장품의</CardTitle>
          </CardHeader>
          <CardContent>
            <TravelForm
              fuelTypes={fuelTypes}
              defaultEfficiency={DEFAULT_EFFICIENCY}
              integration={integration}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">내 출장품의 ({requests.length})</CardTitle>
          </CardHeader>
          <CardContent>
            {requests.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                아직 상신한 출장품의가 없습니다.
              </p>
            ) : (
              <ul className="divide-y">
                {requests.map((r) => (
                  <li
                    key={r.id}
                    className="flex flex-wrap items-center gap-2 py-2.5 text-sm"
                  >
                    <span className="font-medium">{r.purpose}</span>
                    {r.travel_date && (
                      <span className="text-xs text-muted-foreground">
                        {r.travel_date}
                      </span>
                    )}
                    <span className="text-xs text-muted-foreground">
                      {r.distance_km}km{r.round_trip ? "(왕복)" : ""} ·{" "}
                      {r.auto_source ? "자동" : "수동"}
                    </span>
                    <span className="ml-auto font-medium">
                      {formatKrw(r.total_cost)}
                    </span>
                    <Badge
                      variant={
                        r.approvals?.status === "approved"
                          ? "default"
                          : r.approvals?.status === "rejected"
                            ? "destructive"
                            : "secondary"
                      }
                    >
                      {r.approvals
                        ? (APPROVAL_STATUS_LABELS[r.approvals.status] ??
                          r.approvals.status)
                        : "미연결"}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
