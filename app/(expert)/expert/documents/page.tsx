import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import {
  DOCUMENT_TYPE_LABELS,
  SENSITIVE_DOCUMENT_TYPES,
  STANDARD_UPLOAD_DOCUMENT_TYPES,
} from "@/lib/experts/documents";
import { PortalHeader } from "@/components/expert/portal-header";
import { PageIntro } from "@/components/expert/ui";
import { MarkReadOnView } from "@/components/expert/mark-read-on-view";
import { EmptyState } from "@/components/layout/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

import { DocumentUploadForm } from "./upload-form";
import { DocumentGrantsPanel } from "./grants-panel";
import { CertificatesPanel, type CertificateRow } from "./certificates-panel";

export const metadata = { title: "서류함" };

/**
 * 전문가 서류함 (설계문서 10.1) — 서류의 소유자는 전문가.
 * 업로드·교체와 기업별 열람 허용을 여기서 관리한다. 모바일 완전 대응.
 */
export default async function ExpertDocumentsPage() {
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
    .select("id")
    .eq("auth_user_id", user.id)
    .maybeSingle();

  if (!expert) {
    return (
      <div className="min-h-screen bg-muted">
        <PortalHeader />
        <main className="p-5">
          <EmptyState
            title="전문가 프로필이 없습니다"
            description="등록 링크로 등록을 완료하면 서류함을 사용할 수 있습니다."
          />
        </main>
      </div>
    );
  }

  const [{ data: documents }, { data: links }, { data: docRequests }] =
    await Promise.all([
      supabase
        .from("expert_documents")
        .select("id, document_type, file_name, status, created_at")
        .eq("expert_id", expert.id)
        .eq("status", "active"),
      supabase
        .from("expert_tenant_links")
        .select(
          "id, status, tenants (name), expert_document_grants (document_type, revoked_at)"
        )
        .eq("expert_id", expert.id)
        .eq("status", "active"),
      supabase
        .from("document_requests")
        .select("id, requested_types, message, created_at, token_expires_at, tenants (name)")
        .eq("expert_id", expert.id)
        .eq("status", "pending")
        .order("created_at", { ascending: false }),
    ]);

  const activeDocs = new Map(
    (documents ?? []).map((d) => [d.document_type, d] as const)
  );

  // 자격증 사본 (다건) — 마이그레이션 미적용 DB에서는 조용히 빈 목록
  let certificateRows: CertificateRow[] = [];
  {
    const { data: certs, error: certsError } = await supabase
      .from("expert_certificates")
      .select(
        "id, cert_name, issued_on, issuer, note, document_id, expert_documents (file_name, created_at)"
      )
      .eq("expert_id", expert.id)
      .order("created_at", { ascending: true });
    if (!certsError) {
      certificateRows = (certs ?? []).map((c) => ({
        id: c.id,
        documentId: c.document_id,
        fileName: c.expert_documents?.file_name ?? "(파일)",
        createdAt: c.expert_documents?.created_at ?? "",
        certName: c.cert_name ?? "",
        issuedOn: c.issued_on ?? "",
        issuer: c.issuer ?? "",
        note: c.note ?? "",
      }));
    }
  }
  const activeLinks = links ?? [];
  const now = Date.now();
  const pendingRequests = (docRequests ?? []).filter(
    (r) => new Date(r.token_expires_at).getTime() >= now
  );

  return (
    <div className="min-h-screen bg-muted">
      <PortalHeader />
      <main className="mx-auto max-w-4xl space-y-4 p-4 sm:p-6">
        <MarkReadOnView categories={["document_request"]} />
        <PageIntro
          eyebrow="DOCUMENTS"
          title="서류함"
          description="서류의 소유자는 전문가 본인입니다. 업로드·교체와 기업별 열람 허용을 여기서 관리하세요."
        />
        {pendingRequests.map((request) => {
          const satisfied = request.requested_types.filter((type) => {
            const doc = activeDocs.get(type);
            return doc && doc.created_at >= request.created_at;
          });
          return (
            <Card key={request.id} className="border-brand/50">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">
                  {request.tenants?.name ?? "기업"}의 서류 제출 요청
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-1.5 text-sm">
                <p>
                  요청 서류:{" "}
                  {request.requested_types.map((type) => {
                    const done = satisfied.includes(type);
                    return (
                      <Badge
                        key={type}
                        variant={done ? "secondary" : "default"}
                        className="mr-1 text-[10px]"
                      >
                        {DOCUMENT_TYPE_LABELS[type] ?? type}
                        {done ? " ✓" : ""}
                      </Badge>
                    );
                  })}
                </p>
                {request.message && (
                  <p className="text-xs text-muted-foreground">{request.message}</p>
                )}
                <p className="text-xs text-muted-foreground">
                  아래에서 해당 서류를 업로드하면 제출로 처리됩니다.
                </p>
              </CardContent>
            </Card>
          );
        })}

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">내 서류</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {STANDARD_UPLOAD_DOCUMENT_TYPES.map((type) => {
              const doc = activeDocs.get(type);
              const sensitive = SENSITIVE_DOCUMENT_TYPES.includes(type);
              return (
                <div key={type} className="rounded-md border p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold">
                        {DOCUMENT_TYPE_LABELS[type]}
                      </span>
                      {sensitive && (
                        <Badge variant="outline" className="text-[10px]">
                          민감 서류
                        </Badge>
                      )}
                    </div>
                    {doc ? (
                      <span className="flex items-center gap-2">
                        <Button asChild variant="link" size="sm" className="h-auto p-0">
                          <a href={`/expert/documents/${doc.id}/preview`}>
                            미리보기
                          </a>
                        </Button>
                        <Button asChild variant="link" size="sm" className="h-auto p-0">
                          <a
                            href={`/expert/documents/${doc.id}/view`}
                            target="_blank"
                            rel="noreferrer"
                          >
                            원본
                          </a>
                        </Button>
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">미등록</span>
                    )}
                  </div>
                  {doc && (
                    <p className="mb-2 truncate text-xs text-muted-foreground">
                      {doc.file_name} ·{" "}
                      {new Date(doc.created_at).toLocaleDateString("ko-KR")} 등록
                    </p>
                  )}
                  <DocumentUploadForm documentType={type} hasExisting={Boolean(doc)} />
                </div>
              );
            })}
            {/* 통합서류(혼합) — 기업이 일괄 등록한 파일. 있을 때만 노출 */}
            {activeDocs.get("combined") && (
              <div className="rounded-md border p-3">
                <div className="mb-2 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold">
                      {DOCUMENT_TYPE_LABELS.combined}
                    </span>
                    <Badge variant="outline" className="text-[10px]">
                      민감 서류
                    </Badge>
                  </div>
                  <span className="flex items-center gap-2">
                    <Button asChild variant="link" size="sm" className="h-auto p-0">
                      <a
                        href={`/expert/documents/${activeDocs.get("combined")!.id}/preview`}
                      >
                        미리보기
                      </a>
                    </Button>
                    <Button asChild variant="link" size="sm" className="h-auto p-0">
                      <a
                        href={`/expert/documents/${activeDocs.get("combined")!.id}/view`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        원본
                      </a>
                    </Button>
                  </span>
                </div>
                <p className="mb-2 truncate text-xs text-muted-foreground">
                  {activeDocs.get("combined")!.file_name} ·{" "}
                  {new Date(
                    activeDocs.get("combined")!.created_at
                  ).toLocaleDateString("ko-KR")}{" "}
                  등록 — 이력서·신분증·통장이 한 파일에 담긴 서류입니다. 각
                  항목을 따로 올리면 개별 서류로 관리됩니다.
                </p>
                <DocumentUploadForm documentType="combined" hasExisting />
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              PDF·이미지(JPG/PNG)·오피스(doc/docx/xls/xlsx/ppt/pptx)·한글(hwp/hwpx),
              10MB 이하. ‘수정 등록’으로 새 파일을 올리면 기존 파일은 교체 이력으로
              보존됩니다. 민감 서류 열람은 전 건 기록됩니다.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">자격증 사본</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <CertificatesPanel rows={certificateRows} />
            <p className="text-xs text-muted-foreground">
              자격증은 여러 건 등록할 수 있습니다. 각 사본에 자격증명·급수,
              발급일, 발급기관을 작성해 두면 기업이 확인하기 쉽습니다. 기업
              열람은 아래 ‘기업별 열람 허용’에서 자격증 사본을 허용한 경우에만
              가능합니다.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">기업별 열람 허용</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {activeLinks.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                연결된 기업이 없습니다. 열람 허용은 연결된 기업 단위로 설정합니다.
              </p>
            ) : (
              activeLinks.map((link) => {
                const grantedTypes = (link.expert_document_grants ?? [])
                  .filter((g) => g.revoked_at === null)
                  .map((g) => g.document_type);
                return (
                  <div key={link.id}>
                    <p className="mb-2 text-sm font-semibold">
                      {link.tenants?.name ?? "(기업)"}
                    </p>
                    <DocumentGrantsPanel linkId={link.id} grantedTypes={grantedTypes} />
                  </div>
                );
              })
            )}
            <p className="text-xs text-muted-foreground">
              체크한 유형만 해당 기업이 열람할 수 있으며, 언제든 회수할 수
              있습니다. 회수 즉시 열람이 차단됩니다.
            </p>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
