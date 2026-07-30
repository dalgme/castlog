"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useFieldArray, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { FilePlus2, Plus, X } from "lucide-react";

import {
  approvalSubmitSchema,
  type ApprovalSubmitInput,
} from "@/lib/approvals/schemas";
import { APPROVAL_TYPE_LABELS, APPROVAL_TYPES } from "@/lib/approvals/constants";
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
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

import { submitApproval } from "./actions";

type UserOption = { id: string; name: string };
type ProjectOption = { id: string; name: string };

/**
 * 품의 상신 다이얼로그.
 * 결재라인은 전결규정이 자동 결정한다. 규정이 없을 때만 수동 라인을 지정한다.
 * 프로젝트 연결은 operations 모듈 활성 시에만 표시 (CLAUDE.md 1-2-6).
 */
export function SubmitApprovalDialog({
  tenantSlug,
  users,
  projects,
}: {
  tenantSlug: string;
  users: UserOption[];
  projects: ProjectOption[] | null; // null = operations 모듈 비활성
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [serverError, setServerError] = useState<string | null>(null);
  const [showManualLine, setShowManualLine] = useState(false);
  const router = useRouter();

  const form = useForm<ApprovalSubmitInput>({
    resolver: zodResolver(approvalSubmitSchema),
    defaultValues: {
      title: "",
      body: "",
      approvalType: "general",
      amount: "",
      projectId: "",
      manualSteps: [],
    },
  });

  const manualSteps = useFieldArray({ control: form.control, name: "manualSteps" });

  function onSubmit(values: ApprovalSubmitInput) {
    setServerError(null);
    startTransition(async () => {
      const result = await submitApproval(values);
      if (result.ok) {
        setOpen(false);
        form.reset();
        setShowManualLine(false);
        router.push(`/${tenantSlug}/approvals/${result.approvalId}`);
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
          form.reset();
          setServerError(null);
          setShowManualLine(false);
        }
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm">
          <FilePlus2 className="mr-1.5 h-4 w-4" />새 품의
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>품의 상신</DialogTitle>
          <DialogDescription>
            결재라인은 전결규정에 따라 자동 결정됩니다.
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
              name="title"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>제목</FormLabel>
                  <FormControl>
                    <Input placeholder="OO사업 전문가 자문비 지급 품의" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="grid grid-cols-2 gap-3">
              <FormField
                control={form.control}
                name="approvalType"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>유형</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {APPROVAL_TYPES.map((type) => (
                          <SelectItem key={type} value={type}>
                            {APPROVAL_TYPE_LABELS[type]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="amount"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>금액 (원, 선택)</FormLabel>
                    <FormControl>
                      <Input inputMode="numeric" placeholder="1000000" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            {projects && (
              <FormField
                control={form.control}
                name="projectId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>연결 프로젝트 (선택)</FormLabel>
                    <Select
                      onValueChange={(value) =>
                        field.onChange(value === "none" ? "" : value)
                      }
                      value={field.value || "none"}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="프로젝트 선택" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="none">연결 안 함</SelectItem>
                        {projects.map((p) => (
                          <SelectItem key={p.id} value={p.id}>
                            {p.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}
            <FormField
              control={form.control}
              name="body"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>내용</FormLabel>
                  <FormControl>
                    <Textarea rows={5} placeholder="품의 내용을 입력하세요." {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="rounded-md border p-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold">결재라인 직접 지정</p>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setShowManualLine((prev) => !prev);
                    if (!showManualLine && manualSteps.fields.length === 0) {
                      manualSteps.append({
                        stepOrder: "1",
                        stepKind: "approval",
                        approverUserId: "",
                      });
                    }
                  }}
                >
                  {showManualLine ? "접기" : "열기"}
                </Button>
              </div>
              <FormDescription className="mt-1">
                적용 가능한 전결규정이 없을 때만 사용됩니다. 같은 순번은 병렬
                합의(전원 승인)로 처리됩니다.
              </FormDescription>
              {showManualLine && (
                <div className="mt-3 space-y-2">
                  {manualSteps.fields.map((row, index) => (
                    <div key={row.id} className="flex items-center gap-2">
                      <FormField
                        control={form.control}
                        name={`manualSteps.${index}.stepOrder`}
                        render={({ field }) => (
                          <FormItem className="w-16">
                            <FormControl>
                              <Input inputMode="numeric" placeholder="순번" {...field} />
                            </FormControl>
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name={`manualSteps.${index}.stepKind`}
                        render={({ field }) => (
                          <FormItem className="w-24">
                            <Select onValueChange={field.onChange} value={field.value}>
                              <FormControl>
                                <SelectTrigger>
                                  <SelectValue />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent>
                                <SelectItem value="approval">결재</SelectItem>
                                <SelectItem value="agreement">합의</SelectItem>
                              </SelectContent>
                            </Select>
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name={`manualSteps.${index}.approverUserId`}
                        render={({ field }) => (
                          <FormItem className="flex-1">
                            <Select onValueChange={field.onChange} value={field.value}>
                              <FormControl>
                                <SelectTrigger>
                                  <SelectValue placeholder="결재자" />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent>
                                {users.map((u) => (
                                  <SelectItem key={u.id} value={u.id}>
                                    {u.name}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </FormItem>
                        )}
                      />
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => manualSteps.remove(index)}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      manualSteps.append({
                        stepOrder: String(
                          (manualSteps.fields.length > 0
                            ? Math.max(
                                ...form
                                  .getValues("manualSteps")!
                                  .map((s) => parseInt(s.stepOrder || "0", 10))
                              )
                            : 0) + 1
                        ),
                        stepKind: "approval",
                        approverUserId: "",
                      })
                    }
                  >
                    <Plus className="mr-1 h-3.5 w-3.5" />
                    단계 추가
                  </Button>
                </div>
              )}
            </div>

            <Button type="submit" className="w-full" disabled={pending}>
              {pending ? "상신 중..." : "상신"}
            </Button>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
