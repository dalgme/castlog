"use client";

import { useState, useTransition } from "react";
import { ShieldCheck, X } from "lucide-react";

import {
  ADMIN_SCOPES,
  ADMIN_SCOPE_DESCRIPTIONS,
  ADMIN_SCOPE_LABELS,
  type AdminScope,
} from "@/lib/auth/admin-scope-keys";
import { GRADE_LABELS, type UserGrade } from "@/lib/auth/grades";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
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
 * 시스템 설정/관리 권한 위임 (대표 전용).
 *
 * 대표는 'CEO 업무기능 + 시스템 설정·관리기능'을 모두 갖고, 이 중 설정·관리 기능만
 * 임원 등에게 기능 단위로 나눠 줄 수 있다. 세무(주민등록번호) 조회 지정자 관리는
 * 위임 대상이 아니다 — 아래 '세무 조회 지정자' 패널에서 대표만 다룬다.
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
  const [userId, setUserId] = useState("");
  const [scopes, setScopes] = useState<AdminScope[]>([]);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function toggle(scope: AdminScope, checked: boolean) {
    setScopes((prev) =>
      checked ? [...prev, scope] : prev.filter((s) => s !== scope)
    );
  }

  function submit() {
    setError(null);
    if (!userId) return setError("위임 대상을 선택하세요.");
    if (scopes.length === 0) return setError("위임할 기능을 선택하세요.");

    startTransition(async () => {
      const res = await grantAdminScopes({ userId, scopes, note });
      if (res.ok) {
        setUserId("");
        setScopes([]);
        setNote("");
      } else {
        setError(res.error);
      }
    });
  }

  function revoke(grantId: string, label: string, who: string) {
    if (!window.confirm(`${who}의 '${label}' 관리 권한을 회수합니다.`)) return;
    startTransition(async () => {
      const res = await revokeAdminGrant(grantId);
      if (!res.ok) setError(res.error);
    });
  }

  const byUser: { userId: string; userName: string; note: string | null; rows: DelegationRow[] }[] =
    [];
  for (const g of grants) {
    const bucket = byUser.find((b) => b.userId === g.userId);
    if (bucket) bucket.rows.push(g);
    else
      byUser.push({
        userId: g.userId,
        userName: g.userName,
        note: g.note,
        rows: [g],
      });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <ShieldCheck className="h-4 w-4" />
          시스템 설정·관리 권한 위임
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          대표가 가진 설정·관리 기능을 임원 등에게 기능 단위로 나눠 줍니다. 업무
          권한(프로젝트·섭외·결재)은 권한단계로 결정되며 여기서 바뀌지 않습니다.
          <br />
          <strong>세무(주민등록번호) 조회 지정자 관리는 위임 대상이 아닙니다.</strong>
        </p>

        {byUser.length === 0 ? (
          <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
            현재 위임된 관리 권한이 없습니다. 모든 설정·관리 기능은 대표만
            사용합니다.
          </p>
        ) : (
          <div className="space-y-2">
            {byUser.map(({ userId: uid, userName, note: userNote, rows }) => (
              <div
                key={uid}
                className="flex flex-wrap items-center gap-2 rounded-md border p-3"
              >
                <span className="text-sm font-medium">{userName}</span>
                {rows.map((row) => (
                  <Badge key={row.id} variant="secondary" className="gap-1">
                    {ADMIN_SCOPE_LABELS[row.scope]}
                    {canManage && (
                      <button
                        type="button"
                        aria-label="회수"
                        className="ml-0.5 rounded-sm hover:text-destructive"
                        disabled={pending}
                        onClick={() =>
                          revoke(
                            row.id,
                            ADMIN_SCOPE_LABELS[row.scope],
                            row.userName
                          )
                        }
                      >
                        <X className="h-3 w-3" />
                      </button>
                    )}
                  </Badge>
                ))}
                {userNote && (
                  <span className="text-xs text-muted-foreground">· {userNote}</span>
                )}
              </div>
            ))}
          </div>
        )}

        {canManage && (
          <div className="space-y-3 rounded-md border p-3">
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">위임 대상</label>
                <Select value={userId} onValueChange={setUserId}>
                  <SelectTrigger>
                    <SelectValue placeholder="직원 선택" />
                  </SelectTrigger>
                  <SelectContent>
                    {candidates.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name} ({GRADE_LABELS[c.grade]})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">메모 (선택)</label>
                <Input
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="예: 2026년 상반기 시스템 담당"
                />
              </div>
            </div>

            <div className="grid gap-2 sm:grid-cols-2">
              {ADMIN_SCOPES.map((scope) => (
                <label
                  key={scope}
                  className="flex cursor-pointer items-start gap-2 rounded-md border p-2.5"
                >
                  <Checkbox
                    checked={scopes.includes(scope)}
                    onCheckedChange={(checked) => toggle(scope, checked === true)}
                  />
                  <span className="space-y-0.5">
                    <span className="block text-sm font-medium">
                      {ADMIN_SCOPE_LABELS[scope]}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {ADMIN_SCOPE_DESCRIPTIONS[scope]}
                    </span>
                  </span>
                </label>
              ))}
            </div>

            <Button size="sm" onClick={submit} disabled={pending}>
              {pending ? "처리 중..." : "위임하기"}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
