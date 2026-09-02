"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Archive, Pencil, Trash2 } from "lucide-react";

import {
  projectCreateSchema,
  type ProjectCreateInput,
} from "@/lib/operations/schemas";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { CommaNumberInput } from "@/components/ui/comma-number-input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";

import {
  archiveProject,
  deleteEmptyProject,
  updateProjectBasicInfo,
} from "./basic-info-actions";

export type ProjectBasicInfo = {
  name: string;
  businessYear: string;
  clientName: string;
  code: string;
  startsOn: string;
  endsOn: string;
  budgetAmount: string;
  description: string;
  /** 주관·수행기관·D-Day (기획 2026-08-30 — 32번) */
  hostOrg: string;
  executorOrg: string;
  ddayDate: string;
};

/**
 * 프로젝트 기본정보 수정(대표·이사 + 그 프로젝트에 연결된 누구나 — 32번)
 * + 빈 프로젝트 삭제·보관 처리(대표·이사).
 * 삭제는 실적이 없는 중복 생성 건 정리용, 보관은 기록 있는 건의 취소 이관 —
 * 서버가 최종 판정한다 (기획 2026-08-30).
 */
export function BasicInfoDialog({
  tenantSlug,
  projectId,
  initial,
  canDelete = false,
}: {
  tenantSlug: string;
  projectId: string;
  initial: ProjectBasicInfo;
  /** 삭제·보관 처리 노출 — 대표·이사만 */
  canDelete?: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [serverError, setServerError] = useState<string | null>(null);

  const form = useForm<ProjectCreateInput>({
    resolver: zodResolver(projectCreateSchema),
    defaultValues: { ...initial, categoryId: "" },
  });

  function onSubmit(values: ProjectCreateInput) {
    setServerError(null);
    startTransition(async () => {
      const result = await updateProjectBasicInfo(projectId, values);
      if (result.ok) {
        setOpen(false);
        toast({ description: "기본정보를 저장했습니다." });
        router.refresh();
      } else {
        setServerError(result.error);
      }
    });
  }

  function onArchive() {
    const reason = window.prompt(
      "보관(취소) 사유를 입력하세요 — 기록에 남습니다.\n프로젝트는 삭제되지 않고 '설정 > 프로젝트 보관'으로 이관됩니다."
    );
    if (reason === null) return;
    setServerError(null);
    startTransition(async () => {
      const result = await archiveProject(projectId, reason);
      if (result.ok) {
        setOpen(false);
        toast({ description: "보관 처리했습니다. 설정 > 프로젝트 보관에서 확인할 수 있습니다." });
        router.push(`/${tenantSlug}/projects`);
      } else {
        setServerError(result.error);
      }
    });
  }

  function onDelete() {
    if (
      !window.confirm(
        "이 프로젝트를 삭제할까요?\n세션·섭외·품의 기록이 있으면 서버가 거부합니다 — 중복 생성된 빈 프로젝트 정리용입니다."
      )
    ) {
      return;
    }
    setServerError(null);
    startTransition(async () => {
      const result = await deleteEmptyProject(projectId);
      if (result.ok) {
        setOpen(false);
        toast({ description: "프로젝트를 삭제했습니다." });
        router.push(`/${tenantSlug}/projects`);
      } else {
        setServerError(result.error);
      }
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          form.reset({ ...initial, categoryId: "" });
          setServerError(null);
        }
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Pencil className="mr-1.5 h-3.5 w-3.5" />
          기본정보 수정
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>기본정보 수정</DialogTitle>
          <DialogDescription>
            프로젝트명·기간·예산 등 기초정보를 수정합니다 (대표·이사와 이
            프로젝트에 배정된 누구나). 발주처는 비워 둔 채 저장할 수 없습니다.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            {serverError && (
              <Alert variant="destructive">
                <AlertDescription>{serverError}</AlertDescription>
              </Alert>
            )}
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>프로젝트명</FormLabel>
                  <FormControl>
                    <Input {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="grid grid-cols-2 gap-3">
              <FormField
                control={form.control}
                name="businessYear"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>사업연도</FormLabel>
                    <FormControl>
                      <Input inputMode="numeric" maxLength={4} {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="code"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>관리 코드</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <FormField
              control={form.control}
              name="clientName"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>발주처 (필수)</FormLabel>
                  <FormControl>
                    <Input {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            {/* 주관·수행기관·D-Day (기획 2026-08-30 — 32번) */}
            <div className="grid grid-cols-2 gap-3">
              <FormField
                control={form.control}
                name="hostOrg"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>주관</FormLabel>
                    <FormControl>
                      <Input placeholder="예: OO시" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="executorOrg"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>수행기관</FormLabel>
                    <FormControl>
                      <Input placeholder="예: 넥스트랩" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <FormField
              control={form.control}
              name="ddayDate"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>D-Day 기준일 (행사일 등)</FormLabel>
                  <FormControl>
                    <Input type="date" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="grid grid-cols-2 gap-3">
              <FormField
                control={form.control}
                name="startsOn"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>시작일</FormLabel>
                    <FormControl>
                      <Input type="date" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="endsOn"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>종료일</FormLabel>
                    <FormControl>
                      <Input type="date" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <FormField
              control={form.control}
              name="budgetAmount"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>예산 (원)</FormLabel>
                  <FormControl>
                    <CommaNumberInput
                      value={field.value ?? ""}
                      onValueChange={field.onChange}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>설명</FormLabel>
                  <FormControl>
                    <Textarea rows={3} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="flex items-center justify-between gap-2 pt-1">
              {canDelete ? (
                <span className="flex items-center gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:text-destructive"
                    disabled={pending}
                    onClick={onDelete}
                  >
                    <Trash2 className="mr-1 h-3.5 w-3.5" />
                    삭제
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={pending}
                    onClick={onArchive}
                    title="기록이 있어 삭제할 수 없는 건을 취소 상태로 보관 이관합니다"
                  >
                    <Archive className="mr-1 h-3.5 w-3.5" />
                    보관 처리
                  </Button>
                </span>
              ) : (
                <span />
              )}
              <Button type="submit" disabled={pending}>
                {pending ? "저장 중..." : "저장"}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
