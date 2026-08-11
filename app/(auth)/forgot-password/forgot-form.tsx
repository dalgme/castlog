"use client";

import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import {
  forgotPasswordSchema,
  type ForgotPasswordInput,
} from "@/lib/auth/schemas";
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

import { requestPasswordReset } from "./actions";

/** 비밀번호 재설정 메일 요청 폼 (기업회원). */
export function ForgotPasswordForm() {
  const [pending, startTransition] = useTransition();
  const [serverError, setServerError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const form = useForm<ForgotPasswordInput>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: { email: "" },
  });

  function onSubmit(values: ForgotPasswordInput) {
    setServerError(null);
    startTransition(async () => {
      const res = await requestPasswordReset(values);
      if (res.ok) {
        setSent(true);
      } else {
        setServerError(res.error);
      }
    });
  }

  if (sent) {
    return (
      <Alert>
        <AlertDescription className="space-y-1">
          <p className="font-semibold text-foreground">
            재설정 메일을 보냈습니다.
          </p>
          <p className="text-sm text-muted-foreground">
            입력하신 이메일로 가입된 계정이 있다면 비밀번호 재설정 링크가
            전송됩니다. 메일함(스팸함 포함)을 확인해 주세요.
          </p>
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <FormField
          control={form.control}
          name="email"
          render={({ field }) => (
            <FormItem>
              <FormLabel>이메일</FormLabel>
              <FormControl>
                <Input
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  placeholder="name@company.com"
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {serverError && (
          <Alert variant="destructive">
            <AlertDescription>{serverError}</AlertDescription>
          </Alert>
        )}

        <Button type="submit" className="w-full" disabled={pending}>
          {pending ? "전송 중…" : "재설정 메일 받기"}
        </Button>
      </form>
    </Form>
  );
}
