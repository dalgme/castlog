/**
 * 기능별 실행 권한 — 최소 레벨 중앙표 (기획 확정 2026-08-23, 레벨 4·5·6 차등화)
 *
 * 레벨(grade)과 기능의 대응을 한 곳에 모은다. 서버 액션 게이트와 DB RLS가
 * 같은 기준을 쓴다 (DB: app.has_exec_grade(min_grade) — 마이그레이션 참조).
 *
 *   레벨 1 ceo      — 전부
 *   레벨 2 director — 전사 열람·배정 + 실행 전부
 *   레벨 3 team_lead— 실행 전부 + 개설·일괄등록·취소·자유발송 (PL 가능)
 *   레벨 4 deputy   — 발송·품의 실행 (위 4가지 제외, PM 가능)
 *   레벨 5 senior   — 실무 입력 (계획·후보·예정가)
 *   레벨 6 staff    — 조회 전용 (일반 품의 상신만)
 *
 * 이 파일은 클라이언트에서도 임포트될 수 있으므로 server-only를 붙이지 않는다.
 * 다음 단계(회사별 문턱 조정)에서 이 표의 기본값 위에 테넌트 설정을 얹는다.
 */

import {
  gradeAtLeast,
  gradeFromLegacyRole,
  isUserGrade,
  type UserGrade,
} from "@/lib/auth/grades";

/** 실행 기능 키 — 게이트 지점마다 하나를 고른다 */
export const EXEC_FEATURES = {
  /* ── 레벨 3까지 (개설·대량·되돌리기 어려운 것·자유 발송·설정류) ──── */
  projectCreate: { minGrade: "team_lead", label: "프로젝트 개설" },
  bulkImport: { minGrade: "team_lead", label: "일괄 등록 (엑셀·보유자료)" },
  engagementCancel: { minGrade: "team_lead", label: "섭외 긴급 취소 (확정 후)" },
  freeMessageSend: { minGrade: "team_lead", label: "일반 문자·이메일 발송" },
  projectBudget: { minGrade: "team_lead", label: "프로젝트 예산 수정" },
  sendTemplate: { minGrade: "team_lead", label: "발송 문구 관리" },

  /* ── 레벨 4까지 (발송·품의 실행 — PM을 맡는 레벨) ────────────────── */
  engagementRequest: { minGrade: "deputy", label: "섭외요청 발송" },
  // 응답 전 회수는 긴급 취소와 위험도가 다르다 — 요청을 보낼 수 있는 사람이
  // 자기 오발송을 거둘 수 있어야 한다 (검수 F5: 위험도-문턱 역전 해소,
  // 기획 확정 2026-08-29). 확정 후 긴급 취소는 계속 레벨 3.
  engagementWithdraw: { minGrade: "deputy", label: "섭외 요청 회수 (응답 전)" },
  sessionNotice: { minGrade: "deputy", label: "세션 안내문자 발송" },
  acceptanceSend: { minGrade: "deputy", label: "수락서 처리·리마인드" },
  planSubmit: { minGrade: "deputy", label: "섭외계획 품의 상신" },
  // 지급건 생성은 금액을 다루는 기능이라 레벨이 아니라 지급 축(canManagePayments:
  // 이사 이상 + finance 위임)을 유지한다 — 이 키는 예약만 해 두고 배선하지 않는다.
  paymentBatchCreate: { minGrade: "deputy", label: "지급건 생성" },
  expertInvite: { minGrade: "deputy", label: "전문가 등록요청·서류요청" },
  expertRecord: { minGrade: "deputy", label: "태그·평점·메모·섭외분야" },

  /* ── 레벨 5까지 (실무 입력) ──────────────────────────────────────── */
  planInput: { minGrade: "senior", label: "세션 계획·후보·예정가 입력" },
} as const satisfies Record<string, { minGrade: UserGrade; label: string }>;

export type ExecFeature = keyof typeof EXEC_FEATURES;

/**
 * legacy role → grade 역산 (없으면 null) — canExec와 exec-policy가 같은 규칙을 쓴다.
 * 임직원 role(org_admin/manager/staff)만 역산한다. expert·platform_admin은
 * null — 문턱을 레벨 6까지 내려도 전문가 세션이 실행 축에 올라타지 못하게
 * (DB app.can_exec의 role 제한과 동일 규칙).
 */
export function gradeFromLegacyRoleSafe(
  legacyRole?: string | null
): UserGrade | null {
  if (!legacyRole) return null;
  if (legacyRole !== "org_admin" && legacyRole !== "manager" && legacyRole !== "staff") {
    return null;
  }
  return gradeFromLegacyRole(legacyRole);
}

/** grade(없으면 legacy role에서 역산)로 기능 실행 가능 여부 판정 */
export function canExec(
  feature: ExecFeature,
  grade: string | null | undefined,
  legacyRole?: string | null
): boolean {
  const resolved: UserGrade | null = isUserGrade(grade)
    ? grade
    : gradeFromLegacyRoleSafe(legacyRole);
  if (!resolved) return false;
  return gradeAtLeast(resolved, EXEC_FEATURES[feature].minGrade);
}

/**
 * 거부 시 사용자에게 돌려줄 문구 — 규칙 거부임을 명시 (CLAUDE.md 12-9).
 * 회사가 문턱을 조정했다면 조정된 레벨(effectiveMin)을 문구에 쓴다.
 */
export function execDeniedMessage(
  feature: ExecFeature,
  effectiveMin?: UserGrade
): string {
  const def = EXEC_FEATURES[feature];
  const levelLabel: Record<UserGrade, string> = {
    ceo: "레벨 1",
    director: "레벨 2",
    team_lead: "레벨 3",
    deputy: "레벨 4",
    senior: "레벨 5",
    staff: "레벨 6",
  };
  const min = effectiveMin ?? def.minGrade;
  return `'${def.label}'은(는) ${levelLabel[min]} 이상만 실행할 수 있습니다 (권한 규칙). 필요하면 관리자에게 권한 레벨 조정을 요청하세요.`;
}
