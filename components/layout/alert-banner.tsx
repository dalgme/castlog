import { createClient } from "@/lib/supabase/server";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { roleFromUser } from "@/lib/auth/tenant";

import { AlertDismissButton } from "./alert-dismiss-button";

/**
 * 단계 29: 전사 긴급 알림 배너 (대시보드 상단).
 * RLS가 테넌트 범위를 강제 — 자사 미확인(dismissed_at is null) 긴급 알림만 노출.
 */
export async function AlertBanner() {
  if (!hasSupabaseEnv()) return null;

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const role = roleFromUser(user);
  const canDismiss = role === "org_admin" || role === "manager";

  const { data: alerts } = await supabase
    .from("tenant_alerts")
    .select("id, title, body, created_at")
    .is("dismissed_at", null)
    .eq("severity", "urgent")
    .order("created_at", { ascending: false })
    .limit(5);

  if (!alerts || alerts.length === 0) return null;

  return (
    <div className="space-y-2 border-b border-destructive/30 bg-destructive/10 px-4 py-3">
      {alerts.map((alert) => (
        <div key={alert.id} className="flex items-start gap-3 text-sm">
          <span className="mt-0.5 shrink-0 rounded bg-destructive px-1.5 py-0.5 text-xs font-semibold text-white">
            긴급
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-medium text-destructive">{alert.title}</p>
            {alert.body && (
              <p className="break-words text-muted-foreground">{alert.body}</p>
            )}
          </div>
          {canDismiss && <AlertDismissButton alertId={alert.id} />}
        </div>
      ))}
    </div>
  );
}
