import Link from "next/link";
import { redirect } from "next/navigation";

import { requireRole } from "@/lib/auth/session";
import { roleFromUser } from "@/lib/auth/tenant";
import { requireModule } from "@/lib/modules/server";
import { createClient } from "@/lib/supabase/server";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { issueDocumentViewUrl } from "@/lib/experts/document-view";
import { DOCUMENT_TYPE_LABELS, SENSITIVE_DOCUMENT_TYPES } from "@/lib/experts/documents";
import { DocumentPreview } from "@/components/documents/document-preview";
import { PageHeader } from "@/components/layout/header";
import { EmptyState } from "@/components/layout/empty-state";
import { Button } from "@/components/ui/button";

export const metadata = { title: "서류 미리보기" };

/**
 * 기업 측 전문가 서류 웹 미리보기 — 권한은 RLS(활성 연결 + 열람 허용 grants, 이력서는 자사 임직원
 * 누구나 — §4 개정 2026-11-07)가 판정하고, 열람은 전 건 감사 기록된다 (열람 라우트와 동일 게이트).
 *
 * 역할 게이트는 서류 목록 화면과 같이 **전 직원(staff 포함)** — 목록에서는 보이는 링크가 눌러 보면
 * 대시보드로 튕기던 결함 수정 (렛츠 보고 2026-11-11). 민감서류(통장사본·신분증·통합)는 종전대로
 * 팀장(manager) 이상만 열고, 아닌 사람에게는 이유를 화면에 말한다 (§12-9).
 */
export default async function TenantDocumentPreviewPage({
  params,
}: {
  params: { tenantSlug: string; documentId: string };
}) {
  const user = await requireRole(["platform_admin", "org_admin", "manager", "staff"]);
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

  const backHref = `/${params.tenantSlug}/experts/${doc.expert_id}/documents`;
  const typeLabel = DOCUMENT_TYPE_LABELS[doc.document_type] ?? doc.document_type;
  if (SENSITIVE_DOCUMENT_TYPES.includes(doc.document_type) && roleFromUser(user) === "staff") {
    return (
      <div>
        <PageHeader title={`${typeLabel} 미리보기`} />
        <main className="p-5">
          <EmptyState
            title="민감서류는 팀장 이상만 열람할 수 있습니다 (권한 규칙)"
            description={`${typeLabel}은(는) 지급·세무 단계에서 팀장 이상이 열람하는 서류입니다. 필요하면 팀장·이사에게 열람을 요청하세요. 이력서·명함·자격증 사본은 지금 권한으로 볼 수 있습니다.`}
            action={
              <Button asChild size="sm" variant="outline">
                <Link href={backHref}>서류 목록으로</Link>
              </Button>
            }
          />
        </main>
      </div>
    );
  }

  const issued = await issueDocumentViewUrl(params.documentId);
  if (!issued.ok) redirect(`/${params.tenantSlug}/experts`);

  return (
    <div>
      <PageHeader
        title={`${typeLabel} 미리보기`}
        actions={
          <div className="flex items-center gap-2">
            <Button asChild variant="outline" size="sm">
              <a
                href={`/${params.tenantSlug}/experts/documents/${doc.id}/view?download=1`}
                target="_blank"
                rel="noreferrer"
              >
                원본 열기
              </a>
            </Button>
            <Button asChild variant="ghost" size="sm">
              <Link href={backHref}>서류 목록으로</Link>
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
