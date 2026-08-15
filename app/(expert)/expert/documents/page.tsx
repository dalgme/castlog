import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import {
  DOCUMENT_TYPE_LABELS,
  SENSITIVE_DOCUMENT_TYPES,
  UPLOADABLE_DOCUMENT_TYPES,
} from "@/lib/experts/documents";
import { PortalHeader } from "@/components/expert/portal-header";
import { EmptyState } from "@/components/layout/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

import { DocumentUploadForm } from "./upload-form";
import { DocumentGrantsPanel } from "./grants-panel";

export const metadata = { title: "서류함" };

/**
 * 전문가 서류함 (설계문서 10.1) — 서류의 소유자는 전문가.
 * 업로드·교체와 기업별 열람 허용을 여기서 관리한다. 모바일 완전 대응.
 */
export default async function ExpertDocumentsPage() {
  const user = await requireUser("/expert/login");

  if (!hasSupabaseEnv() || !user) {
    return (
      <div className="min-h-screen bg-secondary/50">
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
      <div className="min-h-screen bg-secondary/50">
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
  const activeLinks = links ?? [];
  const now = Date.now();
  const pendingRequests = (docRequests ?? []).filter(
    (r) => new Date(r.token_expires_at).getTime() >= now
  );

  return (
    <div className="min-h-screen bg-secondary/50">
      <PortalHeader />
      <main className="mx-auto max-w-2xl space-y-4 p-4 sm:p-5">
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
            {UPLOADABLE_DOCUMENT_TYPES.map((type) => {
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
                      <Button asChild variant="link" size="sm" className="h-auto p-0">
                        <a
                          href={`/expert/documents/${doc.id}/view`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          보기
                        </a>
                      </Button>
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
            <p className="text-xs text-muted-foreground">
              PDF·JPG·PNG, 10MB 이하. 새 파일을 올리면 기존 파일은 교체 이력으로
              보존됩니다. 민감 서류 열람은 전 건 기록됩니다.
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
