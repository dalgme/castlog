"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  Inbox,
  XCircle,
  FileText,
  ShieldAlert,
  MailOpen,
  Bell,
  CheckCheck,
  type LucideIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Tag } from "@/components/expert/ui";
import { notificationMeta } from "@/lib/experts/notification-meta";
import type { ExpertNotification } from "@/lib/experts/notifications";

import { markNotificationRead, markAllNotificationsRead } from "./actions";

const ICONS: Record<string, LucideIcon> = {
  inbox: Inbox,
  "x-circle": XCircle,
  "file-text": FileText,
  "shield-alert": ShieldAlert,
  "mail-open": MailOpen,
  bell: Bell,
};

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return "방금 전";
  if (min < 60) return `${min}분 전`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}시간 전`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}일 전`;
  return new Date(iso).toLocaleDateString("ko-KR");
}

export function NotificationList({
  notifications,
}: {
  notifications: ExpertNotification[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [items, setItems] = useState(notifications);

  const unreadCount = items.filter((n) => !n.readAt).length;

  const open = (n: ExpertNotification) => {
    if (!n.readAt) {
      setItems((prev) =>
        prev.map((x) => (x.id === n.id ? { ...x, readAt: new Date().toISOString() } : x))
      );
      startTransition(async () => {
        await markNotificationRead(n.id);
        if (n.link) router.push(n.link);
        else router.refresh();
      });
    } else if (n.link) {
      router.push(n.link);
    }
  };

  const readAll = () => {
    const now = new Date().toISOString();
    setItems((prev) => prev.map((x) => (x.readAt ? x : { ...x, readAt: now })));
    startTransition(async () => {
      await markAllNotificationsRead();
      router.refresh();
    });
  };

  if (items.length === 0) {
    return (
      <div className="rounded-xl border bg-background p-8 text-center">
        <Bell className="mx-auto h-8 w-8 text-muted-foreground/50" aria-hidden />
        <p className="mt-3 text-sm font-medium text-brand-navy">받은 알림이 없습니다</p>
        <p className="mt-1 text-xs text-muted-foreground">
          섭외 요청·서류 요청·외부 발송 열람 등이 생기면 여기에서 모아 보여드려요.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          안 읽은 알림 <span className="font-bold text-brand-navy">{unreadCount}</span>건
        </p>
        {unreadCount > 0 && (
          <Button variant="ghost" size="sm" onClick={readAll} disabled={pending}>
            <CheckCheck className="mr-1 h-4 w-4" aria-hidden />
            모두 읽음
          </Button>
        )}
      </div>

      <ul className="space-y-2">
        {items.map((n) => {
          const meta = notificationMeta(n.category);
          const Icon = ICONS[meta.icon] ?? Bell;
          const isUnread = !n.readAt;
          return (
            <li key={n.id}>
              <button
                type="button"
                onClick={() => open(n)}
                className={
                  "flex w-full items-start gap-3 rounded-xl border p-3 text-left shadow-sm transition-colors " +
                  (isUnread
                    ? "border-brand/30 bg-brand/[0.04] hover:bg-brand/[0.07]"
                    : "bg-background hover:bg-muted")
                }
              >
                <span
                  className={
                    "mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full " +
                    (isUnread ? "bg-brand/10 text-brand" : "bg-muted text-muted-foreground")
                  }
                >
                  <Icon className="h-4 w-4" aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Tag tone={meta.tone}>{meta.label}</Tag>
                    {n.tenantName && (
                      <span className="text-xs text-muted-foreground">{n.tenantName}</span>
                    )}
                    {isUnread && (
                      <span className="h-1.5 w-1.5 rounded-full bg-brand" aria-label="안 읽음" />
                    )}
                    <span className="ml-auto text-[11px] text-muted-foreground">
                      {timeAgo(n.createdAt)}
                    </span>
                  </div>
                  <p
                    className={
                      "mt-1 text-sm " +
                      (isUnread ? "font-semibold text-brand-navy" : "text-brand-navy")
                    }
                  >
                    {n.title}
                  </p>
                  {n.body && (
                    <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{n.body}</p>
                  )}
                </div>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
