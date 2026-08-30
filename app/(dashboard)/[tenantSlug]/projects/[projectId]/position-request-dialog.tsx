"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Crown, Search, Star, UserCheck } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatKrMobile } from "@/lib/auth/phone";
import { expertTagLabel } from "@/lib/integrations/expert-tags";

import {
  loadSlotPickerData,
  type SlotPickerExpert,
} from "./position-request-actions";
import { assignExpertsToSlot } from "./position-assign-actions";

/**
 * 전문가 탐색·배정 팝업 (전면 개편 2026-08-23).
 *
 * 전문가 메뉴와 같은 목록(검색·전체/연결됨·정렬·11개 정보 컬럼)을 그대로 띄우고,
 * 이름 앞 선택 체크로 **다중 선택 → 후보 등록**을 한 번에 한다.
 * 팝업은 세션에 귀속된다 — 선택 상한은 이 세션의 미배정 후보 자리 수.
 *
 * 배정은 아직 아무에게도 나가지 않는 내부 결정이다. 전문가에게 알리는 것은
 * 계획 품의 승인 뒤 '섭외 진행'에서 한 번에 한다.
 */

const LINK_STATUS_LABEL: Record<
  string,
  { label: string; variant: "default" | "secondary" | "destructive" | "outline" }
> = {
  active: { label: "연결됨", variant: "default" },
  pending: { label: "대기중", variant: "secondary" },
  revoked: { label: "해제됨", variant: "destructive" },
  none: { label: "미연결", variant: "outline" },
};

type SortKey = "name" | "region" | "rating";
/** 태그·평가 조건 필터 (기획 2026-08-30 — 26번): 버튼 클릭으로 해당 조건만 */
type TagFilter = "all" | "favorite" | "vip" | "rated";

export function PositionRequestDialog({
  positionId,
  code,
  currentExpertName,
  variant = "button",
}: {
  positionId: string;
  code: string;
  /** 이미 배정된 전문가가 있으면 이름 (바꿔 넣는 경우) */
  currentExpertName?: string | null;
  /** chip = 세션 표의 코드 조각 자리에 그대로 놓는 형태 */
  variant?: "button" | "chip";
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [slotLabel, setSlotLabel] = useState("");
  const [openCount, setOpenCount] = useState(0);
  const [experts, setExperts] = useState<SlotPickerExpert[] | null>(null);

  const [search, setSearch] = useState("");
  const [scope, setScope] = useState<"all" | "linked">("all");
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [tagFilter, setTagFilter] = useState<TagFilter>("all");
  const [regionFilter, setRegionFilter] = useState<string>("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  // 지역 필터 선택지 — 불러온 목록에서 건수 상위 12개 (전문가 목록과 동일 방식)
  const regionOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const e of experts ?? []) {
      if (!e.region) continue;
      counts.set(e.region, (counts.get(e.region) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12)
      .map(([name]) => name);
  }, [experts]);

  function load() {
    setError(null);
    startTransition(async () => {
      const result = await loadSlotPickerData(positionId);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setSlotLabel(result.slotLabel);
      setOpenCount(result.openCount);
      setExperts(result.experts);
    });
  }

  const rows = useMemo(() => {
    if (!experts) return [];
    const lowered = search.trim().toLowerCase();
    const digits = search.replace(/\D/g, "").replace(/^0/, "");
    let list = experts.filter((e) => {
      if (scope === "linked" && e.linkStatus !== "active") return false;
      // 조건 필터 (기획 26번): 즐겨찾기·VIP·자사평가 있음·지역
      if (tagFilter === "favorite" && e.tag !== "favorite") return false;
      if (tagFilter === "vip" && e.tag !== "vip") return false;
      if (tagFilter === "rated" && e.rating === null) return false;
      if (regionFilter && (e.region ?? "") !== regionFilter) return false;
      if (!lowered) return true;
      const haystack = [
        e.name,
        e.specialty ?? "",
        e.region ?? "",
        ...e.expertise,
        ...e.recruit,
      ]
        .join(" ")
        .toLowerCase();
      const phoneHit =
        digits.length >= 4 && e.phone.replace(/\D/g, "").includes(digits);
      return haystack.includes(lowered) || phoneHit;
    });
    list = [...list].sort((a, b) => {
      if (sortKey === "region") {
        return (
          (a.region ?? "힣힣").localeCompare(b.region ?? "힣힣", "ko") ||
          a.name.localeCompare(b.name, "ko")
        );
      }
      if (sortKey === "rating") {
        // 자사평가 높은 순 — 미평가는 뒤로
        return (
          (b.rating ?? -1) - (a.rating ?? -1) ||
          a.name.localeCompare(b.name, "ko")
        );
      }
      return a.name.localeCompare(b.name, "ko");
    });
    return list;
  }, [experts, search, scope, sortKey, tagFilter, regionFilter]);

  const capReached = selectedIds.length >= openCount;

  function toggle(expert: SlotPickerExpert) {
    // 미연결도 선택 가능 — 후보 등록 시 자사 관계가 자동 생성된다.
    // 해제(revoked)된 관계만 화면에서 막는다 (서버도 거부).
    if (expert.linkStatus === "revoked" || expert.alreadyInSlot) return;
    setSelectedIds((prev) =>
      prev.includes(expert.id)
        ? prev.filter((id) => id !== expert.id)
        : capReached
          ? prev
          : [...prev, expert.id]
    );
  }

  function submit() {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const result = await assignExpertsToSlot({
        positionId,
        expertIds: selectedIds,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      // 건너뛴 이유를 보여준다 — 건수만 보여주면 같은 선택을 반복한다 (검수 G)
      setNotice(
        `${result.assigned}명을 후보로 등록했습니다.` +
          (result.skipped.length > 0
            ? `\n건너뜀 ${result.skipped.length}건:\n${result.skipped.join("\n")}`
            : "")
      );
      setSelectedIds([]);
      router.refresh();
      // 건너뜀이 있으면 자동으로 닫지 않는다 — 이유를 읽어야 한다 (리뷰 5)
      if (result.skipped.length === 0) {
        setTimeout(() => setOpen(false), 900);
      }
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setSelectedIds([]);
          setNotice(null);
          load(); // 열 때마다 재조회 — 상한·후보 상태가 바뀌었을 수 있다
        }
      }}
    >
      <DialogTrigger asChild>
        {variant === "chip" ? (
          <button
            type="button"
            className="inline-flex items-center gap-1.5 rounded-md border border-dashed border-brand/50 bg-brand/[0.04] px-2 py-1 text-xs text-brand transition-colors hover:border-brand hover:bg-brand/10"
          >
            <span className="font-mono font-semibold">{code}</span>
            <Search className="h-3 w-3" aria-hidden />
            {currentExpertName ? `${currentExpertName} · 변경` : "전문가 탐색 · 배정"}
          </button>
        ) : (
          <Button size="sm" variant="outline">
            <Search className="mr-1 h-4 w-4" aria-hidden />
            {currentExpertName ? "배정 변경" : "전문가 탐색 · 배정"}
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] max-w-5xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>전문가 탐색 · 후보 등록</DialogTitle>
          <DialogDescription>
            {slotLabel || "세션"} — 후보 자리 {openCount}개 ·{" "}
            <b>
              {selectedIds.length}/{openCount}명 선택
            </b>
            . 선택한 전문가는 이 세션의 빈 후보 자리에 순서대로 등록됩니다.
          </DialogDescription>
        </DialogHeader>

        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        {notice && (
          <p className="whitespace-pre-line rounded bg-emerald-50 p-2 text-sm text-emerald-700">
            {notice}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="이름 · 전문분야 · 지역 · 강의분야 · 휴대폰"
            className="h-9 w-72"
          />
          <div className="flex gap-1">
            {(
              [
                { key: "all", label: "전체" },
                { key: "linked", label: "연결됨" },
              ] as const
            ).map((f) => (
              <Button
                key={f.key}
                size="sm"
                variant={scope === f.key ? "default" : "outline"}
                className="h-8 px-2.5 text-xs"
                onClick={() => setScope(f.key)}
              >
                {f.label}
              </Button>
            ))}
          </div>
          {/* 조건 필터 (기획 2026-08-30 — 26번) — 버튼 클릭으로 해당 조건만 */}
          <div className="flex gap-1">
            {(
              [
                { key: "favorite", label: "★ 즐겨찾기" },
                { key: "vip", label: "VIP" },
                { key: "rated", label: "자사평가 있음" },
              ] as const
            ).map((f) => (
              <Button
                key={f.key}
                size="sm"
                variant={tagFilter === f.key ? "default" : "outline"}
                className="h-8 px-2.5 text-xs"
                onClick={() =>
                  setTagFilter((prev) => (prev === f.key ? "all" : f.key))
                }
              >
                {f.label}
              </Button>
            ))}
          </div>
          {regionOptions.length > 0 && (
            <select
              value={regionFilter}
              onChange={(e) => setRegionFilter(e.target.value)}
              className="h-8 rounded-md border bg-background px-2 text-xs"
              aria-label="지역 필터"
            >
              <option value="">지역 전체</option>
              {regionOptions.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          )}
          <div className="ml-auto flex items-center gap-1">
            <span className="text-xs text-muted-foreground">정렬</span>
            {(
              [
                { key: "name", label: "성명순" },
                { key: "region", label: "지역순" },
                { key: "rating", label: "자사평가순" },
              ] as const
            ).map((o) => (
              <Button
                key={o.key}
                size="sm"
                variant={sortKey === o.key ? "default" : "outline"}
                className="h-8 px-2.5 text-xs"
                onClick={() => setSortKey(o.key)}
              >
                {o.label}
              </Button>
            ))}
          </div>
        </div>

        {pending && experts === null ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            전문가 목록을 불러오는 중...
          </p>
        ) : (
          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">선택</TableHead>
                  <TableHead>이름</TableHead>
                  <TableHead>휴대폰</TableHead>
                  <TableHead>전문분야</TableHead>
                  <TableHead>강의(멘토링) 분야</TableHead>
                  <TableHead>섭외 분야</TableHead>
                  <TableHead>지역</TableHead>
                  <TableHead>경력</TableHead>
                  <TableHead>자사 평가</TableHead>
                  <TableHead>등급</TableHead>
                  <TableHead>메모</TableHead>
                  <TableHead>상태</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((e) => {
                  const status = LINK_STATUS_LABEL[e.linkStatus] ?? {
                    label: "미연결",
                    variant: "outline" as const,
                  };
                  const selectable =
                    e.linkStatus !== "revoked" && !e.alreadyInSlot;
                  const checked = selectedIds.includes(e.id);
                  return (
                    <TableRow
                      key={e.id}
                      className={
                        selectable ? "cursor-pointer" : "opacity-60"
                      }
                      onClick={() => toggle(e)}
                    >
                      <TableCell>
                        <input
                          type="checkbox"
                          aria-label={`${e.name} 선택`}
                          checked={checked}
                          disabled={!selectable || (!checked && capReached)}
                          onChange={() => toggle(e)}
                          onClick={(ev) => ev.stopPropagation()}
                          className="h-4 w-4 accent-brand"
                        />
                      </TableCell>
                      <TableCell className="whitespace-nowrap font-medium">
                        {/* 즐겨찾기·VIP를 목록에서 바로 보이게 (기획 26번) */}
                        {e.tag === "favorite" && (
                          <Star
                            className="mr-1 inline h-3.5 w-3.5 text-amber-500"
                            fill="currentColor"
                            aria-label="즐겨찾기"
                          />
                        )}
                        {e.tag === "vip" && (
                          <Crown
                            className="mr-1 inline h-3.5 w-3.5 text-violet-600"
                            fill="currentColor"
                            aria-label="VIP"
                          />
                        )}
                        {e.name}
                        {e.alreadyInSlot && (
                          <span className="ml-1 text-[11px] text-muted-foreground">
                            (이미 후보)
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        {formatKrMobile(e.phone)}
                      </TableCell>
                      <TableCell>{e.specialty ?? "-"}</TableCell>
                      <TableCell className="max-w-[160px] truncate text-xs">
                        {e.expertise.length > 0 ? e.expertise.join(" · ") : "-"}
                      </TableCell>
                      <TableCell className="max-w-[140px] truncate text-xs">
                        {e.recruit.length > 0 ? e.recruit.join(" · ") : "-"}
                      </TableCell>
                      <TableCell>{e.region ?? "-"}</TableCell>
                      <TableCell className="whitespace-nowrap">
                        {e.careerYears !== null ? `${e.careerYears}년` : "-"}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-xs">
                        {e.rating !== null ? `${e.rating}점` : "-"}
                        {e.avgScore ? ` · 평가 ${e.avgScore}` : ""}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-xs">
                        {e.tag ? (
                          <Badge
                            variant={
                              e.tag === "caution" ? "destructive" : "secondary"
                            }
                            className="px-1.5 py-0 text-[10px]"
                          >
                            {expertTagLabel(e.tag) ?? e.tag}
                          </Badge>
                        ) : (
                          "-"
                        )}
                      </TableCell>
                      <TableCell className="text-xs">
                        {e.noteCount > 0 ? `${e.noteCount}건` : "-"}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        <Badge variant={status.variant}>{status.label}</Badge>
                        {e.conflictCount > 0 && (
                          <span className="ml-1 inline-flex items-center gap-0.5 text-[11px] text-amber-700">
                            <AlertTriangle className="h-3 w-3" aria-hidden />
                            일정 {e.conflictCount}
                          </span>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
                {rows.length === 0 && (
                  <TableRow>
                    <TableCell
                      colSpan={12}
                      className="py-8 text-center text-sm text-muted-foreground"
                    >
                      조건에 맞는 전문가가 없습니다.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        )}

        <div className="flex items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">
            미연결 전문가도 선택할 수 있습니다 — 후보로 등록하면 자사 관계가
            자동 생성됩니다(해제된 관계는 전문가 상세에서 재연결 필요). 일정
            겹침은 배정 전 참고용입니다.
          </p>
          <Button
            onClick={submit}
            disabled={pending || selectedIds.length === 0}
            className="shrink-0"
          >
            <UserCheck className="mr-1 h-4 w-4" aria-hidden />
            후보 등록 ({selectedIds.length}/{openCount})
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
