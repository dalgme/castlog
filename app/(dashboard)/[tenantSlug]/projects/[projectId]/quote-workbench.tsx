"use client";

import { useState } from "react";

import { cn } from "@/lib/utils";
import type { LoadedCostSheet } from "@/lib/quotes/cost-load";

import { QuotePanel, type QuoteView } from "./quote-panel";
import { CostPanel } from "./cost-panel";

const DOC_TABS = [
  { key: "quote", label: "견적서" },
  { key: "internal", label: "내부실견적서" },
  { key: "settlement", label: "정산서" },
] as const;
type DocTab = (typeof DOC_TABS)[number]["key"];

/**
 * 견적·정산 탭 — 견적서 → 내부실견적서 → 정산서 순서로 이어지는 세 문서를
 * 한 자리에서 오간다 (기획 지시 2026-09-09).
 */
export function QuoteWorkbench({
  tenantSlug,
  projectId,
  quotes,
  costSheets,
  users,
  canEdit,
}: {
  tenantSlug: string;
  projectId: string;
  quotes: QuoteView[];
  costSheets: LoadedCostSheet[];
  users: { id: string; name: string }[];
  canEdit: boolean;
}) {
  const [doc, setDoc] = useState<DocTab>("quote");
  const latestQuoteVersion = quotes[0]?.version ?? null;

  const counts: Record<DocTab, number> = {
    quote: quotes.length,
    internal: costSheets.filter((s) => s.kind === "internal").length,
    settlement: costSheets.filter((s) => s.kind === "settlement").length,
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1 border-b" role="tablist" aria-label="견적·정산 문서">
        {DOC_TABS.map((t) => {
          const active = t.key === doc;
          return (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setDoc(t.key)}
              className={cn(
                "-mb-px rounded-t-md border px-3 py-1.5 text-xs transition-colors",
                active
                  ? "border-b-white bg-white font-semibold text-brand"
                  : "border-transparent bg-muted text-muted-foreground hover:text-foreground"
              )}
            >
              {t.label}
              <span className="ml-1 text-[10px] font-normal text-muted-foreground">{counts[t.key]}</span>
            </button>
          );
        })}
      </div>

      {doc === "quote" && (
        <QuotePanel tenantSlug={tenantSlug} projectId={projectId} quotes={quotes} canEdit={canEdit} />
      )}
      {doc !== "quote" && (
        <CostPanel
          projectId={projectId}
          kind={doc}
          sheets={costSheets}
          canEdit={canEdit}
          users={users}
          latestQuoteVersion={latestQuoteVersion}
        />
      )}
    </div>
  );
}
