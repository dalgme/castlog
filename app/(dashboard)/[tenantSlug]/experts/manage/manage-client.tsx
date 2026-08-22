"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, Pencil, X } from "lucide-react";

import { formatKrMobile } from "@/lib/auth/phone";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import {
  saveExpertTenantProfile,
  toggleExpertRecruitField,
} from "./manage-actions";

export type ManagedExpertRow = {
  expertId: string;
  name: string;
  phone: string;
  relationSource: string; // self_join | bulk_registered
  engagedAt: string | null;
  expertiseFields: string[]; // 전문가의 강의(멘토링) 분야 (전역)
  rating: number | null;
  memo: string | null;
  recruitFieldIds: string[]; // 자사 섭외분야 배정
};

export type RecruitFieldOption = { id: string; name: string };

const RELATION_LABELS: Record<string, string> = {
  self_join: "본인 등록",
  bulk_registered: "보유자료 등록",
};

/**
 * 전문가 관리 탭 (기획 확정 2026-08-22) — 관계기업에 우리 회사가 있는
 * 전문가를 불러와 평점·메모·섭외분야를 관리한다. 팀장 이상만 수정 가능.
 */
export function ManageClient({
  tenantSlug,
  rows,
  recruitFields,
  canEdit,
}: {
  tenantSlug: string;
  rows: ManagedExpertRow[];
  recruitFields: RecruitFieldOption[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editRating, setEditRating] = useState<string>("");
  const [editMemo, setEditMemo] = useState<string>("");

  function startEdit(row: ManagedExpertRow) {
    setEditingId(row.expertId);
    setEditRating(row.rating ? String(row.rating) : "");
    setEditMemo(row.memo ?? "");
  }

  function saveProfile(expertId: string) {
    setError(null);
    startTransition(async () => {
      const r = await saveExpertTenantProfile({
        expertId,
        rating: editRating ? Number(editRating) : null,
        memo: editMemo,
      });
      if (!r.ok) setError(r.error);
      else {
        setEditingId(null);
        router.refresh();
      }
    });
  }

  function toggleField(expertId: string, fieldId: string, on: boolean) {
    setError(null);
    startTransition(async () => {
      const r = await toggleExpertRecruitField(expertId, fieldId, on);
      if (!r.ok) setError(r.error);
      else router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="overflow-x-auto rounded-md border bg-background">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>전문가</TableHead>
              <TableHead>관계</TableHead>
              <TableHead>강의(멘토링) 분야</TableHead>
              <TableHead>평점</TableHead>
              <TableHead className="min-w-[200px]">메모</TableHead>
              <TableHead className="min-w-[220px]">섭외분야</TableHead>
              {canEdit && <TableHead className="w-[80px]" />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => {
              const editing = editingId === row.expertId;
              return (
                <TableRow key={row.expertId}>
                  <TableCell>
                    <Link
                      href={`/${tenantSlug}/experts/${row.expertId}`}
                      className="font-medium underline-offset-2 hover:underline"
                    >
                      {row.name}
                    </Link>
                    <div className="text-xs text-muted-foreground">
                      {formatKrMobile(row.phone)}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary" className="text-[10px]">
                      {RELATION_LABELS[row.relationSource] ?? row.relationSource}
                    </Badge>
                    {row.engagedAt && (
                      <div className="mt-0.5 text-[10px] text-muted-foreground">
                        섭외 이력 있음
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="max-w-[200px] text-xs">
                    {row.expertiseFields.length > 0
                      ? row.expertiseFields.join(" · ")
                      : "—"}
                  </TableCell>
                  <TableCell>
                    {editing ? (
                      <select
                        className="h-8 rounded-md border bg-background px-2 text-sm"
                        value={editRating}
                        onChange={(e) => setEditRating(e.target.value)}
                      >
                        <option value="">없음</option>
                        {Array.from({ length: 10 }, (_, i) => 10 - i).map((n) => (
                          <option key={n} value={n}>
                            {n}점
                          </option>
                        ))}
                      </select>
                    ) : row.rating ? (
                      <span className="font-medium">{row.rating}점</span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {editing ? (
                      <Textarea
                        rows={2}
                        value={editMemo}
                        onChange={(e) => setEditMemo(e.target.value)}
                        className="min-w-[200px] text-sm"
                      />
                    ) : (
                      <span className="whitespace-pre-wrap text-xs">
                        {row.memo || "—"}
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    {recruitFields.length === 0 ? (
                      <span className="text-xs text-muted-foreground">
                        설정 &gt; 기업관리에서 섭외분야를 먼저 등록하세요
                      </span>
                    ) : (
                      <div className="flex max-w-[260px] flex-wrap gap-1">
                        {recruitFields.map((f) => {
                          const on = row.recruitFieldIds.includes(f.id);
                          return (
                            <button
                              key={f.id}
                              type="button"
                              disabled={!canEdit || pending}
                              onClick={() =>
                                canEdit && toggleField(row.expertId, f.id, !on)
                              }
                              className={
                                "rounded-full border px-2 py-0.5 text-[11px] transition-colors " +
                                (on
                                  ? "border-brand bg-brand/10 font-medium text-brand"
                                  : "text-muted-foreground hover:border-brand/40")
                              }
                            >
                              {f.name}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </TableCell>
                  {canEdit && (
                    <TableCell>
                      {editing ? (
                        <div className="flex gap-1">
                          <Button
                            size="sm"
                            disabled={pending}
                            onClick={() => saveProfile(row.expertId)}
                          >
                            <Check className="h-4 w-4" aria-hidden />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setEditingId(null)}
                          >
                            <X className="h-4 w-4" aria-hidden />
                          </Button>
                        </div>
                      ) : (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => startEdit(row)}
                        >
                          <Pencil className="h-3.5 w-3.5" aria-hidden />
                        </Button>
                      )}
                    </TableCell>
                  )}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <p className="text-[11px] text-muted-foreground">
        평점·메모·섭외분야는 우리 회사에만 보이며 전문가 본인에게는 노출되지
        않습니다. 섭외분야 항목은 설정 &gt; 기업관리 &gt; 섭외분야에서
        추가·수정·삭제합니다.
      </p>
    </div>
  );
}
