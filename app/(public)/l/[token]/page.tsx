import { cookies } from "next/headers";

import { TenantBrand, PoweredByCastlog } from "@/components/brand/tenant-brand";
import { getPublicTenantBrand, type TenantBrand as TenantBrandData } from "@/lib/branding/tenant-logo";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { hashLinkToken } from "@/lib/auth/tokens";
import { clientCookieName, lookupClientLinkByToken, verifyClientSession } from "@/lib/integrations/client-review";
import { formatKstDateTimeFull } from "@/lib/integrations/engagement-roles";

import { ClientPasswordForm } from "./password-form";
import { ClientReviewForm } from "./review-form";

export const metadata = {
  title: "섭외 후보 리스트 검토",
  robots: { index: false, follow: false },
};

const EMPTY_BRAND: TenantBrandData = { name: null, logoSrc: null };

const CLOSED_MESSAGES: Record<string, string> = {
  not_found: "찾을 수 없는 링크입니다. 요청 기업 담당자에게 최근 링크를 다시 확인해 주세요.",
  replied: "회신이 완료된 링크입니다. 보내 주신 의견은 요청 기업에 전달되었습니다. 추가 의견은 담당자에게 연락해 주시면 새 링크를 보내 드립니다.",
  revoked: "요청 기업이 회수한 링크입니다. 새 링크를 받으셨다면 그 링크로 접속해 주세요.",
  expired: "링크의 유효기간이 지났습니다. 요청 기업 담당자에게 새 링크를 요청해 주세요.",
};

/**
 * 발주처 검토 공개 웹문서 (/l/{token}) — 기획 승인 2026-11-07 — 3단계.
 * 비밀번호를 맞추면 후보 리스트(공개 프로필만)가 열리고, 후보별 의견 + 요청사항을 '요청/회신 하기'로 보낸다.
 * 회신하면 링크는 자동 회수된다. 발주처가 만나는 상대는 그 회사다(§16 — 회사 로고·이름 중심).
 */
export default async function ClientReviewPage({ params }: { params: { token: string } }) {
  const shell = (body: React.ReactNode, brand: TenantBrandData = EMPTY_BRAND) => (
    <main className="flex min-h-screen flex-col items-center gap-6 bg-secondary/50 p-4 py-8">
      <TenantBrand name={brand.name} logoSrc={brand.logoSrc} />
      {body}
      <PoweredByCastlog />
    </main>
  );

  if (!hasSupabaseEnv()) {
    return shell(
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>섭외 후보 리스트 검토</CardTitle>
          <CardDescription>서버 설정이 완료되지 않아 처리를 진행할 수 없습니다.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const lookup = await lookupClientLinkByToken(hashLinkToken(params.token));
  if (!lookup.ok) {
    const brand = lookup.tenantId ? await getPublicTenantBrand(lookup.tenantId) : EMPTY_BRAND;
    return shell(
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>섭외 후보 리스트 검토</CardTitle>
          <CardDescription>{CLOSED_MESSAGES[lookup.reason]}</CardDescription>
        </CardHeader>
      </Card>,
      brand
    );
  }

  const { link, doc } = lookup;
  const brand = await getPublicTenantBrand(link.tenant_id);
  const authed = verifyClientSession(link.id, link.password_hash, cookies().get(clientCookieName(link.id))?.value);

  if (!authed) {
    return shell(
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>섭외 후보 리스트 검토</CardTitle>
          <CardDescription>
            <span className="font-medium text-foreground">{doc.tenantName ?? "요청 기업"}</span>이(가) {doc.clientName ? `${doc.clientName} ` : ""}
            검토를 요청한 「{doc.projectName}」 섭외 후보 리스트입니다. 담당자가 알려 드린 비밀번호를 입력하세요.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <ClientPasswordForm token={params.token} />
          <p className="text-[11px] text-muted-foreground">유효기간 {formatKstDateTimeFull(link.expires_at, { withTime: false })}까지 · 비밀번호를 여러 번 틀리면 잠깁니다.</p>
        </CardContent>
      </Card>,
      brand
    );
  }

  return shell(
    <Card className="w-full max-w-4xl">
      <CardHeader>
        <CardTitle>섭외 후보 리스트 검토 요청</CardTitle>
        <CardDescription>
          후보마다 <b>적합 / 교체 요청 / 보류</b> 중 하나를 고르고 필요한 의견을 적어 주세요. 마지막에 전체 요청사항을 쓰고
          <b> ‘요청/회신 하기’</b>를 누르면 {doc.tenantName ?? "요청 기업"}에 전달됩니다. 회신은 한 번만 가능하며, 회신 뒤 이 링크는 닫힙니다.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ClientReviewForm token={params.token} doc={doc} expiresAt={link.expires_at} />
      </CardContent>
    </Card>,
    brand
  );
}
