"use client";

import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import {
  DEGREE_LEVEL_OPTIONS,
  REGION_SIDO_OPTIONS,
  expertProfileSchema,
  type ExpertProfileInput,
} from "@/lib/experts/schemas";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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

import { updateExpertProfile } from "./actions";

export function ExpertProfileForm({
  defaultValues,
}: {
  defaultValues: ExpertProfileInput;
}) {
  const [pending, startTransition] = useTransition();
  const [serverError, setServerError] = useState<string | null>(null);

  const form = useForm<ExpertProfileInput>({
    resolver: zodResolver(expertProfileSchema),
    defaultValues,
  });

  function onSubmit(values: ExpertProfileInput) {
    setServerError(null);
    startTransition(async () => {
      const result = await updateExpertProfile(values);
      if (result?.error) setServerError(result.error);
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
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>이름</FormLabel>
              <FormControl>
                <Input autoComplete="name" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <FormField
            control={form.control}
            name="email"
            render={({ field }) => (
              <FormItem>
                <FormLabel>이메일 (선택)</FormLabel>
                <FormControl>
                  <Input type="email" autoComplete="email" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="secondaryPhone"
            render={({ field }) => (
              <FormItem>
                <FormLabel>보조 연락처 (선택 · 휴대폰/일반번호)</FormLabel>
                <FormControl>
                  <Input
                    inputMode="numeric"
                    placeholder="010-0000-0000 또는 02-000-0000"
                    autoComplete="tel"
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
        {/* 거주지 — 광역자치단체 선택 + 세부 주소 (기획 확정 2026-08-22) */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[180px_1fr]">
          <FormField
            control={form.control}
            name="regionSido"
            render={({ field }) => (
              <FormItem>
                <FormLabel>거주지 (선택)</FormLabel>
                <Select
                  onValueChange={field.onChange}
                  value={field.value ?? ""}
                >
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder="광역자치단체" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {REGION_SIDO_OPTIONS.map((s) => (
                      <SelectItem key={s} value={s}>
                        {s}
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
            name="regionDetail"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="sm:invisible sm:block">세부 주소</FormLabel>
                <FormControl>
                  <Input placeholder="세부 주소 (예: 강남구 테헤란로 …)" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
        {/* 최종학위 선택 + 전공명 (기획 확정 2026-08-22) */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[180px_1fr]">
          <FormField
            control={form.control}
            name="degreeLevel"
            render={({ field }) => (
              <FormItem>
                <FormLabel>최종학위 (선택)</FormLabel>
                <Select
                  onValueChange={field.onChange}
                  value={field.value ?? ""}
                >
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder="학위 선택" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {DEGREE_LEVEL_OPTIONS.map((d) => (
                      <SelectItem key={d} value={d}>
                        {d}
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
            name="degreeMajor"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="sm:invisible sm:block">전공명</FormLabel>
                <FormControl>
                  <Input placeholder="전공명 (예: 경영학)" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
        <FormField
          control={form.control}
          name="careerYears"
          render={({ field }) => (
            <FormItem>
              <FormLabel>경력 연차 (선택)</FormLabel>
              <FormControl>
                <Input inputMode="numeric" maxLength={2} {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="degreeCertifications"
          render={({ field }) => (
            <FormItem>
              <FormLabel>자격증 (선택)</FormLabel>
              <FormControl>
                <Input placeholder="예: 경영지도사, 기술사" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="bio"
          render={({ field }) => (
            <FormItem>
              <FormLabel>소개 (선택)</FormLabel>
              <FormControl>
                <Textarea rows={4} {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <Button type="submit" className="w-full" disabled={pending}>
          {pending ? "저장 중..." : "저장"}
        </Button>
      </form>
    </Form>
  );
}
