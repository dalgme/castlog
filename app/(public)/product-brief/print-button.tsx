"use client";

import { Printer } from "lucide-react";

/**
 * 인쇄(= PDF로 저장) 버튼.
 *
 * PDF를 서버에서 굽지 않는 이유: 그러려면 렌더링 엔진을 하나 더 얹어야 하는데,
 * 브라우저가 이미 그 일을 더 잘하고 글꼴 문제도 없다. 인쇄 대화상자에서
 * 'PDF로 저장'을 고르면 그대로 파일이 된다.
 */
export function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="inline-flex items-center gap-1.5 rounded-md border border-input px-3 py-1.5 text-sm font-medium text-brand-navy transition-colors hover:border-brand hover:text-brand"
    >
      <Printer className="h-4 w-4" aria-hidden />
      인쇄 · PDF로 저장
    </button>
  );
}
