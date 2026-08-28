"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

import { setExpertsLite } from "./module-actions";

/**
 * 전문가 섭외 라이트 모드 설정 (기획 확정 2026-08-25).
 *
 * 기업이 스스로 켜고 끈다 — 기능 축소라 캐스트로그 승인이 필요 없다.
 * 무엇이 꺼지는지(발송·포털 흐름·지급)와 무엇이 그대로인지(현황·중복·순위·
 * 수동 완료·이력)를 켜기 전에 보여준다.
 */
export function LiteModePanel({ enabled }: { enabled: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const toggle = (next: boolean) => {
    const message = next
      ? "라이트 모드를 켭니다.\n\n전문가에게 나가는 발송(섭외요청 문자·이메일, 재안내, 수락서 송부)이 전부 중단되고, 비용·지급 메뉴가 닫힙니다. 섭외 확정은 전화 확인 후 '섭외 완료(수락서 생성)' 버튼으로 합니다.\n\n기존 데이터는 그대로 유지되며 언제든 다시 끌 수 있습니다."
      : "라이트 모드를 끕니다.\n\n섭외요청 발송·수락서 송부·비용·지급 기능이 다시 열립니다. 라이트 모드에서 기록한 섭외 현황은 그대로 이어지며, 회신 대기 중이던 기록 건의 기한은 지금부터 다시 연장됩니다(자동 만료 방지).";
    if (!window.confirm(message)) return;
    setError(null);
    startTransition(async () => {
      const r = await setExpertsLite(next);
      if (!r.ok) setError(r.error);
      else router.refresh();
    });
  };

  return (
    <div className="space-y-3">
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold">
            전문가 섭외 라이트 모드
            {enabled && (
              <span className="ml-2 rounded-full bg-brand px-2 py-0.5 text-[11px] font-bold text-white">
                사용 중
              </span>
            )}
          </p>
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
            보유 전문가 명단으로 섭외 현황·일정 중복·후보 순위만 관리하는 운영
            방식입니다. 전문가에게 나가는 발송(문자·이메일) 없이, 전화 확인 후
            수동으로 섭외를 확정합니다.
          </p>
        </div>
        <Button
          size="sm"
          variant={enabled ? "outline" : "default"}
          disabled={pending}
          onClick={() => toggle(!enabled)}
        >
          {pending ? "저장 중..." : enabled ? "라이트 모드 끄기" : "라이트 모드 켜기"}
        </Button>
      </div>
      <ul className="space-y-1 text-xs leading-relaxed text-muted-foreground">
        <li>
          · <b>그대로 쓰는 것</b> — 전문가 풀(일괄 등록 포함)·섭외 현황·일정
          중복 경고·후보 순위·즐겨찾기/VIP·평점/메모·섭외 이력, 수동 ‘섭외
          완료(수락서 생성)’.
        </li>
        <li>
          · <b>꺼지는 것</b> — 섭외요청 문자·이메일 발송, 재안내, 수락서 송부,
          비용·지급 메뉴.
        </li>
        <li>
          · <b>민감정보</b> — 주민등록번호 기능은 전문가 본인 인증(키 등록)이
          전제라 라이트 모드에서는 제공되지 않습니다. 회사가 올린 서류는 올린
          회사만 열람하며, 계좌 정보는 지급 단계가 없어 수집하지 않습니다.
        </li>
        <li>
          · 껐다 켜도 데이터는 지워지지 않고 그대로 이어집니다.
        </li>
      </ul>
    </div>
  );
}
