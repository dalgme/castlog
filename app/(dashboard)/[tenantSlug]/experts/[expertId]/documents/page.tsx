import Link from "next/link";
import { notFound } from "next/navigation";

import { requireRole } from "@/lib/auth/session";
import { tenantIdFromUser } from "@/lib/auth/tenant";
import { canExecTenant } from "@/lib/auth/exec-policy";
import { requireModule } from "@/lib/modules/server";
import { TenantResumeUpload } from "./resume-upload";
import { createClient } from "@/lib/supabase/server";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import {
  DOCUMENT_TYPE_LABELS,
  SENSITIVE_DOCUMENT_TYPES,
} from "@/lib/experts/documents";
import { PageHeader } from "@/components/layout/header";
import { EmptyState } from "@/components/layout/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DocumentRequestDialog } from "@/components/integrations/document-request-dialog";
import { DocumentRequestCancelButton } from "@/components/integrations/document-request-cancel-button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const metadata = { title: "전문가 서류" };

/**
 * 기업 측 전문가 서류 열람 (experts 모듈)
 * RLS(tenant_can_view_document)가 grants 허용 유형만 돌려준다 — 목록 자체가 권한 결과.
 * 열람 클릭 시 만료 서명 URL 발급 + 전 건 audit_logs 기록.
 */
export default async function TenantExpertDocumentsPage({
  params,
}: {
  params: { tenantSlug: string; expertId: string };
}) {
  const user = await requireRole(["platform_admin", "org_admin", "manager", "staff"]);
  await requireModule("experts");
  // 이력서 대리 등록 — 파일 일괄 등록과 같은 실행 권한(bulkImport, 회사 조정 반영). 서버 액션이 다시 검증한다
  const canUploadResume = await canExecTenant("bulkImport", user);

  if (!hasSupabaseEnv()) {
    return (
      <div>
        <PageHeader title="전문가 서류" />
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
    .select("id, name")
    .eq("id", params.expertId)
    .maybeSingle();

  if (!expert) notFound();

  const tenantId = tenantIdFromUser(user);
  const [{ data: documents }, { data: requests }] = await Promise.all([
    supabase
      .from("expert_documents")
      .select("id, document_type, file_name, created_at, uploaded_by_tenant_id")
      .eq("expert_id", expert.id)
      .eq("status", "active"),
    supabase
      .from("document_requests")
      .select("id, requested_types, message, status, created_at, token_expires_at")
      .eq("expert_id", expert.id)
      .order("created_at", { ascending: false })
      .limit(10),
  ]);

  const docs = documents ?? [];
  const requestRows = requests ?? [];
  // 이력서 대리 등록 패널의 상태 — 이력서는 자사 임직원 누구나 조회되므로(§4 개정) 있으면 여기 보인다
  const activeResume = docs.find((d) => d.document_type === "resume") ?? null;
  const resumeByUs = Boolean(activeResume && tenantId && activeResume.uploaded_by_tenant_id === tenantId);

  // 자격증 사본에는 전문가가 작성한 정보(자격증명·발급일·발급기관)가 붙는다.
  // 마이그레이션 미적용 DB에서는 조용히 빈 맵 — 화면이 죽으면 안 된다.
  const certInfoByDocId = new Map<
    string,
    { certName: string | null; issuedOn: string | null; issuer: string | null; note: string | null }
  >();
  if (docs.some((d) => d.document_type === "certificate")) {
    const { data: certs, error: certsError } = await supabase
      .from("expert_certificates")
      .select("document_id, cert_name, issued_on, issuer, note")
      .eq("expert_id", expert.id);
    if (!certsError) {
      for (const c of certs ?? []) {
        certInfoByDocId.set(c.document_id, {
          certName: c.cert_name,
          issuedOn: c.issued_on,
          issuer: c.issuer,
          note: c.note,
        });
      }
    }
  }

  // 요청 충족 여부: 요청 이후 업로드된 활성 서류가 유형별로 존재하는가
  const satisfiedTypes = (requestCreatedAt: string, types: string[]) =>
    types.filter((type) =>
      docs.some(
        (doc) => doc.document_type === type && doc.created_at >= requestCreatedAt
      )
    );

  return (
    <div>
      <PageHeader
        title={`전문가 서류 — ${expert.name}`}
        actions={
          <div className="flex items-center gap-2">
            <DocumentRequestDialog expertId={expert.id} />
            <Button asChild variant="ghost" size="sm">
              <Link href={`/${params.tenantSlug}/experts`}>목록으로</Link>
            </Button>
          </div>
        }
      />
      <main className="space-y-5 p-5">
        {/* 이력서 대리 등록 (렛츠 요청 2026-11-11) — 권한자에게만 패널, 아니면 한 줄 안내 */}
        {canUploadResume ? (
          <TenantResumeUpload
            expertId={expert.id}
            expertName={expert.name}
            hasResume={activeResume !== null}
            resumeByUs={resumeByUs}
          />
        ) : (
          <p className="text-xs text-muted-foreground">
            이력서 대리 등록은 ‘일괄 등록’ 실행 권한이 있는 직원이 이 화면에서 할 수 있습니다 (회사 권한 조정에 따름).
          </p>
        )}
        {requestRows.length > 0 && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">서류 요청 이력</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2">
                {requestRows.map((request) => {
                  const satisfied = satisfiedTypes(
                    request.created_at,
                    request.requested_types
                  );
                  const allSatisfied =
                    satisfied.length === request.requested_types.length;
                  return (
                    <li
                      key={request.id}
                      className="flex flex-wrap items-center gap-2 rounded-md border p-3 text-sm"
                    >
                      <span className="text-xs text-muted-foreground">
                        {new Date(request.created_at).toLocaleDateString("ko-KR")}
                      </span>
                      <span className="font-medium">
                        {request.requested_types
                          .map((t) => DOCUMENT_TYPE_LABELS[t] ?? t)
                          .join(" · ")}
                      </span>
                      <Badge
                        className="ml-auto"
                        variant={
                          request.status === "completed" || allSatisfied
                            ? "secondary"
                            : request.status === "pending"
                              ? "default"
                              : "outline"
                        }
                      >
                        {request.status === "canceled"
                          ? "회수"
                          : request.status === "completed" || allSatisfied
                            ? "제출 완료"
                            : `대기 (${satisfied.length}/${request.requested_types.length})`}
                      </Badge>
                      {request.status === "pending" && !allSatisfied && (
                        <DocumentRequestCancelButton requestId={request.id} />
                      )}
                    </li>
                  );
                })}
              </ul>
            </CardContent>
          </Card>
        )}
        {docs.length === 0 ? (
          <EmptyState
            title="열람 가능한 서류가 없습니다"
            description="전문가가 서류를 등록하고 우리 회사에 열람을 허용하면 여기에 표시됩니다. 이력서는 위 '이력서 대리 등록'으로 회사가 직접 넣을 수도 있습니다."
          />
        ) : (
          <Card>
            <CardContent className="pt-6">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>유형</TableHead>
                      <TableHead>파일명</TableHead>
                      <TableHead>등록일</TableHead>
                      <TableHead className="w-44" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {docs.map((doc) => (
                      <TableRow key={doc.id}>
                        <TableCell className="font-medium">
                          <span className="inline-flex items-center gap-1.5">
                            {DOCUMENT_TYPE_LABELS[doc.document_type] ??
                              doc.document_type}
                            {SENSITIVE_DOCUMENT_TYPES.includes(
                              doc.document_type
                            ) && (
                              <Badge variant="outline" className="text-[10px]">
                                민감
                              </Badge>
                            )}
                          </span>
                        </TableCell>
                        <TableCell className="max-w-48">
                          <span className="block truncate">{doc.file_name}</span>
                          {certInfoByDocId.has(doc.id) && (
                            <span className="block text-xs text-muted-foreground">
                              {[
                                certInfoByDocId.get(doc.id)?.certName,
                                certInfoByDocId.get(doc.id)?.issuedOn,
                                certInfoByDocId.get(doc.id)?.issuer,
                                certInfoByDocId.get(doc.id)?.note,
                              ]
                                .filter(Boolean)
                                .join(" · ")}
                            </span>
                          )}
                        </TableCell>
                        <TableCell>
                          {new Date(doc.created_at).toLocaleDateString("ko-KR")}
                        </TableCell>
                        <TableCell>
                          <span className="flex items-center gap-1">
                            <Button asChild variant="outline" size="sm">
                              <Link
                                href={`/${params.tenantSlug}/experts/documents/${doc.id}/preview`}
                              >
                                미리보기
                              </Link>
                            </Button>
                            <Button asChild variant="ghost" size="sm">
                              <a
                                href={`/${params.tenantSlug}/experts/documents/${doc.id}/view`}
                                target="_blank"
                                rel="noreferrer"
                              >
                                원본
                              </a>
                            </Button>
                          </span>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <p className="mt-3 text-xs text-muted-foreground">
                모든 열람은 기록되며 전문가 본인에게 공개될 수 있습니다.
              </p>
            </CardContent>
          </Card>
        )}
      </main>
    </div>
  );
}
