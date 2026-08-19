"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Trash2 } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { updateStaffProfile, deleteStaffUser } from "./actions";

export type StaffEditTarget = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  department: string | null;
  positionId: string | null;
};

const NO_POSITION = "__none__";

/**
 * 직원 정보 수정 · 삭제.
 *
 * 정보 수정에는 권한단계가 없다 — 등급 변경은 표의 별도 선택 상자에서 한다.
 * 부서 오타를 고치다가 등급을 잘못 건드리는 일을 만들지 않는다. 그래서 본인
 * 정보도 여기서 고칠 수 있다.
 *
 * 삭제는 업무 이력이 없는 계정만 된다. 서버가 막으면 왜 막았는지와 대안
 * (비활성화)을 그대로 보여 준다 — '실패했습니다'만 띄우면 사용자는 다시 누른다.
 */
export function StaffEditDialog({
  target,
  positions,
  isSelf,
  isCeoTarget,
}: {
  target: StaffEditTarget;
  positions: { id: string; name: string }[];
  isSelf: boolean;
  /** 대상이 대표인가 — 대표 계정은 삭제 대상이 아니다 */
  isCeoTarget: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [blockedBy, setBlockedBy] = useState<string[]>([]);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const [name, setName] = useState(target.name);
  const [email, setEmail] = useState(target.email);
  const [phone, setPhone] = useState(target.phone ?? "");
  const [department, setDepartment] = useState(target.department ?? "");
  const [positionId, setPositionId] = useState(target.positionId ?? NO_POSITION);

  function save() {
    setError(null);
    setBlockedBy([]);
    startTransition(async () => {
      const res = await updateStaffProfile({
        userId: target.id,
        name,
        email,
        phone,
        department,
        positionId: positionId === NO_POSITION ? "" : positionId,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setOpen(false);
      router.refresh();
    });
  }

  function remove() {
    setError(null);
    setBlockedBy([]);
    startTransition(async () => {
      const res = await deleteStaffUser(target.id);
      if (!res.ok) {
        setError(res.error);
        setBlockedBy(res.blockedBy ?? []);
        setConfirmDelete(false);
        return;
      }
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setError(null);
          setBlockedBy([]);
          setConfirmDelete(false);
        }
      }}
    >
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" aria-label={`${target.name} 정보 수정`}>
          <Pencil className="h-3.5 w-3.5" />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>직원 정보 수정</DialogTitle>
          <DialogDescription>
            권한단계는 목록의 선택 상자에서 바꿉니다. 여기서는 이름·연락처·소속만
            고칩니다.
          </DialogDescription>
        </DialogHeader>

        {error && (
          <Alert variant="destructive">
            <AlertDescription>
              {error}
              {blockedBy.length > 0 && (
                <ul className="mt-1.5 space-y-0.5">
                  {blockedBy.map((b) => (
                    <li key={b} className="text-xs">
                      · {b}
                    </li>
                  ))}
                </ul>
              )}
            </AlertDescription>
          </Alert>
        )}

        <div className="space-y-3">
          <div>
            <Label htmlFor="staff-name">이름</Label>
            <Input
              id="staff-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={50}
            />
          </div>
          <div>
            <Label htmlFor="staff-email">이메일 (로그인 아이디)</Label>
            <Input
              id="staff-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <p className="mt-1 text-xs text-muted-foreground">
              바꾸면 다음 로그인부터 새 주소로 들어와야 합니다. 본인에게 반드시
              알려 주세요.
            </p>
          </div>
          <div>
            <Label htmlFor="staff-phone">휴대폰</Label>
            <Input
              id="staff-phone"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              inputMode="tel"
              maxLength={30}
              placeholder="010-0000-0000"
            />
          </div>
          <div>
            <Label htmlFor="staff-department">부서</Label>
            <Input
              id="staff-department"
              value={department}
              onChange={(e) => setDepartment(e.target.value)}
              maxLength={50}
            />
          </div>
          <div>
            <Label>직급</Label>
            <Select value={positionId} onValueChange={setPositionId}>
              <SelectTrigger>
                <SelectValue placeholder="직급 선택" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_POSITION}>지정 안 함</SelectItem>
                {positions.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
            취소
          </Button>
          <Button className="flex-1" onClick={save} disabled={pending}>
            {pending ? "저장 중…" : "저장"}
          </Button>
        </div>

        {/* 삭제 — 되돌릴 수 없으므로 접어 두고 2단계 확인을 거친다 (§14-3) */}
        {!isSelf && !isCeoTarget && (
          <details className="rounded-lg border border-destructive/30 p-3">
            <summary className="cursor-pointer text-xs font-semibold text-destructive">
              계정 삭제
            </summary>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              업무 이력이 없는 계정만 지워집니다. 결재·배정·사용 기록이 있으면
              삭제 대신 <strong>비활성화</strong>하세요 — 로그인은 막히고 기록은
              그대로 남습니다. 이력이 걸린 계정을 지우면 ‘누가 했는지 모르는
              기록’이 생깁니다.
            </p>
            {confirmDelete ? (
              <div className="mt-2 flex gap-2">
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={remove}
                  disabled={pending}
                >
                  {pending ? "삭제 중…" : `정말 ${target.name} 계정을 삭제합니다`}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setConfirmDelete(false)}
                  disabled={pending}
                >
                  취소
                </Button>
              </div>
            ) : (
              <Button
                size="sm"
                variant="outline"
                className="mt-2 border-destructive/40 text-destructive"
                onClick={() => setConfirmDelete(true)}
                disabled={pending}
              >
                <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                삭제하기
              </Button>
            )}
          </details>
        )}
      </DialogContent>
    </Dialog>
  );
}
