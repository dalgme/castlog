import { GraduationCap } from "lucide-react";

/**
 * 연습모드 경고 띠 — 연습 중일 때만 화면 최상단에 뜬다.
 *
 * 연습인 줄 모르고 실제 업무를 입력하는 사고를 막는 게 이 띠의 존재 이유다.
 * 색·문구를 은근하게 두지 않는다. 전환 버튼은 상단 바(PracticeToggle)에 있다 —
 * 버튼과 경고를 한 덩어리로 두면, 꺼져 있을 때도 자리를 차지하면서 정작
 * 켜졌을 때의 경고는 약해진다.
 */
export function PracticeBar({ practice }: { practice: boolean }) {
  if (!practice) return null;

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b-2 border-amber-400 bg-amber-100 px-4 py-2 text-amber-950">
      <span className="inline-flex items-center gap-1.5 text-sm font-bold">
        <GraduationCap className="h-4 w-4" />
        연습모드
      </span>
      <span className="text-xs">
        지금 보이는 프로젝트·전문가·결재는 모두 가상입니다. 실제 데이터는 표시되지
        않고, 문자·이메일도 발송되지 않습니다.
      </span>
    </div>
  );
}
