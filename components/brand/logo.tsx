import { useId } from "react";

import { cn } from "@/lib/utils";

/**
 * CASTLOG 로고 심볼 (브랜드 가이드 v1.8 / Claude Design 핸드오프 기준)
 * 그라데이션 id 충돌을 피하기 위해 인스턴스별 useId를 사용한다.
 */
export function LogoMark({
  className,
  width = 26,
  height = 32,
}: {
  className?: string;
  width?: number;
  height?: number;
}) {
  const uid = useId().replace(/[:]/g, "");
  const body = `clgBody-${uid}`;
  const top = `clgTop-${uid}`;
  const amber = `clgAmber-${uid}`;

  return (
    <svg
      className={className}
      width={width}
      height={height}
      viewBox="-2 -2 104 127"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={body} x1="0.15" y1="0" x2="0.5" y2="1">
          <stop offset="0" stopColor="#1A68F0" />
          <stop offset="1" stopColor="#0A55DA" />
        </linearGradient>
        <linearGradient id={top} x1="0.2" y1="0" x2="0.7" y2="1">
          <stop offset="0" stopColor="#7CB1FD" />
          <stop offset="1" stopColor="#5A98FB" />
        </linearGradient>
        <linearGradient id={amber} x1="0" y1="0" x2="0.6" y2="1">
          <stop offset="0" stopColor="#FFBE1A" />
          <stop offset="1" stopColor="#F9AB00" />
        </linearGradient>
      </defs>
      <g strokeLinejoin="round" strokeWidth="4">
        <polygon
          points="51.5,0 0,33.2 0,89.8 51.5,123 51.5,94.1 25.2,76.3 25.2,46.7 51.5,29.5"
          fill={`url(#${body})`}
          stroke={`url(#${body})`}
        />
        <polygon
          points="25.2,46.7 0,59 0,86 19,92.3 41.7,116.9 51.5,123 51.5,94.1 25.2,76.3"
          fill="#0A429F"
          stroke="#0A429F"
          strokeWidth="1.5"
        />
        <polygon
          points="51.5,0 100,33.2 100,41.8 89,52.9 76.5,52.9 76.5,46.7 51.5,29.5"
          fill={`url(#${top})`}
          stroke={`url(#${top})`}
        />
        <polygon
          points="51.5,123 100,89.8 100,81.2 89,70.1 76.5,70.1 76.5,76.3 51.5,94.1"
          fill={`url(#${amber})`}
          stroke={`url(#${amber})`}
        />
      </g>
    </svg>
  );
}

/** CASTLOG 워드마크 — invert=true면 다크 배경용 */
export function Wordmark({
  className,
  invert = false,
}: {
  className?: string;
  invert?: boolean;
}) {
  return (
    <span
      className={cn(
        "font-semibold tracking-[0.11em]",
        invert ? "text-white" : "text-brand-navy",
        className
      )}
    >
      CAST
      <span className={invert ? "text-brand-sky" : "text-brand"}>L</span>
      <span className="text-brand-amber">O</span>
      <span className={invert ? "text-brand-sky" : "text-brand"}>G</span>
    </span>
  );
}
