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
import { lookupEngagementByToken } from "@/lib/integrations/engagements";
import {
  formatEventSchedule,
  roleTypeLabel,
} from "@/lib/integrations/engagement-roles";

import { EngagementRespondForm } from "./respond-form";

export const metadata = {
  title: "섭외 동의",
  robots: { index: false, follow: false },
};

const INVALID_MESSAGES: Record<string, string> = {
  not_found: "존재하지 않는 섭외 링크입니다. 링크를 다시 확인해 주세요.",
  expired: "섭외 링크의 유효기간이 지났습니다. 기업 담당자에게 문의하세요.",
  already_responded: "이미 응답한 섭외 요청입니다.",
  canceled: "기업에서 회수한 섭외 요청입니다.",
};

/**
 * 섭외 동의 공개 페이지 (설계문서 5.2 /e) — 로그인 불필요, 모바일 완전 대응.
 * 토큰 검증·응답 처리는 서버(service_role) 전용 (lib/integrations/engagements).
 */
const EMPTY_BRAND: TenantBrandData = { name: null, logoSrc: null };

export default async function EngagementConsentPage({
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

  const lookup = await lookupEngagementByToken(params.token);

  if (!lookup.ok) {
    return shell(
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>섭외 동의</CardTitle>
          <CardDescription>{INVALID_MESSAGES[lookup.reason]}</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const { engagement, tenantName, projectName, expertName } = lookup;
  // 전문가가 이 화면에서 만나는 상대는 캐스트로그가 아니라 그 회사다 (§16)
  const brand = await getPublicTenantBrand(engagement.tenant_id);
  const schedule = formatEventSchedule(
    engagement.starts_on,
    engagement.ends_on,
    engagement.starts_time,
    engagement.ends_time
  );

  return shell(
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle>전문가 섭외 요청</CardTitle>
        <CardDescription>
          <span className="font-medium text-foreground">{tenantName}</span>
          에서 {expertName} 전문가님께 드리는 섭외 요청입니다.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1.5 rounded-md border p-3 text-sm">
          {engagement.program_name && (
            <p>
              <span className="text-muted-foreground">사업명</span>{" "}
              <span className="font-medium">{engagement.program_name}</span>
            </p>
          )}
          {!engagement.program_name && projectName && (
            <p>
              <span className="text-muted-foreground">프로젝트</span>{" "}
              <span className="font-medium">{projectName}</span>
            </p>
          )}
          <p>
            <span className="text-muted-foreground">요청 역할</span>{" "}
            <span className="font-medium">
              {[roleTypeLabel(engagement.role_type), engagement.role_description]
                .filter(Boolean)
                .join(" · ")}
            </span>
          </p>
          {schedule ? (
            <p>
              <span className="text-muted-foreground">일정</span>{" "}
              <span className="font-medium">{schedule}</span>
            </p>
          ) : (
            (engagement.starts_on || engagement.ends_on) && (
              <p>
                <span className="text-muted-foreground">일정</span>{" "}
                {engagement.starts_on ?? "?"} ~ {engagement.ends_on ?? "?"}
              </p>
            )
          )}
          {engagement.location_name && (
            <p>
              <span className="text-muted-foreground">장소</span>{" "}
              <span className="font-medium">{engagement.location_name}</span>
              {engagement.location_address && (
                <span className="text-muted-foreground">
                  {" "}
                  ({engagement.location_address})
                </span>
              )}
            </p>
          )}
          {engagement.fee_amount !== null && (
            <p>
              <span className="text-muted-foreground">의뢰비용</span>{" "}
              <span className="font-medium">{formatKrw(engagement.fee_amount)}</span>
            </p>
          )}
          {engagement.event_summary && (
            <p className="whitespace-pre-wrap border-t pt-2">
              <span className="text-muted-foreground">주제</span>{" "}
              {engagement.event_summary}
            </p>
          )}
          {engagement.special_notes && (
            <p className="whitespace-pre-wrap text-muted-foreground">
              {engagement.special_notes}
            </p>
          )}
          {engagement.message && (
            <p className="whitespace-pre-wrap border-t pt-2 text-muted-foreground">
              {engagement.message}
            </p>
          )}
        </div>
        <EngagementRespondForm token={params.token} />
      </CardContent>
    </Card>,
    brand
  );
}
