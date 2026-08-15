"use client";

import { useState, useTransition } from "react";
import { ShieldCheck } from "lucide-react";

import { RRN_ACCESS_ROLES, type RrnAccessRole } from "@/lib/integrations/rrn-access";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { grantTaxAccess, revokeTaxAccess } from "./tax-access-actions";

type StaffOption = { id: string; name: string; email: string };
type GrantRow = {
  id: string;
  user_id: string;
  role_label: string | null;
  userName: string;
};

/**
 * 주민등록번호 조회 지정자 관리 — 회계담당·대표만 지정 가능.
 * 지정자만 이후 주민번호 복호화 요청 주체가 된다. 대결·위임 대상 아님.
 */
export function TaxAccessGrantsPanel({
  staff,
  grants,
}: {
  staff: StaffOption[];
  grants: GrantRow[];
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [userId, setUserId] = useState<string>("");
  const [role, setRole] = useState<RrnAccessRole>("accountant");

  const grantedIds = new Set(grants.map((g) => g.user_id));
  const available = staff.filter((s) => !grantedIds.has(s.id));

  const onGrant = () => {
    setError(null);
    if (!userId) {
      setError("지정할 직원을 선택하세요.");
      return;
    }
    startTransition(async () => {
      const result = await grantTaxAccess({ userId, roleLabel: role });
      if (!result.ok) setError(result.error);
      else setUserId("");
    });
  };

  const onRevoke = (grantId: string) => {
    setError(null);
    startTransition(async () => {
      const result = await revokeTaxAccess(grantId);
      if (!result.ok) setError(result.error);
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-2 rounded-lg border border-brand/40 bg-[#F2F6FF] p-3 text-sm text-[#33405A]">
        <ShieldCheck className="mt-0.5 h-4 w-4 flex-none text-brand" aria-hidden />
        <p>
          지정된 담당자만 소득세법상 지급명세서 목적으로 주민등록번호를 조회할 수
          있습니다. 조회는 프로젝트당 2회로 제한되며, 대결·위임으로 이전되지 않고,
          모든 조회는 전문가 본인에게 즉시 통지됩니다.
        </p>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {grants.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          지정된 담당자가 없습니다. 회계담당자 또는 대표자를 지정하세요.
        </p>
      ) : (
        <ul className="divide-y rounded-lg border">
          {grants.map((g) => (
            <li
              key={g.id}
              className="flex items-center justify-between gap-2 px-3 py-2.5 text-sm"
            >
              <span>
                <span className="font-semibold text-brand-navy">{g.userName}</span>
                <span className="ml-2 text-xs text-muted-foreground">
                  {g.role_label ?? "지정자"}
                </span>
              </span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onRevoke(g.id)}
                disabled={pending}
              >
                해제
              </Button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-[160px] flex-1">
          <label className="mb-1 block text-xs text-muted-foreground">직원</label>
          <Select value={userId} onValueChange={setUserId}>
            <SelectTrigger>
              <SelectValue placeholder="직원 선택" />
            </SelectTrigger>
            <SelectContent>
              {available.length === 0 ? (
                <SelectItem value="__none" disabled>
                  지정 가능한 직원이 없습니다
                </SelectItem>
              ) : (
                available.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name} ({s.email})
                  </SelectItem>
                ))
              )}
            </SelectContent>
          </Select>
        </div>
        <div className="w-32">
          <label className="mb-1 block text-xs text-muted-foreground">역할</label>
          <Select
            value={role}
            onValueChange={(v) => setRole(v as RrnAccessRole)}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(RRN_ACCESS_ROLES) as RrnAccessRole[]).map((k) => (
                <SelectItem key={k} value={k}>
                  {RRN_ACCESS_ROLES[k]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button onClick={onGrant} disabled={pending || !userId}>
          지정
        </Button>
      </div>
    </div>
  );
}
