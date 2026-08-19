"use client";

import { useState, useTransition } from "react";
import { ShieldCheck } from "lucide-react";

import {
  RRN_ACCESS_ROLES,
  RRN_GRANT_LIMIT,
} from "@/lib/integrations/rrn-access";
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
 * 주민등록번호 조회 지정자 관리 — 대표만 지정 가능.
 *
 * **최대 3명.** 실무에서 필요한 자리는 대표·임원(전결)·회계담당 정도다. 그
 * 이상은 "혹시 몰라서"로 늘고, 조회 가능한 사람이 늘어난 만큼 유출면이 넓어진다.
 * 부족하면 늘리는 게 아니라 교체한다(해제 후 지정). 상한은 DB 트리거로도 강제한다.
 *
 * 역할 표기는 회사 직급 체계에서 고른다 — 어떤 회사는 '상무이사'가, 어떤 회사는
 * '경영지원팀장'이 이 일을 한다. 기본값(회계담당자·대표자)은 직급을 아직 등록하지
 * 않은 회사를 위해 남겨 둔다.
 */
export function TaxAccessGrantsPanel({
  staff,
  grants,
  positionNames = [],
}: {
  staff: StaffOption[];
  grants: GrantRow[];
  /** 회사가 등록한 직급 (설정 > 임직원 설정 > 직급 관리) */
  positionNames?: string[];
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [userId, setUserId] = useState<string>("");

  // 기본 역할 + 회사 직급. 중복은 한 번만.
  const roleOptions: string[] = [];
  for (const label of [
    ...Object.values(RRN_ACCESS_ROLES),
    ...positionNames,
  ]) {
    if (label && !roleOptions.includes(label)) roleOptions.push(label);
  }
  const [role, setRole] = useState<string>(roleOptions[0] ?? "회계담당자");

  const grantedIds = new Set(grants.map((g) => g.user_id));
  const available = staff.filter((s) => !grantedIds.has(s.id));
  const full = grants.length >= RRN_GRANT_LIMIT;

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

      <p className="text-xs text-muted-foreground">
        지정 인원 <b>{grants.length} / {RRN_GRANT_LIMIT}명</b> — 조회할 수 있는
        사람이 늘어난 만큼 유출면이 넓어집니다. 자리가 부족하면 기존 지정을
        해제한 뒤 지정하세요.
      </p>

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

      {full ? (
        <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
          지정 인원이 모두 찼습니다({RRN_GRANT_LIMIT}명). 새로 지정하려면 위에서
          한 명을 해제하세요.
        </p>
      ) : (
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
        <div className="w-40">
          <label className="mb-1 block text-xs text-muted-foreground">
            역할 (직급)
          </label>
          <Select value={role} onValueChange={setRole}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {roleOptions.map((label) => (
                <SelectItem key={label} value={label}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button onClick={onGrant} disabled={pending || !userId}>
          지정
        </Button>
      </div>
      )}

      <p className="text-[11px] text-muted-foreground">
        역할 목록은 <b>설정 &gt; 임직원 설정 &gt; 직급 관리</b>에 등록한 직급에서
        가져옵니다. 회사에서 쓰는 직급(예: 상무이사)을 등록해 두면 여기서 바로
        고를 수 있습니다.
      </p>
    </div>
  );
}
