"use client";

import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import {
  inquirySchema,
  INQUIRY_TYPE_LABELS,
  type InquiryInput,
  type InquiryType,
} from "@/lib/inquiries/schemas";
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
import { Textarea } from "@/components/ui/textarea";

import { submitInquiry } from "./actions";

/**
 * 도입 문의·무료 체험 신청 폼 — 공개, 모바일 완전 대응.
 * RHF + Zod (CLAUDE.md 9·12).
 */
export function InquiryForm({
  initialType,
  source,
}: {
  initialType: InquiryType;
  source?: string;
}) {
  const [pending, startTransition] = useTransition();
  const [serverError, setServerError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const form = useForm<InquiryInput>({
    resolver: zodResolver(inquirySchema),
    defaultValues: {
      inquiryType: initialType,
      companyName: "",
      contactName: "",
      email: "",
      phone: "",
      message: "",
      source,
    },
  });

  const currentType = form.watch("inquiryType");

  function onSubmit(values: InquiryInput) {
    setServerError(null);
    startTransition(async () => {
      const res = await submitInquiry(values);
      if (res.ok) {
        setDone(true);
      } else {
        setServerError(res.error);
      }
    });
  }

  if (done) {
    return (
      <Alert>
        <AlertDescription className="space-y-1">
          <p className="font-semibold text-foreground">신청이 접수되었습니다.</p>
          <p className="text-sm text-muted-foreground">
            담당자가 입력하신 연락처로 영업일 기준 1~2일 내에 연락드리겠습니다.
          </p>
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
        {/* 문의 유형 선택 */}
        <FormField
          control={form.control}
          name="inquiryType"
          render={({ field }) => (
            <FormItem>
              <FormLabel>문의 유형</FormLabel>
              <div className="grid grid-cols-2 gap-2">
                {(Object.keys(INQUIRY_TYPE_LABELS) as InquiryType[]).map(
                  (type) => {
                    const active = currentType === type;
                    return (
                      <button
                        type="button"
                        key={type}
                        onClick={() => field.onChange(type)}
                        className={`rounded-md border px-4 py-2.5 text-sm font-medium transition-colors ${
                          active
                            ? "border-brand bg-brand text-white"
                            : "border-input bg-background text-foreground hover:bg-muted"
                        }`}
                        aria-pressed={active}
                      >
                        {INQUIRY_TYPE_LABELS[type]}
                      </button>
                    );
                  }
                )}
              </div>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="companyName"
          render={({ field }) => (
            <FormItem>
              <FormLabel>회사·기관명</FormLabel>
              <FormControl>
                <Input placeholder="(주)한빛창업파트너스" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="contactName"
          render={({ field }) => (
            <FormItem>
              <FormLabel>담당자명</FormLabel>
              <FormControl>
                <Input placeholder="홍길동" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

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
                  placeholder="name@company.com"
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="phone"
          render={({ field }) => (
            <FormItem>
              <FormLabel>
                연락처 <span className="text-muted-foreground">(선택)</span>
              </FormLabel>
              <FormControl>
                <Input
                  type="tel"
                  inputMode="tel"
                  placeholder="010-1234-5678"
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="message"
          render={({ field }) => (
            <FormItem>
              <FormLabel>
                문의 내용 <span className="text-muted-foreground">(선택)</span>
              </FormLabel>
              <FormControl>
                <Textarea
                  rows={4}
                  placeholder="도입 규모, 사용 목적, 궁금한 점 등을 자유롭게 남겨주세요."
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
          {pending ? "접수 중…" : "신청하기"}
        </Button>

        <p className="text-center text-xs text-muted-foreground">
          제출하신 정보는 도입 상담 목적으로만 이용되며, 상담 완료 후 파기됩니다.
        </p>
      </form>
    </Form>
  );
}
