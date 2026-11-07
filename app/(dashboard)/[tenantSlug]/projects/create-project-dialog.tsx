"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { FolderPlus } from "lucide-react";

import {
  projectCreateSchema,
  type ProjectCreateInput,
} from "@/lib/operations/schemas";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { KoreanDateInput } from "@/components/ui/korean-date-input";
import { CommaNumberInput } from "@/components/ui/comma-number-input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ClientNamesInput } from "@/components/projects/client-names-input";

import { createProject } from "./actions";

/** 프로젝트 생성 다이얼로그 — 공통 기반. (21스텝 구성은 operations 영역 몫 — §15) */
export function CreateProjectDialog({
  tenantSlug,
  categories,
}: {
  tenantSlug: string;
  /** 대표가 설정한 분야별 카테고리 (활성만) */
  categories: { id: string; name: string }[];
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [serverError, setServerError] = useState<string | null>(null);
  const router = useRouter();

  const form = useForm<ProjectCreateInput>({
    resolver: zodResolver(projectCreateSchema),
    defaultValues: {
      name: "",
      businessYear: String(new Date().getFullYear()),
      clientName: "",
      hostOrg: "",
      contractType: "",
      categoryId: "",
      code: "",
      startsOn: "",
      endsOn: "",
      budgetAmount: "",
      description: "",
    },
  });

  function onSubmit(values: ProjectCreateInput) {
    setServerError(null);
    startTransition(async () => {
      const result = await createProject(values);
      if (result.ok) {
        setOpen(false);
        form.reset();
        router.push(`/${tenantSlug}/projects/${result.projectId}`);
      } else {
        setServerError(result.error);
      }
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          form.reset();
          setServerError(null);
        }
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm">
          <FolderPlus className="mr-1.5 h-4 w-4" />
          프로젝트 생성
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>프로젝트 생성</DialogTitle>
          <DialogDescription>
            행사명·기간·예산 등 기본 정보로 프로젝트를 엽니다. 세부 정보는 생성 후 언제든 수정할 수 있습니다.
          </DialogDescription>
        </DialogHeader>
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
                  <FormLabel>프로젝트명 (필수)</FormLabel>
                  <FormControl>
                    <Input placeholder="2026 청년창업 아카데미" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="grid grid-cols-2 gap-3">
              <FormField
                control={form.control}
                name="businessYear"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>사업연도 (자동 — 올해)</FormLabel>
                    <FormControl>
                      <Input inputMode="numeric" maxLength={4} {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              {/* 프로젝트 코드는 PM만 작성 (기획 2026-11-07) — 개설 시점엔 PM이 없으므로 배정 후 PM이 '기본정보 수정'에서 넣는다 */}
              <div className="space-y-1.5">
                <p className="text-sm font-medium leading-none text-muted-foreground">프로젝트 코드</p>
                <p className="rounded-md bg-secondary/50 px-2.5 py-2 text-xs text-muted-foreground">
                  PM 배정 후 PM이 ‘기본정보 수정’에서 입력합니다.
                </p>
              </div>
            </div>
            {/* 발주처 여러 곳 (기획 2026-11-07) — '발주처 추가'로 칸을 늘린다. 저장은 ' · '로 이어 한 칸 */}
            <FormField
              control={form.control}
              name="clientName"
              render={({ field, fieldState }) => (
                <FormItem>
                  <FormLabel>발주처 (필수 — 공동 발주면 추가)</FormLabel>
                  <FormControl>
                    <ClientNamesInput
                      value={field.value ?? ""}
                      onChange={field.onChange}
                      disabled={pending}
                      invalid={Boolean(fieldState.error)}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="hostOrg"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>주관기관 (선택)</FormLabel>
                  <FormControl>
                    <Input placeholder="예: OO시" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            {/* 계약 처리 구분 (기획 2026-09-21) — 모르면 비워 두고 '기본정보 수정'에서 정한다 */}
            <FormField
              control={form.control}
              name="contractType"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>계약 처리 구분 (선택 — 수의/입찰)</FormLabel>
                  <Select value={field.value ?? ""} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="아직 모르면 비워 두세요" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="private">수의 계약</SelectItem>
                      <SelectItem value="bid">입찰</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="categoryId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>프로젝트 카테고리 (선택)</FormLabel>
                  {categories.length === 0 ? (
                    <p className="rounded-md bg-secondary/50 p-2.5 text-xs text-muted-foreground">
                      아직 등록된 카테고리가 없습니다. 대표 계정의 기업 관리
                      화면에서 ‘창업 · 교육행사 · 엑셀러레이터’처럼 회사가 쓰는
                      분야를 먼저 등록하세요.
                    </p>
                  ) : (
                    <Select value={field.value ?? ""} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="분야 선택" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {categories.map((c) => (
                          <SelectItem key={c.id} value={c.id}>
                            {c.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="grid grid-cols-2 gap-3">
              <FormField
                control={form.control}
                name="startsOn"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>시작일 (선택)</FormLabel>
                    <FormControl>
                      <KoreanDateInput value={field.value ?? ""} onChange={field.onChange} ariaLabel="시작일" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="endsOn"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>종료일 (선택)</FormLabel>
                    <FormControl>
                      <KoreanDateInput value={field.value ?? ""} onChange={field.onChange} ariaLabel="종료일" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <FormField
              control={form.control}
              name="budgetAmount"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>총 예산 (원, 선택)</FormLabel>
                  <FormControl>
                    <CommaNumberInput
                      placeholder="50,000,000"
                      value={field.value ?? ""}
                      onValueChange={field.onChange}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>설명 (선택)</FormLabel>
                  <FormControl>
                    <Textarea rows={3} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <Button type="submit" className="w-full" disabled={pending}>
              {pending ? "생성 중..." : "프로젝트 생성"}
            </Button>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
