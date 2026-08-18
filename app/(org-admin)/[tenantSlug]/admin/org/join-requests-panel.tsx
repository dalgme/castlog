"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Copy, Check, Link2 } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { GRADE_LABELS, USER_GRADES } from "@/lib/auth/grades";

import { approveJoinRequest, rejectJoinRequest } from "./join-actions";

export type JoinRequestRow = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  department: string | null;
  note: string | null;
  createdAt: string;
};

/**
 * 임직원 가입 신청 승인 — 대표 또는 staff 위임자.
 * 권한단계는 여기서 정한다(신청서에는 등급 항목이 없다).
 */
export function JoinRequestsPanel({
  joinUrl,
  requests,
  positions,
  canGrantCeo,
}: {
  joinUrl: string;
  requests: JoinRequestRow[];
  positions: { id: string; name: string }[];
  canGrantCeo: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [issued, setIssued] = useState<{ email: string; tempPassword: string } | null>(
    null
  );
  const [copied, setCopied] = useState<string | null>(null);
  const [grades, setGrades] = useState<Record<string, string>>({});
  const [positionIds, setPositionIds] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});

  const grantable = USER_GRADES.filter((g) => canGrantCeo || g !== "ceo");

  const copy = (text: string, key: string) => {
    navigator.clipboard?.writeText(text).then(() => {
      setCopied(key);
      setTimeout(() => setCopied(null), 1500);
    });
  };

  const approve = (id: string) => {
    const grade = grades[id];
    if (!grade) return setError("권한단계를 선택하세요.");
    setError(null);
    startTransition(async () => {
      const r = await approveJoinRequest({
        requestId: id,
        grade,
        positionId: positionIds[id] ?? "",
        note: notes[id] ?? "",
      });
      if (!r.ok) setError(r.error);
      else {
        setIssued({ email: r.email, tempPassword: r.tempPassword });
        router.refresh();
      }
    });
  };

  const reject = (id: string) => {
    setError(null);
    startTransition(async () => {
      const r = await rejectJoinRequest(id, notes[id] ?? "");
      if (!r.ok) setError(r.error);
      else router.refresh();
    });
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 rounded-md bg-secondary/50 p-2.5">
        <Link2 className="h-4 w-4 flex-none text-muted-foreground" aria-hidden />
        <span className="text-xs text-muted-foreground">임직원 가입 신청 링크</span>
        <code className="flex-1 truncate rounded bg-white px-2 py-1 text-xs">
          {joinUrl}
        </code>
        <Button size="sm" variant="outline" onClick={() => copy(joinUrl, "url")}>
          {copied === "url" ? (
            <Check className="h-4 w-4" />
          ) : (
            <Copy className="h-4 w-4" />
          )}
        </Button>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {issued && (
        <Alert>
          <AlertDescription>
            <p className="mb-2 text-sm">
              <b>{issued.email}</b> 계정을 만들었습니다. 임시 비밀번호는 지금 한 번만
              표시되며 저장되지 않습니다. 본인에게 안전한 경로로 전달하세요.
            </p>
            <div className="flex items-center gap-2">
              <code className="flex-1 rounded bg-secondary/70 px-2 py-1 text-sm">
                {issued.tempPassword}
              </code>
              <Button
                size="sm"
                variant="outline"
                onClick={() => copy(issued.tempPassword, "pw")}
              >
                {copied === "pw" ? (
                  <Check className="h-4 w-4" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      )}

      {requests.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          대기 중인 가입 신청이 없습니다. 위 링크를 임직원에게 전달하세요.
        </p>
      ) : (
        <ul className="space-y-3">
          {requests.map((r) => (
            <li key={r.id} className="rounded-lg border p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold">{r.name}</span>
                <Badge variant="secondary">{r.email}</Badge>
                {r.department && (
                  <span className="text-xs text-muted-foreground">{r.department}</span>
                )}
                {r.phone && (
                  <span className="text-xs text-muted-foreground">{r.phone}</span>
                )}
                <span className="text-xs text-muted-foreground">
                  {new Date(r.createdAt).toLocaleString("ko-KR", {
                    timeZone: "Asia/Seoul",
                    month: "numeric",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
              </div>
              {r.note && (
                <p className="mt-1.5 whitespace-pre-wrap rounded-md bg-secondary/50 p-2 text-sm">
                  {r.note}
                </p>
              )}
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Select
                  value={grades[r.id] ?? ""}
                  onValueChange={(v) =>
                    setGrades((prev) => ({ ...prev, [r.id]: v }))
                  }
                >
                  <SelectTrigger className="h-9 w-36">
                    <SelectValue placeholder="권한단계" />
                  </SelectTrigger>
                  <SelectContent>
                    {grantable.map((g) => (
                      <SelectItem key={g} value={g}>
                        {GRADE_LABELS[g]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {positions.length > 0 && (
                  <Select
                    value={positionIds[r.id] ?? ""}
                    onValueChange={(v) =>
                      setPositionIds((prev) => ({ ...prev, [r.id]: v }))
                    }
                  >
                    <SelectTrigger className="h-9 w-32">
                      <SelectValue placeholder="직급(선택)" />
                    </SelectTrigger>
                    <SelectContent>
                      {positions.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                <Input
                  value={notes[r.id] ?? ""}
                  onChange={(e) =>
                    setNotes((prev) => ({ ...prev, [r.id]: e.target.value }))
                  }
                  placeholder="처리 메모 (선택)"
                  className="h-9 max-w-[200px]"
                />
                <Button size="sm" disabled={pending} onClick={() => approve(r.id)}>
                  승인 · 계정 생성
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={pending}
                  onClick={() => reject(r.id)}
                >
                  반려
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
