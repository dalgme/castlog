import { LogoMark, Wordmark } from "@/components/brand/logo";
import { cn } from "@/lib/utils";

/**
 * 회사 브랜드 표시 (화이트라벨 — CLAUDE.md §16).
 *
 * 전문가가 보는 화면의 머리에는 그 회사의 이름과 로고가 온다. 캐스트로그는
 * 뒤로 물러난다 — 전문가는 '캐스트로그'가 아니라 '그 회사'와 일하기 때문이다.
 * 로고를 등록하지 않은 회사에서는 캐스트로그 심볼로 돌아간다.
 */
export function TenantBrand({
  name,
  logoSrc,
  size = "md",
  className,
}: {
  name: string | null;
  logoSrc: string | null;
  size?: "sm" | "md";
  className?: string;
}) {
  const box = size === "sm" ? "h-7 w-7" : "h-10 w-10";
  const img = size === "sm" ? "max-h-6 max-w-6" : "max-h-9 max-w-9";
  const text = size === "sm" ? "text-sm" : "text-lg";

  if (!name && !logoSrc) {
    return (
      <div className={cn("flex items-center gap-2.5", className)}>
        <LogoMark width={size === "sm" ? 20 : 26} height={size === "sm" ? 25 : 32} />
        <Wordmark className={text} />
      </div>
    );
  }

  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      {logoSrc ? (
        <span
          className={cn(
            "flex shrink-0 items-center justify-center rounded-lg border bg-white",
            box
          )}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={logoSrc}
            alt={name ?? "회사 로고"}
            className={cn("object-contain", img)}
          />
        </span>
      ) : (
        <LogoMark width={size === "sm" ? 20 : 26} height={size === "sm" ? 25 : 32} />
      )}
      <span className={cn("font-bold text-brand-navy", text)}>{name}</span>
    </div>
  );
}

/**
 * 화면 아래 플랫폼 고지 — 브랜드는 회사가 쓰되, 이 서비스가 무엇 위에서
 * 도는지는 작게 밝힌다. 브랜딩과 법적·신뢰 고지는 다른 문제다.
 */
export function PoweredByCastlog({ className }: { className?: string }) {
  return (
    <p
      className={cn(
        "flex items-center justify-center gap-1 text-[11px] text-muted-foreground",
        className
      )}
    >
      <LogoMark width={10} height={12} />
      캐스트로그로 운영됩니다
    </p>
  );
}
