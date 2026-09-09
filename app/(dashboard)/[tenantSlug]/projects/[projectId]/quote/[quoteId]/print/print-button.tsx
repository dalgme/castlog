"use client";

import { Printer } from "lucide-react";

import { Button } from "@/components/ui/button";

/** 인쇄 창 열기 — 서버 컴포넌트에서는 window를 쓸 수 없다 */
export function PrintButton() {
  return (
    <Button type="button" size="sm" onClick={() => window.print()}>
      <Printer className="mr-1 h-4 w-4" aria-hidden /> 인쇄 / PDF 저장
    </Button>
  );
}
