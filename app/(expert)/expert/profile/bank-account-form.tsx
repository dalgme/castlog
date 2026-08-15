"use client";

import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import { bankAccountSchema, type BankAccountInput } from "@/lib/experts/schemas";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";

import { saveBankAccount } from "./actions";

/**
 * 계좌(통장) 정보 입력 — 계좌번호는 암호화 저장(평문 미표시).
 * 이미 등록된 경우 마지막 4자리만 표시하고, 비워두면 기존 값을 유지한다.
 */
export function BankAccountForm({
  defaultValues,
  maskedLast4,
}: {
  defaultValues: Pick<BankAccountInput, "bankName" | "accountHolder">;
  maskedLast4?: string | null;
}) {
  const [pending, startTransition] = useTransition();
  const [serverError, setServerError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const form = useForm<BankAccountInput>({
    resolver: zodResolver(bankAccountSchema),
    defaultValues: {
      bankName: defaultValues.bankName ?? "",
      accountHolder: defaultValues.accountHolder ?? "",
      accountNumber: "",
    },
  });

  function onSubmit(values: BankAccountInput) {
    setServerError(null);
    setSaved(false);
    startTransition(async () => {
      const result = await saveBankAccount(values);
      if (result.ok) {
        setSaved(true);
        form.setValue("accountNumber", "");
      } else {
        setServerError(result.error);
      }
    });
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        {serverError && (
          <Alert variant="destructive">
            <AlertDescription>{serverError}</AlertDescription>
          </Alert>
        )}
        {saved && (
          <Alert>
            <AlertDescription>계좌 정보가 저장되었습니다.</AlertDescription>
          </Alert>
        )}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <FormField
            control={form.control}
            name="bankName"
            render={({ field }) => (
              <FormItem>
                <FormLabel>은행 (선택)</FormLabel>
                <FormControl>
                  <Input placeholder="예: 국민은행" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="accountHolder"
            render={({ field }) => (
              <FormItem>
                <FormLabel>예금주 (선택)</FormLabel>
                <FormControl>
                  <Input autoComplete="name" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
        <FormField
          control={form.control}
          name="accountNumber"
          render={({ field }) => (
            <FormItem>
              <FormLabel>계좌번호</FormLabel>
              <FormControl>
                <Input
                  inputMode="numeric"
                  placeholder={
                    maskedLast4
                      ? `등록됨 · ****${maskedLast4} (변경 시에만 입력)`
                      : "숫자만 입력 (- 가능)"
                  }
                  autoComplete="off"
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <p className="text-xs text-muted-foreground">
          계좌번호는 암호화되어 안전하게 보관되며 화면에는 마지막 4자리만
          표시됩니다. 지급 단계에서 지정된 담당자만 열람할 수 있습니다.
        </p>
        <Button type="submit" disabled={pending}>
          {pending ? "저장 중..." : "계좌 정보 저장"}
        </Button>
      </form>
    </Form>
  );
}
