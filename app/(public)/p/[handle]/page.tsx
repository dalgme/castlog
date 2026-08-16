import { notFound } from "next/navigation";
import { Briefcase, MapPin, Award, ExternalLink } from "lucide-react";

import { resolvePublicProfile } from "@/lib/experts/public-profile";
import { LogoMark, Wordmark } from "@/components/brand/logo";
import { Tag } from "@/components/expert/ui";

export const metadata = { title: "전문가 프로필" };

/**
 * 전문가 공개 프로필 (공개 — 로그인 불요). /p/{handle}
 * is_public + visible_fields만 노출. 민감정보(주민번호·연락처·서류)는 절대 미포함.
 */
export default async function PublicProfilePage({
  params,
}: {
  params: { handle: string };
}) {
  const profile = await resolvePublicProfile(params.handle);
  if (!profile) notFound();

  const chips: { icon: typeof Briefcase; text: string }[] = [];
  if (profile.specialty) chips.push({ icon: Briefcase, text: profile.specialty });
  if (profile.region) chips.push({ icon: MapPin, text: profile.region });
  if (profile.careerYears != null)
    chips.push({ icon: Award, text: `경력 ${profile.careerYears}년` });

  return (
    <div className="min-h-screen bg-secondary/40">
      <header className="flex h-14 items-center gap-2 border-b bg-background px-5">
        <LogoMark width={22} height={27} />
        <Wordmark className="text-base" />
      </header>

      <main className="mx-auto max-w-2xl space-y-4 p-4 sm:p-6">
        {/* 헤더 카드 */}
        <div className="rounded-2xl border bg-background p-6 shadow-sm">
          <h1 className="text-2xl font-bold text-brand-navy">{profile.name}</h1>
          {profile.headline && (
            <p className="mt-1 text-sm font-medium text-brand">{profile.headline}</p>
          )}
          {chips.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {chips.map((c, i) => {
                const Icon = c.icon;
                return (
                  <span
                    key={i}
                    className="inline-flex items-center gap-1.5 rounded-full bg-secondary px-3 py-1 text-xs font-medium text-brand-navy"
                  >
                    <Icon className="h-3.5 w-3.5" aria-hidden />
                    {c.text}
                  </span>
                );
              })}
            </div>
          )}
          {profile.bio && (
            <p className="mt-4 whitespace-pre-wrap text-sm leading-relaxed text-brand-navy/90">
              {profile.bio}
            </p>
          )}
          {profile.intro && (
            <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">
              {profile.intro}
            </p>
          )}
        </div>

        {/* 경력·실적 */}
        {profile.visibleFields.portfolio && profile.portfolio.length > 0 && (
          <div className="rounded-2xl border bg-background p-6 shadow-sm">
            <p className="mb-3 text-sm font-bold text-brand-navy">경력 · 실적</p>
            <ul className="space-y-4">
              {profile.portfolio.map((item) => (
                <li key={item.id} className="border-l-2 border-brand/30 pl-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-brand-navy">{item.title}</span>
                    {item.period && <Tag tone="gray">{item.period}</Tag>}
                  </div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {[item.role, item.orgName].filter(Boolean).join(" · ")}
                  </div>
                  {item.summary && (
                    <p className="mt-1 text-sm text-brand-navy/90">{item.summary}</p>
                  )}
                  {item.links.length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
                      {item.links.map((l, i) => (
                        <a
                          key={i}
                          href={l}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-xs text-brand hover:underline"
                        >
                          <ExternalLink className="h-3 w-3" /> 자료 {i + 1}
                        </a>
                      ))}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        <p className="pb-4 text-center text-xs text-muted-foreground">
          이 프로필은 CASTLOG로 만들어졌습니다.
        </p>
      </main>
    </div>
  );
}
