"use client";

import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import {
  expertOtpSchema,
  expertPhoneSchema,
  type ExpertOtpInput,
  type ExpertPhoneInput,
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

import { requestExpertOtp, verifyExpertOtp } from "./actions";

/**
 * 전문가 휴대폰 OTP 로그인 — 2단계 (번호 입력 → 인증번호 검증).
 * 모바일 완전 대응 최우선 대상 (설계문서 8.1).
 */
export function ExpertLoginForm({ next }: { next: string | null }) {
  const [step, setStep] = useState<"phone" | "verify">("phone");
  const [pending, startTransition] = useTransition();
  const [serverError, setServerError] = useState<string | null>(null);

  const phoneForm = useForm<ExpertPhoneInput>({
    resolver: zodResolver(expertPhoneSchema),
    defaultValues: { phone: "" },
  });

  const otpForm = useForm<ExpertOtpInput>({
    resolver: zodResolver(expertOtpSchema),
    defaultValues: { phone: "", token: "" },
  });

  function onRequestOtp(values: ExpertPhoneInput) {
    setServerError(null);
    startTransition(async () => {
      const result = await requestExpertOtp(values);
      if (result.ok) {
        otpForm.reset({ phone: values.phone, token: "" });
        setStep("verify");
      } else {
        setServerError(result.error);
      }
    });
  }

  function onVerifyOtp(values: ExpertOtpInput) {
    setServerError(null);
    startTransition(async () => {
      const result = await verifyExpertOtp(values, next);
      if (result?.error) setServerError(result.error);
    });
  }

  if (step === "phone") {
    return (
      <Form {...phoneForm}>
        <form onSubmit={phoneForm.handleSubmit(onRequestOtp)} className="space-y-4">
          {serverError && (
            <Alert variant="destructive">
              <AlertDescription>{serverError}</AlertDescription>
            </Alert>
          )}
          <FormField
            control={phoneForm.control}
            name="phone"
            render={({ field }) => (
              <FormItem>
                <FormLabel>휴대폰 번호</FormLabel>
                <FormControl>
                  <Input
                    type="tel"
                    inputMode="tel"
                    autoComplete="tel"
                    placeholder="010-1234-5678"
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <Button type="submit" className="w-full" disabled={pending}>
            {pending ? "발송 중..." : "인증번호 받기"}
          </Button>
        </form>
      </Form>
    );
  }

  return (
    <Form {...otpForm}>
      <form onSubmit={otpForm.handleSubmit(onVerifyOtp)} className="space-y-4">
        {serverError && (
          <Alert variant="destructive">
            <AlertDescription>{serverError}</AlertDescription>
          </Alert>
        )}
        <p className="text-sm text-muted-foreground">
          <span className="font-medium text-foreground">
            {otpForm.getValues("phone")}
          </span>
          로 발송된 인증번호 6자리를 입력하세요.
        </p>
        <FormField
          control={otpForm.control}
          name="token"
          render={({ field }) => (
            <FormItem>
              <FormLabel>인증번호</FormLabel>
              <FormControl>
                <Input
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  placeholder="123456"
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <Button type="submit" className="w-full" disabled={pending}>
          {pending ? "확인 중..." : "로그인"}
        </Button>
        <Button
          type="button"
          variant="ghost"
          className="w-full"
          disabled={pending}
          onClick={() => {
            setServerError(null);
            setStep("phone");
          }}
        >
          번호 다시 입력
        </Button>
      </form>
    </Form>
  );
}
