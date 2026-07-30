import Link from "next/link";
import { notFound } from "next/navigation";

import { requireRole } from "@/lib/auth/session";
import { requireModule } from "@/lib/modules/server";
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
import { Card, CardContent } from "@/components/ui/card";
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
  await requireRole(["platform_admin", "org_admin", "manager", "staff"]);
  await requireModule("experts");

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

  const { data: documents } = await supabase
    .from("expert_documents")
    .select("id, document_type, file_name, created_at")
    .eq("expert_id", expert.id)
    .eq("status", "active");

  const docs = documents ?? [];

  return (
    <div>
      <PageHeader
        title={`전문가 서류 — ${expert.name}`}
        actions={
          <Button asChild variant="ghost" size="sm">
            <Link href={`/${params.tenantSlug}/experts`}>목록으로</Link>
          </Button>
        }
      />
      <main className="p-5">
        {docs.length === 0 ? (
          <EmptyState
            title="열람 가능한 서류가 없습니다"
            description="전문가가 서류를 등록하고 우리 회사에 열람을 허용하면 여기에 표시됩니다."
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
                      <TableHead className="w-20" />
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
                        <TableCell className="max-w-48 truncate">
                          {doc.file_name}
                        </TableCell>
                        <TableCell>
                          {new Date(doc.created_at).toLocaleDateString("ko-KR")}
                        </TableCell>
                        <TableCell>
                          <Button asChild variant="outline" size="sm">
                            <a
                              href={`/${params.tenantSlug}/experts/documents/${doc.id}/view`}
                              target="_blank"
                              rel="noreferrer"
                            >
                              열람
                            </a>
                          </Button>
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
