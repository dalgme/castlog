"use client";

import { useState, useTransition } from "react";
import { SlidersHorizontal, X } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  setExecThreshold,
  addExecGrant,
  removeExecGrant,
} from "./exec-policy-actions";

/**
 * 기능별 권한 문턱 조정 패널 (기획 확정 2026-08-23).
 * 행 = 기능, 열 = 기본 레벨 / 이 회사 적용 레벨 / 특정인 지정.
 * "레벨 6개로 부족할 때"의 두 번째 확장 축 — 첫 번째는 관리 권한 위임(9종 스위치).
 */

export type ExecPolicyRow = {
  feature: string;
  label: string;
  /** 기본 레벨 표기 (예: "레벨 4") */
  defaultLabel: string;
  /** 조정된 레벨 grade 키 (미조정이면 null) */
  overrideGrade: string | null;
  grants: { userId: string; name: string }[];
};

const GRADE_OPTIONS: { value: string; label: string }[] = [
  { value: "ceo", label: "레벨 1" },
  { value: "director", label: "레벨 2" },
  { value: "team_lead", label: "레벨 3" },
  { value: "deputy", label: "레벨 4" },
  { value: "senior", label: "레벨 5" },
  { value: "staff", label: "레벨 6" },
];

export function ExecThresholdPanel({
  rows,
  staff,
}: {
  rows: ExecPolicyRow[];
  staff: { id: string; name: string; gradeLabel: string }[];
}) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function run(fn: () => Promise<{ ok: true } | { ok: false; error: string }>, done: string) {
    setMessage(null);
    setError(null);
    startTransition(async () => {
      const result = await fn();
      if (result.ok) setMessage(done);
      else setError(result.error);
    });
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm">
          <SlidersHorizontal className="h-4 w-4 text-brand" aria-hidden />
          기능별 권한 문턱 조정
        </CardTitle>
        <p className="pt-1 text-xs leading-relaxed text-muted-foreground">
          기능마다 필요한 <b>최소 레벨</b>을 회사 사정에 맞게 올리거나 내릴 수
          있습니다. 레벨과 무관하게 <b>특정 직원</b>에게만 열어줄 수도 있습니다
          (예: 레벨 5 직원 한 명에게 섭외요청 발송 허용). 문턱을 내리면 그
          레벨의 모든 직원에게 열립니다 — 한 사람만 필요하면 특정인 지정을
          쓰세요.
        </p>
      </CardHeader>
      <CardContent className="space-y-1">
        {message && <p className="pb-1 text-xs text-emerald-600">{message}</p>}
        {error && <p className="pb-1 text-xs text-red-600">{error}</p>}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th className="py-2 pr-2 font-medium">기능</th>
                <th className="py-2 pr-2 font-medium">기본</th>
                <th className="py-2 pr-2 font-medium">적용 레벨</th>
                <th className="py-2 font-medium">특정인 지정 (레벨 무관 허용)</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.feature} className="border-b last:border-0 align-top">
                  <td className="py-2.5 pr-2 font-medium">{row.label}</td>
                  <td className="py-2.5 pr-2">
                    <Badge variant="secondary" className="font-normal">
                      {row.defaultLabel}
                    </Badge>
                  </td>
                  <td className="py-2.5 pr-2">
                    <select
                      className="h-8 rounded-md border bg-background px-2 text-xs"
                      value={row.overrideGrade ?? ""}
                      disabled={pending}
                      onChange={(e) => {
                        const v = e.target.value || null;
                        run(
                          () => setExecThreshold(row.feature, v),
                          v ? "적용 레벨을 조정했습니다." : "기본값으로 되돌렸습니다."
                        );
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
                  <td className="py-2.5">
                    <div className="flex flex-wrap items-center gap-1.5">
                      {row.grants.map((g) => (
                        <span
                          key={g.userId}
                          className="inline-flex items-center gap-1 rounded-full border bg-muted/50 py-0.5 pl-2 pr-1 text-xs"
                        >
                          {g.name}
                          <button
                            type="button"
                            aria-label={`${g.name} 지정 해제`}
                            disabled={pending}
                            onClick={() =>
                              run(
                                () => removeExecGrant(row.feature, g.userId),
                                "지정을 해제했습니다."
                              )
                            }
                            className="rounded-full p-0.5 text-muted-foreground hover:text-red-600"
                          >
                            <X className="h-3 w-3" aria-hidden />
                          </button>
                        </span>
                      ))}
                      <select
                        className="h-7 rounded-md border bg-background px-1.5 text-xs text-muted-foreground"
                        value=""
                        disabled={pending}
                        onChange={(e) => {
                          const userId = e.target.value;
                          if (!userId) return;
                          run(
                            () => addExecGrant(row.feature, userId),
                            "지정했습니다. 해당 직원에게 즉시 적용됩니다."
                          );
                          e.target.value = "";
                        }}
                      >
                        <option value="">+ 직원 지정</option>
                        {staff
                          .filter((s) => !row.grants.some((g) => g.userId === s.id))
                          .map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.name} ({s.gradeLabel})
                            </option>
                          ))}
                      </select>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="pt-2 text-xs leading-relaxed text-muted-foreground">
          변경은 저장 즉시 전 직원에게 적용되며, 감사로그에 남습니다. 지급·정산
          금액을 다루는 기능(지급건 검토·확정)은 이 표가 아니라{" "}
          <b>관리 권한 위임의 &lsquo;지급·정산&rsquo; 스위치</b>로 관리합니다.
        </p>
      </CardContent>
    </Card>
  );
}

export type { ExecPolicyRow as ExecThresholdRow };
