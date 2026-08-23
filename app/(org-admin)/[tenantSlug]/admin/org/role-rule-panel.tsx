"use client";

import { useState, useTransition } from "react";
import { UsersRound } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { setAssignmentRoleRule } from "./exec-policy-actions";

/**
 * 프로젝트 역할별 최소 레벨 패널 (기획 확정 2026-08-23).
 * 기본값: PL 레벨 3 · PM 레벨 4 · 부PM 레벨 5 · 담당 레벨 6.
 * PL·PM 겸임은 별도 설정 없이 둘 중 높은 쪽을 자동으로 따른다.
 */

export type RoleRuleRow = {
  role: string;
  label: string;
  /** 기본 레벨 표기 (예: "레벨 3") */
  defaultLabel: string;
  /** 조정된 레벨 grade 키 (미조정이면 null) */
  overrideGrade: string | null;
};

const GRADE_OPTIONS: { value: string; label: string }[] = [
  { value: "ceo", label: "레벨 1" },
  { value: "director", label: "레벨 2" },
  { value: "team_lead", label: "레벨 3" },
  { value: "deputy", label: "레벨 4" },
  { value: "senior", label: "레벨 5" },
  { value: "staff", label: "레벨 6" },
];

export function RoleRulePanel({ rows }: { rows: RoleRuleRow[] }) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm">
          <UsersRound className="h-4 w-4 text-brand" aria-hidden />
          프로젝트 역할별 최소 레벨
        </CardTitle>
        <p className="pt-1 text-xs leading-relaxed text-muted-foreground">
          프로젝트에 <b>PL · PM · 부PM · 담당</b>을 배정할 때 요구되는 최소 권한
          레벨입니다. 기본값은 PL 레벨 3 · PM 레벨 4 · 부PM 레벨 5 · 담당 레벨
          6이며, 회사 사정에 맞게 조정할 수 있습니다. PL·PM 겸임은 둘 중 높은
          기준을 자동으로 따릅니다.
        </p>
      </CardHeader>
      <CardContent className="space-y-1">
        {message && <p className="pb-1 text-xs text-emerald-600">{message}</p>}
        {error && <p className="pb-1 text-xs text-red-600">{error}</p>}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[400px] text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th className="py-2 pr-2 font-medium">역할</th>
                <th className="py-2 pr-2 font-medium">기본</th>
                <th className="py-2 font-medium">적용 레벨</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.role} className="border-b last:border-0">
                  <td className="py-2.5 pr-2 font-medium">{row.label}</td>
                  <td className="py-2.5 pr-2">
                    <Badge variant="secondary" className="font-normal">
                      {row.defaultLabel}
                    </Badge>
                  </td>
                  <td className="py-2.5">
                    <select
                      className="h-8 rounded-md border bg-background px-2 text-xs"
                      value={row.overrideGrade ?? ""}
                      disabled={pending}
                      onChange={(e) => {
                        const v = e.target.value || null;
                        setMessage(null);
                        setError(null);
                        startTransition(async () => {
                          const result = await setAssignmentRoleRule(row.role, v);
                          if (result.ok) {
                            setMessage(
                              v
                                ? `${row.label} 역할의 최소 레벨을 조정했습니다.`
                                : `${row.label} 역할을 기본값으로 되돌렸습니다.`
                            );
                          } else {
                            setError(result.error);
                          }
                        });
                      }}
                    >
                      <option value="">기본값 ({row.defaultLabel})</option>
                      {GRADE_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label} 이상
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="pt-2 text-xs leading-relaxed text-muted-foreground">
          이미 배정된 담당자는 그대로 유지됩니다 — 새 배정·역할 변경부터
          적용됩니다. 역할 배정과 별개로, 그 역할이 실행하는 기능(섭외요청
          발송 등)은 위 <b>기능별 권한 문턱</b>을 따릅니다.
        </p>
      </CardContent>
    </Card>
  );
}
