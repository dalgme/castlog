import Link from "next/link";

import {
  TenantBrand,
  PoweredByCastlog,
} from "@/components/brand/tenant-brand";
import {
  getPublicTenantBrand,
  type TenantBrand as TenantBrandData,
} from "@/lib/branding/tenant-logo";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { createAdminClient } from "@/lib/supabase/admin";
import { hashLinkToken } from "@/lib/auth/tokens";
import { DOCUMENT_TYPE_LABELS } from "@/lib/experts/documents";

export const metadata = {
  title: "서류 제출",
  robots: { index: false, follow: false },
};

/**
 * 서류 제출·갱신 공개 착지 페이지 (설계문서 5.2 /d)
 * 업로드 자체는 서류 소유자(전문가) 로그인 후 포털 서류함에서 진행한다.
 */
const EMPTY_BRAND: TenantBrandData = { name: null, logoSrc: null };

export default async function DocumentSubmitPage({
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
          <CardTitle>서류 제출</CardTitle>
          <CardDescription>
            서버 설정이 완료되지 않아 처리를 진행할 수 없습니다.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const admin = createAdminClient();
  const { data: request } = await admin
    .from("document_requests")
    .select(
      "id, tenant_id, requested_types, message, status, token_expires_at, tenants (name), experts (name)"
    )
    .eq("token_hash", hashLinkToken(params.token))
    .maybeSingle();

  if (!request || request.status === "canceled") {
    return shell(
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>서류 제출</CardTitle>
          <CardDescription>
            {request?.status === "canceled"
              ? "회수된 서류 요청입니다. 기업 담당자에게 문의하세요."
              : "유효하지 않은 제출 링크입니다. 링크를 다시 확인해 주세요."}
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const expired =
    request.status !== "completed" &&
    new Date(request.token_expires_at).getTime() < Date.now();
  const brand = await getPublicTenantBrand(request.tenant_id);

  return shell(
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle>서류 제출 요청</CardTitle>
        <CardDescription>
          <span className="font-medium text-foreground">
            {request.tenants?.name ?? "기업"}
          </span>
          에서 {request.experts?.name ?? "전문가"}님께 서류 제출을 요청했습니다.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1.5 rounded-md border p-3 text-sm">
          <p>
            <span className="text-muted-foreground">요청 서류</span>{" "}
            <span className="font-medium">
              {request.requested_types
                .map((type) => DOCUMENT_TYPE_LABELS[type] ?? type)
                .join(" · ")}
            </span>
          </p>
          {request.message && (
            <p className="whitespace-pre-wrap border-t pt-2 text-muted-foreground">
              {request.message}
            </p>
          )}
        </div>

        {request.status === "completed" ? (
          <p className="text-sm text-muted-foreground">
            이미 제출이 완료된 요청입니다. 감사합니다.
          </p>
        ) : expired ? (
          <p className="text-sm text-muted-foreground">
            제출 기한이 지났습니다. 기업 담당자에게 새 링크를 요청하세요.
          </p>
        ) : (
          <>
            <Button asChild className="w-full">
              <Link href="/expert/login?next=/expert/documents">
                로그인하고 서류 제출하기
              </Link>
            </Button>
            <p className="text-xs text-muted-foreground">
              휴대폰 인증으로 로그인하면 서류함에서 안전하게 업로드할 수
              있습니다. 서류의 소유자는 전문가 본인입니다.
            </p>
          </>
        )}
      </CardContent>
    </Card>,
    brand
  );
}
