import { NextResponse, type NextRequest } from "next/server";

import { requireRole } from "@/lib/auth/session";
import { blockInPractice } from "@/lib/practice/server";
import { createClient } from "@/lib/supabase/server";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { xlsxResponse, type SheetRows } from "@/lib/exports/xlsx";
import { logAudit } from "@/lib/audit/log";
import { PROJECT_STATUS_LABELS } from "@/lib/operations/steps";
import {
  APPROVAL_TYPE_LABELS,
  APPROVAL_STATUS_LABELS,
  formatKrw,
} from "@/lib/approvals/constants";
import { ENGAGEMENT_STATUS_LABELS } from "@/lib/integrations/engagements";

/**
 * 단계 20: 테넌트 데이터 반출(백업) — C+ MVP (설계문서: 자가보관 C+안)
 *
 * 공유 DB를 유지하되, 회사(테넌트)가 자사 데이터의 백업 사본을 다운로드한다.
 * 원칙(민감정보 제외):
 *  - 주민등록번호: 애초에 미저장 (Phase 1) — 포함 대상 없음.
 *  - 서류 원본/서명 이미지: 제외 (메타데이터만).
 *  - 통장사본·사업자번호·세무 프로필: 제외.
 *  - 지급 데이터: 합계·상태 등 업무 데이터만(계좌 정보 없음).
 * 권한: org_admin(대표) 이상. 조회는 RLS 세션 범위(자사 테넌트) 내에서만.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { tenantSlug: string } }
) {
  const user = await requireRole(["platform_admin", "org_admin"]);
  if (!hasSupabaseEnv()) {
    return NextResponse.redirect(
      new URL(`/${params.tenantSlug}/admin/org`, request.url)
    );
  }

  // 연습모드에서 내려받으면 '자사 데이터 백업'이라 믿고 연습 데이터를 받게 된다.
  const practice = await blockInPractice("backup");
  if (!practice.ok) {
    return NextResponse.json({ error: practice.error }, { status: 409 });
  }

  const supabase = createClient();

  const [
    projectsRes,
    contributionsRes,
    engagementsRes,
    acceptancesRes,
    cancellationsRes,
    evaluationsRes,
    paymentsRes,
    approvalsRes,
    linksRes,
    usersRes,
  ] = await Promise.all([
    supabase
      .from("projects")
      .select(
        "name, code, business_year, client_name, status, starts_on, ends_on, closed_at"
      )
      .order("business_year", { ascending: false }),
    supabase
      .from("project_contributions")
      .select("percentage, note, projects (name), users (name)"),
    supabase
      .from("expert_engagements")
      .select(
        "role_description, fee_amount, status, starts_on, ends_on, created_at, responded_at, experts (name), projects (name)"
      ),
    supabase
      .from("engagement_acceptances")
      .select(
        "letter_no, expert_name, role_description, fee_amount, starts_on, ends_on, has_signature, signed_via, accepted_at, project_name"
      ),
    supabase
      .from("engagement_cancellations")
      .select(
        "prior_status, is_urgent, reason, canceled_at, experts (name), projects (name), users (name)"
      ),
    supabase
      .from("expert_evaluations")
      .select("score, reason, created_at, experts (name), projects (name)"),
    supabase
      .from("expert_payment_batches")
      .select(
        "title, status, total_gross, total_withholding, total_net, created_at, paid_at, projects (name)"
      ),
    supabase
      .from("approvals")
      .select("title, approval_type, status, amount, created_at, completed_at"),
    supabase
      .from("expert_tenant_links")
      .select("status, experts (name, specialty, region)"),
    supabase.from("users").select("name, email, role, department"),
  ]);

  const projects: SheetRows = (projectsRes.data ?? []).map((p) => ({
    사업연도: p.business_year,
    프로젝트명: p.name,
    관리코드: p.code ?? "",
    발주처: p.client_name ?? "",
    상태: PROJECT_STATUS_LABELS[p.status] ?? p.status,
    시작일: p.starts_on ?? "",
    종료일: p.ends_on ?? "",
    종료확정일: p.closed_at ? p.closed_at.slice(0, 10) : "",
  }));

  const contributions: SheetRows = (contributionsRes.data ?? []).map((c) => ({
    프로젝트: c.projects?.name ?? "",
    직원: c.users?.name ?? "",
    기여도: c.percentage,
    메모: c.note ?? "",
  }));

  const engagements: SheetRows = (engagementsRes.data ?? []).map((e) => ({
    전문가: e.experts?.name ?? "",
    프로젝트: e.projects?.name ?? "",
    역할: e.role_description,
    의뢰비용: e.fee_amount ?? "",
    상태: ENGAGEMENT_STATUS_LABELS[e.status] ?? e.status,
    시작일: e.starts_on ?? "",
    종료일: e.ends_on ?? "",
    요청일: e.created_at ? e.created_at.slice(0, 10) : "",
    응답일: e.responded_at ? e.responded_at.slice(0, 10) : "",
  }));

  const acceptances: SheetRows = (acceptancesRes.data ?? []).map((a) => ({
    문서번호: a.letter_no,
    전문가: a.expert_name,
    프로젝트: a.project_name ?? "",
    역할: a.role_description,
    의뢰비용: a.fee_amount ?? "",
    서명첨부: a.has_signature ? "예" : "아니오",
    수락경로: a.signed_via === "portal" ? "포털" : "공개링크",
    수락일: a.accepted_at ? a.accepted_at.slice(0, 10) : "",
  }));

  const cancellations: SheetRows = (cancellationsRes.data ?? []).map((c) => ({
    구분: c.is_urgent ? "긴급취소" : "회수",
    전문가: c.experts?.name ?? "",
    프로젝트: c.projects?.name ?? "",
    사유: c.reason ?? "",
    취소자: c.users?.name ?? "",
    취소일시: c.canceled_at ? c.canceled_at.slice(0, 19).replace("T", " ") : "",
  }));

  const evaluations: SheetRows = (evaluationsRes.data ?? []).map((e) => ({
    전문가: e.experts?.name ?? "",
    프로젝트: e.projects?.name ?? "",
    점수: e.score,
    사유: e.reason ?? "",
    작성일: e.created_at ? e.created_at.slice(0, 10) : "",
  }));

  const payments: SheetRows = (paymentsRes.data ?? []).map((b) => ({
    제목: b.title,
    프로젝트: b.projects?.name ?? "",
    상태: b.status,
    총비용: formatKrw(b.total_gross),
    원천징수: formatKrw(b.total_withholding),
    실지급액: formatKrw(b.total_net),
    생성일: b.created_at ? b.created_at.slice(0, 10) : "",
    지급완료일: b.paid_at ? b.paid_at.slice(0, 10) : "",
  }));

  const approvals: SheetRows = (approvalsRes.data ?? []).map((a) => ({
    제목: a.title,
    유형: APPROVAL_TYPE_LABELS[a.approval_type ?? ""] ?? a.approval_type ?? "",
    상태: APPROVAL_STATUS_LABELS[a.status] ?? a.status,
    금액: a.amount != null ? formatKrw(a.amount) : "",
    상신일: a.created_at ? a.created_at.slice(0, 10) : "",
    완료일: a.completed_at ? a.completed_at.slice(0, 10) : "",
  }));

  const links: SheetRows = (linksRes.data ?? []).map((l) => ({
    전문가: l.experts?.name ?? "",
    전문분야: l.experts?.specialty ?? "",
    활동지역: l.experts?.region ?? "",
    연결상태: l.status,
  }));

  const staff: SheetRows = (usersRes.data ?? []).map((u) => ({
    이름: u.name,
    이메일: u.email ?? "",
    역할: u.role,
    부서: u.department ?? "",
  }));

  await logAudit(supabase, user, {
    action: "export.tenant_backup",
    resourceType: "export",
    afterData: {
      projects: projects.length,
      engagements: engagements.length,
      payments: payments.length,
    },
  });

  return xlsxResponse("테넌트백업", [
    ["프로젝트", projects],
    ["종료기여도", contributions],
    ["섭외", engagements],
    ["섭외수락서", acceptances],
    ["섭외취소", cancellations],
    ["전문가평가", evaluations],
    ["지급배치", payments],
    ["결재", approvals],
    ["연결전문가", links],
    ["직원", staff],
  ]);
}
