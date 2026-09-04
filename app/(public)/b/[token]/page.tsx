import {
  TenantBrand,
  PoweredByCastlog,
} from "@/components/brand/tenant-brand";
import {
  getPublicTenantBrand,
  type TenantBrand as TenantBrandData,
} from "@/lib/branding/tenant-logo";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { formatKrw } from "@/lib/approvals/constants";
import { countExpertScheduleConflicts } from "@/lib/integrations/engagements";
import { lookupEngagementBundleByToken } from "@/lib/integrations/engagement-bundles";
import {
  formatEventSchedule,
  roleTypeLabel,
} from "@/lib/integrations/engagement-roles";

import { getExpertPortalGuide } from "@/lib/integrations/expert-portal-guide";

import { BundleRespondForm, type BundleFormItem } from "./respond-form";

export const metadata = {
  title: "섭외 동의",
  robots: { index: false, follow: false },
};

const INVALID_MESSAGES: Record<string, string> = {
  not_found:
    "찾을 수 없는 섭외 링크입니다. 새 링크가 재발송되었을 수 있으니 가장 최근에 받은 문자·메일의 링크를 확인해 주세요.",
  expired:
    "섭외 링크의 회신 기한이 지났습니다. 계속 참여를 원하시면 기업 담당자에게 연락해 재발송을 요청해 주세요.",
  already_responded: "이미 회신한 섭외 요청입니다.",
  canceled: "기업에서 회수(취소)한 섭외 요청입니다.",
};

const EMPTY_BRAND: TenantBrandData = { name: null, logoSrc: null };

/**
 * 묶음 섭외 동의 공개 페이지 (기획 확정 2026-08-30 — 20번, /b) —
 * 로그인 불필요, 모바일 완전 대응. 한 프로젝트의 여러 세션 건이 리스트업되고
 * 건별로 수락/거절을 골라 한 번에 회신한다.
 * 토큰 검증·응답 처리는 서버(service_role) 전용 (lib/integrations/engagement-bundles).
 */
export default async function EngagementBundlePage({
  params,
}: {
  params: { token: string };
}) {
  const shell = (
    body: React.ReactNode,
    brand: TenantBrandData = EMPTY_BRAND
  ) => (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-secondary/50 p-4">
      <TenantBrand name={brand.name} logoSrc={brand.logoSrc} />
      {body}
      <PoweredByCastlog />
    </main>
  );

  if (!hasSupabaseEnv()) {
    return shell(
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>섭외 동의</CardTitle>
          <CardDescription>
            서버 설정이 완료되지 않아 처리를 진행할 수 없습니다.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const lookup = await lookupEngagementBundleByToken(params.token);

  if (!lookup.ok) {
    const summary = lookup.summary;
    // 실패 화면에도 회사 브랜딩을 유지한다 (§16 — /e와 동일 원칙)
    const failBrand = summary
      ? await getPublicTenantBrand(summary.tenantId)
      : EMPTY_BRAND;
    return shell(
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>섭외 동의</CardTitle>
          <CardDescription>{INVALID_MESSAGES[lookup.reason]}</CardDescription>
        </CardHeader>
        {summary && (
          <CardContent className="space-y-3 text-sm">
            <div className="space-y-1.5 rounded-md border p-3">
              {summary.tenantName && (
                <p>
                  <span className="text-muted-foreground">요청 기업</span>{" "}
                  <span className="font-medium">{summary.tenantName}</span>
                </p>
              )}
              {summary.programName && (
                <p>
                  <span className="text-muted-foreground">사업명</span>{" "}
                  <span className="font-medium">{summary.programName}</span>
                </p>
              )}
              <p>
                <span className="text-muted-foreground">요청 건수</span>{" "}
                <span className="font-medium">{summary.itemCount}건</span>
              </p>
            </div>
            <p className="text-xs leading-relaxed text-muted-foreground">
              자세한 내역과 수락서는{" "}
              <a
                href="/login?tab=expert&next=%2Fexpert%2Fengagements"
                className="text-brand underline underline-offset-4"
              >
                전문가 포털
              </a>
              에서 휴대폰 인증으로 로그인해 확인할 수 있습니다.
            </p>
          </CardContent>
        )}
      </Card>,
      failBrand
    );
  }

  const { bundle, tenantName, projectName, expertName, items } = lookup;
  const brand = await getPublicTenantBrand(bundle.tenant_id);
  // 수락 후 포털 안내 — 등록 상태(미가입/기업 사전등록/가입)별 문구
  const portalGuide = await getExpertPortalGuide(bundle.expert_id);

  // 응답 대기 건만 폼에 올린다 — 이미 회수·처리된 건은 아래에 상태로만 보인다.
  const pendingItems = items.filter((i) => i.status === "requested");
  const closedItems = items.filter((i) => i.status !== "requested");

  // 같은 묶음 안에서 날짜가 겹치는 건 — 확정 일정 겹침 계산(아래)은 아직
  // requested인 형제 건을 못 본다. 한 번에 같이 수락하면 이중 일정이 되므로
  // 여기서 따로 표시한다 (리뷰 P3-8)
  const overlapsSibling = (item: (typeof pendingItems)[number]) => {
    if (!item.starts_on) return false;
    const from = item.starts_on;
    const to = item.ends_on ?? item.starts_on;
    return pendingItems.some((other) => {
      if (other.id === item.id || !other.starts_on) return false;
      const oFrom = other.starts_on;
      const oTo = other.ends_on ?? other.starts_on;
      return oFrom <= to && oTo >= from;
    });
  };

  const formItems: BundleFormItem[] = await Promise.all(
    pendingItems.map(async (item) => ({
      engagementId: item.id,
      sessionName: item.session_name,
      roleLabel:
        [roleTypeLabel(item.role_type), item.role_description]
          .filter(Boolean)
          .join(" · ") || null,
      schedule: formatEventSchedule(
        item.starts_on,
        item.ends_on,
        item.starts_time,
        item.ends_time
      ),
      locationName: item.location_name,
      feeLabel: item.fee_amount !== null ? formatKrw(item.fee_amount) : null,
      // 형제 건은 아직 requested라 확정 일정 집계에 들어가지 않는다 —
      // 겹침 수는 '이미 확정된 다른 일정' 기준 (lib/integrations/engagements)
      conflictCount: await countExpertScheduleConflicts(item),
      siblingOverlap: overlapsSibling(item),
    }))
  );

  // 행사 내용·특이사항·메시지 — 일괄 발송에서 전 건 동일하게 저장된다.
  // 단건(/e) 화면과 같은 정보량을 유지한다 (리뷰 P2-2: 계약 성립 전 필수 노출)
  const firstItem = pendingItems[0] ?? items[0] ?? null;
  const eventSummary = firstItem?.event_summary ?? null;
  const specialNotes = firstItem?.special_notes ?? null;
  const message = firstItem?.message ?? null;

  const programName = items[0]?.program_name ?? null;
  const totalFeeValues = pendingItems
    .map((i) => i.fee_amount)
    .filter((v): v is number => v !== null);
  const totalFee =
    totalFeeValues.length > 0
      ? totalFeeValues.reduce((a, b) => a + b, 0)
      : null;

  return shell(
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle>전문가 섭외 요청 {pendingItems.length}건</CardTitle>
        <CardDescription>
          <span className="font-medium text-foreground">{tenantName}</span>
          에서 {expertName} 전문가님께 드리는 섭외 요청입니다. 각 건을 확인하고
          건별로 수락 또는 거절을 선택한 뒤 한 번에 회신해 주세요.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1.5 rounded-md border p-3 text-sm">
          {programName && (
            <p>
              <span className="text-muted-foreground">사업명</span>{" "}
              <span className="font-medium">{programName}</span>
            </p>
          )}
          {!programName && projectName && (
            <p>
              <span className="text-muted-foreground">프로젝트</span>{" "}
              <span className="font-medium">{projectName}</span>
            </p>
          )}
          {totalFee !== null && (
            <p>
              <span className="text-muted-foreground">의뢰비용 합계</span>{" "}
              <span className="font-medium">{formatKrw(totalFee)}</span>
            </p>
          )}
          <p>
            <span className="text-muted-foreground">회신 마감</span>{" "}
            <span className="font-medium">
              {new Date(bundle.token_expires_at).toLocaleString("ko-KR", {
                timeZone: "Asia/Seoul",
                month: "long",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit",
                hour12: false,
              })}
              까지
            </span>
          </p>
          {eventSummary && (
            <p className="whitespace-pre-wrap border-t pt-2">
              <span className="text-muted-foreground">행사 내용</span>{" "}
              {eventSummary}
            </p>
          )}
          {specialNotes && (
            <p className="whitespace-pre-wrap text-muted-foreground">
              {specialNotes}
            </p>
          )}
          {message && (
            <p className="whitespace-pre-wrap border-t pt-2 text-muted-foreground">
              {message}
            </p>
          )}
        </div>

        {pendingItems.length > 0 ? (
          <BundleRespondForm
            token={params.token}
            items={formItems}
            guide={portalGuide}
            tenantName={tenantName}
          />
        ) : (
          <p className="rounded-md border p-3 text-sm text-muted-foreground">
            응답할 수 있는 섭외 건이 없습니다. 문의는 기업 담당자에게 연락해
            주세요.
          </p>
        )}

        {closedItems.length > 0 && (
          <div className="space-y-1 text-xs text-muted-foreground">
            {closedItems.map((item) => (
              <p key={item.id}>
                · {item.session_name || item.role_description} —{" "}
                {item.status === "canceled"
                  ? "기업에서 회수됨"
                  : item.status === "accepted"
                    ? "수락 완료"
                    : item.status === "declined"
                      ? "거절함"
                      : "만료됨"}
              </p>
            ))}
          </div>
        )}
      </CardContent>
    </Card>,
    brand
  );
}
