import Link from "next/link";
import { notFound } from "next/navigation";
import { FileText, Phone, Mail, MapPin, Award } from "lucide-react";

import { requireRole } from "@/lib/auth/session";
import { requireModule } from "@/lib/modules/server";
import { createClient } from "@/lib/supabase/server";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { formatKrMobile } from "@/lib/auth/phone";
import { formatKrw } from "@/lib/approvals/constants";
import { ENGAGEMENT_STATUS_LABELS } from "@/lib/integrations/engagements";
import { expertTagLabel } from "@/lib/integrations/expert-tags";
import { PageHeader } from "@/components/layout/header";
import { EmptyState } from "@/components/layout/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const metadata = { title: "전문가 상세" };

const HISTORY_LIMIT = 50;

/**
 * 전문가 상세 — 자사 관점 한 장 요약.
 *
 * 목록에서 이름만 보고 섭외를 결정할 수는 없다. 이 화면은 "이 사람을 우리가
 * 몇 번 썼고, 얼마를 줬고, 평가가 어땠는가"를 한 번에 보여준다.
 *
 * 여기 보이는 섭외이력·의뢰비용·평가는 **전부 자사 것만**이다 (CLAUDE.md §4).
 * 다른 기업에서의 활동은 표시하지 않는다 — 그건 전문가 본인만 통합해서 본다.
 */
export default async function ExpertDetailPage({
  params,
}: {
  params: { tenantSlug: string; expertId: string };
}) {
  await requireRole(["platform_admin", "org_admin", "manager", "staff"]);
  await requireModule("experts");

  if (!hasSupabaseEnv()) {
    return (
      <div>
        <PageHeader title="전문가 상세" />
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

  // 연결이 없는 전문가는 RLS가 막는다 — 그 경우 notFound로 떨어진다.
  const { data: expert } = await supabase
    .from("experts")
    .select(
      "id, name, phone, email, specialty, region, career_years, bio, degree_certifications, expertise_other"
    )
    .eq("id", params.expertId)
    .maybeSingle();
  if (!expert) notFound();

  // 강의(멘토링) 분야 (전역 마스터 선택분) + 계좌 정보(마스킹).
  // 계좌는 본인 전용 RLS 테이블이라 admin으로 읽되, **끝 4자리만** 보여 준다 —
  // 전체 계좌번호는 지급 단계 경로에서만 (CLAUDE.md §5 통장 정책과 일관).
  const [{ data: expertiseRows }, bankMasked] = await Promise.all([
    supabase
      .from("expert_expertise_fields")
      .select("field_id, expertise_fields (name)")
      .eq("expert_id", expert.id),
    (async () => {
      try {
        const { createAdminClient } = await import("@/lib/supabase/admin");
        const { data } = await createAdminClient()
          .from("expert_bank_accounts")
          .select("bank_name, account_holder, account_last4")
          .eq("expert_id", expert.id)
          .maybeSingle();
        return data;
      } catch {
        return null;
      }
    })(),
  ]);
  const expertiseNames = (expertiseRows ?? [])
    .map((r) => r.expertise_fields?.name)
    .filter((n): n is string => Boolean(n));
  if (expert.expertise_other) expertiseNames.push(`기타: ${expert.expertise_other}`);

  const [
    { data: link },
    { data: tag },
    { data: engagements },
    { data: evaluations },
    { count: documentCount },
  ] = await Promise.all([
    supabase
      .from("expert_tenant_links")
      .select("status, created_at")
      .eq("expert_id", expert.id)
      .maybeSingle(),
    supabase
      .from("expert_tenant_tags")
      .select("tag, note")
      .eq("expert_id", expert.id)
      .maybeSingle(),
    supabase
      .from("expert_engagements")
      .select(
        "id, project_id, program_name, role_description, session_name, fee_amount, starts_on, status, created_at, responded_at, projects (name)"
      )
      .eq("expert_id", expert.id)
      .order("starts_on", { ascending: false, nullsFirst: false })
      .limit(HISTORY_LIMIT),
    supabase
      .from("expert_evaluations")
      .select("id, score, reason, created_at, projects (name)")
      .eq("expert_id", expert.id)
      .order("created_at", { ascending: false })
      .limit(20),
    supabase
      .from("expert_documents")
      .select("id", { count: "exact", head: true })
      .eq("expert_id", expert.id),
  ]);

  const rows = engagements ?? [];
  const evalRows = evaluations ?? [];

  // 자사 기준 요약 — 확정(accepted)만 실적으로 센다. 요청·취소는 실적이 아니다.
  const accepted = rows.filter((r) => r.status === "accepted");
  const totalFee = accepted.reduce((sum, r) => sum + (r.fee_amount ?? 0), 0);
  const pending = rows.filter((r) => r.status === "requested").length;
  const canceled = rows.filter(
    (r) => r.status === "canceled" || r.status === "declined"
  ).length;
  const avgScore =
    evalRows.length > 0
      ? evalRows.reduce((s, e) => s + e.score, 0) / evalRows.length
      : null;

  const today = new Date().toISOString().slice(0, 10);
  const upcoming = accepted.filter((r) => r.starts_on && r.starts_on >= today);

  return (
    <div>
      <PageHeader
        title={expert.name}
        actions={
          <div className="flex items-center gap-2">
            <Button asChild variant="outline" size="sm">
              <Link
                href={`/${params.tenantSlug}/experts/${expert.id}/documents`}
              >
                <FileText className="mr-1.5 h-4 w-4" aria-hidden />
                서류 {documentCount ?? 0}
              </Link>
            </Button>
            <Button asChild variant="ghost" size="sm">
              <Link href={`/${params.tenantSlug}/experts`}>전문가 목록</Link>
            </Button>
          </div>
        }
      />
      <main className="space-y-5 p-5">
        <Card>
          <CardContent className="pt-6">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-lg font-bold text-brand-navy">
                {expert.name}
              </span>
              {link && (
                <Badge
                  variant={link.status === "active" ? "default" : "secondary"}
                >
                  {link.status === "active"
                    ? "연결됨"
                    : link.status === "pending"
                      ? "대기중"
                      : "해제됨"}
                </Badge>
              )}
              {expertTagLabel(tag?.tag ?? null) && (
                <Badge
                  variant={tag?.tag === "caution" ? "destructive" : "secondary"}
                >
                  {expertTagLabel(tag?.tag ?? null)}
                </Badge>
              )}
            </div>
            {tag?.tag === "caution" && tag.note && (
              <p className="mt-2 rounded-md bg-destructive/5 p-2 text-sm text-destructive">
                주의: {tag.note}
              </p>
            )}
            <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-sm text-muted-foreground">
              {expert.phone && (
                <span className="inline-flex items-center gap-1.5">
                  <Phone className="h-3.5 w-3.5" aria-hidden />
                  {formatKrMobile(expert.phone)}
                </span>
              )}
              {expert.email && (
                <span className="inline-flex items-center gap-1.5">
                  <Mail className="h-3.5 w-3.5" aria-hidden />
                  {expert.email}
                </span>
              )}
              {expert.region && (
                <span className="inline-flex items-center gap-1.5">
                  <MapPin className="h-3.5 w-3.5" aria-hidden />
                  {expert.region}
                </span>
              )}
              {expert.specialty && (
                <span className="inline-flex items-center gap-1.5">
                  <Award className="h-3.5 w-3.5" aria-hidden />
                  {expert.specialty}
                  {expert.career_years ? ` · 경력 ${expert.career_years}년` : ""}
                </span>
              )}
            </div>
            {(expert.degree_certifications || expertiseNames.length > 0 || bankMasked) && (
              <div className="mt-3 space-y-1.5 text-sm">
                {expert.degree_certifications && (
                  <p>
                    <span className="mr-1.5 text-muted-foreground">
                      최종학위·자격증
                    </span>
                    {expert.degree_certifications}
                  </p>
                )}
                {expertiseNames.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1">
                    <span className="mr-0.5 text-muted-foreground">
                      강의(멘토링) 분야
                    </span>
                    {expertiseNames.map((n) => (
                      <Badge key={n} variant="secondary" className="text-[10px]">
                        {n}
                      </Badge>
                    ))}
                  </div>
                )}
                {bankMasked && (bankMasked.bank_name || bankMasked.account_last4) && (
                  <p className="text-muted-foreground">
                    지급 계좌 {bankMasked.bank_name ?? ""}{" "}
                    {bankMasked.account_last4
                      ? `····${bankMasked.account_last4}`
                      : "(계좌번호 미등록)"}
                    {bankMasked.account_holder
                      ? ` · 예금주 ${bankMasked.account_holder}`
                      : ""}
                    <span className="ml-1 text-[11px]">
                      — 전체 번호는 지급 단계에서만 표시됩니다
                    </span>
                  </p>
                )}
              </div>
            )}
            {expert.bio && (
              <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-[#33405A]">
                {expert.bio}
              </p>
            )}
          </CardContent>
        </Card>

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <Tile label="확정 섭외" value={`${accepted.length}건`} />
          <Tile label="예정 일정" value={`${upcoming.length}건`} />
          <Tile label="진행 중(미회신)" value={`${pending}건`} />
          <Tile label="취소·거절" value={`${canceled}건`} />
          <Tile
            label="평균 평가"
            value={avgScore === null ? "—" : avgScore.toFixed(1)}
          />
        </div>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">
              자사 의뢰비용 합계 (확정 기준)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold tabular-nums text-brand-navy">
              {formatKrw(totalFee)}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              우리 회사에서 확정된 섭외의 의뢰비용 합계입니다. 다른 기업에서의
              활동·비용은 표시되지 않습니다.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">
              섭외 이력 ({rows.length}건, 최근 {HISTORY_LIMIT}건)
            </CardTitle>
          </CardHeader>
          <CardContent>
            {rows.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                아직 이 전문가에게 보낸 섭외가 없습니다.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>일자</TableHead>
                      <TableHead>프로젝트</TableHead>
                      <TableHead>역할·세션</TableHead>
                      <TableHead className="text-right">의뢰비용</TableHead>
                      <TableHead>상태</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell className="whitespace-nowrap text-sm">
                          {r.starts_on ?? "—"}
                        </TableCell>
                        <TableCell className="text-sm">
                          {r.project_id ? (
                            <Link
                              href={`/${params.tenantSlug}/projects/${r.project_id}`}
                              className="text-brand underline-offset-4 hover:underline"
                            >
                              {r.projects?.name ?? "프로젝트"}
                            </Link>
                          ) : (
                            <span className="text-muted-foreground">
                              {r.program_name ?? "프로젝트 미연결"}
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {[r.role_description, r.session_name]
                            .filter(Boolean)
                            .join(" · ")}
                        </TableCell>
                        <TableCell className="text-right text-sm tabular-nums">
                          {r.fee_amount ? formatKrw(r.fee_amount) : "—"}
                        </TableCell>
                        <TableCell className="whitespace-nowrap">
                          <Badge
                            variant={
                              r.status === "accepted"
                                ? "default"
                                : r.status === "canceled" || r.status === "declined"
                                  ? "destructive"
                                  : "secondary"
                            }
                          >
                            {ENGAGEMENT_STATUS_LABELS[r.status] ?? r.status}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">평가 이력 ({evalRows.length})</CardTitle>
          </CardHeader>
          <CardContent>
            {evalRows.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                아직 평가가 없습니다. 프로젝트 종료 시 평가를 남기면 다음 섭외
                판단에 쓰입니다.
              </p>
            ) : (
              <ul className="space-y-2">
                {evalRows.map((e) => (
                  <li key={e.id} className="rounded-md border p-2.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="secondary">{e.score}점</Badge>
                      <span className="text-sm">{e.projects?.name ?? "—"}</span>
                      <span className="text-xs text-muted-foreground">
                        {e.created_at.slice(0, 10)}
                      </span>
                    </div>
                    {e.reason && (
                      <p className="mt-1 text-sm text-muted-foreground">
                        {e.reason}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-white p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-lg font-bold text-brand-navy">{value}</p>
    </div>
  );
}
