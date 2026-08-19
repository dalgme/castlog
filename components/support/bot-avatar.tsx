import { cn } from "@/lib/utils";

/**
 * 로그봇 얼굴.
 *
 * 외부 이미지 파일을 쓰지 않고 SVG로 그린다 — 아바타 하나 때문에 이미지 호스팅
 * 경로를 열 이유가 없고, 색은 브랜드 토큰을 그대로 따라야 한다.
 * 캐스트로그 심볼(둥근 사각 + 앰버 포인트)의 인상을 이어 받은 얼굴이다.
 */
export function BotAvatar({
  className,
  size = 32,
}: {
  className?: string;
  size?: number;
}) {
  return (
    <svg
      className={cn("shrink-0", className)}
      width={size}
      height={size}
      viewBox="0 0 48 48"
      role="img"
      aria-label="로그봇"
    >
      {/* 머리 */}
      <rect x="6" y="12" width="36" height="28" rx="10" fill="#1A68F0" />
      {/* 안테나 */}
      <rect x="22.5" y="4" width="3" height="8" rx="1.5" fill="#0A55DA" />
      <circle cx="24" cy="4" r="3.2" fill="#F5A524" />
      {/* 눈 */}
      <circle cx="17" cy="25" r="3.4" fill="#FFFFFF" />
      <circle cx="31" cy="25" r="3.4" fill="#FFFFFF" />
      <circle cx="17.8" cy="25.6" r="1.5" fill="#0A2540" />
      <circle cx="31.8" cy="25.6" r="1.5" fill="#0A2540" />
      {/* 입 — 살짝 웃는 선 */}
      <path
        d="M18 32.5c2 1.8 10 1.8 12 0"
        stroke="#FFFFFF"
        strokeWidth="2"
        strokeLinecap="round"
        fill="none"
      />
      {/* 귀 */}
      <rect x="2.5" y="22" width="4" height="8" rx="2" fill="#7CB1FD" />
      <rect x="41.5" y="22" width="4" height="8" rx="2" fill="#7CB1FD" />
    </svg>
  );
}
