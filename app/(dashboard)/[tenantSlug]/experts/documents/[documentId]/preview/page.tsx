import Link from "next/link";
import { redirect } from "next/navigation";

import { requireRole } from "@/lib/auth/session";
import { requireModule } from "@/lib/modules/server";
import { createClient } from "@/lib/supabase/server";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { issueDocumentViewUrl } from "@/lib/experts/document-view";
import { DOCUMENT_TYPE_LABELS } from "@/lib/experts/documents";
import { DocumentPreview } from "@/components/documents/document-preview";
import { PageHeader } from "@/components/layout/header";
import { Button } from "@/components/ui/button";

export const metadata = { title: "서류 미리보기" };

/**
 * 기업 측 전문가 서류 웹 미리보기 — 권한은 RLS(활성 연결 + 열람 허용 grants)가
 * 판정하고, 열람은 전 건 감사 기록된다 (열람 라우트와 동일 게이트).
 */
export default async function TenantDocumentPreviewPage({
  params,
}: {
  params: { tenantSlug: string; documentId: string };
}) {
  await requireRole(["platform_admin", "org_admin", "manager"]);
  await requireModule("experts");
  if (!hasSupabaseEnv()) redirect(`/${params.tenantSlug}/experts`);

  const supabase = createClient();
  const { data: doc } = await supabase
    .from("expert_documents")
    .select("id, expert_id, document_type, file_name, status")
    .eq("id", params.documentId)
    .maybeSingle();
  if (!doc || doc.status === "destroyed") {
    redirect(`/${params.tenantSlug}/experts`);
  }

  const issued = await issueDocumentViewUrl(params.documentId);
  if (!issued.ok) redirect(`/${params.tenantSlug}/experts`);

  return (
    <div>
      <PageHeader
        title={`${DOCUMENT_TYPE_LABELS[doc.document_type] ?? doc.document_type} 미리보기`}
        actions={
          <div className="flex items-center gap-2">
            <Button asChild variant="outline" size="sm">
              <a
                href={`/${params.tenantSlug}/experts/documents/${doc.id}/view`}
                target="_blank"
                rel="noreferrer"
              >
                원본 열기
              </a>
            </Button>
            <Button asChild variant="ghost" size="sm">
              <Link href={`/${params.tenantSlug}/experts/${doc.expert_id}/documents`}>
                서류 목록으로
              </Link>
            </Button>
          </div>
        }
      />
      <main className="mx-auto max-w-4xl space-y-3 p-5">
        <p className="text-sm text-muted-foreground">
          {doc.file_name} — 모든 열람은 기록되며 전문가 본인에게 공개될 수
          있습니다.
        </p>
        <DocumentPreview url={issued.url} fileName={doc.file_name} />
      </main>
    </div>
  );
}
