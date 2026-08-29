import { ShieldCheck } from "lucide-react";

/**
 * 권한 체계 안내 패널 (기획 확정 2026-08-23).
 * 처음 쓰는 회사가 "직급 / 권한 레벨 / 프로젝트 역할"의 관계를 화면에서 바로
 * 이해하도록, 전결규정·기업 관리 화면 상단에 개조식으로 붙인다.
 * 내용은 코드의 실제 판정 규칙과 일치해야 한다 — 규칙이 바뀌면 여기도 고친다.
 */

const LEVEL_ROWS: { level: string; who: string; can: string[] }[] = [
  {
    level: "레벨 1",
    who: "보통 대표 (회사당 1명 이상 필수)",
    can: [
      "회사의 모든 화면·기능 사용",
      "임직원 계정 만들기, 각 직원의 권한 레벨 정하기",
      "전결규정·문자 발송·회사 정보 등 시스템 설정",
      "아래 '추가 권한 스위치'를 다른 직원에게 켜고 끄기",
      "주민등록번호 조회 지정자 관리 — 레벨 1만 가능, 위임 불가",
    ],
  },
  {
    level: "레벨 2",
    who: "보통 임원",
    can: [
      "회사의 모든 프로젝트를 배정 없이 열람",
      "프로젝트에 담당자(PL·PM·부PM·담당) 배정",
      "섭외·품의 등 실행 기능 전부",
      "시스템 설정은 불가 — 필요하면 레벨 1이 스위치를 켜줌",
    ],
  },
  {
    level: "레벨 3",
    who: "보통 팀장급 — PL은 이 레벨부터",
    can: [
      "자기가 배정된 프로젝트만 열람 (다른 팀 프로젝트는 안 보임)",
      "배정된 프로젝트 안에서 전 기능 실행 — 섭외요청, 수락서, 안내문자, 품의 상신",
      "레벨 4에는 없는 4가지 — 프로젝트 개설 · 보유자료 일괄 등록 · 섭외 긴급 취소(확정 후) · 문자 자유 발송",
    ],
  },
  {
    level: "레벨 4",
    who: "실무 책임 — PM은 이 레벨부터 (기본값)",
    can: [
      "배정된 프로젝트에서 레벨 3의 대부분 기능 실행 — 섭외요청 발송, 수락서, 세션 안내문자, 지급건 생성, 전문가 평가·서류 요청",
      "안 되는 것 4가지 — 프로젝트 개설, 보유자료 일괄 등록, 섭외 긴급 취소(확정 후), 문자 자유 발송 (레벨 3 이상에게 요청). 응답 전 요청 회수는 레벨 4부터 가능",
    ],
  },
  {
    level: "레벨 5",
    who: "실무 입력 — 부PM은 이 레벨부터 (기본값)",
    can: [
      "배정된 프로젝트에서 실무 입력 — 세션 계획, 후보 지정, 예정가, 첨부 자료",
      "발송·품의 상신 같은 실행은 레벨 4 이상이 함 (입력해 두면 위 레벨이 보냄)",
    ],
  },
  {
    level: "레벨 6",
    who: "조회 전용 — 인턴·신규 입사 기본값",
    can: [
      "배정된 프로젝트 조회, 일반 품의(지출·출장 등) 상신",
      "입력·발송·실행 없음 — 업무를 맡기려면 레벨 5 이상으로 올려주세요",
    ],
  },
];

export function PermissionLevelGuide({
  defaultOpen = false,
}: {
  /** 팝업(레벨 설정 이해하기) 안에서는 펼친 상태로 시작한다 */
  defaultOpen?: boolean;
} = {}) {
  return (
    <details
      open={defaultOpen}
      className="group rounded-xl border border-brand/30 bg-[#F2F6FF]"
    >
      <summary className="flex cursor-pointer list-none items-center gap-2 p-4 text-sm font-bold text-brand-navy [&::-webkit-details-marker]:hidden">
        <ShieldCheck className="h-4 w-4 text-brand" aria-hidden />
        권한 체계 한눈에 보기 — 직급 · 권한 레벨 · 프로젝트 역할
        <span className="ml-auto text-xs font-normal text-muted-foreground group-open:hidden">
          펼치기 ▾
        </span>
        <span className="ml-auto hidden text-xs font-normal text-muted-foreground group-open:inline">
          접기 ▴
        </span>
      </summary>

      <div className="space-y-4 px-4 pb-4 text-sm leading-relaxed text-[#33405A]">
        {/* 1. 세 가지가 서로 다르다 */}
        <div>
          <p className="mb-1 font-semibold text-brand-navy">
            ① 이름이 비슷해도, 세 가지는 서로 다른 것입니다
          </p>
          <ul className="list-disc space-y-1 pl-5">
            <li>
              <b>직급</b> — 회사가 자유롭게 만드는 <b>호칭</b>입니다 (예: 선임연구원,
              책임, 본부장, 인턴). 몇 개든 만들 수 있고, 화면·문서에 표기만 될 뿐{" "}
              <b>권한과는 무관</b>합니다.
            </li>
            <li>
              <b>권한 레벨 (레벨 1~6)</b> — 시스템이 &ldquo;이 사람이 이 기능을 쓸 수
              있는가&rdquo;를 판단하는 기준입니다. <b>직급이 몇 개든, 모든 직원은
              레벨 하나를 배정받습니다.</b> 예: 본부장·수석 → 레벨 3, 선임·책임 →
              레벨 4, 인턴 → 레벨 6.
            </li>
            <li>
              <b>프로젝트 역할 (PL · PM · 부PM · 담당)</b> — 특정 프로젝트 안에서의
              책임입니다. 역할에는 최소 레벨이 있습니다 — 기본값은 <b>PL 레벨 3 ·
              PM 레벨 4 · 부PM 레벨 5 · 담당 레벨 6</b>이며, 설정 &gt; 임직원
              설정에서 회사가 조정할 수 있습니다.
            </li>
          </ul>
        </div>

        {/* 2. 레벨별 권한 */}
        <div>
          <p className="mb-1 font-semibold text-brand-navy">
            ② 레벨별로 할 수 있는 일
          </p>
          <div className="space-y-2">
            {LEVEL_ROWS.map((row) => (
              <div key={row.level} className="rounded-md border bg-white/70 p-2.5">
                <p className="font-semibold">
                  {row.level}{" "}
                  <span className="text-xs font-normal text-muted-foreground">
                    — {row.who}
                  </span>
                </p>
                <ul className="mt-1 list-disc space-y-0.5 pl-5 text-[13px]">
                  {row.can.map((c) => (
                    <li key={c}>{c}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>

        {/* 3. 결재 흐름 */}
        <div>
          <p className="mb-1 font-semibold text-brand-navy">
            ③ 품의(결재)는 이렇게 올라갑니다
          </p>
          <ul className="list-disc space-y-1 pl-5">
            <li>
              <b>전결규정을 등록했다면</b> — 유형·금액 구간에 맞는 규정의 결재라인이
              자동으로 걸립니다. (이 화면에서 등록·개정)
            </li>
            <li>
              <b>규정이 없다면</b> — 상신자보다 높은 레벨 중 <b>가장 가까운
              상급자</b>에게 가고, 50만 원 이상 건은 레벨 2를 한 번 더 거치며,
              마지막은 항상 레벨 1입니다.
            </li>
            <li>
              같은 레벨에 여러 명이 있으면 먼저 등록된 사람에게 갑니다 — 누구에게
              갈지 회사가 정하려면 전결규정을 등록하세요.
            </li>
          </ul>
        </div>

        {/* 4. 추가 권한 스위치 = 레벨 확장 */}
        <div>
          <p className="mb-1 font-semibold text-brand-navy">
            ④ 레벨 6개로 부족할 때 — &ldquo;추가 권한 스위치&rdquo;로 확장됩니다
          </p>
          <ul className="list-disc space-y-1 pl-5">
            <li>
              관리 기능 9종(회사 설정 / 사용 기능 / 임직원 / 발송 / 발송 문구 /
              전결규정 / 감사로그 / 데이터 반출 / 지급·정산)은 레벨과 별개로{" "}
              <b>사람마다 켜고 끌 수 있습니다</b> (설정 &gt; 임직원 설정 &gt;
              관리 권한 위임).
            </li>
            <li>
              예: <b>레벨 5 + 발송·문구 스위치</b> = 홍보 담당,{" "}
              <b>레벨 4 + 지급 스위치</b> = 회계 담당, <b>레벨 3 + 전결규정
              스위치</b> = 경영지원 팀장.
            </li>
            <li>
              즉 실제 권한 조합은 <b>6레벨 × 9스위치</b>라서, 회사 직급이 10개여도
              각 직급에 맞는 권한 조합을 만들 수 있습니다.
            </li>
            <li>
              여기에 더해 <b>기능별 권한 문턱 조정</b>(설정 &gt; 임직원 설정)으로
              기능마다 필요한 최소 레벨을 회사가 직접 올리거나 내릴 수 있고,
              레벨과 무관하게 <b>특정 직원에게만</b> 기능을 열어줄 수도 있습니다
              — 위 표의 레벨은 그 조정이 없을 때의 기본값입니다.
            </li>
          </ul>
        </div>

        {/* 5. 프로젝트 역할과의 관계 */}
        <div>
          <p className="mb-1 font-semibold text-brand-navy">
            ⑤ PL · PM · 부PM은 레벨과 어떻게 얽히나
          </p>
          <ul className="list-disc space-y-1 pl-5">
            <li>
              프로젝트 역할은 <b>그 프로젝트 안에서만</b> 의미가 있습니다. 배정은
              레벨 1·2가 합니다.
            </li>
            <li>
              레벨 3 이하 직원은 <b>배정된 프로젝트만</b> 볼 수 있으므로, 배정 =
              &ldquo;이 프로젝트를 볼 수 있게 하는 것&rdquo;이기도 합니다.
            </li>
            <li>
              PL·PM은 프로젝트당 각 1명(한 사람이 겸임 가능), 부PM·담당은 여러 명.
            </li>
            <li>
              역할 최소 레벨(기본값): <b>PL 레벨 3 · PM 레벨 4 · 부PM 레벨 5 ·
              담당 레벨 6.</b> PM이 섭외요청·안내문자를 직접 실행해야 하고,
              부PM은 PM 승인 아래 실무를 맡기 때문입니다 — 기준에 못 미치는
              레벨을 지정하려 하면 시스템이 막습니다. 이 기준은 설정 &gt;
              임직원 설정에서 회사가 역할별로 조정할 수 있습니다.
            </li>
            <li>
              부PM이 실행한 민감한 작업은 PM(또는 PL)의 승인을 거칩니다.
            </li>
            <li>
              품의 결재선은 프로젝트 역할이 아니라 <b>전결규정·레벨</b>을 따릅니다 —
              PM이라도 결재는 자기보다 높은 레벨에게 올라갑니다.
            </li>
          </ul>
        </div>
      </div>
    </details>
  );
}
