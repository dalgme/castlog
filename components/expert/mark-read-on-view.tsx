"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

import { markNotificationsReadByCategory } from "@/app/(expert)/expert/notifications/actions";

/**
 * 알림함을 없앤 뒤, 각 탭을 열면 그 탭이 담당하는 카테고리의 알림을 읽음 처리해
 * 상단 탭 뱃지를 소진한다. 렌더링 side-effect가 아니라 마운트 effect에서 1회 호출.
 */
export function MarkReadOnView({ categories }: { categories: string[] }) {
  const router = useRouter();
  const done = useRef(false);

  useEffect(() => {
    if (done.current || categories.length === 0) return;
    done.current = true;
    void markNotificationsReadByCategory(categories).then((r) => {
      if (r.ok) router.refresh();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}
