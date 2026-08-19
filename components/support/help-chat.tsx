"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { usePathname } from "next/navigation";
import { MessageCircleQuestion, X, SendHorizontal } from "lucide-react";

import { LogoMark } from "@/components/brand/logo";
import { askHelpBot } from "@/lib/ai/help-actions";
import { HELP_GREETING, HELP_SUGGESTIONS } from "@/lib/ai/help-copy";

import { BotAvatar } from "./bot-avatar";

type Turn = { role: "user" | "assistant"; content: string };

/**
 * 사용법 도우미 — 화면 오른쪽 아래에 떠 있는 상담 위젯.
 *
 * 왜 상시 노출인가: 이 제품에서 막히는 지점은 "이 버튼이 왜 안 눌리지",
 * "이건 어느 메뉴에서 하지"다. 그 순간 도움말을 찾아 다른 화면으로 나가면
 * 하던 일을 잃는다. 그래서 화면을 떠나지 않는 레이어로 둔다.
 *
 * 왜 오른쪽 아래인가: 상단 바에 두면 다른 버튼들과 섞여 '메뉴 중 하나'로
 * 읽힌다. 상담 창구는 화면 어디서 무엇을 하든 같은 자리에 있어야 눈에 익고,
 * 그 자리는 관례적으로 오른쪽 아래다. 본문 읽기를 가리지 않는 자리이기도 하다.
 *
 * 대화창 머리에는 **회사 로고**를 쓴다 — 직원이 매일 보는 창은 자기 회사의
 * 창이어야 한다. 로고가 없으면 캐스트로그 심볼로 돌아간다.
 */
export function HelpChat({
  tenantName,
  logoSrc,
}: {
  tenantName: string | null;
  logoSrc: string | null;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const endRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (open) {
      endRef.current?.scrollIntoView({ block: "end" });
      inputRef.current?.focus();
    }
  }, [open, turns, pending]);

  function send(text: string) {
    const question = text.trim();
    if (!question || pending) return;
    setError(null);
    const next: Turn[] = [...turns, { role: "user", content: question }];
    setTurns(next);
    setDraft("");
    startTransition(async () => {
      const res = await askHelpBot({ messages: next, path: pathname });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setTurns((prev) => [...prev, { role: "assistant", content: res.text }]);
    });
  }

  return (
    <>
      {/* 떠 있는 버튼 — 열려 있을 때는 숨긴다. 창 바로 뒤에 같은 버튼이 겹쳐
          보이면 무엇을 눌러야 닫히는지 헷갈린다 */}
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-expanded={false}
          aria-label="사용법 도우미 열기"
          title="사용법 도우미 — 지금 화면에서 무엇을 하면 되는지 물어보세요"
          className="fixed bottom-5 right-5 z-40 inline-flex items-center gap-2 rounded-full bg-brand-navy py-2.5 pl-2.5 pr-4 text-sm font-semibold text-white shadow-lg transition-transform hover:scale-105 sm:bottom-6 sm:right-6"
        >
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white">
            <BotAvatar size={22} />
          </span>
          <span className="hidden sm:inline">도움말</span>
          <MessageCircleQuestion className="h-4 w-4 sm:hidden" aria-hidden />
        </button>
      )}

      {open && (
        <div
          role="dialog"
          aria-label="사용법 도우미"
          className="fixed bottom-5 right-5 z-40 flex h-[min(38rem,calc(100vh-3rem))] w-[min(28rem,calc(100vw-2.5rem))] flex-col overflow-hidden rounded-2xl border bg-white shadow-2xl sm:bottom-6 sm:right-6"
        >
          {/* 머리 — 회사 로고 + 봇 */}
          <div className="flex items-center gap-2.5 border-b bg-brand-navy px-4 py-3 text-white">
            <span className="flex h-8 w-8 items-center justify-center rounded bg-white">
              {logoSrc ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={logoSrc}
                  alt={tenantName ?? "회사 로고"}
                  className="max-h-7 max-w-7 object-contain"
                />
              ) : (
                <LogoMark width={16} height={20} />
              )}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-bold">사용법 도우미</p>
              <p className="truncate text-[11px] text-white/70">
                {tenantName ?? "캐스트로그"} · 로그봇
              </p>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="도우미 닫기"
              className="rounded p-1 text-white/80 transition-colors hover:bg-white/10 hover:text-white"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* 대화 */}
          <div className="flex-1 space-y-3 overflow-y-auto bg-secondary/30 p-4">
            <div className="flex gap-2">
              <BotAvatar size={26} />
              <p className="max-w-[85%] rounded-lg rounded-tl-none border bg-white p-3 text-sm leading-relaxed">
                {HELP_GREETING}
              </p>
            </div>

            {turns.length === 0 && (
              <div className="flex flex-wrap gap-1.5 pl-8">
                {HELP_SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => send(s)}
                    disabled={pending}
                    className="rounded-full border bg-white px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:border-brand hover:text-brand"
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}

            {turns.map((turn, i) =>
              turn.role === "user" ? (
                <div key={i} className="flex justify-end">
                  <p className="max-w-[85%] whitespace-pre-wrap rounded-lg rounded-tr-none bg-brand p-3 text-sm leading-relaxed text-white">
                    {turn.content}
                  </p>
                </div>
              ) : (
                <div key={i} className="flex gap-2">
                  <BotAvatar size={26} />
                  <p className="max-w-[85%] whitespace-pre-wrap rounded-lg rounded-tl-none border bg-white p-3 text-sm leading-relaxed">
                    {turn.content}
                  </p>
                </div>
              )
            )}

            {pending && (
              <div className="flex gap-2">
                <BotAvatar size={26} />
                <p className="rounded-lg rounded-tl-none border bg-white p-3 text-sm text-muted-foreground">
                  답을 찾는 중…
                </p>
              </div>
            )}

            {error && (
              <p className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
                {error}
              </p>
            )}
            <div ref={endRef} />
          </div>

          {/* 입력 */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              send(draft);
            }}
            className="flex items-center gap-2 border-t p-3"
          >
            <input
              ref={inputRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              maxLength={1000}
              placeholder="예: 수락서는 어디서 보내나요?"
              className="h-10 min-w-0 flex-1 rounded-md border border-input px-3 text-sm outline-none focus:border-brand"
            />
            <button
              type="submit"
              disabled={pending || !draft.trim()}
              aria-label="보내기"
              className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-brand text-white transition-opacity disabled:opacity-40"
            >
              <SendHorizontal className="h-4 w-4" />
            </button>
          </form>
          <p className="border-t bg-white px-4 py-2 text-[11px] leading-snug text-muted-foreground">
            사용법 안내만 합니다. 실제 프로젝트·전문가·금액은 조회하지 못하며,
            결재·지급 판단의 근거로 쓸 수 없습니다.
          </p>
        </div>
      )}
    </>
  );
}
