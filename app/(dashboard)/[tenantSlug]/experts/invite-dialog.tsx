"use client";

import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Copy, Check, UserPlus } from "lucide-react";

import {
  inviteCreateSchema,
  type InviteCreateInput,
} from "@/lib/experts/schemas";
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
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";

import { createExpertInvitation } from "./actions";

/** 전문가 등록 링크 생성 다이얼로그 — 생성된 링크는 복사해 직접 전달 (SMS 발송은 단계 14) */
export function InviteExpertDialog() {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [serverError, setServerError] = useState<string | null>(null);
  const [createdUrl, setCreatedUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const form = useForm<InviteCreateInput>({
    resolver: zodResolver(inviteCreateSchema),
    defaultValues: { name: "", phone: "" },
  });

  function onSubmit(values: InviteCreateInput) {
    setServerError(null);
    startTransition(async () => {
      const result = await createExpertInvitation(values);
      if (result.ok) {
        setCreatedUrl(result.url);
      } else {
        setServerError(result.error);
      }
    });
  }

  async function copyUrl() {
    if (!createdUrl) return;
    await navigator.clipboard.writeText(createdUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  function handleOpenChange(nextOpen: boolean) {
    setOpen(nextOpen);
    if (!nextOpen) {
      form.reset();
      setServerError(null);
      setCreatedUrl(null);
      setCopied(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button size="sm">
          <UserPlus className="mr-1.5 h-4 w-4" />
          전문가 등록 요청
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>전문가 등록 요청</DialogTitle>
          <DialogDescription>
            전문가에게 전달할 등록 링크를 생성합니다. 전문가가 링크에서 휴대폰
            인증 후 본인 계정을 만들면 우리 회사와 연결됩니다.
          </DialogDescription>
        </DialogHeader>

        {createdUrl ? (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              링크가 생성되었습니다. 복사해서 전문가에게 전달하세요 (유효기간
              7일).
            </p>
            <div className="flex items-center gap-2">
              <Input readOnly value={createdUrl} className="font-mono text-xs" />
              <Button type="button" size="sm" variant="outline" onClick={copyUrl}>
                {copied ? (
                  <Check className="h-4 w-4" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
              </Button>
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
                    <FormLabel>이름 (선택)</FormLabel>
                    <FormControl>
                      <Input placeholder="홍길동" {...field} />
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
                    <FormLabel>휴대폰 번호 (선택)</FormLabel>
                    <FormControl>
                      <Input
                        type="tel"
                        placeholder="010-1234-5678"
                        {...field}
                      />
                    </FormControl>
                    <FormDescription>
                      입력하면 해당 번호로 인증한 전문가만 이 링크로 등록할 수
                      있습니다.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <Button type="submit" className="w-full" disabled={pending}>
                {pending ? "생성 중..." : "등록 링크 생성"}
              </Button>
            </form>
          </Form>
        )}
      </DialogContent>
    </Dialog>
  );
}
