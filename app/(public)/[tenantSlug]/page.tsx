import Link from "next/link";
import { redirect } from "next/navigation";
import { notFound } from "next/navigation";
import { ArrowRight, Building2, ShieldCheck, UserPlus } from "lucide-react";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { validateTenantSlug } from "@/lib/routing/slug";
import { TenantBrand, PoweredByCastlog } from "@/components/brand/tenant-brand";

export const metadata = { title: "기업 전용 주소" };

/**
 * 기업 전용 진입 주소 — castlog.kr/{tenant-slug}
 *
 * 회사마다 '우리 주소'가 필요하다. 임직원에게 공지하고, 전문가에게 알려 주고,
 * 브라우저 즐겨찾기에 넣는 자리다. 지금까지 이 주소는 로그인한 사람만 열 수
 * 있었고(그 아래가 전부 업무 화면이라), 로그아웃 상태로 열면 캐스트로그
 * 로그인 화면으로 튕겼다 — 회사 주소를 눌렀는데 다른 회사 이름이 나오는 셈이다.
 *
 * 그래서 슬러그 루트 한 칸만 공개 진입 화면으로 연다. 여기서 보이는 것은
 * **회사 이름과 로고, 그리고 들어가는 문 세 개**뿐이다 (CLAUDE.md §16 — 이 접점의
 * 주인은 캐스트로그가 아니라 그 회사다). 직원 수·프로젝트·구성원 같은 조직 정보는
 * 한 줄도 내보내지 않는다. 슬러그를 아는 사람이 회사를 들여다보는 통로가 되면
 * 안 되기 때문이다.
 *
 * 주소 체계 자체는 Phase 1 확정안 그대로다 — 경로 방식(castlog.kr/{slug}).
 * 서브도메인·기업 자체 도메인은 Phase 2 (판정 기록: docs/decisions/tenant-address.md).
 */
export default async function TenantHomePage({
  params,
}: {
  params: { tenantSlug: string };
}) {
  const slug = params.tenantSlug;
  if (!validateTenantSlug(slug).ok) notFound();
  if (!hasSupabaseEnv()) notFound();

  const admin = createAdminClient();
  const { data: tenant } = await admin
    .from("tenants")
    .select("id, name, status, logo_url, updated_at")
    .eq("slug", slug)
    .maybeSingle();

  // 없는 회사와 해지된 회사는 구분하지 않는다 — 슬러그를 찍어 보며 '이 회사가
  // 캐스트로그를 쓰는가'를 알아내는 통로를 만들지 않기 위해서다.
  if (!tenant || tenant.status === "terminated") notFound();

  // 이미 이 회사에 로그인해 있다면 문 앞에 세워 둘 이유가 없다
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user && user.app_metadata?.tenant_slug === slug) {
    redirect(`/${slug}/dashboard`);
  }

  const stamp = tenant.updated_at ? Date.parse(tenant.updated_at) : 0;
  const logoSrc = tenant.logo_url
    ? `/api/tenant-logo/${tenant.id}?v=${Number.isFinite(stamp) ? stamp : 0}`
    : null;
  const suspended = tenant.status !== "active";

  return (
    <div className="flex min-h-screen flex-col bg-muted">
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-5 py-10">
        <div className="rounded-2xl border bg-white p-7 shadow-sm">
          <TenantBrand name={tenant.name} logoSrc={logoSrc} />
          <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
            {suspended
              ? "현재 이 회사의 서비스 이용이 일시 중지되어 있습니다. 회사 관리자에게 문의하세요."
              : `${tenant.name} 업무 시스템입니다. 아래에서 해당하는 항목을 선택하세요.`}
          </p>

          {!suspended && (
            <div className="mt-6 space-y-2.5">
              <EntryLink
                href={`/login?tab=org&next=${encodeURIComponent(`/${slug}/dashboard`)}`}
                icon={<Building2 className="h-4 w-4" aria-hidden />}
                title="임직원 로그인"
                description="회사 이메일과 비밀번호로 들어갑니다"
                primary
              />
              <EntryLink
                href={`/join/${slug}`}
                icon={<UserPlus className="h-4 w-4" aria-hidden />}
                title="임직원 가입 신청"
                description="계정이 없다면 신청 후 관리자 승인을 받습니다"
              />
              <EntryLink
                href="/login?tab=expert"
                icon={<ShieldCheck className="h-4 w-4" aria-hidden />}
                title="전문가 로그인"
                description="휴대폰 번호로 인증합니다"
              />
            </div>
          )}
        </div>

        <div className="mt-6 space-y-3">
          <p className="text-center text-xs text-muted-foreground">
            <Link href="/legal/terms" className="underline-offset-2 hover:underline">
              이용약관
            </Link>
            <span className="mx-2">·</span>
            <Link href="/legal/privacy" className="underline-offset-2 hover:underline">
              개인정보처리방침
            </Link>
          </p>
          {/* 플랫폼 고지는 남긴다 — 브랜딩과 법적 고지는 다른 문제다 (§16) */}
          <PoweredByCastlog />
        </div>
      </main>
    </div>
  );
}

function EntryLink({
  href,
  icon,
  title,
  description,
  primary,
}: {
  href: string;
  icon: React.ReactNode;
  title: string;
  description: string;
  primary?: boolean;
}) {
  return (
    <Link
      href={href}
      className={
        primary
          ? "flex items-center gap-3 rounded-xl border border-brand bg-brand/5 p-3.5 transition-colors hover:bg-brand/10"
          : "flex items-center gap-3 rounded-xl border bg-white p-3.5 transition-colors hover:border-brand/50 hover:bg-secondary/40"
      }
    >
      <span
        className={
          primary
            ? "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand text-white"
            : "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-secondary text-brand-navy"
        }
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-brand-navy">{title}</span>
        <span className="block truncate text-xs text-muted-foreground">
          {description}
        </span>
      </span>
      <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
    </Link>
  );
}
