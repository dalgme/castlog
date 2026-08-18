import Link from "next/link";
import { notFound } from "next/navigation";

import { createAdminClient } from "@/lib/supabase/admin";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { validateTenantSlug } from "@/lib/routing/slug";
import { LogoMark, Wordmark } from "@/components/brand/logo";

import { JoinForm } from "./join-form";

export const metadata = { title: "임직원 가입 신청" };

/**
 * 임직원 셀프 가입 신청 (/join/{tenant-slug}) — 비로그인 공개 경로.
 *
 * 테넌트 경로(/{slug}/…) 안에 두지 않는다. 그 아래는 로그인한 사람의 업무 화면이고,
 * 이 화면은 아직 계정이 없는 사람이 여는 곳이다. 경로를 섞으면 인증 게이트를
 * 예외 처리해야 하고, 예외는 곧 구멍이 된다.
 *
 * 회사명만 노출하고 그 밖의 정보는 보여주지 않는다 — 슬러그를 아는 사람이
 * 조직 정보를 긁어 가는 통로가 되면 안 된다.
 */
export default async function JoinPage({
  params,
}: {
  params: { tenantSlug: string };
}) {
  if (!validateTenantSlug(params.tenantSlug).ok) notFound();

  let companyName: string | null = null;
  if (hasSupabaseEnv()) {
    const admin = createAdminClient();
    const { data } = await admin
      .from("tenants")
      .select("name, status")
      .eq("slug", params.tenantSlug)
      .maybeSingle();
    if (data && data.status === "active") companyName = data.name;
  }

  return (
    <div className="min-h-screen bg-muted">
      <header className="border-b bg-white">
        <div className="mx-auto flex max-w-lg items-center justify-between px-5 py-4">
          <Link href="/" className="flex items-center gap-2">
            <LogoMark width={20} height={25} />
            <Wordmark className="text-sm" />
          </Link>
          <Link href="/login" className="text-sm text-muted-foreground hover:text-brand">
            로그인
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-lg px-5 py-8">
        <h1 className="text-xl font-bold text-brand-navy">
          {companyName ? `${companyName} 임직원 가입 신청` : "임직원 가입 신청"}
        </h1>
        <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
          신청서를 제출하면 회사 관리자가 확인 후 계정을 만들어 드립니다. 신청만으로
          계정이 생성되지는 않습니다.
        </p>

        <div className="mt-6 rounded-lg border bg-white p-5">
          <JoinForm tenantSlug={params.tenantSlug} />
        </div>
      </main>
    </div>
  );
}
