"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Pencil, Trash2 } from "lucide-react";

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

import { deleteEmptyProject, updateProjectBasicInfo } from "./basic-info-actions";

export type ProjectBasicInfo = {
  name: string;
  businessYear: string;
  clientName: string;
  code: string;
  startsOn: string;
  endsOn: string;
  budgetAmount: string;
  description: string;
};

/**
 * 프로젝트 기본정보 수정 + 빈 프로젝트 삭제 (대표·이사 전용 — 기획 2026-08-30).
 * 삭제는 실적(세션·섭외·품의)이 없는 중복 생성 건 정리용 — 서버가 최종 판정한다.
 */
export function BasicInfoDialog({
  tenantSlug,
  projectId,
  initial,
}: {
  tenantSlug: string;
  projectId: string;
  initial: ProjectBasicInfo;
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
            프로젝트명·기간·예산 등 기초정보를 수정합니다 (대표·이사 전용).
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
                  <FormLabel>발주처</FormLabel>
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
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-destructive hover:text-destructive"
                disabled={pending}
                onClick={onDelete}
              >
                <Trash2 className="mr-1 h-3.5 w-3.5" />
                프로젝트 삭제
              </Button>
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
