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

  function open() {
    const popup = window.open(
      url,
      "castlog-map",
      "popup=yes,width=960,height=720,resizable=yes,scrollbars=yes,noopener,noreferrer"
    );
    if (!popup) window.open(url, "_blank", "noopener,noreferrer");
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button type="button" size="sm" variant="outline" onClick={open}>
        <MapPin className="mr-1 h-4 w-4" aria-hidden />
        찾아오시는 길
        <ExternalLink className="ml-1 h-3 w-3 opacity-60" aria-hidden />
      </Button>
      {host && <span className="text-xs text-muted-foreground">{host}</span>}
    </div>
  );
}
