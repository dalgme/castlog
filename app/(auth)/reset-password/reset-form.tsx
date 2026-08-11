"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import {
  resetPasswordSchema,
  type ResetPasswordInput,
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

import { updatePassword } from "./actions";

/** 새 비밀번호 설정 폼. */
export function ResetPasswordForm() {
  const [pending, startTransition] = useTransition();
  const [serverError, setServerError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const form = useForm<ResetPasswordInput>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: { password: "", confirm: "" },
  });

  function onSubmit(values: ResetPasswordInput) {
    setServerError(null);
    startTransition(async () => {
      const res = await updatePassword(values);
      if (res.ok) {
        setDone(true);
      } else {
        setServerError(res.error);
      }
    });
  }

  if (done) {
    return (
      <div className="space-y-4">
        <Alert>
          <AlertDescription className="space-y-1">
            <p className="font-semibold text-foreground">
              비밀번호가 변경되었습니다.
            </p>
            <p className="text-sm text-muted-foreground">
              새 비밀번호로 로그인해 주세요.
            </p>
          </AlertDescription>
        </Alert>
        <Button asChild className="w-full">
          <Link href="/login">로그인하러 가기</Link>
        </Button>
      </div>
    );
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <FormField
          control={form.control}
          name="password"
          render={({ field }) => (
            <FormItem>
              <FormLabel>새 비밀번호</FormLabel>
              <FormControl>
                <Input
                  type="password"
                  autoComplete="new-password"
                  placeholder="8자 이상"
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="confirm"
          render={({ field }) => (
            <FormItem>
              <FormLabel>새 비밀번호 확인</FormLabel>
              <FormControl>
                <Input
                  type="password"
                  autoComplete="new-password"
                  placeholder="다시 입력"
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
          {pending ? "변경 중…" : "비밀번호 변경"}
        </Button>
      </form>
    </Form>
  );
}
