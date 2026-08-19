"use client";

import { useState, useTransition } from "react";
import { KeyRound, ShieldAlert, ShieldCheck, X } from "lucide-react";

import {
  ADMIN_SCOPE_DESCRIPTIONS,
  ADMIN_SCOPE_GROUPS,
  ADMIN_SCOPE_LABELS,
  ADMIN_SCOPE_RISK,
  SCOPE_IMPLIES,
  type AdminScope,
} from "@/lib/auth/admin-scope-keys";
import { GRADE_LABELS, type UserGrade } from "@/lib/auth/grades";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { grantAdminScopes, revokeAdminGrant } from "./actions";

export type DelegationCandidate = {
  id: string;
  name: string;
  grade: UserGrade;
};

export type DelegationRow = {
  id: string;
  userId: string;
  userName: string;
  scope: AdminScope;
  note: string | null;
  grantedAt: string;
};

/**
 * 시스템 설정·관리 권한 위임 (대표 전용).
 *
 * ── 왜 '기능별'로 뒤집었나 ─────────────────────────────────────────────────
 * 이전 화면은 **사람을 먼저 고르고** 그 사람에게 줄 기능을 체크하는 방식이었다.
 * 그러면 화면이 "이 한 사람에게 무엇을 다 줄까"로 읽혀서, 실제로는 기능마다
 * 다른 담당자를 둘 수 있는데도 한 사람에게 몰아주게 된다. 회사에서 이 일들의
 * 실제 주인은 서로 다르다 — 발송은 홍보, 지급은 회계, 계정은 인사다.
 *
 * 그래서 축을 뒤집었다: **기능이 행이고, 그 행에 담당자를 붙인다.** 한 기능에
 * 여러 명을 둘 수도 있고, 기능마다 완전히 다른 사람을 둘 수도 있다.
 *
 * ── 왜 색이 다른가 ─────────────────────────────────────────────────────────
 * 여기서 주는 것은 업무 권한이 아니라 **회사 시스템을 바꾸는 권한**이다.
 * 잘못 주면 문자 발송 키, 지급 금액, 회사 자료 반출이 함께 열린다. 다른 설정
 * 카드와 같은 흰 카드로 두면 그 무게가 읽히지 않아서, 화면에서 구분한다.
 * 위험이 큰 항목은 행에도 별도 표시를 둔다.
 *
 * 세무(주민등록번호) 조회 지정자 관리와 위임 자체의 재위임은 여기에 없다 —
 * 코드로 막혀 있다 (CLAUDE.md §3-1 위임 금지 대상).
 */
export function AdminDelegationPanel({
  candidates,
  grants,
  canManage,
}: {
  candidates: DelegationCandidate[];
  grants: DelegationRow[];
  canManage: boolean;
}) {
  const [picked, setPicked] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function grant(scope: AdminScope) {
    const userId = picked[scope];
    if (!userId) return;
    setError(null);
    startTransition(async () => {
      const res = await grantAdminScopes({ userId, scopes: [scope] });
      if (res.ok) setPicked((prev) => ({ ...prev, [scope]: "" }));
      else setError(res.error);
    });
  }

  function revoke(grantId: string, label: string, who: string) {
    if (!window.confirm(`${who}의 ‘${label}’ 관리 권한을 회수합니다.`)) return;
    setError(null);
    startTransition(async () => {
      const res = await revokeAdminGrant(grantId);
      if (!res.ok) setError(res.error);
    });
  }

  const holdersOf = (scope: AdminScope) => grants.filter((g) => g.scope === scope);
  const totalHolders = new Set(grants.map((g) => g.userId)).size;

  return (
    <Card className="border-2 border-amber-300 bg-amber-50/60">
      {/* 머리띠 — 이 카드가 다른 설정 카드와 다른 무게라는 신호 */}
      <div className="flex flex-wrap items-center gap-2 rounded-t-lg border-b-2 border-amber-300 bg-amber-100/80 px-5 py-3">
        <KeyRound className="h-4 w-4 shrink-0 text-amber-800" aria-hidden />
        <span className="text-sm font-bold text-amber-900">
          시스템 설정·관리 권한 위임
        </span>
        <span className="rounded-full bg-amber-800 px-2 py-0.5 text-[10px] font-semibold text-white">
          중요
        </span>
        <span className="ml-auto text-xs text-amber-900/80">
          {totalHolders === 0
            ? "위임 없음 — 대표만 사용"
            : `${totalHolders}명에게 위임 중`}
        </span>
      </div>

      <CardContent className="space-y-4 pt-4">
        <p className="text-sm leading-relaxed text-amber-950">
          대표가 가진 <b>설정·관리 기능</b>을 기능 단위로 나눠 줍니다. 기능마다
          다른 사람을 지정할 수 있고, 한 기능에 여러 명을 둘 수도 있습니다.
          위임하면 그 사람의 화면에 해당 메뉴가 곧바로 열립니다.
          <br />
          업무 권한(프로젝트·섭외·결재 승인)은 권한단계로 결정되며 여기서 바뀌지
          않습니다. <b>주민등록번호 조회 지정자 관리와 위임 권한 자체는 위임할 수
          없습니다.</b>
        </p>

        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {ADMIN_SCOPE_GROUPS.map((group) => (
          <div key={group.key} className="space-y-2">
            <p className="text-xs font-semibold text-amber-900">{group.title}</p>
            {group.scopes.map((scope) => {
              const holders = holdersOf(scope);
              const high = ADMIN_SCOPE_RISK[scope] === "high";
              const implied = SCOPE_IMPLIES[scope];
              return (
                <div
                  key={scope}
                  className={
                    "rounded-lg border bg-white p-3 " +
                    (high ? "border-amber-400" : "border-border")
                  }
                >
                  <div className="flex flex-wrap items-center gap-2">
                    {high ? (
                      <ShieldAlert
                        className="h-4 w-4 shrink-0 text-amber-700"
                        aria-hidden
                      />
                    ) : (
                      <ShieldCheck
                        className="h-4 w-4 shrink-0 text-muted-foreground"
                        aria-hidden
                      />
                    )}
                    <span className="text-sm font-semibold text-brand-navy">
                      {ADMIN_SCOPE_LABELS[scope]}
                    </span>
                    {high && (
                      <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-900">
                        신중히
                      </span>
                    )}
                    {holders.length === 0 && (
                      <span className="text-xs text-muted-foreground">
                        대표만 사용 중
                      </span>
                    )}
                  </div>

                  <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
                    {ADMIN_SCOPE_DESCRIPTIONS[scope]}
                    {implied && implied.length > 0 && (
                      <>
                        {" "}
                        이 권한은{" "}
                        <b>
                          {implied.map((k) => ADMIN_SCOPE_LABELS[k]).join(" · ")}
                        </b>
                        을(를) 함께 포함합니다.
                      </>
                    )}
                  </p>

                  {holders.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {holders.map((row) => (
                        <span
                          key={row.id}
                          className="inline-flex items-center gap-1 rounded-full border border-brand/40 bg-[#F2F6FF] px-2.5 py-1 text-xs font-medium text-brand-navy"
                        >
                          {row.userName}
                          {row.note && (
                            <span className="text-[10px] text-muted-foreground">
                              · {row.note}
                            </span>
                          )}
                          {canManage && (
                            <button
                              type="button"
                              aria-label={`${row.userName} 회수`}
                              title="이 사람에게서 회수"
                              className="rounded-sm hover:text-destructive"
                              disabled={pending}
                              onClick={() =>
                                revoke(
                                  row.id,
                                  ADMIN_SCOPE_LABELS[scope],
                                  row.userName
                                )
                              }
                            >
                              <X className="h-3 w-3" />
                            </button>
                          )}
                        </span>
                      ))}
                    </div>
                  )}

                  {canManage && (
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <Select
                        value={picked[scope] ?? ""}
                        onValueChange={(v) =>
                          setPicked((prev) => ({ ...prev, [scope]: v }))
                        }
                      >
                        <SelectTrigger className="h-9 w-56">
                          <SelectValue placeholder="담당자 추가…" />
                        </SelectTrigger>
                        <SelectContent>
                          {candidates.length === 0 ? (
                            <SelectItem value="__none" disabled>
                              위임할 직원이 없습니다
                            </SelectItem>
                          ) : (
                            candidates.map((c) => (
                              <SelectItem key={c.id} value={c.id}>
                                {c.name} ({GRADE_LABELS[c.grade]})
                              </SelectItem>
                            ))
                          )}
                        </SelectContent>
                      </Select>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={pending || !picked[scope]}
                        onClick={() => grant(scope)}
                      >
                        위임
                      </Button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ))}

        {!canManage && (
          <p className="rounded-md border border-dashed border-amber-300 p-3 text-xs text-amber-900">
            위임의 부여·회수는 대표만 할 수 있습니다. 위임받은 사람은 다시 위임할
            수 없습니다 — 권한이 조용히 번지는 것을 막기 위해서입니다.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
