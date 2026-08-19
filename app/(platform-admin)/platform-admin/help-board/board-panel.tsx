"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Bug, Lightbulb, HelpCircle, Building2, MapPin } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/layout/empty-state";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";

import { updateHelpFeedback } from "./actions";
import {
  FEEDBACK_STATUSES,
  FEEDBACK_STATUS_LABELS,
  type BoardRow,
  type FeedbackStatus,
} from "./constants";

const TABS = [
  {
    key: "requests" as const,
    label: "건의 / 요청",
    hint: "불편하다·안 된다·이렇게 해 달라 — 제품을 고칠 일감",
  },
  {
    key: "faq" as const,
    label: "FAQ",
    hint: "어디서 하는지 모르겠다·버튼을 못 찾겠다 — 화면이 설명을 못 한 자리",
  },
];

const KIND_META: Record<
  BoardRow["kind"],
  { label: string; icon: typeof Bug; className: string }
> = {
  bug: {
    label: "오류",
    icon: Bug,
    className: "bg-destructive/10 text-destructive",
  },
  suggestion: {
    label: "개선 요청",
    icon: Lightbulb,
    className: "bg-amber-100 text-amber-900",
  },
  confusion: {
    label: "이해 실패",
    icon: HelpCircle,
    className: "bg-brand/10 text-brand",
  },
};

/**
 * 챗봇 상담게시판.
 *
 * 두 탭으로 나누는 이유는 대응하는 사람이 다르기 때문이다.
 * 건의/요청은 **만들 것**이고, FAQ는 **이미 있는데 못 찾는 것**이다.
 * 후자는 기능을 더 만들 게 아니라 그 화면의 문구·위치를 고쳐야 한다는 신호다.
 * 그래서 FAQ 항목에는 어느 화면에서 나왔는지(path)를 크게 붙인다.
 */
export function HelpBoardPanel({ rows }: { rows: BoardRow[] }) {
  const router = useRouter();
  const [tab, setTab] = useState<"requests" | "faq">("requests");
  const [showDone, setShowDone] = useState(false);
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();

  const filtered = useMemo(() => {
    const byTab = rows.filter((r) =>
      tab === "faq" ? r.kind === "confusion" : r.kind !== "confusion"
    );
    return showDone
      ? byTab
      : byTab.filter((r) => r.status !== "done" && r.status !== "dismissed");
  }, [rows, tab, showDone]);

  // FAQ는 '어느 화면에서 몇 번 막혔는가'가 핵심이라 화면별로 묶어 센다
  const pathCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of rows) {
      if (row.kind !== "confusion" || !row.path) continue;
      map.set(row.path, (map.get(row.path) ?? 0) + 1);
    }
    return Array.from(map, ([path, count]) => ({ path, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 6);
  }, [rows]);

  function save(id: string, patch: { status?: FeedbackStatus; adminNote?: string }) {
    startTransition(async () => {
      const res = await updateHelpFeedback({ id, ...patch });
      if (!res.ok) {
        toast({ variant: "destructive", description: res.error });
        return;
      }
      router.refresh();
    });
  }

  const counts = {
    requests: rows.filter(
      (r) => r.kind !== "confusion" && r.status !== "done" && r.status !== "dismissed"
    ).length,
    faq: rows.filter(
      (r) => r.kind === "confusion" && r.status !== "done" && r.status !== "dismissed"
    ).length,
  };

  return (
    <div className="space-y-4">
      <nav className="flex flex-wrap gap-1 border-b">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            aria-current={tab === t.key ? "page" : undefined}
            className={cn(
              "-mb-px flex items-center gap-1.5 rounded-t-md border border-b-0 px-4 py-2 text-sm font-medium transition-colors",
              tab === t.key
                ? "border-border bg-white text-brand"
                : "border-transparent text-muted-foreground hover:text-brand"
            )}
          >
            {t.label}
            {counts[t.key] > 0 && (
              <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">
                {counts[t.key]}
              </Badge>
            )}
          </button>
        ))}
      </nav>

      <p className="text-xs text-muted-foreground">
        {TABS.find((t) => t.key === tab)?.hint}
      </p>

      {tab === "faq" && pathCounts.length > 0 && (
        <Card>
          <CardContent className="pt-5">
            <p className="text-sm font-semibold">막힌 화면 순위</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              같은 화면에서 반복해서 물어본다면, 그 화면이 설명을 못 하고 있는
              것입니다.
            </p>
            <ul className="mt-2 space-y-1.5">
              {pathCounts.map((p) => (
                <li key={p.path} className="flex items-center gap-2 text-sm">
                  <MapPin className="h-3.5 w-3.5 shrink-0 text-brand" aria-hidden />
                  <code className="min-w-0 flex-1 truncate text-xs">{p.path}</code>
                  <span className="shrink-0 rounded bg-secondary px-1.5 py-0.5 text-xs font-semibold">
                    {p.count}건
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <label className="flex items-center gap-2 text-xs text-muted-foreground">
        <input
          type="checkbox"
          checked={showDone}
          onChange={(e) => setShowDone(e.target.checked)}
        />
        처리 완료·보류 건도 보기
      </label>

      {filtered.length === 0 ? (
        <EmptyState
          title="쌓인 상담이 없습니다"
          description="사용자가 챗봇에 불편·오류·개선 의견을 말하면 여기에 자동으로 정리됩니다."
        />
      ) : (
        <ul className="space-y-2">
          {filtered.map((row) => {
            const meta = KIND_META[row.kind];
            const Icon = meta.icon;
            return (
              <li key={row.id} className="rounded-lg border bg-white p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={cn(
                      "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-semibold",
                      meta.className
                    )}
                  >
                    <Icon className="h-3 w-3" aria-hidden />
                    {meta.label}
                  </span>
                  <p className="min-w-0 flex-1 truncate text-sm font-semibold">
                    {row.title}
                  </p>
                  <Badge
                    variant={row.status === "new" ? "default" : "secondary"}
                    className="shrink-0"
                  >
                    {FEEDBACK_STATUS_LABELS[row.status]}
                  </Badge>
                </div>

                <p className="mt-1.5 whitespace-pre-wrap text-sm leading-relaxed">
                  {row.summary}
                </p>

                <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                  <span className="inline-flex items-center gap-1">
                    <Building2 className="h-3 w-3" aria-hidden />
                    {row.tenantName ?? "(회사 미상)"}
                  </span>
                  {row.path && (
                    <span className="inline-flex items-center gap-1">
                      <MapPin className="h-3 w-3" aria-hidden />
                      <code>{row.path}</code>
                    </span>
                  )}
                  <span>{new Date(row.createdAt).toLocaleString("ko-KR")}</span>
                </div>

                <details className="mt-2">
                  <summary className="cursor-pointer text-xs text-muted-foreground">
                    처리 상태 · 메모
                  </summary>
                  <div className="mt-2 space-y-2">
                    <div className="flex flex-wrap gap-1">
                      {FEEDBACK_STATUSES.map((s) => (
                        <Button
                          key={s}
                          size="sm"
                          variant={row.status === s ? "default" : "outline"}
                          disabled={pending}
                          onClick={() => save(row.id, { status: s })}
                        >
                          {FEEDBACK_STATUS_LABELS[s]}
                        </Button>
                      ))}
                    </div>
                    <Textarea
                      defaultValue={row.adminNote ?? ""}
                      rows={2}
                      maxLength={2000}
                      disabled={pending}
                      placeholder="처리 메모 (내부 기록) — 포커스를 벗어나면 저장됩니다."
                      onBlur={(e) => {
                        if (e.target.value !== (row.adminNote ?? "")) {
                          save(row.id, { adminNote: e.target.value });
                        }
                      }}
                      className="text-sm"
                    />
                  </div>
                </details>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
