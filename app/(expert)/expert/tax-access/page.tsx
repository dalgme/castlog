import Link from "next/link";
import { ShieldCheck, Info } from "lucide-react";

import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { PortalHeader } from "@/components/expert/portal-header";
import { PageIntro, Tag, type TagTone } from "@/components/expert/ui";
import { MarkReadOnView } from "@/components/expert/mark-read-on-view";
import { EmptyState } from "@/components/layout/empty-state";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export const metadata = { title: "주민등록번호 조회 이력" };

const REASON_LABEL: Record<string, { label: string; tone: TagTone }> = {
  payment_approval: { label: "지급품의", tone: "blue" },
  tax_filing: { label: "세무자료 제출", tone: "amber" },
  other: { label: "기타", tone: "gray" },
};

const ACCESS_TYPE_LABEL: Record<string, string> = {
  file_generation: "지급명세서 파일 생성",
  screen: "화면 단건 조회",
};

/**
 * 전문가 포털 — 주민등록번호 조회 이력 (설계문서 5장 이력 공개 의무).
 * 어느 기관·프로젝트에서, 언제, 어떤 사유로, 누가 조회했는지 전문가 본인에게 공개.
 * 기록은 Phase 2 분리 복호화 서비스만 남긴다(메인 앱은 조회·기록 능력 없음).
 */
export default async function ExpertTaxAccessPage() {
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
            description="등록 링크로 등록을 완료하면 조회 이력을 확인할 수 있습니다."
          />
        </main>
      </div>
    );
  }

  const { data: logs } = await supabase
    .from("tax_access_logs")
    .select(
      "id, tenant_name, project_name, reason, access_type, accessor_label, accessed_at, is_over_limit, over_limit_reason"
    )
    .eq("expert_id", expert.id)
    .order("accessed_at", { ascending: false })
    .limit(200);

  const rows = logs ?? [];

  return (
    <div className="min-h-screen bg-muted">
      <PortalHeader />
      <main className="mx-auto max-w-4xl space-y-4 p-4 sm:p-6">
        <MarkReadOnView categories={["rrn_access"]} />
        <PageIntro
          eyebrow="PRIVACY"
          title="주민등록번호 조회 이력"
          description="전문가님의 주민등록번호가 언제·어디서·어떤 사유로 조회되었는지 투명하게 공개합니다."
          action={
            <Button asChild variant="outline" size="sm">
              <Link href="/expert/profile">내 프로필로</Link>
            </Button>
          }
        />

        {/* 안내문 — 권한 자동 부여 규칙 (정중한 비즈니스 용어) */}
        <Card className="border-brand/40 bg-[#F2F6FF] shadow-sm">
          <CardContent className="space-y-3 pt-5 text-sm leading-relaxed text-[#33405A]">
            <div className="flex items-center gap-2 font-bold text-brand-navy">
              <ShieldCheck className="h-4 w-4 text-brand" aria-hidden />
              주민등록번호 열람 권한 안내
            </div>
            <p>
              전문가님의 주민등록번호는 <b>기업이 상시 보관하지 않으며</b>, 소득세법상
              원천징수·지급명세서 제출 등 <b>법령상 근거가 있는 경우에 한하여</b>{" "}
              필요한 시점에만 열람됩니다.
            </p>
            <p>
              섭외를 수락하여 <b>계약이 성립된 프로젝트</b>에 한해, 해당 프로젝트의
              지정된 담당자(회계담당자 또는 대표자)에게 <b>프로젝트 참여 종료 이후</b>{" "}
              <b>프로젝트당 최대 2회</b>의 열람 권한이 자동으로 부여됩니다. 세무조사·
              경정청구 등 정당한 사유가 발생한 경우 <b>대표자 승인과 사유 기재</b>를 거쳐
              추가 열람이 가능하며, 이 경우에도 전문가님께 즉시 통지됩니다.
            </p>
            <p className="text-xs text-muted-foreground">
              모든 열람은 예외 없이 아래 이력에 기록되며, 열람 시 전문가님께 즉시
              알림이 발송됩니다. 플랫폼 운영사(넥스트랩)는 주민등록번호를 열람할 수
              없습니다.
            </p>
          </CardContent>
        </Card>

        {/* 조회 이력 */}
        {rows.length === 0 ? (
          <Card className="shadow-sm">
            <CardContent className="pt-5">
              <div className="flex items-start gap-2 text-sm text-muted-foreground">
                <Info className="mt-0.5 h-4 w-4 flex-none text-brand" aria-hidden />
                <p>
                  아직 조회된 이력이 없습니다. 주민등록번호가 열람되면 조회 기관·
                  프로젝트·일시·사유·조회자가 이곳에 기록되어 표시됩니다.
                </p>
              </div>
            </CardContent>
          </Card>
        ) : (
          <Card className="shadow-sm">
            <CardContent className="pt-5">
              <ul className="divide-y">
                {rows.map((log) => {
                  const reason = REASON_LABEL[log.reason] ?? {
                    label: "기타",
                    tone: "gray" as const,
                  };
                  return (
                    <li key={log.id} className="py-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-bold text-brand-navy">
                          {log.tenant_name ?? "(기업)"}
                        </span>
                        {log.project_name && (
                          <span className="text-xs text-muted-foreground">
                            {log.project_name}
                          </span>
                        )}
                        <Tag className="ml-auto" tone={reason.tone}>
                          {reason.label}
                        </Tag>
                        {log.is_over_limit && <Tag tone="red">한도 초과</Tag>}
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                        <span>
                          {new Date(log.accessed_at).toLocaleString("ko-KR")}
                        </span>
                        <span>
                          {ACCESS_TYPE_LABEL[log.access_type] ?? log.access_type}
                        </span>
                        {log.accessor_label && (
                          <span>조회자 {log.accessor_label}</span>
                        )}
                      </div>
                      {log.is_over_limit && (
                        <p className="mt-1 rounded-md bg-amber-50 p-2 text-xs text-amber-900">
                          프로젝트당 2회 한도를 넘어 <b>대표자 승인</b>으로 진행된
                          조회입니다. 기재된 사유:{" "}
                          {log.over_limit_reason ?? "(미기재)"}
                        </p>
                      )}
                    </li>
                  );
                })}
              </ul>
            </CardContent>
          </Card>
        )}
      </main>
    </div>
  );
}
