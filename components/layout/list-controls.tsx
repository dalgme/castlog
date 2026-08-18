import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { withParams } from "@/lib/ui/paging";
import { Button } from "@/components/ui/button";

/**
 * 목록 공통 컨트롤 — 검색 폼과 페이지 이동.
 *
 * 서버 컴포넌트로 둔다. 검색은 GET 폼이라 URL에 남고, 새로고침·공유·뒤로가기가
 * 그대로 동작한다. 클라이언트 상태로 만들면 그게 전부 깨진다.
 */

export function SearchForm({
  action,
  name = "q",
  defaultValue,
  placeholder,
  hidden,
}: {
  action: string;
  name?: string;
  defaultValue?: string;
  placeholder: string;
  /** 검색 시 유지해야 할 다른 필터들 */
  hidden?: Record<string, string | undefined>;
}) {
  return (
    <form action={action} method="get" className="flex gap-2">
      {Object.entries(hidden ?? {}).map(([key, value]) =>
        value ? <input key={key} type="hidden" name={key} value={value} /> : null
      )}
      <input
        type="search"
        name={name}
        defaultValue={defaultValue}
        placeholder={placeholder}
        className="h-9 w-full max-w-xs rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
      <Button type="submit" size="sm" variant="outline">
        검색
      </Button>
      {defaultValue && (
        <Button asChild size="sm" variant="ghost">
          <Link href={withParams(action, hidden ?? {}, { [name]: undefined })}>
            초기화
          </Link>
        </Button>
      )}
    </form>
  );
}

export function Pagination({
  basePath,
  params,
  page,
  pageCount,
  totalCount,
  unitLabel = "건",
}: {
  basePath: string;
  params: Record<string, string | undefined>;
  page: number;
  pageCount: number;
  totalCount: number | null;
  unitLabel?: string;
}) {
  if (pageCount <= 1) {
    return totalCount === null ? null : (
      <p className="text-xs text-muted-foreground">
        전체 {totalCount.toLocaleString("ko-KR")}
        {unitLabel}
      </p>
    );
  }

  const prev = page > 1 ? String(page - 1) : undefined;
  const next = page < pageCount ? String(page + 1) : undefined;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <p className="text-xs text-muted-foreground">
        전체 {(totalCount ?? 0).toLocaleString("ko-KR")}
        {unitLabel} · {page}/{pageCount} 쪽
      </p>
      <div className="ml-auto flex gap-1">
        <Button asChild={Boolean(prev)} size="sm" variant="outline" disabled={!prev}>
          {prev ? (
            <Link href={withParams(basePath, params, { page: prev })}>
              <ChevronLeft className="h-3.5 w-3.5" />
              이전
            </Link>
          ) : (
            <span>
              <ChevronLeft className="h-3.5 w-3.5" />
              이전
            </span>
          )}
        </Button>
        <Button asChild={Boolean(next)} size="sm" variant="outline" disabled={!next}>
          {next ? (
            <Link href={withParams(basePath, params, { page: next })}>
              다음
              <ChevronRight className="h-3.5 w-3.5" />
            </Link>
          ) : (
            <span>
              다음
              <ChevronRight className="h-3.5 w-3.5" />
            </span>
          )}
        </Button>
      </div>
    </div>
  );
}
