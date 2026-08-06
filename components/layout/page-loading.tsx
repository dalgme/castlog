import { Skeleton } from "@/components/ui/skeleton";

/** 라우트 전환 중 표시되는 공통 로딩 스켈레톤 (헤더 + 카드 3개) */
export function PageLoading() {
  return (
    <div className="min-h-screen bg-secondary/50">
      <div className="flex h-14 items-center border-b bg-background px-5">
        <Skeleton className="h-5 w-40" />
      </div>
      <div className="space-y-4 p-5">
        <Skeleton className="h-24 w-full rounded-xl" />
        <Skeleton className="h-24 w-full rounded-xl" />
        <Skeleton className="h-24 w-full rounded-xl" />
      </div>
    </div>
  );
}
