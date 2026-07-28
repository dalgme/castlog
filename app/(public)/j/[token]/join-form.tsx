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
import {
  joinRegistrationSchema,
  type JoinRegistrationInput,
} from "@/lib/experts/schemas";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

import {
  completeExpertRegistration,
  requestJoinOtp,
  verifyJoinOtp,
} from "./actions";

type Step = "phone" | "otp" | "profile";

/**
 * 전문가 등록 3단계: 휴대폰 인증 → 인증번호 확인 → 프로필·필수 동의.
 * 공개 페이지 · 모바일 완전 대응 (설계문서 8.1).
 */
export function ExpertJoinForm({
  token,
  invitedName,
  invitedPhone,
}: {
  token: string;
  invitedName: string | null;
  invitedPhone: string | null;
}) {
  const [step, setStep] = useState<Step>("phone");
  const [pending, startTransition] = useTransition();
  const [serverError, setServerError] = useState<string | null>(null);

  const phoneForm = useForm<ExpertPhoneInput>({
    resolver: zodResolver(expertPhoneSchema),
    defaultValues: { phone: invitedPhone ?? "" },
  });

  const otpForm = useForm<ExpertOtpInput>({
    resolver: zodResolver(expertOtpSchema),
    defaultValues: { phone: "", token: "" },
  });

  const profileForm = useForm<JoinRegistrationInput>({
    resolver: zodResolver(joinRegistrationSchema),
    defaultValues: {
      name: invitedName ?? "",
      email: "",
      specialty: "",
      region: "",
      careerYears: "",
      bio: "",
    },
  });

  function onRequestOtp(values: ExpertPhoneInput) {
    setServerError(null);
    startTransition(async () => {
      const result = await requestJoinOtp(token, values);
      if (result.ok) {
        otpForm.reset({ phone: values.phone, token: "" });
        setStep("otp");
      } else {
        setServerError(result.error);
      }
    });
  }

  function onVerifyOtp(values: ExpertOtpInput) {
    setServerError(null);
    startTransition(async () => {
      const result = await verifyJoinOtp(token, values);
      if (result.ok) {
        setStep("profile");
      } else {
        setServerError(result.error);
      }
    });
  }

  function onComplete(values: JoinRegistrationInput) {
    setServerError(null);
    startTransition(async () => {
      const result = await completeExpertRegistration(token, values);
      if (result?.error) setServerError(result.error);
    });
  }

  const errorAlert = serverError && (
    <Alert variant="destructive">
      <AlertDescription>{serverError}</AlertDescription>
    </Alert>
  );

  if (step === "phone") {
    return (
      <Form {...phoneForm}>
        <form onSubmit={phoneForm.handleSubmit(onRequestOtp)} className="space-y-4">
          {errorAlert}
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
                    readOnly={Boolean(invitedPhone)}
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

  if (step === "otp") {
    return (
      <Form {...otpForm}>
        <form onSubmit={otpForm.handleSubmit(onVerifyOtp)} className="space-y-4">
          {errorAlert}
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
            {pending ? "확인 중..." : "인증 확인"}
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

  return (
    <Form {...profileForm}>
      <form onSubmit={profileForm.handleSubmit(onComplete)} className="space-y-4">
        {errorAlert}
        <FormField
          control={profileForm.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>이름</FormLabel>
              <FormControl>
                <Input autoComplete="name" placeholder="홍길동" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={profileForm.control}
          name="email"
          render={({ field }) => (
            <FormItem>
              <FormLabel>이메일 (선택)</FormLabel>
              <FormControl>
                <Input
                  type="email"
                  autoComplete="email"
                  placeholder="name@example.com"
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <div className="grid grid-cols-2 gap-3">
          <FormField
            control={profileForm.control}
            name="specialty"
            render={({ field }) => (
              <FormItem>
                <FormLabel>전문분야 (선택)</FormLabel>
                <FormControl>
                  <Input placeholder="사업계획서" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={profileForm.control}
            name="region"
            render={({ field }) => (
              <FormItem>
                <FormLabel>활동지역 (선택)</FormLabel>
                <FormControl>
                  <Input placeholder="서울" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
        <FormField
          control={profileForm.control}
          name="careerYears"
          render={({ field }) => (
            <FormItem>
              <FormLabel>경력 연차 (선택)</FormLabel>
              <FormControl>
                <Input inputMode="numeric" maxLength={2} placeholder="10" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={profileForm.control}
          name="bio"
          render={({ field }) => (
            <FormItem>
              <FormLabel>소개 (선택)</FormLabel>
              <FormControl>
                <Textarea rows={3} placeholder="주요 이력과 프로젝트를 간단히 소개해 주세요." {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="space-y-2.5 rounded-md border p-3">
          <FormField
            control={profileForm.control}
            name="termsOfService"
            render={({ field }) => (
              <FormItem className="flex flex-row items-start gap-2 space-y-0">
                <FormControl>
                  <Checkbox
                    checked={field.value === true}
                    onCheckedChange={(checked) =>
                      field.onChange(checked === true ? true : undefined)
                    }
                  />
                </FormControl>
                <div className="space-y-1 leading-none">
                  <FormLabel className="text-sm font-normal">
                    (필수) 이용약관에 동의합니다
                  </FormLabel>
                  <FormMessage />
                </div>
              </FormItem>
            )}
          />
          <FormField
            control={profileForm.control}
            name="privacyCollection"
            render={({ field }) => (
              <FormItem className="flex flex-row items-start gap-2 space-y-0">
                <FormControl>
                  <Checkbox
                    checked={field.value === true}
                    onCheckedChange={(checked) =>
                      field.onChange(checked === true ? true : undefined)
                    }
                  />
                </FormControl>
                <div className="space-y-1 leading-none">
                  <FormLabel className="text-sm font-normal">
                    (필수) 개인정보 수집·이용에 동의합니다
                  </FormLabel>
                  <FormMessage />
                </div>
              </FormItem>
            )}
          />
        </div>

        <Button type="submit" className="w-full" disabled={pending}>
          {pending ? "등록 중..." : "등록 완료"}
        </Button>
      </form>
    </Form>
  );
}
