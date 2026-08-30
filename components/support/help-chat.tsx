"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { usePathname } from "next/navigation";
import { MessageCircleQuestion, X, SendHorizontal } from "lucide-react";

import { LogoMark } from "@/components/brand/logo";
import { askHelpBot } from "@/lib/ai/help-actions";
import {
  HELP_DISCLAIMER,
  HELP_GREETING,
  HELP_INPUT_PLACEHOLDER,
  HELP_SUGGESTIONS,
} from "@/lib/ai/help-copy";

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
  testSupport = false,
}: {
  tenantName: string | null;
  logoSrc: string | null;
  /** 실시간 모니터링 창이 열림 — 테스트 지원 모드 배지·안내 */
  testSupport?: boolean;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const endRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  /**
   * 버튼의 아래쪽 여백(px) — 위아래로 끌어 옮길 수 있다.
   *
   * 오른쪽 아래는 관례적인 자리지만, 화면에 따라 그 자리에 표·합계·저장 버튼이
   * 오기도 한다. 그럴 때 버튼을 옮기지 못하면 도우미가 일을 가린다. 좌우로는
   * 움직이지 않는다 — 좌우까지 열면 사용자가 버튼을 화면 구석에 흘려 두고
   * 다시 찾지 못한다.
   *
   * 위치는 이 컴포넌트의 상태로만 갖는다. localStorage는 쓰지 않는다
   * (CLAUDE.md §11-7). 셸에 얹혀 있어 화면을 옮겨 다녀도 유지된다.
   */
  const [bottom, setBottom] = useState(24);
  const dragRef = useRef<{ startY: number; startBottom: number; moved: boolean } | null>(
    null
  );

  function onPointerDown(e: React.PointerEvent<HTMLButtonElement>) {
    dragRef.current = { startY: e.clientY, startBottom: bottom, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: React.PointerEvent<HTMLButtonElement>) {
    const drag = dragRef.current;
    if (!drag) return;
    const delta = drag.startY - e.clientY;
    // 손이 살짝 흔들린 것까지 이동으로 치면 버튼이 안 눌린다
    if (Math.abs(delta) > 4) drag.moved = true;
    if (!drag.moved) return;
    const max = Math.max(24, window.innerHeight - 96);
    setBottom(Math.min(max, Math.max(12, drag.startBottom + delta)));
  }

  function onPointerUp(e: React.PointerEvent<HTMLButtonElement>) {
    const drag = dragRef.current;
    dragRef.current = null;
    e.currentTarget.releasePointerCapture(e.pointerId);
    // 끌어 옮긴 동작이면 창을 열지 않는다 — 옮길 때마다 창이 뜨면 성가시다
    if (!drag?.moved) setOpen(true);
  }

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
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onKeyDown={(e) => {
            // 키보드 사용자도 옮길 수 있어야 한다
            if (e.key === "ArrowUp") setBottom((v) => Math.min(window.innerHeight - 96, v + 24));
            if (e.key === "ArrowDown") setBottom((v) => Math.max(12, v - 24));
          }}
          aria-expanded={false}
          aria-label="챗봇 열기 (위아래 화살표로 위치 이동)"
          title="챗봇 — 사용법을 묻거나 불편한 점을 알려 주세요. 끌어서 위아래로 옮길 수 있습니다"
          style={{ bottom }}
          className="fixed right-5 z-40 inline-flex touch-none items-center gap-2 rounded-full bg-coral py-2.5 pl-2.5 pr-4 text-sm font-semibold text-white shadow-lg transition-colors hover:bg-coral-dark sm:right-6"
        >
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white">
            <BotAvatar size={22} />
          </span>
          <span className="hidden sm:inline">챗봇</span>
          <MessageCircleQuestion className="h-4 w-4 sm:hidden" aria-hidden />
        </button>
      )}

      {open && (
        <div
          role="dialog"
          aria-label="사용법 안내 · 개선 요청 도우미"
          style={{ bottom }}
          className="fixed right-5 z-40 flex h-[min(38rem,calc(100vh-3rem))] max-h-[calc(100vh-3rem)] w-[min(28rem,calc(100vw-2.5rem))] flex-col overflow-hidden rounded-2xl border bg-white shadow-2xl sm:right-6"
        >
          {/* 머리 — 회사 로고 + 봇 */}
          <div className="flex items-center gap-2.5 border-b bg-coral px-4 py-3 text-white">
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
              <p className="truncate text-sm font-bold">사용법 안내 · 개선 요청</p>
              <p className="truncate text-[11px] text-white/70">
                {tenantName ?? "캐스트로그"} · 로그봇
                {testSupport && " · 테스트 지원 중"}
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
                {testSupport && (
                  <span className="mt-2 block rounded-md bg-secondary px-2 py-1.5 text-xs text-muted-foreground">
                    지금 사용자 테스트를 캐스트로그가 실시간으로 지원하고
                    있습니다. 오류나 이상한 동작을 보시면 화면과 상황을 그대로
                    적어 주세요 — 즉시 전달됩니다.
                  </span>
                )}
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
              placeholder={HELP_INPUT_PLACEHOLDER}
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
            {HELP_DISCLAIMER}
          </p>
        </div>
      )}
    </>
  );
}
