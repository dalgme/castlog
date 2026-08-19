import { ShieldCheck, ArrowLeftRight } from "lucide-react";

import {
  enterPlatformAdminMode,
  exitPlatformAdminMode,
} from "@/lib/auth/platform-mode-actions";

/**
 * 관리모드 전환 버튼 — 넥스트랩 운영자만 보인다.
 *
 * form + 서버 액션이다. 링크로 두지 않는 이유: 권한이 바뀌는 동작을 GET으로
 * 만들면 링크를 눌러 주기만 해도(또는 프리페치만으로도) 모드가 바뀔 수 있다.
 */
export function PlatformModeButton({ mode }: { mode: "enter" | "exit" }) {
  const enter = mode === "enter";

  return (
    <form action={enter ? enterPlatformAdminMode : exitPlatformAdminMode}>
      <button
        type="submit"
        title={
          enter
            ? "캐스트로그 관리모드로 전환합니다 (테넌트·모듈 관리)"
            : "원래 회사 화면으로 돌아갑니다"
        }
        className={
          enter
            ? "inline-flex h-8 items-center gap-1.5 rounded-md border border-brand-navy bg-brand-navy px-3 text-xs font-semibold text-white transition-opacity hover:opacity-90"
            : "inline-flex h-8 items-center gap-1.5 rounded-md border border-input px-3 text-xs font-medium text-brand-navy transition-colors hover:border-brand hover:text-brand"
        }
      >
        {enter ? (
          <ShieldCheck className="h-3.5 w-3.5" aria-hidden />
        ) : (
          <ArrowLeftRight className="h-3.5 w-3.5" aria-hidden />
        )}
        {enter ? "관리자 모드" : "기업 모드로"}
      </button>
    </form>
  );
}
