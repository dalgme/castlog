"use client";

import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { ShieldAlert } from "lucide-react";

import {
  companyProfileSchema,
  type CompanyProfileInput,
} from "@/lib/admin/company-schemas";
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

import { saveCompanyProfile } from "./company-actions";

/** 기업 가입정보 + 개인정보 보호책임자 지정 폼 */
export function CompanyProfileForm({
  initial,
}: {
  initial: CompanyProfileInput;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const form = useForm<CompanyProfileInput>({
    resolver: zodResolver(companyProfileSchema),
    defaultValues: initial,
  });

  const officerMissing = !form.watch("privacyOfficerName");

  const onSubmit = (values: CompanyProfileInput) => {
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const r = await saveCompanyProfile(values);
      if (!r.ok) setError(r.error);
      else setSaved(true);
    });
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <FormField
            control={form.control}
            name="businessRegistrationNumber"
            render={({ field }) => (
              <FormItem>
                <FormLabel>사업자등록번호</FormLabel>
                <FormControl>
                  <Input placeholder="123-45-67890" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="representativeName"
            render={({ field }) => (
              <FormItem>
                <FormLabel>대표자 성명</FormLabel>
                <FormControl>
                  <Input placeholder="홍길동" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="address"
            render={({ field }) => (
              <FormItem className="sm:col-span-2">
                <FormLabel>사업장 주소</FormLabel>
                <FormControl>
                  <Input placeholder="서울특별시 …" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="contactPhone"
            render={({ field }) => (
              <FormItem>
                <FormLabel>대표 연락처</FormLabel>
                <FormControl>
                  <Input placeholder="02-000-0000" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="industry"
            render={({ field }) => (
              <FormItem>
                <FormLabel>업종·업태</FormLabel>
                <FormControl>
                  <Input placeholder="서비스 / 교육컨설팅" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <div className="rounded-lg border p-3">
          <p className="text-sm font-semibold">개인정보 보호책임자</p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            개인정보보호법 제31조에 따라 <b>지정과 공개가 의무</b>입니다. 우리 회사가
            임직원·전문가의 개인정보를 처리하는 주체이므로 캐스트로그가 아니라
            <b> 회사가 직접</b> 지정해야 합니다.
          </p>
          {officerMissing && (
            <p className="mt-2 flex items-start gap-1.5 rounded-md bg-amber-50 p-2 text-xs text-amber-900">
              <ShieldAlert className="mt-0.5 h-3.5 w-3.5 flex-none" aria-hidden />
              아직 지정되지 않았습니다. 서비스를 본격 사용하기 전에 지정해 주세요.
            </p>
          )}
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <FormField
              control={form.control}
              name="privacyOfficerName"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>성명·직위</FormLabel>
                  <FormControl>
                    <Input placeholder="김보안 이사" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="privacyOfficerEmail"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>이메일</FormLabel>
                  <FormControl>
                    <Input type="email" placeholder="privacy@company.co.kr" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="privacyOfficerPhone"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>연락처</FormLabel>
                  <FormControl>
                    <Input placeholder="02-000-0000" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
        </div>

        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        {saved && (
          <Alert>
            <AlertDescription>기업 정보를 저장했습니다.</AlertDescription>
          </Alert>
        )}

        <Button type="submit" disabled={pending}>
          {pending ? "저장 중…" : "저장"}
        </Button>
      </form>
    </Form>
  );
}
