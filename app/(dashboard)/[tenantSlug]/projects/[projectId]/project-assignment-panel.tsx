"use client";

import { useState, useTransition } from "react";
import { UserPlus, X } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import {
  ASSIGNMENT_ROLES,
  ASSIGNMENT_ROLE_LABELS,
  type AssignmentRole,
} from "@/lib/integrations/assignment-roles";

import {
  assignProjectMember,
  setAssignmentRole,
  unassignProjectMember,
} from "./assignment-actions";

export type StaffOption = {
  id: string;
  name: string;
  gradeLabel: string;
  department: string | null;
};
export type AssignedMember = {
  userId: string;
  name: string;
  gradeLabel: string;
  assignmentRole: AssignmentRole;
};

/**
 * 프로젝트 담당자 배정 (권한자 전용). 배정된 담당자만 이 프로젝트를 열람한다.
 * 권한자(대표·이사)는 배정과 무관하게 전체 프로젝트를 본다.
 */
export function ProjectAssignmentPanel({
  projectId,
  staff,
  assigned,
}: {
  projectId: string;
  staff: StaffOption[];
  assigned: AssignedMember[];
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [pick, setPick] = useState("");
  const [pickRole, setPickRole] = useState<AssignmentRole>("member");

  const assignedIds = new Set(assigned.map((a) => a.userId));
  const assignable = staff.filter((s) => !assignedIds.has(s.id));

  const onAssign = () => {
    if (!pick) return;
    setError(null);
    startTransition(async () => {
      const r = await assignProjectMember(projectId, pick, pickRole);
      if (!r.ok) setError(r.error);
      else {
        setPick("");
        setPickRole("member");
      }
    });
  };

  const onChangeRole = (userId: string, next: string) => {
    setError(null);
    startTransition(async () => {
      const r = await setAssignmentRole(projectId, userId, next);
      if (!r.ok) setError(r.error);
    });
  };

  const onRemove = (userId: string) => {
    setError(null);
    startTransition(async () => {
      const r = await unassignProjectMember(projectId, userId);
      if (!r.ok) setError(r.error);
    });
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        배정된 담당자만 이 프로젝트를 볼 수 있습니다. 대표·이사(권한자)는 배정과 무관하게
        전체 프로젝트를 봅니다. PM·부PM은 프로젝트당 각 1명입니다.
      </p>

      {assigned.length === 0 ? (
        <p className="rounded-md bg-secondary/50 p-2 text-xs text-muted-foreground">
          아직 배정된 담당자가 없습니다. 권한자만 이 프로젝트를 볼 수 있는 상태입니다.
        </p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {assigned.map((m) => (
            <span
              key={m.userId}
              className="inline-flex items-center gap-1.5 rounded-md border bg-secondary/40 px-2.5 py-1 text-sm text-brand-navy"
            >
              {m.name}
              <span className="text-[11px] text-muted-foreground">{m.gradeLabel}</span>
              <Select
                value={m.assignmentRole}
                onValueChange={(next) => onChangeRole(m.userId, next)}
                disabled={pending}
              >
                <SelectTrigger className="h-6 w-[76px] text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ASSIGNMENT_ROLES.map((r) => (
                    <SelectItem key={r} value={r}>
                      {ASSIGNMENT_ROLE_LABELS[r]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <button
                type="button"
                onClick={() => onRemove(m.userId)}
                disabled={pending}
                aria-label="배정 해제"
                className="text-muted-foreground hover:text-red-600"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </span>
          ))}
        </div>
      )}

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="flex items-center gap-2">
        <Select value={pick} onValueChange={setPick}>
          <SelectTrigger className="w-full sm:w-64">
            <SelectValue placeholder="담당자 추가" />
          </SelectTrigger>
          <SelectContent>
            {assignable.length === 0 ? (
              <SelectItem value="none" disabled>
                추가할 직원이 없습니다
              </SelectItem>
            ) : (
              assignable.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.name}
                  {s.department ? ` · ${s.department}` : ""} ({s.gradeLabel})
                </SelectItem>
              ))
            )}
          </SelectContent>
        </Select>
        <Select
          value={pickRole}
          onValueChange={(v) => setPickRole(v as AssignmentRole)}
        >
          <SelectTrigger className="w-24">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ASSIGNMENT_ROLES.map((r) => (
              <SelectItem key={r} value={r}>
                {ASSIGNMENT_ROLE_LABELS[r]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button size="sm" onClick={onAssign} disabled={pending || !pick}>
          <UserPlus className="mr-1 h-4 w-4" /> 배정
        </Button>
      </div>
    </div>
  );
}
