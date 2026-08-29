/**
 * 감사로그 표기 사전 — 화면과 엑셀 내보내기가 같은 문구를 쓰도록 한 곳에 둔다.
 * 미등록 action은 원문 그대로 노출한다(사전을 못 따라잡아도 기록이 가려지면 안 된다).
 */

/** 행위 카테고리(action 접두어) 필터 */
export const ACTION_CATEGORIES: Record<string, string> = {
  approval: "전자결재",
  approval_rule: "전결규정",
  approval_delegation: "대결·위임",
  engagement: "섭외",
  expert: "전문가",
  expert_document: "전문가 서류",
  expert_invitation: "등록 요청",
  document_request: "서류 제출 요청",
  payment_batch: "지급",
  project: "프로젝트",
  project_step: "프로젝트 스텝",
  message: "발송",
  export: "데이터 내보내기",
  user: "계정",
  sms_config: "SMS 설정",
  ad: "수신동의",
  rrn: "주민번호 보안",
};

/** 대표 행위 한글 표기 */
export const ACTION_LABELS: Record<string, string> = {
  "approval.submit": "결재 상신",
  "approval.approve": "결재 승인",
  "approval.reject": "결재 반려",
  "approval.cancel": "결재 회수",
  "approval.resubmit": "재상신",
  "approval_rule.deactivate": "전결규정 비활성화",
  "approval_delegation.create": "대결·위임 설정",
  "approval_delegation.end": "대결·위임 종료",
  "engagement.request": "섭외 요청",
  "engagement.cancel": "섭외 취소",
  "expert.register": "전문가 등록",
  "expert_document.upload": "서류 업로드",
  "expert_document.view": "서류 열람",
  "expert_invitation.create": "등록 요청 생성",
  "expert_invitation.bulk_create": "등록 요청 일괄 생성",
  "expert_invitation.revoke": "등록 요청 회수",
  "document_request.create": "서류 제출 요청",
  "document_request.cancel": "서류 제출 요청 회수",
  "payment_batch.create": "지급건 생성",
  "payment_batch.submit_approval": "지급 품의 상신",
  "payment_batch.simple_confirm": "지급 확정(결재 생략)",
  "payment_batch.paid": "지급 완료",
  "payment_batch.cancel": "지급건 취소",
  "project.create": "프로젝트 생성",
  "project_step.status_change": "스텝 상태 변경",
  "message.send": "발송 실행",
  "export.experts": "전문가 목록 내보내기",
  "export.projects": "프로젝트 목록 내보내기",
  "export.approvals": "결재 목록 내보내기",
  "export.payments": "지급 현황 내보내기",
  "export.staff": "직원 목록 내보내기",
  "export.audit_logs": "감사로그 내보내기",
  "export.rrn_access_logs": "주민번호 조회 이력 내보내기",
  "user.create": "직원 계정 생성",
  "user.activate": "계정 활성화",
  "user.deactivate": "계정 비활성화",
  "sms_config.save": "SMS 설정 저장",
  "ad.unsubscribe": "광고 수신거부",
  "tenant.create": "테넌트 생성",
  "tenant.update_modules": "모듈 조합 변경",
  "tenant.monitor_on": "실시간 모니터링 켬",
  "tenant.monitor_off": "실시간 모니터링 끔",
  "monitor.error_interpret": "에러 기록 AI 해석",
  "usage.snapshot": "사용량 수동 집계",
  "rrn.lockdown.triggered": "주민번호 조회 전체 잠금 발생",
  "rrn.over_limit.request": "주민번호 초과 조회 요청",
  "rrn.over_limit.approve": "주민번호 초과 조회 승인",
  "rrn.over_limit.deny": "주민번호 초과 조회 반려",
};

export const AUDIT_ROLE_LABELS: Record<string, string> = {
  platform_admin: "플랫폼관리자",
  org_admin: "기업총괄관리자",
  manager: "관리자",
  staff: "직원",
  expert: "전문가",
  system: "시스템",
};

export function auditActionLabel(action: string): string {
  return ACTION_LABELS[action] ?? action;
}

export function auditRoleLabel(role: string | null): string {
  if (!role) return "-";
  return AUDIT_ROLE_LABELS[role] ?? role;
}
