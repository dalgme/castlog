import Link from "next/link";

import { createAdminClient } from "@/lib/supabase/admin";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { LogoMark, Wordmark } from "@/components/brand/logo";
import {
  buildProductBrief,
  type ProductBrief,
} from "@/lib/marketing/product-brief";

import { PrintButton } from "./print-button";

export const metadata = { title: "제품 소개" };
export const dynamic = "force-dynamic";

/**
 * 제품 소개서 (/product-brief) — 공개.
 *
 * 예전에는 랜딩의 ‘제품 소개 다운로드’가 메일 보내기(mailto:)였다. 자료를
 * 보려던 사람이 메일 앱을 열고 요청을 쓰고 답장을 기다려야 했으니, 사실상
 * 자료가 없는 것과 같았다.
 *
 * 지금은 **제품 코드에서 생성한 소개서**를 바로 보여 준다. 화면에서 읽고,
 * 필요하면 브라우저 인쇄로 PDF를 만든다. PDF를 서버에서 굽지 않는 이유는
 * 단순하다 — 그러려면 렌더링 엔진을 하나 더 얹어야 하는데, 브라우저가 이미
 * 그 일을 더 잘한다.
 *
 * 매월 1일 02시(KST) 크론이 최신 판을 저장한다. 저장된 판이 있으면 그것을
 * 보여 주고(그 달 안에는 내용이 흔들리지 않는다), 없으면 지금 코드로 만든 판을
 * 보여 준다 — 어느 경우에도 '자료가 없다'가 되지 않는다.
 */
export default async function ProductBriefPage() {
  const fallback = buildProductBrief(new Date());
  let brief: ProductBrief = fallback;
  let published = false;

  if (hasSupabaseEnv()) {
    const admin = createAdminClient();
    const { data } = await admin
      .from("product_brief_editions")
      .select("edition, content")
      .order("edition", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (data?.content && typeof data.content === "object") {
      brief = data.content as unknown as ProductBrief;
      published = true;
    }
  }

  return (
    <div className="min-h-screen bg-muted print:bg-white">
      <header className="border-b bg-white print:hidden">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-5 py-4">
          <Link href="/" className="flex items-center gap-2">
            <LogoMark width={20} height={25} />
            <Wordmark className="text-sm" />
          </Link>
          <div className="flex items-center gap-2">
            <PrintButton />
            <Link
              href="/contact?type=trial&source=brief"
              className="rounded-md bg-brand px-3 py-1.5 text-sm font-semibold text-white"
            >
              무료 체험 시작
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-5 py-8 print:max-w-none print:px-0 print:py-0">
        <article className="rounded-2xl border bg-white p-7 print:rounded-none print:border-0 print:p-0">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b pb-4">
            <h1 className="text-2xl font-bold text-brand-navy">{brief.title}</h1>
            <span className="rounded bg-secondary px-2 py-0.5 text-xs text-muted-foreground">
              {brief.edition}판
            </span>
            {!published && (
              <span className="text-[11px] text-muted-foreground print:hidden">
                (최신 코드 기준 미리보기)
              </span>
            )}
          </div>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
            {brief.subtitle}
          </p>

          {brief.sections.map((section) => (
            <section key={section.heading} className="mt-8 break-inside-avoid">
              <h2 className="text-base font-bold text-brand-navy">
                {section.heading}
              </h2>
              {section.lead && (
                <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                  {section.lead}
                </p>
              )}
              <dl className="mt-3 space-y-3">
                {section.items.map((item) => (
                  <div
                    key={item.term}
                    className="rounded-lg border-l-2 border-brand/40 bg-secondary/30 py-2 pl-3 pr-2 print:bg-transparent"
                  >
                    <dt className="text-sm font-semibold text-brand-navy">
                      {item.term}
                    </dt>
                    <dd className="mt-0.5 text-sm leading-relaxed text-muted-foreground">
                      {item.desc}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}

          <footer className="mt-9 border-t pt-4">
            <ul className="space-y-1 text-xs leading-relaxed text-muted-foreground">
              {brief.notes.map((note) => (
                <li key={note}>· {note}</li>
              ))}
            </ul>
            <p className="mt-3 text-xs text-muted-foreground">
              캐스트로그 · castlog.kr · 문의 hello@castlog.kr
            </p>
          </footer>
        </article>
      </main>
    </div>
  );
}
