import { requireRole } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { formatKrMobile } from "@/lib/auth/phone";
import { PageHeader } from "@/components/layout/header";
import { EmptyState } from "@/components/layout/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

import { ExpertActiveToggle } from "./active-toggle";

export const metadata = { title: "전문가 상세 — 캐스트로그 관리모드" };
export const dynamic = "force-dynamic";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const RELATION_SOURCE_LABELS: Record<string, string> = {
  self_join: "본인 등록 (/j)",
  bulk_registered: "보유자료 등록",
  engaged: "섭외 배정 (자동 연결)",
};

const LINK_STATUS_LABELS: Record<string, string> = {
  active: "활성",
  pending: "대기",
  revoked: "해제",
};

function fmtDate(iso: string | null): string {
  if (!iso) return "-";
  return new Date(iso).toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul" });
}

/**
 * 전역 전문가 상세 (관리모드).
 *
 * 표시 범위 = 전 테넌트 공개 프로필 + 플랫폼 운영 정보(계정 연결·관계기업·
 * 서류 건수). 테넌트별 평가·메모·섭외이력은 격리 대상이라 싣지 않고(§4),
 * 주민번호·계좌·서류 내용은 플랫폼관리자도 접근 불가(§5 — 설계문서 4.4).
 */
export default async function PlatformExpertDetailPage({
  params,
}: {
  params: { expertId: string };
}) {
  await requireRole(["platform_admin"]);

  const backButton = (
    <Button asChild variant="outline" size="sm">
      <a href="/platform-admin/experts">← 전문가 DB</a>
    </Button>
  );

  if (!hasSupabaseEnv() || !UUID.test(params.expertId)) {
    return (
      <div className="min-h-screen bg-secondary/50">
        <PageHeader title="전문가 상세" actions={backButton} />
        <main className="mx-auto max-w-3xl p-4 sm:p-6">
          <EmptyState title="전문가를 확인할 수 없습니다" />
        </main>
      </div>
    );
  }

  const admin = createAdminClient();
  const [{ data: expert }, { data: links }, { count: documentCount }, { data: fieldRows }] =
    await Promise.all([
      admin
        .from("experts")
        .select(
          "id, name, phone, email, organization, job_title, specialty, region, career_years, bio, degree_level, degree_major, degree_certifications, expertise_other, auth_user_id, is_active, deactivated_at, deactivation_note, is_practice, created_at, updated_at"
        )
        .eq("id", params.expertId)
        .maybeSingle(),
      admin
        .from("expert_tenant_links")
        .select("id, status, relation_source, accepted_at, engaged_at, created_at, tenants (name, slug)")
        .eq("expert_id", params.expertId)
        .eq("is_practice", false)
        .order("created_at", { ascending: true }),
      admin
        .from("expert_documents")
        .select("id", { count: "exact", head: true })
        .eq("expert_id", params.expertId),
      admin
        .from("expert_expertise_fields")
        .select("expertise_fields (name)")
        .eq("expert_id", params.expertId),
    ]);

  if (!expert || expert.is_practice) {
    return (
      <div className="min-h-screen bg-secondary/50">
        <PageHeader title="전문가 상세" actions={backButton} />
        <main className="mx-auto max-w-3xl p-4 sm:p-6">
          <EmptyState title="전문가를 확인할 수 없습니다" />
        </main>
      </div>
    );
  }

  const fieldNames = (fieldRows ?? [])
    .map((r) => r.expertise_fields?.name)
    .filter((v): v is string => Boolean(v));
  if (expert.expertise_other) fieldNames.push(`기타: ${expert.expertise_other}`);

  const profileRows: [string, string][] = [
    ["휴대폰", formatKrMobile(expert.phone)],
    ["이메일", expert.email ?? "-"],
    ["소속 · 직위", [expert.organization, expert.job_title].filter(Boolean).join(" · ") || "-"],
    ["전문분야", expert.specialty ?? "-"],
    ["지역", expert.region ?? "-"],
    ["경력", expert.career_years !== null ? `${expert.career_years}년` : "-"],
    ["최종학위", [expert.degree_level, expert.degree_major].filter(Boolean).join(" · ") || "-"],
    ["학위·자격증", expert.degree_certifications ?? "-"],
    ["강의(멘토링) 분야", fieldNames.join(", ") || "-"],
    ["등록일", fmtDate(expert.created_at)],
  ];

  return (
    <div className="min-h-screen bg-secondary/50">
      <PageHeader
        title={`전문가 상세 — ${expert.name}`}
        actions={backButton}
      />
      <main className="mx-auto max-w-3xl space-y-4 p-4 sm:p-6">
        {!expert.is_active && (
          <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm">
            <p className="font-semibold text-red-800">
              이용 중지 상태 ({fmtDate(expert.deactivated_at)})
            </p>
            {expert.deactivation_note && (
              <p className="mt-1 text-red-700">사유: {expert.deactivation_note}</p>
            )}
          </div>
        )}

        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base">공개 프로필</CardTitle>
            <div className="flex items-center gap-2">
              {expert.auth_user_id ? (
                <span className="text-xs text-muted-foreground">계정 연결됨</span>
              ) : (
                <Badge variant="outline" className="text-xs">
                  계정 미연결 (본인 휴대폰 인증 시 이어받음)
                </Badge>
              )}
              <ExpertActiveToggle
                expertId={expert.id}
                expertName={expert.name}
                active={expert.is_active}
              />
            </div>
          </CardHeader>
          <CardContent>
            <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
              {profileRows.map(([label, value]) => (
                <div key={label} className="flex gap-2">
                  <dt className="w-28 flex-none text-muted-foreground">{label}</dt>
                  <dd className="min-w-0 break-words">{value}</dd>
                </div>
              ))}
            </dl>
            {expert.bio && (
              <p className="mt-3 whitespace-pre-wrap rounded-md bg-secondary/50 p-3 text-sm">
                {expert.bio}
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              관계기업 ({(links ?? []).length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            {(links ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">
                아직 연결된 기업이 없습니다.
              </p>
            ) : (
              <ul className="divide-y text-sm">
                {(links ?? []).map((link) => (
                  <li
                    key={link.id}
                    className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2"
                  >
                    <span className="font-medium">
                      {link.tenants?.name ?? "(삭제된 테넌트)"}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {RELATION_SOURCE_LABELS[link.relation_source] ??
                        link.relation_source}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {LINK_STATUS_LABELS[link.status] ?? link.status}
                    </span>
                    <span className="ml-auto text-xs text-muted-foreground">
                      연결 {fmtDate(link.accepted_at ?? link.created_at)}
                      {link.engaged_at && ` · 첫 섭외 수락 ${fmtDate(link.engaged_at)}`}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-3 text-xs text-muted-foreground">
              기업별 평가·메모·섭외 이력은 테넌트 격리 대상이라 여기 표시하지
              않습니다.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">서류</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm">
              등록 서류 <b className="tabular-nums">{documentCount ?? 0}</b>건
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              서류 내용은 전문가의 열람 허용(grants) 범위에서만 열립니다 —
              플랫폼관리자는 건수만 확인할 수 있습니다. 주민등록번호·계좌
              정보도 플랫폼관리자 조회 불가입니다 (설계문서 4.4).
            </p>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
