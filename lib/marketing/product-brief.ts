import {
  MODULE_KEYS,
  MODULE_LABELS,
  MODULE_DESCRIPTIONS,
  MODULE_NUMBERS,
} from "@/lib/modules/modules";
import { USER_GRADES, GRADE_LABELS, GRADE_DESCRIPTIONS } from "@/lib/auth/grades";
import {
  ADMIN_SCOPES,
  ADMIN_SCOPE_LABELS,
  ADMIN_SCOPE_DESCRIPTIONS,
} from "@/lib/auth/admin-scope-keys";

/**
 * 제품 소개서 본문 — **코드에서 생성한다.**
 *
 * 소개서를 사람이 따로 써 두면 반드시 제품과 어긋난다. 기능을 고칠 때 문서를
 * 같이 고치는 일은 언제나 뒤로 밀리고, 어긋난 소개서는 영업에서 그대로 사고가
 * 된다(없는 기능을 약속하거나, 있는 기능을 빠뜨린다).
 *
 * 그래서 모듈·권한·위임 스코프 같은 사실은 실제 상수에서 뽑는다. 여기 적힌
 * 것은 제품이 실제로 가진 것이고, 상수가 바뀌면 소개서도 함께 바뀐다.
 *
 * 숫자(도입 기업 수 등)는 싣지 않는다. 공개 문서에 고객 규모를 적으면 그 자체가
 * 고객 정보 공개가 되고, 매달 흔들리는 숫자는 관리 부담만 남긴다.
 */

export type BriefSection = {
  heading: string;
  lead?: string;
  items: { term: string; desc: string }[];
};

export type ProductBrief = {
  /** 예: "2026-09" — 매월 1일 갱신 */
  edition: string;
  title: string;
  subtitle: string;
  sections: BriefSection[];
  /** 문서 하단 고지 */
  notes: string[];
};

/** KST 기준 판(edition) 문자열 */
export function editionOf(date: Date): string {
  const kst = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  const y = kst.getUTCFullYear();
  const m = String(kst.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

export function buildProductBrief(now: Date): ProductBrief {
  return {
    edition: editionOf(now),
    title: "캐스트로그 제품 소개",
    subtitle:
      "창업교육·창업컨설팅 기업을 위한 프로젝트·전문가 섭외·전자결재 통합 플랫폼",
    sections: [
      {
        heading: "1. 무엇을 해결하나",
        lead:
          "행사 하나를 치르려면 프로젝트를 열고, 세션을 짜고, 전문가를 섭외하고, 품의를 올리고, 지급하고, 정산합니다. 이 일들이 엑셀·메신저·종이 결재로 흩어져 있으면 '지금 어디까지 됐는지'를 아는 사람이 아무도 없습니다. 캐스트로그는 그 전 과정을 한 줄기로 잇습니다.",
        items: [
          {
            term: "프로젝트에서 시작한다",
            desc: "행사명·발주처·사업연도·기간·예산을 열고, PM·부PM·담당자를 배정하고, 세션별 날짜·역할·필요인원·1인당 비용·장소를 잡습니다. 전문가 코드넘버가 자동으로 발급되어, 아직 사람이 정해지지 않은 자리도 먼저 관리됩니다.",
          },
          {
            term: "그 자리에 사람을 붙인다",
            desc: "코드넘버 자리에 전문가를 섭외 요청하고, 수락서를 보내고, 전문가가 서명하면 참여가 확정됩니다. 수락서는 파일로 오가지 않고 화면에서 확인합니다.",
          },
          {
            term: "돈이 움직일 때 결재가 붙는다",
            desc: "섭외 계획, 프로젝트 종료, 지급 — 금액이 걸린 지점마다 품의가 붙고, 전결규정이 결재선을 자동으로 정합니다.",
          },
        ],
      },
      {
        heading: "2. 세 영역, 필요한 만큼만",
        lead:
          "전 기능을 강제로 쓰게 하지 않습니다. 공통 기반(프로젝트·세션·계정·권한·발송·통계)은 항상 열려 있고, 아래 세 영역은 회사가 쓰는 것만 켭니다. 나중에 추가해도 기존 데이터가 그대로 이어집니다.",
        items: MODULE_KEYS.map((key) => ({
          term: `${MODULE_NUMBERS[key]}. ${MODULE_LABELS[key]}`,
          desc: MODULE_DESCRIPTIONS[key],
        })),
      },
      {
        heading: "3. 권한 — 직급과 위임을 나눈다",
        lead:
          "회사 조직 그대로 6단계 권한을 씁니다. 전사 프로젝트 열람은 대표·이사만이고, 팀장 이하는 배정된 프로젝트만 봅니다.",
        items: USER_GRADES.map((grade) => ({
          term: GRADE_LABELS[grade],
          desc: GRADE_DESCRIPTIONS[grade],
        })),
      },
      {
        heading: "4. 대표 업무를 나눠 맡길 수 있다",
        lead:
          "시스템 설정·관리 기능은 기능 단위로 위임합니다. 발송은 홍보 담당에게, 지급은 회계 담당에게, 계정은 인사 담당에게 — 기능마다 다른 사람을 지정할 수 있습니다. 위임받은 사람은 다시 위임할 수 없습니다.",
        items: ADMIN_SCOPES.map((scope) => ({
          term: ADMIN_SCOPE_LABELS[scope],
          desc: ADMIN_SCOPE_DESCRIPTIONS[scope],
        })),
      },
      {
        heading: "5. 전문가는 자기 이력을 갖는다",
        items: [
          {
            term: "전문가 소유 신원",
            desc: "이력서·경력 같은 신원 정보는 전문가 본인의 것입니다. 기업은 연결된 전문가만 조회하고, 서류는 허용된 범위에서만 봅니다.",
          },
          {
            term: "테넌트 격리",
            desc: "섭외 이력·의뢰비용·평판 점수·프로젝트 정보는 회사별로 완전히 분리됩니다. 다른 회사가 얼마를 줬는지 볼 수 없습니다.",
          },
          {
            term: "전문가 포털",
            desc: "전문가는 휴대폰 인증으로 로그인해 참여 일정·수락서·지급 내역·자기 이력을 봅니다. 여러 회사와 일해도 통합 이력은 본인만 봅니다.",
          },
        ],
      },
      {
        heading: "6. 개인정보를 회사가 떠안지 않게 한다",
        lead:
          "지급명세서를 만들려면 주민등록번호가 필요합니다. 그러나 회사가 그 번호를 보관하면 그 순간부터 유출 책임이 회사에 남습니다. 캐스트로그는 보관 대신 필요한 순간에만 지나가게 설계했습니다.",
        items: [
          {
            term: "기업은 번호를 보유하지 않는다",
            desc: "필요 시점에 조회만 합니다. 기본 경로는 화면 조회가 아니라 지급명세서 파일 자동 생성입니다.",
          },
          {
            term: "조회 지정자는 최대 3명",
            desc: "대표가 직접 지정하며, 이 권한만은 위임·대결 대상이 아닙니다. 프로젝트당 조회 한도가 있고, 모든 조회는 전문가 본인에게 즉시 통지됩니다.",
          },
          {
            term: "조회 이력은 회사가 직접 본다",
            desc: "누가 언제 무엇을 열었는지 보안 현황 화면에서 확인하고 감사로그로 내보낼 수 있습니다.",
          },
        ],
      },
      {
        heading: "7. 발송은 회사 명의로",
        items: [
          {
            term: "자사 발신번호·자사 계정",
            desc: "문자는 회사가 등록한 공급자(솔라피·알리고·NHN 등) 계정과 사전등록 발신번호로 나갑니다. 플랫폼이 대신 보내지 않습니다.",
          },
          {
            term: "업무연락과 광고를 구분한다",
            desc: "광고성 발송을 고르면 미동의자 자동 제외, (광고) 표기, 수신거부 링크, 야간 발송 차단이 시스템에서 강제됩니다. 담당자가 실수로 위법 발송을 하지 못하게 막습니다.",
          },
        ],
      },
      {
        heading: "8. 회사 이름으로 쓴다 (화이트라벨)",
        items: [
          {
            term: "회사 전용 주소",
            desc: "castlog.kr/{회사} 로 회사 진입 화면이 열립니다. 회사 로고와 이름이 첫 화면에 나옵니다.",
          },
          {
            term: "전문가가 보는 화면도 회사 얼굴",
            desc: "섭외 동의·서류 제출·수락서 등 전문가가 여는 모든 화면에 회사 로고와 이름이 붙습니다. 전문가는 캐스트로그가 아니라 그 회사와 일합니다.",
          },
        ],
      },
      {
        heading: "9. 시작하기",
        items: [
          {
            term: "연습모드",
            desc: "실제 데이터를 건드리지 않고 전 과정을 연습할 수 있습니다. 가상 전문가와 섭외 이력이 준비되어 있습니다.",
          },
          {
            term: "최초 설정 안내",
            desc: "가입 직후 반드시 잡아야 할 설정(사용 기능·보호책임자·임직원·문자 발송·전결규정)을 한 화면에서 점검합니다.",
          },
          {
            term: "화면 안의 도우미",
            desc: "화면 오른쪽 아래 챗봇에서 사용법을 묻고, 불편한 점·개선 요청을 그대로 전달할 수 있습니다.",
          },
        ],
      },
    ],
    notes: [
      "이 문서는 제품 코드에서 자동 생성되며 매월 1일 갱신됩니다. 문서의 기능 목록은 실제 배포된 제품과 일치합니다.",
      "요금·계약 조건은 이 문서에 포함되지 않습니다. 별도 안내를 요청해 주세요.",
      "데이터는 국내(서울 리전)에 보관됩니다.",
    ],
  };
}
