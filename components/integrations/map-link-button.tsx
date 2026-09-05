"use client";

import { MapPin, ExternalLink } from "lucide-react";

import { Button } from "@/components/ui/button";

/**
 * 수락서 '찾아오시는 길' — 기업이 등록한 지도 URL을 팝업 창으로 연다
 * (기획 지시 2026-09-05). 네이버·카카오 지도는 iframe 삽입을 막으므로
 * 화면 안 프레임이 아니라 별도 창으로 띄운다. 팝업이 차단되면 새 탭으로 간다.
 */
export function MapLinkButton({ url }: { url: string }) {
  let host: string | null = null;
  try {
    host = new URL(url).hostname;
  } catch {
    host = null;
  }

  const safe = /^https?:\/\/\S+$/i.test(url);

  function open() {
    if (!safe) return;
    // noopener가 들어가면 window.open은 항상 null을 돌려준다(명세) — 반환값으로
    // 차단 여부를 판정하면 팝업과 새 탭이 두 번 열린다 (리뷰 1). 한 번만 연다.
    // 팝업이 차단되면 브라우저가 새 탭으로 대신 연다.
    window.open(
      url,
      "_blank",
      "popup=yes,width=960,height=720,resizable=yes,scrollbars=yes,noopener,noreferrer"
    );
  }

  if (!safe) return null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button type="button" size="sm" variant="outline" onClick={open}>
        <MapPin className="mr-1 h-4 w-4" aria-hidden />
        찾아오시는 길
        <ExternalLink className="ml-1 h-3 w-3 opacity-60" aria-hidden />
      </Button>
      {host && (
        <span className="text-xs text-muted-foreground print:hidden">{host}</span>
      )}
      {/* 인쇄본에는 버튼이 소용없다 — 주소 자체를 찍는다 */}
      <span className="hidden break-all text-xs text-muted-foreground print:inline">
        {url}
      </span>
    </div>
  );
}
