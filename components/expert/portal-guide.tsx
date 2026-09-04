import { KeyRound, Smartphone, UserRoundCheck, UserRoundPlus } from "lucide-react";

import type { ExpertPortalGuide } from "@/lib/integrations/expert-portal-guide";

/**
 * 수락 직후 "다음은 포털" 안내 카드 — 상태별 문구 (lib/integrations/expert-portal-guide).
 * 공개 링크 화면(/e·/b)과 포털 밖 문맥에서 쓴다. 회사 이름 중심(§16) —
 * 캐스트로그는 '포털 제공자'로만 언급한다.
 */
export function PortalGuide({
  guide,
  tenantName,
  /** 지급용 키 전달을 포털에서 할 수 있음을 함께 알릴지 */
  mentionRewrap = false,
}: {
  guide: ExpertPortalGuide;
  tenantName: string | null;
  mentionRewrap?: boolean;
}) {
  const company = tenantName ?? "요청 기업";
  const missingLine =
    guide.missing.length > 0
      ? `지급·계약을 위해 ${guide.missing.join(" · ")} 등록이 필요합니다.`
      : "지급·계약에 필요한 정보가 모두 등록되어 있습니다.";

  const body = (() => {
    switch (guide.kind) {
      case "registered":
        return {
          icon: UserRoundCheck,
          title: "다음은 전문가 포털에서 진행됩니다",
          lines: [
            `${company}가 수락서를 보내면 문자로 안내됩니다. 수락서 확인·승인(서명)과 지급 정보는 전문가 포털(캐스트로그)에서 처리합니다.`,
            missingLine,
          ],
          cta: "전문가 포털로 이동",
        };
      case "claim_prefilled":
        return {
          icon: UserRoundPlus,
          title: `${company}가 등록해 둔 정보가 있습니다`,
          lines: [
            `${company}가 전문가님의 ${[
              guide.prefilled.length > 0 ? guide.prefilled.join("·") : null,
              guide.documentCount > 0 ? `서류 ${guide.documentCount}건` : null,
            ]
              .filter(Boolean)
              .join("과 ")}을(를) 미리 등록해 두었습니다.`,
            `휴대폰 ${guide.phoneMasked ?? "등록된 번호"}로 인증하면 그 정보를 그대로 이어받아 확인·수정할 수 있습니다 (별도 가입 절차 없음, 1분).`,
            missingLine,
          ],
          cta: "휴대폰 인증으로 내 정보 확인",
        };
      case "claim_minimal":
        return {
          icon: Smartphone,
          title: "전문가 포털 등록이 아직 없습니다",
          lines: [
            `수락서 확인·승인(서명)과 지급은 전문가 포털(캐스트로그)에서 진행됩니다. 휴대폰 ${guide.phoneMasked ?? "등록된 번호"}로 인증하면 바로 등록됩니다 (1분, 비밀번호 없음).`,
            missingLine,
          ],
          cta: "휴대폰 인증으로 등록하기",
        };
      case "no_phone":
        return {
          icon: Smartphone,
          title: "휴대폰 번호가 등록되어 있지 않습니다",
          lines: [
            `전문가 포털은 휴대폰 인증으로 로그인합니다. ${company} 담당자에게 휴대폰 번호 등록을 요청해 주세요. 등록되면 수락서 안내 문자를 받을 수 있습니다.`,
          ],
          cta: null,
        };
    }
  })();

  const Icon = body.icon;

  return (
    <div className="space-y-2 rounded-lg border border-brand/30 bg-brand/[0.04] p-3">
      <p className="flex items-center gap-1.5 text-sm font-semibold text-brand-navy">
        <Icon className="h-4 w-4 text-brand" aria-hidden />
        {body.title}
      </p>
      {body.lines.map((line, i) => (
        <p key={i} className="text-xs leading-relaxed text-muted-foreground">
          {line}
        </p>
      ))}
      {mentionRewrap && guide.kind !== "no_phone" && (
        <p className="flex items-start gap-1.5 text-xs leading-relaxed text-muted-foreground">
          <KeyRound className="mt-0.5 h-3.5 w-3.5 flex-none text-brand" aria-hidden />
          지급명세서용 주민번호 키 전달(선택)도 포털의 수락서 화면에서 할 수 있습니다.
        </p>
      )}
      {body.cta && (
        <a
          href={guide.loginHref}
          className="inline-flex h-11 w-full items-center justify-center rounded-md bg-brand px-4 text-sm font-semibold text-white hover:bg-brand/90"
        >
          {body.cta}
        </a>
      )}
    </div>
  );
}
