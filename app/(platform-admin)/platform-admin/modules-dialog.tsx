"use client";

import { useState, useTransition } from "react";

import { MODULE_KEYS, MODULE_LABELS, type ModuleFlags } from "@/lib/modules/modules";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";

import { updateTenantModules } from "./actions";

/** 테넌트 모듈 조합 변경 다이얼로그 */
export function TenantModulesDialog({
  tenantId,
  tenantName,
  modules,
}: {
  tenantId: string;
  tenantName: string;
  modules: ModuleFlags;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<ModuleFlags>(modules);
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();

  function onSave() {
    startTransition(async () => {
      const result = await updateTenantModules({ tenantId, modules: draft });
      if (result.ok) {
        toast({ description: "모듈 설정이 변경되었습니다." });
        setOpen(false);
      } else {
        toast({ variant: "destructive", description: result.error });
      }
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setDraft(modules);
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          모듈
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>모듈 설정 — {tenantName}</DialogTitle>
          <DialogDescription>
            비활성화한 모듈은 해당 테넌트에서 즉시 숨겨지고 서버 게이트로
            차단됩니다.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          {MODULE_KEYS.map((key) => (
            <label
              key={key}
              className="flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm"
            >
              <Checkbox
                checked={draft[key]}
                disabled={pending}
                onCheckedChange={(checked) =>
                  setDraft((prev) => ({ ...prev, [key]: checked === true }))
                }
              />
              <span>{MODULE_LABELS[key]}</span>
            </label>
          ))}
        </div>
        <Button type="button" className="w-full" disabled={pending} onClick={onSave}>
          {pending ? "저장 중..." : "저장"}
        </Button>
      </DialogContent>
    </Dialog>
  );
}
