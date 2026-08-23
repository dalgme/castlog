"use client";

import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Minus, Plus } from "lucide-react";

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
  phoneDisplay,
  hasSaved,
}: {
  defaultValues: ExpertProfileInput;
  /** 로그인 인증 수단인 휴대폰 번호 — 표시 전용, 수정 불가 */
  phoneDisplay: string;
  /** 필수영역(이름)이 이미 저장되어 있는지 — 저장 버튼을 '수정하기'로 표시 */
  hasSaved: boolean;
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
        <FormField
          control={form.control}
          name="email"
          render={({ field }) => (
            <FormItem>
              <FormLabel>이메일</FormLabel>
              <FormControl>
                <Input type="email" autoComplete="email" {...field} />

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField
            control={form.control}
            name="organization"
            render={({ field }) => (
              <FormItem>
                <FormLabel>소속 (선택)</FormLabel>
                <FormControl>
                  <Input placeholder="예: OO대학교, OO컨설팅" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="jobTitle"
            render={({ field }) => (
              <FormItem>
                <FormLabel>직위 (선택)</FormLabel>
                <FormControl>
                  <Input placeholder="예: 교수, 대표, 수석 컨설턴트" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        {/* 휴대폰 번호 — 로그인 인증 수단이라 수정 불가, 표시만 (기획 확정 2026-08-22) */}
        <div className="space-y-2">
          <p className="text-sm font-medium">핸드폰 번호</p>
          <Input value={phoneDisplay} readOnly disabled className="bg-muted" />
          <p className="text-xs text-muted-foreground">
            로그인 인증에 사용하는 번호라 여기서 변경할 수 없습니다.
          </p>
        </div>
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
        {/* 경력 연차 — 직접 타이핑 대신 +/- 선택 (기획 확정 2026-08-22) */}
        <FormField
          control={form.control}
          name="careerYears"
          render={({ field }) => {
            const current = parseInt(field.value || "0", 10) || 0;
            const step = (delta: number) =>
              field.onChange(String(Math.min(99, Math.max(0, current + delta))));
            return (
              <FormItem>
                <FormLabel>경력 연차 (선택)</FormLabel>
                <FormControl>
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="h-9 w-9 shrink-0"
                      onClick={() => step(-1)}
                      disabled={current <= 0}
                      aria-label="경력 연차 줄이기"
                    >
                      <Minus className="h-4 w-4" aria-hidden />
                    </Button>
                    <Input
                      readOnly
                      inputMode="none"
                      value={field.value ? `${current}년` : "미입력"}
                      className="w-24 text-center"
                      tabIndex={-1}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="h-9 w-9 shrink-0"
                      onClick={() => step(1)}
                      disabled={current >= 99}
                      aria-label="경력 연차 늘리기"
                    >
                      <Plus className="h-4 w-4" aria-hidden />
                    </Button>
                  </div>
                </FormControl>
                <FormMessage />
              </FormItem>
            );
          }}
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
        {/* 필수영역(이름)이 저장되어 있으면 '수정하기'로 (기획 확정 2026-08-22) */}
        <Button
          type="submit"
          className={
            hasSaved
              ? "w-full bg-emerald-600 text-white hover:bg-emerald-700"
              : "w-full"
          }
          disabled={pending}
        >
          {pending ? "저장 중..." : hasSaved ? "수정하기" : "저장"}
        </Button>
      </form>
    </Form>
  );
}
