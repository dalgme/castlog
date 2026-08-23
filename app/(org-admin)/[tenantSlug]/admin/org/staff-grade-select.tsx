"use client";

import { useState, useTransition } from "react";

import {
  GRADE_LABELS,
  GRADE_SHORT_TAGS,
  USER_GRADES,
  type UserGrade,
} from "@/lib/auth/grades";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { setStaffGrade } from "./actions";

/**
 * 권한단계 인라인 변경.
 * 되돌리기 어려운 변경은 아니지만 권한 이동이므로 확인 1회를 거친다(§14-3).
 */
export function StaffGradeSelect({
  userId,
  grade,
  disabled,
  disabledReason,
}: {
  userId: string;
  grade: UserGrade;
  disabled?: boolean;
  disabledReason?: string;
}) {
  const [value, setValue] = useState<UserGrade>(grade);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onChange(next: string) {
    const nextGrade = next as UserGrade;
    if (nextGrade === value) return;
    const ok = window.confirm(
      `권한단계를 '${GRADE_LABELS[value]}' → '${GRADE_LABELS[nextGrade]}'(으)로 변경합니다.\n` +
        `본인 계정에는 다음 로그인(토큰 갱신) 시점부터 적용됩니다.`
    );
    if (!ok) return;

    setError(null);
    const previous = value;
    setValue(nextGrade);
    startTransition(async () => {
      const res = await setStaffGrade({ userId, grade: nextGrade });
      if (!res.ok) {
        setValue(previous);
        setError(res.error);
      }
    });
  }

  if (disabled) {
    return (
      <span className="text-sm text-muted-foreground" title={disabledReason}>
        {GRADE_LABELS[grade]}
      </span>
    );
  }

  return (
    <div className="space-y-1">
      <Select value={value} onValueChange={onChange} disabled={pending}>
        <SelectTrigger className="h-8 w-[104px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {USER_GRADES.map((g) => (
            <SelectItem key={g} value={g}>
              {GRADE_LABELS[g]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {/* 레벨 숫자만으로는 뭘 할 수 있는지 안 읽힌다 — 현재 값의 꼬리표를 보여준다 */}
      <p className="text-[11px] text-muted-foreground">{GRADE_SHORT_TAGS[value]}</p>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
