"use client";

import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { CircleCheck } from "lucide-react";

import {
  staffJoinRequestSchema,
  type StaffJoinRequestInput,
} from "@/lib/admin/join-schemas";
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

import { submitJoinRequest } from "./actions";

/**
 * 임직원 가입 신청 폼 — 비로그인, 모바일 완전 대응.
 *
 * 권한단계 선택란이 없는 것은 의도된 설계다. 등급은 승인하는 대표가 정한다.
 */
export function JoinForm({ tenantSlug }: { tenantSlug: string }) {
  const [pending, startTransition] = useTransition();
  const [serverError, setServerError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const form = useForm<StaffJoinRequestInput>({
    resolver: zodResolver(staffJoinRequestSchema),
    defaultValues: {
      tenantSlug,
      name: "",
      email: "",
      phone: "",
      department: "",
      note: "",
    },
  });

  const onSubmit = (values: StaffJoinRequestInput) => {
    setServerError(null);
    startTransition(async () => {
      const r = await submitJoinRequest(values);
      if (!r.ok) setServerError(r.error);
      else setDone(true);
    });
  };

  if (done) {
    return (
      <div className="rounded-lg border border-brand/40 bg-[#F2F6FF] p-5 text-center">
        <CircleCheck className="mx-auto h-8 w-8 text-brand" aria-hidden />
        <p className="mt-2 font-bold text-brand-navy">신청이 접수되었습니다</p>
        <p className="mt-1.5 text-sm leading-relaxed text-[#33405A]">
          회사 관리자가 승인하면 등록하신 이메일로 계정 안내가 전달됩니다.
          승인 여부와 권한 범위는 회사 관리자가 결정합니다.
        </p>
      </div>
    );
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>이름</FormLabel>
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
              <FormLabel>회사 이메일</FormLabel>
              <FormControl>
                <Input type="email" placeholder="name@company.co.kr" {...field} />
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
              <FormLabel>휴대전화번호</FormLabel>
              <FormControl>
                <Input type="tel" placeholder="010-0000-0000" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="department"
          render={({ field }) => (
            <FormItem>
              <FormLabel>
                부서 <span className="text-muted-foreground">(선택)</span>
              </FormLabel>
              <FormControl>
                <Input placeholder="사업본부" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="note"
          render={({ field }) => (
            <FormItem>
              <FormLabel>
                담당 업무·전달사항{" "}
                <span className="text-muted-foreground">(선택)</span>
              </FormLabel>
              <FormControl>
                <Textarea
                  rows={3}
                  placeholder="담당 업무나 관리자에게 전할 내용을 적어주세요."
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <p className="rounded-md bg-secondary/50 p-2.5 text-xs leading-relaxed text-muted-foreground">
          권한단계(대표·이사·팀장·대리·주임·사원)는 신청자가 선택하지 않습니다.
          회사 관리자가 승인하면서 지정합니다.
        </p>

        <div className="space-y-2.5 rounded-md border p-3">
          <FormField
            control={form.control}
            name="termsConsent"
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
                    (필수){" "}
                    <a
                      href="/legal/terms"
                      target="_blank"
                      rel="noreferrer"
                      className="underline"
                    >
                      이용약관
                    </a>
                    에 동의합니다
                  </FormLabel>
                  <FormMessage />
                </div>
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="privacyConsent"
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
                  <p className="text-xs text-muted-foreground">
                    항목: 성명, 이메일, 휴대전화번호, 부서 · 목적: 계정 식별·업무
                    연락·권한 관리 · 보유기간: 계정 비활성화 후 1년 또는 회사의
                    계약 종료 시.{" "}
                    <a
                      href="/legal/privacy"
                      target="_blank"
                      rel="noreferrer"
                      className="underline"
                    >
                      개인정보처리방침
                    </a>
                  </p>
                  <FormMessage />
                </div>
              </FormItem>
            )}
          />
        </div>

        {serverError && (
          <Alert variant="destructive">
            <AlertDescription>{serverError}</AlertDescription>
          </Alert>
        )}

        <Button type="submit" className="w-full" disabled={pending}>
          {pending ? "접수 중…" : "가입 신청"}
        </Button>
      </form>
    </Form>
  );
}
