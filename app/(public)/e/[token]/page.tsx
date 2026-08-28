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
import {
  countExpertScheduleConflicts,
  lookupEngagementByToken,
} from "@/lib/integrations/engagements";
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
  // 재안내로 링크가 재발급되면 옛 링크는 여기로 온다 — "존재하지 않는다"로만
  // 말하면 오해를 만든다 (검수 C2)
  not_found:
    "찾을 수 없는 섭외 링크입니다. 새 링크가 재발송되었을 수 있으니 가장 최근에 받은 문자·메일의 링크를 확인해 주세요.",
  expired:
    "섭외 링크의 회신 기한이 지났습니다. 계속 참여를 원하시면 아래 기업 담당자에게 연락해 재발송을 요청해 주세요.",
  already_responded: "이미 응답한 섭외 요청입니다.",
  canceled: "기업에서 회수(취소)한 섭외 요청입니다.",
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
    const summary = lookup.summary;
    // 실패 화면에도 회사 브랜딩을 유지한다 (§16 — 검수 C5)
    const failBrand = summary
      ? await getPublicTenantBrand(summary.tenantId)
      : EMPTY_BRAND;
    const failSchedule = summary
      ? formatEventSchedule(
          summary.startsOn,
          summary.endsOn,
          summary.startsTime,
          summary.endsTime
        )
      : null;
    return shell(
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>섭외 동의</CardTitle>
          <CardDescription>
            {lookup.reason === "already_responded" && summary?.respondedAs
              ? summary.respondedAs === "accepted"
                ? "이미 수락한 섭외 요청입니다. 계약이 성립되어 있습니다."
                : "이미 거절한 섭외 요청입니다."
              : INVALID_MESSAGES[lookup.reason]}
          </CardDescription>
        </CardHeader>
        {summary && (
          <CardContent className="space-y-3 text-sm">
            {/* 링크가 유일한 접점인 전문가가 행사 정보를 다시 볼 수 있어야 한다 (검수 C2) */}
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
              {failSchedule && (
                <p>
                  <span className="text-muted-foreground">일정</span>{" "}
                  <span className="font-medium">{failSchedule}</span>
                </p>
              )}
              {summary.locationName && (
                <p>
                  <span className="text-muted-foreground">장소</span>{" "}
                  <span className="font-medium">{summary.locationName}</span>
                </p>
              )}
              {summary.respondedAs === "accepted" &&
                summary.feeAmount !== null && (
                  <p>
                    <span className="text-muted-foreground">의뢰비용</span>{" "}
                    <span className="font-medium">
                      {formatKrw(summary.feeAmount)}
                    </span>
                  </p>
                )}
            </div>
            <p className="text-xs leading-relaxed text-muted-foreground">
              자세한 내역과 수락서는{" "}
              <a href="/expert" className="text-brand underline underline-offset-4">
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

  const { engagement, tenantName, projectName, expertName } = lookup;
  // 전문가가 이 화면에서 만나는 상대는 캐스트로그가 아니라 그 회사다 (§16)
  const brand = await getPublicTenantBrand(engagement.tenant_id);
  const schedule = formatEventSchedule(
    engagement.starts_on,
    engagement.ends_on,
    engagement.starts_time,
    engagement.ends_time
  );
  // 본인의 확정 일정과 겹치는지 — 수락은 계약 성립인데, 이중 계약 위험을
  // 수락 전에 본인에게 알려 주는 화면이 없었다 (검수 C6). 어느 회사의 무슨
  // 일인지는 밝히지 않고 겹침 건수만 보여 준다 (테넌트 격리 원칙).
  const conflictCount = await countExpertScheduleConflicts(engagement);

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
          {/* 회신 마감 — 포털에는 있는데 정작 대부분이 쓰는 공개 링크에 없었다 (검수 C4) */}
          <p>
            <span className="text-muted-foreground">회신 마감</span>{" "}
            <span className="font-medium">
              {new Date(engagement.token_expires_at).toLocaleString("ko-KR", {
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
        {conflictCount > 0 && (
          <p className="rounded-md border border-amber-300 bg-amber-50 p-2.5 text-xs leading-relaxed text-amber-900">
            ⚠ 이 일정은 이미 <b>확정하신 다른 일정 {conflictCount}건</b>과
            겹칩니다. 일정을 확인한 뒤 응답해 주세요 — 수락하면 계약이
            성립합니다.
          </p>
        )}
        <EngagementRespondForm token={params.token} />
      </CardContent>
    </Card>,
    brand
  );
}
