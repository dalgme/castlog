/**
 * 경로 → 화면 이름 (상단 위치 표시용, 클라이언트 안전)
 *
 * 사이드바 메뉴명과 같은 이름을 써야 사용자가 "내가 누른 메뉴"와 "지금 위치"를
 * 같은 것으로 읽는다. 이름이 갈리면 위치 표시가 오히려 헷갈리게 만든다.
 *
 * 키는 테넌트 슬러그를 뗀 나머지 경로다. 긴 경로부터 맞춰 본다.
 */
export const NAV_LABELS: Record<string, string> = {
  dashboard: "대시보드",
  "my-work": "내 업무",
  executive: "업무배정 현황",
  projects: "프로젝트",
  approvals: "전자결재",
  "approvals/rules": "전결규정",
  "approvals/delegations": "대결·위임",
  "approvals/travel": "출장품의",
  experts: "전문가",
  "experts/engagements": "섭외 현황",
  "experts/acceptances": "섭외 수락서",
  "experts/cancellations": "섭외 취소 내역",
  "experts/documents": "전문가 서류",
  "experts/import": "전문가 가져오기",
  payments: "비용·지급",
  reports: "보고서",
  messages: "발송",
  guide: "섭외 안내",
  settings: "설정",
  setup: "최초 설정",
  "admin/org": "기업관리",
  "admin/org/security": "보안 현황",
  "admin/org/audit": "감사로그",
};

export type Crumb = { label: string; href?: string };

/**
 * 현재 경로에서 위치 표시를 만든다.
 * 등록되지 않은 하위 경로(상세 화면 등)는 '상세'로 뭉뚱그린다 — id를 그대로
 * 보여주면 위치 표시가 아니라 소음이 된다.
 */
export function buildCrumbs(pathname: string, tenantSlug: string): Crumb[] {
  const base = `/${tenantSlug}`;
  if (!pathname.startsWith(base)) return [];
  const rest = pathname.slice(base.length).replace(/^\/+/, "");
  if (!rest) return [];

  const segments = rest.split("/").filter(Boolean);
  const crumbs: Crumb[] = [];
  let matchedDepth = 0;

  // 등록된 경로 중 가장 긴 것부터 맞춰 나간다 (approvals → approvals/rules)
  for (let depth = segments.length; depth > 0; depth--) {
    const key = segments.slice(0, depth).join("/");
    if (NAV_LABELS[key]) {
      // 상위 경로가 별도 화면으로 존재하면 함께 노출한다
      for (let i = 1; i < depth; i++) {
        const parentKey = segments.slice(0, i).join("/");
        if (NAV_LABELS[parentKey]) {
          crumbs.push({ label: NAV_LABELS[parentKey], href: `${base}/${parentKey}` });
        }
      }
      crumbs.push({ label: NAV_LABELS[key], href: `${base}/${key}` });
      matchedDepth = depth;
      break;
    }
  }

  if (crumbs.length === 0) return [];
  if (segments.length > matchedDepth) crumbs.push({ label: "상세" });
  return crumbs;
}
