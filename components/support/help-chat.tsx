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
 * 사용법 도우미 — 상단 오른쪽에서 항상 대기한다.
 *
 * 왜 상시 노출인가: 이 제품에서 막히는 지점은 "이 버튼이 왜 안 눌리지",
 * "이건 어느 메뉴에서 하지"다. 그 순간 도움말을 찾아 다른 화면으로 나가면
 * 하던 일을 잃는다. 그래서 화면을 떠나지 않는 패널로 둔다.
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
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label="사용법 도우미"
        title="사용법 도우미 — 지금 화면에서 무엇을 하면 되는지 물어보세요"
        className="inline-flex h-8 items-center gap-1.5 rounded-md border border-input px-2.5 text-xs font-medium text-brand-navy transition-colors hover:border-brand hover:text-brand"
      >
        <BotAvatar size={18} />
        <span className="hidden sm:inline">도움말</span>
        <MessageCircleQuestion className="h-3.5 w-3.5 sm:hidden" aria-hidden />
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="사용법 도우미"
          className="fixed right-3 top-14 z-50 flex h-[min(32rem,calc(100vh-4.5rem))] w-[min(24rem,calc(100vw-1.5rem))] flex-col overflow-hidden rounded-xl border bg-white shadow-2xl"
        >
          {/* 머리 — 회사 로고 + 봇 */}
          <div className="flex items-center gap-2 border-b bg-brand-navy px-3 py-2.5 text-white">
            <span className="flex h-7 w-7 items-center justify-center rounded bg-white">
              {logoSrc ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={logoSrc}
                  alt={tenantName ?? "회사 로고"}
                  className="max-h-6 max-w-6 object-contain"
                />
              ) : (
                <LogoMark width={14} height={17} />
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
              aria-label="닫기"
              className="rounded p-1 text-white/80 transition-colors hover:bg-white/10 hover:text-white"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* 대화 */}
          <div className="flex-1 space-y-3 overflow-y-auto bg-secondary/30 p-3">
            <div className="flex gap-2">
              <BotAvatar size={26} />
              <p className="max-w-[85%] rounded-lg rounded-tl-none border bg-white p-2.5 text-xs leading-relaxed">
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
                    className="rounded-full border bg-white px-2.5 py-1 text-[11px] text-muted-foreground transition-colors hover:border-brand hover:text-brand"
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}

            {turns.map((turn, i) =>
              turn.role === "user" ? (
                <div key={i} className="flex justify-end">
                  <p className="max-w-[85%] whitespace-pre-wrap rounded-lg rounded-tr-none bg-brand p-2.5 text-xs leading-relaxed text-white">
                    {turn.content}
                  </p>
                </div>
              ) : (
                <div key={i} className="flex gap-2">
                  <BotAvatar size={26} />
                  <p className="max-w-[85%] whitespace-pre-wrap rounded-lg rounded-tl-none border bg-white p-2.5 text-xs leading-relaxed">
                    {turn.content}
                  </p>
                </div>
              )
            )}

            {pending && (
              <div className="flex gap-2">
                <BotAvatar size={26} />
                <p className="rounded-lg rounded-tl-none border bg-white p-2.5 text-xs text-muted-foreground">
                  답을 찾는 중…
                </p>
              </div>
            )}

            {error && (
              <p className="rounded-lg border border-destructive/40 bg-destructive/5 p-2.5 text-xs text-destructive">
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
            className="flex items-center gap-1.5 border-t p-2"
          >
            <input
              ref={inputRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              maxLength={1000}
              placeholder="예: 수락서는 어디서 보내나요?"
              className="h-9 min-w-0 flex-1 rounded-md border border-input px-2.5 text-sm outline-none focus:border-brand"
            />
            <button
              type="submit"
              disabled={pending || !draft.trim()}
              aria-label="보내기"
              className="inline-flex h-9 w-9 items-center justify-center rounded-md bg-brand text-white transition-opacity disabled:opacity-40"
            >
              <SendHorizontal className="h-4 w-4" />
            </button>
          </form>
          <p className="border-t bg-white px-3 py-1.5 text-[11px] leading-snug text-muted-foreground">
            사용법 안내만 합니다. 실제 프로젝트·전문가·금액은 조회하지 못하며,
            결재·지급 판단의 근거로 쓸 수 없습니다.
          </p>
        </div>
      )}
    </>
  );
}
