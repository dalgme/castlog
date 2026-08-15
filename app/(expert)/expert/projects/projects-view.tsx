"use client";

import { useMemo, useState } from "react";
import { Search } from "lucide-react";

import {
  Tag,
  ENGAGEMENT_TONE,
  ENGAGEMENT_STATUS_LABELS,
} from "@/components/expert/ui";
import { EmptyState } from "@/components/layout/empty-state";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export type ProjectGroupDTO = {
  key: string;
  projectName: string;
  tenantName: string;
  totalFee: number;
  latestAt: number;
  approvedAt: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  paidAt: string | null;
  engagements: {
    id: string;
    role: string;
    status: string;
    startsOn: string | null;
    endsOn: string | null;
    fee: number | null;
  }[];
};

const won = (v: number) => `${v.toLocaleString("ko-KR")}원`;
const fmt = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("ko-KR") : "-";

type SortKey = "recent" | "project" | "tenant" | "paid";

const SORTS: { key: SortKey; label: string }[] = [
  { key: "recent", label: "최근순" },
  { key: "project", label: "사업명" },
  { key: "tenant", label: "기관명" },
  { key: "paid", label: "지급일순" },
];

function DateChip({ label, value }: { label: string; value: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-secondary/70 px-2 py-1 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-semibold text-brand-navy">{value}</span>
    </span>
  );
}

export function ProjectsView({ groups }: { groups: ProjectGroupDTO[] }) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("recent");

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q
      ? groups.filter(
          (g) =>
            g.projectName.toLowerCase().includes(q) ||
            g.tenantName.toLowerCase().includes(q) ||
            g.engagements.some((e) => e.role.toLowerCase().includes(q))
        )
      : groups;

    const sorted = [...filtered];
    sorted.sort((a, b) => {
      if (sort === "project") return a.projectName.localeCompare(b.projectName, "ko");
      if (sort === "tenant") return a.tenantName.localeCompare(b.tenantName, "ko");
      if (sort === "paid") {
        const pa = a.paidAt ? new Date(a.paidAt).getTime() : 0;
        const pb = b.paidAt ? new Date(b.paidAt).getTime() : 0;
        return pb - pa;
      }
      return b.latestAt - a.latestAt;
    });
    return sorted;
  }, [groups, query, sort]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="사업·기관·역할 검색"
            className="pl-8"
          />
        </div>
        <Select value={sort} onValueChange={(v) => setSort(v as SortKey)}>
          <SelectTrigger className="w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SORTS.map((s) => (
              <SelectItem key={s.key} value={s.key}>
                {s.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {visible.length === 0 ? (
        <EmptyState
          title="결과가 없습니다"
          description="검색어를 바꾸거나 섭외를 수락하면 프로젝트가 표시됩니다."
        />
      ) : (
        visible.map((group) => (
          <Card key={group.key} className="shadow-sm">
            <CardHeader className="gap-2 pb-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-base font-bold text-brand-navy">
                  {group.projectName}
                </span>
                <Tag tone="gray">{group.tenantName}</Tag>
                {group.totalFee > 0 && (
                  <span className="ml-auto text-xs text-muted-foreground">
                    의뢰비용 합계{" "}
                    <span className="font-bold text-brand-navy">
                      {won(group.totalFee)}
                    </span>
                  </span>
                )}
              </div>
              <div className="flex flex-wrap gap-1.5">
                <DateChip label="섭외승인" value={fmt(group.approvedAt)} />
                <DateChip
                  label="참여기간"
                  value={
                    group.periodStart || group.periodEnd
                      ? `${group.periodStart ?? "?"} ~ ${group.periodEnd ?? "?"}`
                      : "-"
                  }
                />
                <DateChip label="지급일" value={fmt(group.paidAt)} />
              </div>
            </CardHeader>
            <CardContent>
              <ul className="divide-y">
                {group.engagements.map((e) => (
                  <li
                    key={e.id}
                    className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm"
                  >
                    <span className="font-medium text-brand-navy">{e.role}</span>
                    {(e.startsOn || e.endsOn) && (
                      <span className="text-xs text-muted-foreground">
                        {e.startsOn ?? "?"} ~ {e.endsOn ?? "?"}
                      </span>
                    )}
                    {e.fee != null && (
                      <span className="text-xs text-muted-foreground">{won(e.fee)}</span>
                    )}
                    <Tag className="ml-auto" tone={ENGAGEMENT_TONE[e.status] ?? "gray"}>
                      {ENGAGEMENT_STATUS_LABELS[e.status] ?? e.status}
                    </Tag>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
}
