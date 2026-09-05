import Link from "next/link";
import { redirect } from "next/navigation";

import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { issueDocumentViewUrl } from "@/lib/experts/document-view";
import { DOCUMENT_TYPE_LABELS } from "@/lib/experts/documents";
import { DocumentPreview } from "@/components/documents/document-preview";
import { PortalHeader } from "@/components/expert/portal-header";
import { Button } from "@/components/ui/button";

export const metadata = { title: "서류 미리보기" };

/** 전문가 본인 서류 웹 미리보기 — 권한은 RLS(본인)로 판정, 열람은 감사 기록 */
export default async function ExpertDocumentPreviewPage({
  params,
}: {
  params: { documentId: string };
}) {
  await requireUser("/expert/login");
  if (!hasSupabaseEnv()) redirect("/expert/documents");

  const supabase = createClient();
  const { data: doc } = await supabase
    .from("expert_documents")
    .select("id, document_type, file_name, status")
    .eq("id", params.documentId)
    .maybeSingle();
  if (!doc || doc.status === "destroyed") redirect("/expert/documents");

  const issued = await issueDocumentViewUrl(params.documentId);
  if (!issued.ok) redirect("/expert/documents");

  return (
    <div className="min-h-screen bg-muted">
      <PortalHeader />
      <main className="mx-auto max-w-4xl space-y-4 p-4 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h1 className="text-lg font-bold">
              {DOCUMENT_TYPE_LABELS[doc.document_type] ?? doc.document_type} 미리보기
            </h1>
            <p className="text-sm text-muted-foreground">{doc.file_name}</p>
          </div>
          <div className="flex items-center gap-2">
            <Button asChild variant="outline" size="sm">
              <a
                href={`/expert/documents/${doc.id}/view?download=1`}
                target="_blank"
                rel="noreferrer"
              >
                원본 열기
              </a>
            </Button>
            <Button asChild variant="ghost" size="sm">
              <Link href="/expert/documents">서류함으로</Link>
            </Button>
          </div>
        </div>
        <DocumentPreview url={issued.url} fileName={doc.file_name} />
      </main>
    </div>
  );
}
