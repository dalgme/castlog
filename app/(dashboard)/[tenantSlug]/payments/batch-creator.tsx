"use client";

import { useMemo, useState, useTransition } from "react";

import { formatKrw } from "@/lib/approvals/constants";
import { PAYMENT_TYPE_LABELS } from "@/lib/payments/tax";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";

import { createPaymentBatch } from "./actions";

export type PayableRow = {
  engagementId: string;
  expertName: string;
  roleDescription: string;
  paymentType: string | null; // null = 소득유형 미설정 (포함 불가)
  gross: number;
  withholding: number;
  net: number;
};

/**
 * 프로젝트별 지급 대상 일괄 선택 (기획 확정 — 리스트로 한 번에 확인·일괄 품의)
 * 전문가별 소득유형에 따라 총비용/원천징수/실지급을 계산해 표시한다.
 */
export function BatchCreator({
  projectId,
  projectName,
  rows,
  approvalsActive,
}: {
  projectId: string; // "" = 프로젝트 미지정 그룹
  projectName: string | null;
  rows: PayableRow[];
  approvalsActive: boolean;
}) {
  const selectable = useMemo(
    () => rows.filter((r) => r.paymentType !== null),
    [rows]
  );
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(selectable.map((r) => r.engagementId))
  );
  const [title, setTitle] = useState(
    `${projectName ?? "프로젝트 미지정"} 전문가 지급`
  );
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();

  const selectedRows = selectable.filter((r) => selected.has(r.engagementId));
  const totals = selectedRows.reduce(
    (acc, r) => ({
      gross: acc.gross + r.gross,
      withholding: acc.withholding + r.withholding,
      net: acc.net + r.net,
    }),
    { gross: 0, withholding: 0, net: 0 }
  );

  function toggle(engagementId: string, checked: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(engagementId);
      else next.delete(engagementId);
      return next;
    });
  }

  function onCreate() {
    if (selectedRows.length === 0) {
      toast({ variant: "destructive", description: "지급 대상을 선택하세요." });
      return;
    }
    const label = approvalsActive ? "일괄 지급 품의를 상신" : "일괄 지급 건을 생성";
    if (!window.confirm(`${selectedRows.length}명 ${label}할까요?\n합계 실지급 ${formatKrw(totals.net)}`)) {
      return;
    }
    startTransition(async () => {
      const result = await createPaymentBatch({
        projectId,
        title,
        engagementIds: selectedRows.map((r) => r.engagementId),
      });
      if (result.ok) {
        if (result.submitted) {
          toast({ description: "일괄 지급 품의가 상신되었습니다." });
        } else if (result.warning) {
          toast({
            description: `지급 건이 생성되었습니다. ${result.warning}`,
          });
        } else {
          toast({ description: "지급 건이 생성되었습니다." });
        }
      } else {
        toast({ variant: "destructive", description: result.error });
      }
    });
  }

  const hasMissingType = rows.some((r) => r.paymentType === null);

  return (
    <div className="space-y-3">
      {hasMissingType && (
        <Alert>
          <AlertDescription>
            소득유형 미설정 전문가는 선택할 수 없습니다. 전문가가 포털 프로필에서
            사업소득/기타소득/사업자를 설정하면 목록에 포함됩니다.
          </AlertDescription>
        </Alert>
      )}
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10" />
              <TableHead>전문가</TableHead>
              <TableHead>역할</TableHead>
              <TableHead>소득유형</TableHead>
              <TableHead className="text-right">총비용</TableHead>
              <TableHead className="text-right">원천징수</TableHead>
              <TableHead className="text-right">실지급</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => {
              const disabled = row.paymentType === null;
              return (
                <TableRow key={row.engagementId} className={disabled ? "opacity-60" : ""}>
                  <TableCell>
                    <Checkbox
                      checked={!disabled && selected.has(row.engagementId)}
                      disabled={disabled || pending}
                      onCheckedChange={(checked) =>
                        toggle(row.engagementId, checked === true)
                      }
                    />
                  </TableCell>
                  <TableCell className="font-medium">{row.expertName}</TableCell>
                  <TableCell>{row.roleDescription}</TableCell>
                  <TableCell>
                    {row.paymentType ? (
                      <span className="text-xs">
                        {PAYMENT_TYPE_LABELS[row.paymentType] ?? row.paymentType}
                      </span>
                    ) : (
                      <Badge variant="destructive" className="text-[10px]">
                        미설정
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right">{formatKrw(row.gross)}</TableCell>
                  <TableCell className="text-right text-muted-foreground">
                    {row.paymentType ? formatKrw(row.withholding) : "-"}
                  </TableCell>
                  <TableCell className="text-right font-medium">
                    {row.paymentType ? formatKrw(row.net) : "-"}
                  </TableCell>
                </TableRow>
              );
            })}
            {selectedRows.length > 0 && (
              <TableRow className="bg-secondary/50 font-semibold">
                <TableCell colSpan={4}>
                  합계 ({selectedRows.length}명 선택)
                </TableCell>
                <TableCell className="text-right">{formatKrw(totals.gross)}</TableCell>
                <TableCell className="text-right">
                  {formatKrw(totals.withholding)}
                </TableCell>
                <TableCell className="text-right">{formatKrw(totals.net)}</TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={120}
          placeholder="지급 건 제목"
        />
        <Button
          type="button"
          className="shrink-0"
          disabled={pending || selectedRows.length === 0}
          onClick={onCreate}
        >
          {pending
            ? "처리 중..."
            : approvalsActive
              ? `일괄 지급 품의 상신 (${selectedRows.length}명)`
              : `일괄 지급 건 생성 (${selectedRows.length}명)`}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        원천징수액은 소득유형별 참고 계산이며, 지급 전 세무 확인이 필요합니다.
      </p>
    </div>
  );
}
