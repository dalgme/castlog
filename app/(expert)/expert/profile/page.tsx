import Link from "next/link";
import { redirect } from "next/navigation";
import { ShieldCheck } from "lucide-react";

import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { formatKrMobile } from "@/lib/auth/phone";
import { PortalHeader } from "@/components/expert/portal-header";
import { PageIntro } from "@/components/expert/ui";
import { EmptyState } from "@/components/layout/empty-state";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

import { ExpertProfileForm } from "./profile-form";
import { TaxTypeForm } from "./tax-type-form";
import { BankAccountForm } from "./bank-account-form";
import { SignaturePad } from "./signature-pad";

export const metadata = { title: "프로필 수정" };

/** 전문가 프로필 수정 — 본인만 (RLS experts_update_self). 휴대폰 번호는 인증 기반이므로 여기서 변경 불가. */
export default async function ExpertProfilePage() {
  const user = await requireUser("/expert/login");

  if (!hasSupabaseEnv() || !user) {
    return (
      <div className="min-h-screen bg-muted">
        <PortalHeader />
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
  const { data: expert } = await supabase
    .from("experts")
    .select(
      "id, name, phone, email, specialty, region, career_years, bio, secondary_phone"
    )
    .eq("auth_user_id", user.id)
    .maybeSingle();

  if (!expert) {
    redirect("/expert");
  }

  const { data: bankAccount } = await supabase
    .from("expert_bank_accounts")
    .select("bank_name, account_holder, account_last4")
    .eq("expert_id", expert.id)
    .maybeSingle();

  const { data: taxProfile } = await supabase
    .from("expert_tax_profiles")
    .select("payment_type, business_registration_number")
    .eq("expert_id", expert.id)
    .maybeSingle();

  // 서명·날인 등록 여부 (단계 28-A) — 활성 서류만
  const { data: signatureDocs } = await supabase
    .from("expert_documents")
    .select("document_type")
    .eq("expert_id", expert.id)
    .eq("status", "active")
    .in("document_type", ["signature", "seal"]);
  const registeredTypes = new Set(
    (signatureDocs ?? []).map((d) => d.document_type)
  );

  return (
    <div className="min-h-screen bg-muted">
      <PortalHeader />
      <main className="mx-auto max-w-4xl space-y-4 p-4 sm:p-6">
        <PageIntro
          eyebrow="PROFILE"
          title="내 프로필"
          description="전문분야·경력·소득유형과 섭외수락서에 쓰이는 서명·날인을 관리합니다."
        />
        <Card className="shadow-sm">
          <CardContent className="pt-6">
            <p className="mb-4 text-sm text-muted-foreground">
              휴대폰 번호({formatKrMobile(expert.phone)})는 인증 수단이므로 여기서
              변경할 수 없습니다.
            </p>
            <ExpertProfileForm
              defaultValues={{
                name: expert.name,
                email: expert.email ?? "",
                specialty: expert.specialty ?? "",
                region: expert.region ?? "",
                careerYears:
                  expert.career_years != null ? String(expert.career_years) : "",
                bio: expert.bio ?? "",
                secondaryPhone: expert.secondary_phone
                  ? formatKrMobile(expert.secondary_phone)
                  : "",
              }}
            />
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">소득유형 (지급·세무)</CardTitle>
          </CardHeader>
          <CardContent>
            <TaxTypeForm
              currentType={taxProfile?.payment_type ?? null}
              currentBizNumber={taxProfile?.business_registration_number ?? null}
            />
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">계좌 정보 (지급 계좌)</CardTitle>
          </CardHeader>
          <CardContent>
            <BankAccountForm
              defaultValues={{
                bankName: bankAccount?.bank_name ?? "",
                accountHolder: bankAccount?.account_holder ?? "",
              }}
              maskedLast4={bankAccount?.account_last4 ?? null}
            />
          </CardContent>
        </Card>

        <Card className="border-brand/40 bg-[#F2F6FF] shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm text-brand-navy">
              <ShieldCheck className="h-4 w-4 text-brand" aria-hidden />
              주민등록번호 (특별 보호 항목)
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm leading-relaxed text-[#33405A]">
            <p>
              주민등록번호는 <b>일반 프로필 항목처럼 상시 입력·보관하지 않습니다.</b>{" "}
              소득세법상 원천징수·지급명세서 제출을 위해, <b>섭외를 수락하여 계약이
              성립되는 시점</b>에 별도의 보안 절차(분리 저장·전용 복호화)로만 안전하게
              수집·처리됩니다.
            </p>
            <p className="text-xs text-muted-foreground">
              누가·언제·어떤 사유로 열람했는지는 전문가님께 모두 공개되며 즉시
              알림이 발송됩니다.
            </p>
            <Button asChild variant="outline" size="sm">
              <Link href="/expert/tax-access">주민등록번호 조회 이력 보기</Link>
            </Button>
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">서명·날인 등록</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <p className="text-sm text-muted-foreground">
              등록한 서명·날인은 섭외를 수락할 때 섭외수락서에 자동으로 사용됩니다.
              이미지는 암호화되어 안전하게 보관되며, 서명된 만료 링크로만 열람됩니다.
            </p>
            <SignaturePad
              kind="signature"
              label="서명"
              registered={registeredTypes.has("signature")}
            />
            <SignaturePad
              kind="seal"
              label="날인(도장)"
              registered={registeredTypes.has("seal")}
            />
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
