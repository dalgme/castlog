"use client";

import { useState, useTransition } from "react";
import { useFieldArray, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Plus, X } from "lucide-react";

import { ruleSaveSchema, type RuleSaveInput } from "@/lib/approvals/schemas";
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

import { saveApprovalRule } from "../actions";

type UserOption = { id: string; name: string };

export type RulePrefill = {
  baseRuleId: string;
  name: string;
  approvalType: string;
  minAmount: string;
  maxAmount: string;
  priority: string;
  steps: { stepOrder: string; stepKind: "approval" | "agreement"; approverUserId: string }[];
};

/** 전결규정 생성·개정 다이얼로그 — 개정 시 새 버전이 생성되고 구 버전은 이력으로 보존 */
export function RuleDialog({
  users,
  prefill,
  trigger,
}: {
  users: UserOption[];
  prefill?: RulePrefill;
  trigger: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [serverError, setServerError] = useState<string | null>(null);

  const form = useForm<RuleSaveInput>({
    resolver: zodResolver(ruleSaveSchema),
    defaultValues: prefill
      ? {
          baseRuleId: prefill.baseRuleId,
          name: prefill.name,
          approvalType:
            (prefill.approvalType as RuleSaveInput["approvalType"]) || "",
          minAmount: prefill.minAmount,
          maxAmount: prefill.maxAmount,
          priority: prefill.priority,
          steps: prefill.steps,
        }
      : {
          baseRuleId: "",
          name: "",
          approvalType: "",
          minAmount: "",
          maxAmount: "",
          priority: "0",
          steps: [{ stepOrder: "1", stepKind: "approval", approverUserId: "" }],
        },
  });

  const steps = useFieldArray({ control: form.control, name: "steps" });

  function onSubmit(values: RuleSaveInput) {
    setServerError(null);
    startTransition(async () => {
      const result = await saveApprovalRule(values);
      if (result.ok) {
        setOpen(false);
        form.reset();
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
        if (!next) setServerError(null);
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {prefill ? `전결규정 개정 — ${prefill.name}` : "전결규정 등록"}
          </DialogTitle>
          <DialogDescription>
            상신 시 유형·금액 구간이 일치하는 규정(우선순위 높은 순)이 결재라인을
            자동 결정합니다. {prefill && "개정하면 새 버전이 적용되고 기존 버전은 이력으로 남습니다."}
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
                  <FormLabel>규정명</FormLabel>
                  <FormControl>
                    <Input placeholder="100만원 이하 지출 전결" {...field} />
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
                    <FormLabel>결재 유형</FormLabel>
                    <Select
                      onValueChange={(value) =>
                        field.onChange(value === "all" ? "" : value)
                      }
                      value={field.value || "all"}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="all">전체 유형</SelectItem>
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
                name="priority"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>우선순위 (클수록 우선)</FormLabel>
                    <FormControl>
                      <Input inputMode="numeric" maxLength={3} {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <FormField
                control={form.control}
                name="minAmount"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>최소 금액 (원, 선택)</FormLabel>
                    <FormControl>
                      <Input inputMode="numeric" placeholder="0" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="maxAmount"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>최대 금액 (원, 선택)</FormLabel>
                    <FormControl>
                      <Input inputMode="numeric" placeholder="1000000" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="space-y-2 rounded-md border p-3">
              <p className="text-sm font-semibold">
                결재라인 (같은 순번 = 병렬 합의)
              </p>
              {steps.fields.map((row, index) => (
                <div key={row.id} className="flex items-center gap-2">
                  <FormField
                    control={form.control}
                    name={`steps.${index}.stepOrder`}
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
                    name={`steps.${index}.stepKind`}
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
                    name={`steps.${index}.approverUserId`}
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
                    onClick={() => steps.remove(index)}
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
                  steps.append({
                    stepOrder: String(
                      Math.max(
                        0,
                        ...form
                          .getValues("steps")
                          .map((s) => parseInt(s.stepOrder || "0", 10))
                      ) + 1
                    ),
                    stepKind: "approval",
                    approverUserId: "",
                  })
                }
              >
                <Plus className="mr-1 h-3.5 w-3.5" />
                단계 추가
              </Button>
              <FormField
                control={form.control}
                name="steps"
                render={() => <FormMessage />}
              />
            </div>

            <Button type="submit" className="w-full" disabled={pending}>
              {pending ? "저장 중..." : prefill ? "개정 저장" : "규정 등록"}
            </Button>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
