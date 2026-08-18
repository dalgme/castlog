"use client";

import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Building2, Copy, Check } from "lucide-react";

import {
  tenantCreateSchema,
  type TenantCreateInput,
} from "@/lib/admin/schemas";
import { MODULE_KEYS, MODULE_LABELS } from "@/lib/modules/modules";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";

import { createTenant } from "./actions";

/**
 * 테넌트 생성 다이얼로그 — 모듈 조합 선택 + 첫 총괄관리자 계정 생성.
 *
 * 도입 문의 화면에서도 쓴다. 그때는 신청서의 기업명·담당자·이메일을 채워 열고
 * (defaults), 생성에 성공하면 해당 신청을 '테넌트 생성됨'으로 넘긴다(inquiryId).
 * 슬러그는 채우지 않는다 — 한글 기업명에서 유도할 수 없고, 한번 정하면 인쇄된
 * QR·발송된 문자에 남으므로 사람이 정해야 한다 (CLAUDE.md §1-1).
 */
export function CreateTenantDialog({
  defaults,
  inquiryId,
  triggerLabel = "테넌트 생성",
  triggerVariant = "default",
}: {
  defaults?: { name: string; orgAdminName: string; orgAdminEmail: string };
  inquiryId?: string;
  triggerLabel?: string;
  triggerVariant?: "default" | "outline";
} = {}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [serverError, setServerError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    email: string;
    tempPassword: string;
  } | null>(null);
  const [copied, setCopied] = useState(false);

  const form = useForm<TenantCreateInput>({
    resolver: zodResolver(tenantCreateSchema),
    defaultValues: {
      slug: "",
      name: defaults?.name ?? "",
      planName: "",
      modules: { experts: true, approvals: true, operations: true },
      orgAdminName: defaults?.orgAdminName ?? "",
      orgAdminEmail: defaults?.orgAdminEmail ?? "",
    },
  });

  function onSubmit(values: TenantCreateInput) {
    setServerError(null);
    startTransition(async () => {
      const res = await createTenant(values, inquiryId);
      if (res.ok) {
        setResult({ email: res.orgAdminEmail, tempPassword: res.tempPassword });
      } else {
        setServerError(res.error);
      }
    });
  }

  async function copyPassword() {
    if (!result) return;
    await navigator.clipboard.writeText(result.tempPassword);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      form.reset();
      setServerError(null);
      setResult(null);
      setCopied(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button size="sm" variant={triggerVariant}>
          <Building2 className="mr-1.5 h-4 w-4" />
          {triggerLabel}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>테넌트 생성</DialogTitle>
          <DialogDescription>
            기업 테넌트와 첫 총괄관리자 계정을 만듭니다. 모듈 조합은 계약
            내용에 맞게 선택하세요.
          </DialogDescription>
        </DialogHeader>

        {result ? (
          <div className="space-y-3">
            <Alert>
              <AlertDescription>
                테넌트가 생성되었습니다. 아래 임시 비밀번호는{" "}
                <strong>이 화면에서만 표시</strong>되며 저장되지 않습니다.
                총괄관리자에게 안전한 경로로 전달하세요.
              </AlertDescription>
            </Alert>
            <div className="space-y-1.5 rounded-md border p-3 text-sm">
              <p>
                <span className="text-muted-foreground">이메일:</span>{" "}
                {result.email}
              </p>
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">임시 비밀번호:</span>
                <code className="rounded bg-muted px-1.5 py-0.5 font-mono">
                  {result.tempPassword}
                </code>
                <Button type="button" size="sm" variant="outline" onClick={copyPassword}>
                  {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                </Button>
              </div>
            </div>
            <Button
              type="button"
              variant="secondary"
              className="w-full"
              onClick={() => handleOpenChange(false)}
            >
              닫기
            </Button>
          </div>
        ) : (
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
                    <FormLabel>기업명</FormLabel>
                    <FormControl>
                      <Input placeholder="넥스트랩" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="slug"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>슬러그 (URL 경로)</FormLabel>
                    <FormControl>
                      <Input placeholder="nextlab" {...field} />
                    </FormControl>
                    <FormDescription>
                      castlog.kr/<strong>{field.value || "slug"}</strong>/... 로
                      사용됩니다. 생성 후 변경하지 않는 것을 권장합니다.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="planName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>플랜명 (선택 — 계약 참고용)</FormLabel>
                    <FormControl>
                      <Input placeholder="standard" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="space-y-2">
                <FormLabel>사용 모듈</FormLabel>
                <div className="space-y-2 rounded-md border p-3">
                  {MODULE_KEYS.map((key) => (
                    <FormField
                      key={key}
                      control={form.control}
                      name={`modules.${key}` as const}
                      render={({ field }) => (
                        <FormItem className="flex flex-row items-center gap-2 space-y-0">
                          <FormControl>
                            <Checkbox
                              checked={field.value}
                              onCheckedChange={(checked) =>
                                field.onChange(checked === true)
                              }
                            />
                          </FormControl>
                          <FormLabel className="text-sm font-normal">
                            {MODULE_LABELS[key]}
                          </FormLabel>
                        </FormItem>
                      )}
                    />
                  ))}
                </div>
              </div>

              <div className="space-y-4 rounded-md border p-3">
                <p className="text-sm font-semibold">첫 총괄관리자</p>
                <FormField
                  control={form.control}
                  name="orgAdminName"
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
                  name="orgAdminEmail"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>이메일</FormLabel>
                      <FormControl>
                        <Input type="email" placeholder="admin@company.com" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <Button type="submit" className="w-full" disabled={pending}>
                {pending ? "생성 중..." : "테넌트 생성"}
              </Button>
            </form>
          </Form>
        )}
      </DialogContent>
    </Dialog>
  );
}
