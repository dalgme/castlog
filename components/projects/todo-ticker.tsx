import {
  PROJECT_STAGE_DESCRIPTIONS,
  PROJECT_STAGE_LABELS,
  type ProjectStage,
} from "@/lib/integrations/project-stage";

/**
 * 프로젝트별 '지금 할 일' 전광판 (기획 확정 2026-08-22).
 * 단계 색 컬러바 위로 할 일 문구가 흐른다 (순수 CSS — globals.css의
 * castlog-marquee 키프레임). 마우스를 올리면 멈춰서 읽을 수 있다.
 */
const STAGE_COLORS: Record<ProjectStage, string> = {
  assigning: "bg-sky-600",
  plan_review: "bg-amber-500",
  plan_approved: "bg-violet-600",
  requesting: "bg-orange-500",
  accepted_all: "bg-emerald-600",
  letters_sent: "bg-teal-600",
  confirmed: "bg-emerald-700",
  closing: "bg-indigo-600",
  settlement_review: "bg-amber-600",
  settled: "bg-slate-500",
};

export function ProjectTodoTicker({
  stage,
  size = "sm",
}: {
  stage: ProjectStage;
  /** sm = 목록 행 안 (기본) / lg = 프로젝트 현황 대시보드 상단 전광판 */
  size?: "sm" | "lg";
}) {
  const text = `지금 할 일 ▶ ${PROJECT_STAGE_LABELS[stage]} — ${PROJECT_STAGE_DESCRIPTIONS[stage]}`;
  const sizing =
    size === "lg"
      ? "h-8 rounded-md"
      : "mt-1.5 h-6 max-w-md rounded";
  const trackText = size === "lg" ? "text-[13px] leading-8" : "text-[11px] leading-6";
  return (
    <div
      className={`castlog-marquee w-full overflow-hidden ${sizing} ${STAGE_COLORS[stage]}`}
      title={text}
    >
      <div
        className={`castlog-marquee-track flex whitespace-nowrap font-medium text-white ${trackText}`}
      >
        {/* 두 벌을 이어 붙여 끊김 없는 루프를 만든다 */}
        <span className="pr-16">{text}</span>
        <span className="pr-16" aria-hidden>
          {text}
        </span>
      </div>
    </div>
  );
}
