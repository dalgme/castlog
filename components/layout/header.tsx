import type { ReactNode } from "react";

/** 대시보드 공통 헤더 — 페이지 제목과 우측 액션 슬롯 */
export function PageHeader({
  title,
  actions,
}: {
  title: string;
  actions?: ReactNode;
}) {
  return (
    <header className="flex h-14 items-center justify-between border-b bg-background px-5">
      <h1 className="text-[15px] font-extrabold">{title}</h1>
      {actions && <div className="flex items-center gap-3">{actions}</div>}
    </header>
  );
}
