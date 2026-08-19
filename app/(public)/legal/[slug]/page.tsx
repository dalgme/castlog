import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle } from "lucide-react";

import { LogoMark, Wordmark } from "@/components/brand/logo";
import {
  LEGAL_DOCUMENTS,
  LEGAL_REVIEWED,
  type LegalDocument,
} from "@/lib/legal/documents";

export function generateStaticParams() {
  return [{ slug: "terms" }, { slug: "privacy" }];
}

export function generateMetadata({ params }: { params: { slug: string } }) {
  const doc = docOf(params.slug);
  return { title: doc ? doc.title : "약관" };
}

function docOf(slug: string): LegalDocument | null {
  return slug === "terms" || slug === "privacy" ? LEGAL_DOCUMENTS[slug] : null;
}

/**
 * 약관·개인정보처리방침 공개 페이지 (/legal/terms · /legal/privacy)
 *
 * 동의 체크박스가 가리킬 문서가 실제로 존재해야 동의가 성립한다.
 * 법무 검토 전에는 초안임을 화면에 분명히 표시한다 — 검토받지 않은 문서를
 * 확정본처럼 보이게 하면 그 자체가 이용자를 오인시킨다.
 */
export default function LegalPage({ params }: { params: { slug: string } }) {
  const doc = docOf(params.slug);
  if (!doc) notFound();

  return (
    <div className="min-h-screen bg-white">
      <header className="border-b">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-5 py-4">
          <Link href="/" className="flex items-center gap-2">
            <LogoMark width={20} height={25} />
            <Wordmark className="text-sm" />
          </Link>
          <nav className="flex items-center gap-3 text-sm text-muted-foreground">
            <Link href="/legal/terms" className="hover:text-brand">
              이용약관
            </Link>
            <Link href="/legal/privacy" className="hover:text-brand">
              개인정보처리방침
            </Link>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-5 py-8">
        <h1 className="text-2xl font-bold text-brand-navy">{doc.title}</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">{doc.summary}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          버전 {doc.version} · 시행일 {doc.effectiveOn}
        </p>

        {!LEGAL_REVIEWED && (
          <div className="mt-5 flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-4">
            <AlertTriangle
              className="mt-0.5 h-4 w-4 flex-none text-amber-700"
              aria-hidden
            />
            <p className="text-sm leading-relaxed text-amber-900">
              <b>법무 검토 전 초안입니다.</b> 서비스 정식 운영 전에 변호사 검토를
              거쳐 확정되며, 확정 시 버전과 시행일이 갱신됩니다. 현재 문서는 서비스가
              무엇을 어떻게 처리하는지 알리기 위한 것으로, 확정본과 다를 수 있습니다.
            </p>
          </div>
        )}

        <div className="mt-6 space-y-6">
          {doc.sections.map((section) => (
            <section key={section.heading}>
              <h2 className="text-base font-bold text-brand-navy">
                {section.heading}
              </h2>
              <div className="mt-2 space-y-1.5">
                {section.body.map((line, i) => (
                  <p key={i} className="text-sm leading-relaxed text-[#33405A]">
                    {line}
                  </p>
                ))}
              </div>
            </section>
          ))}
        </div>
      </main>
    </div>
  );
}
