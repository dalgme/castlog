import Link from "next/link";
import { ShieldAlert, ArrowRight } from "lucide-react";

/**
 * 최초 설정 미완료 띠 — 남은 필수 항목이 있는 동안 계속 보인다.
 *
 * 닫기 버튼을 두지 않는다. 닫히는 안내는 결국 닫히고, 설정은 끝내 안 된다.
 * 항목을 실제로 끝내야 사라진다 — 그게 "강하게 안내"의 정직한 형태다.
 */
export function SetupBanner({
  tenantSlug,
  requiredRemaining,
  recommendedRemaining,
}: {
  tenantSlug: string;
  requiredRemaining: number;
  recommendedRemaining: number;
}) {
  if (requiredRemaining === 0 && recommendedRemaining === 0) return null;
  const urgent = requiredRemaining > 0;

  return (
    <div
      className={
        "flex flex-wrap items-center gap-2 border-b px-4 py-2.5 text-sm " +
        (urgent
          ? "border-amber-300 bg-amber-50 text-amber-900"
          : "border-border bg-secondary/70 text-muted-foreground")
      }
    >
      <ShieldAlert className="h-4 w-4 flex-none" aria-hidden />
      {urgent ? (
        <span>
          <b>최초 설정 {requiredRemaining}건이 남아 있습니다.</b> 마치기 전에는 문자
          발송·결재 상신 같은 핵심 업무가 막히거나 법적 의무가 채워지지 않은 상태로
          운영됩니다.
        </span>
      ) : (
        <span>
          권장 설정 {recommendedRemaining}건이 남아 있습니다. 실무에서 곧 필요해지는
          항목입니다.
        </span>
      )}
      <Link
        href={`/${tenantSlug}/setup`}
        className="ml-auto inline-flex items-center gap-1 font-semibold underline underline-offset-2"
      >
        설정 계속하기
        <ArrowRight className="h-3.5 w-3.5" aria-hidden />
      </Link>
    </div>
  );
}
