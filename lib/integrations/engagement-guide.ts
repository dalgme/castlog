import type { ModuleKey } from "@/lib/modules/modules";
import type { UserGrade } from "@/lib/auth/grades";

/**
 * 전문가 섭외 관리 — 기능·프로세스 안내 데이터.
 *
 * 화면 하드코딩 대신 데이터로 두는 이유: 단계가 바뀔 때 문구·순서·권한을 한곳에서
 * 고치기 위해서다. 여기 적힌 최소 권한은 실제 서버 게이트와 같은 기준을 쓴다
 * (실행 권한 = role, 열람 범위 = grade — CLAUDE.md §3-1).
 */

export type GuideStep = {
  no: number;
  title: string;
  /** 무엇을 하는 단계인가 */
  summary: string;
  /** 실무에서 놓치기 쉬운 것 — 한 줄 */
  caution?: string;
  /** 이 단계를 실행할 수 있는 최소 등급 */
  minGrade: UserGrade;
  /** 이 단계에 필요한 모듈. 빈 배열 = 공통 기반(모듈 조합과 무관하게 항상 제공) */
  modules: ModuleKey[];
  /** 바로 가기 — 테넌트 경로 뒤에 붙는 상대 경로 */
  href?: string;
};

export const ENGAGEMENT_GUIDE_STEPS: readonly GuideStep[] = [
  {
    no: 1,
    title: "프로젝트 개설",
    summary:
      "사업연도·발주처·기간을 등록해 프로젝트를 만듭니다. 이후 모든 섭외·결재·지급이 이 프로젝트에 매답니다.",
    caution:
      "사업연도는 통계 축이라 나중에 바꾸면 지난 집계가 흔들립니다. 개설할 때 확정하세요.",
    minGrade: "team_lead",
    modules: [],
    href: "projects",
  },
  {
    no: 2,
    title: "PM · 부PM · 담당자 배정",
    summary:
      "PM 1명(필수)과 부PM(인원 제한 없음), 실무 담당자를 지정합니다. 배정된 사람만 그 프로젝트를 볼 수 있습니다.",
    caution:
      "대표·이사는 전사 프로젝트를 모두 보지만, 팀장 이하는 배정된 프로젝트만 보입니다. 배정을 빠뜨리면 담당자 화면이 비어 있습니다.",
    minGrade: "director",
    modules: [],
    href: "projects",
  },
  {
    no: 3,
    title: "세션 등록 · 전문가 코드넘버 발급",
    summary:
      "날짜별 세션(시간·세션명·역할·필요인원·1인당 예산·장소)을 등록하면 필요인원 1명당 코드넘버가 자동 발급됩니다. 코드가 이후 모든 집계의 기준 단위입니다. 여기까지가 공통 기능이고, 그 자리에 실제 전문가를 붙이는 것부터 전문가 모듈입니다.",
    caution:
      "필요인원을 나중에 줄이면 이미 발급된 코드와 어긋납니다. 인원은 확정 후 입력하세요.",
    minGrade: "team_lead",
    modules: [],
    href: "projects",
  },
  {
    no: 4,
    title: "섭외계획 품의 → 승인",
    summary:
      "세션·인원·예산이 담긴 섭외계획을 품의로 올립니다. 승인 전에는 섭외요청을 보낼 수 없습니다.",
    caution:
      "전결규정(approval_rules)이 등록돼 있으면 결재선이 자동 결정되고, 없으면 결재자를 직접 고릅니다.",
    minGrade: "staff",
    modules: ["approvals"],
    href: "approvals",
  },
  {
    no: 5,
    title: "후보군 조회 · 일정 중복 검증",
    summary:
      "넘버링코드별로 자사와 연결된 전문가 후보를 봅니다. 해당 일시와 겹치는 일정이 자동으로 표시됩니다.",
    caution:
      "타사 섭외는 어느 기업의 무슨 일인지 공개되지 않고, ‘섭외 진행 중(아직 미수락)’인지 ‘이미 확정’인지와 건수만 보입니다. 진행 중 건은 경합일 뿐이니 함께 요청해 볼 수 있습니다.",
    minGrade: "staff",
    modules: ["experts"],
    href: "experts",
  },
  {
    no: 6,
    title: "섭외요청 발송 → 전문가 수락",
    summary:
      "후보를 고르면 세션 정보(일시·장소·역할·비용)를 승계한 섭외요청이 만들어지고, 전문가에게 동의 링크가 발송됩니다.",
    caution:
      "요청은 만료 기한이 있습니다. 회신이 없으면 만료 처리되니 마감 전에 확인하세요.",
    minGrade: "staff",
    modules: ["experts"],
    href: "experts/engagements",
  },
  {
    no: 7,
    title: "계획 변경 시 변경 품의 → 재승인",
    summary:
      "승인된 계획의 일정·인원·비용이 바뀌면 변경 품의가 필요합니다. 메모·주소 같은 표기 수정은 재승인 대상이 아닙니다.",
    minGrade: "staff",
    modules: ["approvals"],
    href: "approvals",
  },
  {
    no: 8,
    title: "수락서 자동 생성 · 확인",
    summary:
      "전문가가 수락하면 프로젝트 정보·코드에 묶인 일시/장소·세션명·전문가 정보를 읽어와 수락서가 자동으로 만들어집니다. 승인·확인·반려에 사용합니다.",
    caution:
      "수락서는 화면에서만 봅니다. 파일로 만들어 주고받지 않습니다 — 내려받기·PDF 내보내기 경로가 없습니다.",
    minGrade: "staff",
    modules: ["experts"],
    href: "experts/engagements",
  },
  {
    no: 9,
    title: "세션별 안내문자 (자동 예약 · 수동)",
    summary:
      "세션마다 확정된 전문가에게 안내문자를 예약하거나 즉시 보냅니다. 예약 건은 15분 간격으로 발송됩니다.",
    caution:
      "업무연락과 광고성은 법적으로 다릅니다. 기본값은 안전한 쪽(광고성)이며, 광고성은 야간 발송이 차단되고 수신거부 링크가 자동으로 붙습니다.",
    minGrade: "staff",
    modules: ["experts"],
    href: "messages",
  },
  {
    no: 10,
    title: "수행 후 평가 · 후기 · 등급",
    summary:
      "정량 평가(프로젝트당 1건)와 자유 후기를 남기고, 자사 기준 등급(즐겨찾기·VIP·주의)을 지정합니다. 다음 섭외의 후보군 정렬에 반영됩니다.",
    caution:
      "평가·후기·등급은 전문가 본인에게 절대 보이지 않습니다. 회사 내부 판단 자료입니다.",
    minGrade: "team_lead",
    modules: ["experts"],
    href: "experts",
  },
  {
    no: 11,
    title: "프로젝트 종료 기여도 · 종료 품의",
    summary:
      "참여 직원의 기여도를 합계 100%로 배분합니다(공통 기능). 전자결재를 쓰는 회사는 종료 품의가 승인되어야 프로젝트가 종료 처리됩니다.",
    minGrade: "team_lead",
    modules: ["approvals"],
    href: "approvals",
  },
  {
    no: 12,
    title: "지급 품의 → 승인 → 지급명세서 → 지급 확정",
    summary:
      "확정된 섭외 건을 묶어 지급 품의를 올립니다. 승인된 뒤에야 지급명세서 파일이 만들어지고 지급을 확정할 수 있습니다.",
    caution:
      "주민등록번호는 회사가 보관하지 않습니다. 승인된 지급 건에 한해, 지정된 담당자가 필요한 시점에 조회만 합니다. 조회는 전건 기록되고 전문가 본인에게 즉시 통지됩니다.",
    minGrade: "team_lead",
    modules: ["experts", "approvals"],
    href: "payments",
  },
] as const;

/** 안내 페이지에 함께 싣는 권한 요약 — 두 축을 헷갈리는 문의가 가장 많다. */
export const GUIDE_PERMISSION_NOTES: readonly {
  title: string;
  body: string;
}[] = [
  {
    title: "실행 권한과 열람 범위는 다른 축입니다",
    body:
      "섭외요청·품의 상신 같은 실행 권한은 팀장까지 관리자로 봅니다. 반면 전사 프로젝트 열람은 대표·이사만이고, 팀장 이하는 배정된 프로젝트만 보입니다.",
  },
  {
    title: "대표의 설정·관리 기능만 위임할 수 있습니다",
    body:
      "설정·직원관리·발송설정·감사로그 네 가지 범위로 나눠 임원 등에게 넘길 수 있습니다. 다만 세무(주민등록번호) 조회 지정자 관리, 위임 자체의 부여·회수, 대표 등급 부여는 위임할 수 없습니다.",
  },
  {
    title: "프로젝트 기초는 모듈이 아닙니다",
    body:
      "프로젝트 개설·기본정보·PM/부PM 배정·예산·세션 등록·전문가 코드넘버 발급은 어떤 모듈 조합을 쓰든 항상 제공됩니다. 전문가 모듈 없이도 코드넘버로 필요 인원(TO)을 관리할 수 있습니다.",
  },
  {
    title: "쓰지 않는 모듈의 단계는 건너뜁니다",
    body:
      "전자결재를 쓰지 않는 회사라면 품의 단계 없이 바로 섭외·지급 확정으로 이어집니다. 전문가 관리만 쓰는 회사는 프로젝트 없이도 전문가 풀·서류 수집을 운영할 수 있습니다.",
  },
  {
    title: "모듈은 나중에 추가할 수 있고, 기존 데이터에 이어집니다",
    body:
      "설정 화면에서 추가를 요청하면 캐스트로그가 승인해 켜 줍니다. 이미 만들어 둔 세션·코드넘버는 그대로 쓰이고, 프로젝트에 연결하지 않고 만든 섭외 건은 나중에 프로젝트에 붙일 수 있습니다.",
  },
];
