import { Download, ShieldCheck } from "lucide-react";

import { resolveExternalSend, markSendOpened } from "@/lib/experts/external-send";
import { LogoMark, Wordmark } from "@/components/brand/logo";

export const metadata = { title: "서류 다운로드" };

/**
 * 외부 송신 다운로드 페이지 (공개 — 수신자용).
 * 전문가가 보낸 서류를 만료 전까지 다운로드. 각 다운로드는 만료 서명 URL 경유.
 */
export default async function ExternalSendPage({
  params,
}: {
  params: { token: string };
}) {
  const send = await resolveExternalSend(params.token);

  if (!send) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-secondary/50 px-4 text-center">
        <LogoMark width={28} height={35} />
        <h1 className="mt-4 text-lg font-bold text-brand-navy">
          유효하지 않은 링크입니다
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          링크가 만료되었거나 발신자가 회수했습니다. 발신자에게 재발송을 요청해
          주세요.
        </p>
      </div>
    );
  }

  await markSendOpened(send.id);

  return (
    <div className="min-h-screen bg-secondary/50">
      <header className="flex h-14 items-center gap-2 border-b bg-background px-5">
        <LogoMark width={22} height={27} />
        <Wordmark className="text-base" />
      </header>
      <main className="mx-auto max-w-lg space-y-4 p-5">
        <div>
          <h1 className="text-xl font-bold text-brand-navy">
            {send.expertName} 전문가님이 보낸 서류
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {send.recipientName ? `${send.recipientName}님, ` : ""}
            아래 서류를 다운로드하세요.
            {send.eventName ? ` (${send.eventName})` : ""}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            만료: {new Date(send.expiresAt).toLocaleString("ko-KR")}
          </p>
        </div>

        <ul className="divide-y rounded-xl border bg-background">
          {send.items.map((it) => (
            <li
              key={it.id}
              className="flex items-center justify-between gap-3 px-4 py-3"
            >
              <span className="text-sm font-medium text-brand-navy">
                {it.label}
              </span>
              <a
                href={`/x/${params.token}/${it.id}`}
                className="inline-flex items-center gap-1.5 rounded-md bg-brand px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand/90"
              >
                <Download className="h-4 w-4" aria-hidden />
                다운로드
              </a>
            </li>
          ))}
        </ul>

        <p className="flex items-start gap-2 rounded-lg border bg-background p-3 text-xs text-muted-foreground">
          <ShieldCheck className="mt-0.5 h-4 w-4 flex-none text-brand" aria-hidden />
          이 링크는 만료 시각 이후 사용할 수 없으며, 발신자가 언제든 회수할 수
          있습니다. 다운로드한 서류는 안전하게 관리해 주세요.
        </p>
      </main>
    </div>
  );
}
