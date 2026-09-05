"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Paperclip, Trash2, Upload } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import {
  uploadProjectAttachment,
  deleteProjectAttachment,
} from "./attachment-actions";

export type AttachmentRow = {
  id: string;
  scope: string;
  expertId: string | null;
  expertName: string | null;
  fileName: string;
};

/**
 * 섭외요청·수락서 첨부 (공통 / 개별).
 *
 * 공통은 전원에게 같은 파일이 붙고, 개별은 고른 전문가에게만 붙는다. 두 가지를
 * 한 화면에 두는 이유는 실제로 함께 준비하기 때문이다 — 사업 안내문(공통) 하나
 * 올리고, 몇 사람만 다른 시간표(개별)를 붙인다.
 */
export function AttachmentPanel({
  projectId,
  purpose,
  title,
  description,
  experts,
  attachments,
}: {
  projectId: string;
  purpose: "engagement" | "acceptance";
  title: string;
  description: string;
  /** 개별 첨부 대상 후보 — 이 프로젝트에 배정·섭외된 전문가 */
  experts: { id: string; name: string }[];
  attachments: AttachmentRow[];
}) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [scope, setScope] = useState<"common" | "individual">("common");
  const [expertId, setExpertId] = useState<string>("");

  const common = attachments.filter((a) => a.scope === "common");
  const individual = attachments.filter((a) => a.scope === "individual");

  function upload() {
    const file = fileRef.current?.files?.[0];
    if (!file) {
      setError("파일을 선택하세요.");
      return;
    }
    if (scope === "individual" && !expertId) {
      setError("개별 첨부는 대상 전문가를 고르세요.");
      return;
    }
    setError(null);
    const formData = new FormData();
    formData.set("projectId", projectId);
    formData.set("purpose", purpose);
    formData.set("scope", scope);
    formData.set("expertId", scope === "individual" ? expertId : "");
    formData.set("file", file);
    formData.set("fileName", file.name); // 한글 파일명 보전
    startTransition(async () => {
      const res = await uploadProjectAttachment(formData);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      if (fileRef.current) fileRef.current.value = "";
      router.refresh();
    });
  }

  function remove(id: string) {
    setError(null);
    startTransition(async () => {
      const res = await deleteProjectAttachment(id);
      if (!res.ok) setError(res.error);
      else router.refresh();
    });
  }

  return (
    <div className="rounded-lg border p-3">
      <p className="flex items-center gap-1.5 text-sm font-semibold">
        <Paperclip className="h-3.5 w-3.5 text-brand" aria-hidden />
        {title}
      </p>
      <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
        {description}
      </p>

      {error && (
        <Alert variant="destructive" className="mt-2">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="mt-3 flex flex-wrap items-end gap-2">
        <div>
          <Label className="text-[11px] text-muted-foreground">범위</Label>
          <Select
            value={scope}
            onValueChange={(v) => setScope(v as "common" | "individual")}
          >
            <SelectTrigger className="h-9 w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="common">공통 (전원)</SelectItem>
              <SelectItem value="individual">개별 (1명)</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {scope === "individual" && (
          <div>
            <Label className="text-[11px] text-muted-foreground">대상</Label>
            <Select value={expertId} onValueChange={setExpertId}>
              <SelectTrigger className="h-9 w-40">
                <SelectValue placeholder="전문가 선택" />
              </SelectTrigger>
              <SelectContent>
                {experts.map((e) => (
                  <SelectItem key={e.id} value={e.id}>
                    {e.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        <input
          ref={fileRef}
          type="file"
          accept=".pdf,.jpg,.jpeg,.png"
          className="text-sm file:mr-3 file:rounded-md file:border file:border-input file:bg-transparent file:px-3 file:py-1.5 file:text-sm file:font-medium"
        />
        <Button size="sm" onClick={upload} disabled={pending}>
          <Upload className="mr-1.5 h-3.5 w-3.5" />
          {pending ? "올리는 중…" : "첨부"}
        </Button>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        PDF · JPG · PNG, 10MB 이하. 첨부는 화면 안에서만 열람됩니다(공개 링크 없음).
      </p>

      {(common.length > 0 || individual.length > 0) && (
        <div className="mt-3 space-y-2">
          {common.length > 0 && (
            <div>
              <p className="text-xs font-semibold">공통 첨부 ({common.length})</p>
              <ul className="mt-1 divide-y">
                {common.map((a) => (
                  <li
                    key={a.id}
                    className="flex items-center gap-2 py-1.5 text-sm"
                  >
                    <span className="min-w-0 flex-1 truncate">{a.fileName}</span>
                    <button
                      type="button"
                      aria-label={`${a.fileName} 삭제`}
                      disabled={pending}
                      onClick={() => remove(a.id)}
                      className="rounded p-1 text-muted-foreground hover:text-destructive"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {individual.length > 0 && (
            <div>
              <p className="text-xs font-semibold">
                개별 첨부 ({individual.length})
              </p>
              <ul className="mt-1 divide-y">
                {individual.map((a) => (
                  <li
                    key={a.id}
                    className="flex items-center gap-2 py-1.5 text-sm"
                  >
                    <span className="shrink-0 rounded bg-secondary px-1.5 py-0.5 text-xs font-medium">
                      {a.expertName ?? "전문가"}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{a.fileName}</span>
                    <button
                      type="button"
                      aria-label={`${a.fileName} 삭제`}
                      disabled={pending}
                      onClick={() => remove(a.id)}
                      className="rounded p-1 text-muted-foreground hover:text-destructive"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
