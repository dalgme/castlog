import Link from "next/link";
import { redirect } from "next/navigation";

import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { formatKrMobile } from "@/lib/auth/phone";
import { PageHeader } from "@/components/layout/header";
import { EmptyState } from "@/components/layout/empty-state";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

import { ExpertProfileForm } from "./profile-form";
import { TaxTypeForm } from "./tax-type-form";

export const metadata = { title: "프로필 수정" };

/** 전문가 프로필 수정 — 본인만 (RLS experts_update_self). 휴대폰 번호는 인증 기반이므로 여기서 변경 불가. */
export default async function ExpertProfilePage() {
  const user = await requireUser("/expert/login");

  const headerActions = (
    <Button asChild variant="ghost" size="sm">
      <Link href="/expert">돌아가기</Link>
    </Button>
  );

  if (!hasSupabaseEnv() || !user) {
    return (
      <div className="min-h-screen bg-secondary/50">
        <PageHeader title="프로필 수정" actions={headerActions} />
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
    .select("id, name, phone, email, specialty, region, career_years, bio")
    .eq("auth_user_id", user.id)
    .maybeSingle();

  if (!expert) {
    redirect("/expert");
  }

  const { data: taxProfile } = await supabase
    .from("expert_tax_profiles")
    .select("payment_type, business_registration_number")
    .eq("expert_id", expert.id)
    .maybeSingle();

  return (
    <div className="min-h-screen bg-secondary/50">
      <PageHeader title="프로필 수정" actions={headerActions} />
      <main className="mx-auto max-w-2xl p-4 sm:p-5">
        <Card>
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
              }}
            />
          </CardContent>
        </Card>

        <Card className="mt-4">
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
      </main>
    </div>
  );
}
