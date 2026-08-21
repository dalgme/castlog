"use client";

import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import { smsConfigSchema, type SmsConfigInput } from "@/lib/messaging/schemas";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";

import { saveSmsConfig } from "./actions";

const SECRET_LABEL: Record<string, string> = {
  solapi: "API Secret",
  aligo: "사용자 ID",
  nhncloud: "Secret Key",
};

/** SMS 공급자 설정 폼 — 키는 저장 후 다시 표시하지 않는다 (마스킹) */
export function SmsConfigForm({
  current,
}: {
  current: { provider: string; senderNumber: string } | null;
}) {
  const [pending, startTransition] = useTransition();
  const [serverError, setServerError] = useState<string | null>(null);
  const { toast } = useToast();

  const form = useForm<SmsConfigInput>({
    resolver: zodResolver(smsConfigSchema),
    defaultValues: {
      provider:
        (current?.provider as SmsConfigInput["provider"] | undefined) ?? "solapi",
      apiKey: "",
      apiSecret: "",
      senderNumber: current?.senderNumber ?? "",
    },
  });

  const provider = form.watch("provider");

  function onSubmit(values: SmsConfigInput) {
    setServerError(null);
    startTransition(async () => {
      const result = await saveSmsConfig(values);
      if (result.ok) {
        toast({ description: "발송 설정이 저장되었습니다." });
        form.setValue("apiKey", "");
        form.setValue("apiSecret", "");
      } else {
        setServerError(result.error);
      }
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
        {current && (
          <Alert>
            <AlertDescription>
              현재 설정: {current.provider} / 발신번호 {current.senderNumber} — API
              키는 암호화되어 저장되어 있으며 다시 표시되지 않습니다. 변경하려면
              새 키를 입력하세요.
            </AlertDescription>
          </Alert>
        )}
        <FormField
          control={form.control}
          name="provider"
          render={({ field }) => (
            <FormItem>
              <FormLabel>공급자</FormLabel>
              <Select onValueChange={field.onChange} value={field.value}>
                <FormControl>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  <SelectItem value="solapi">솔라피 (Solapi)</SelectItem>
                  <SelectItem value="aligo">알리고 (Aligo)</SelectItem>
                  <SelectItem value="nhncloud">NHN Cloud (준비 중)</SelectItem>
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="apiKey"
          render={({ field }) => (
            <FormItem>
              <FormLabel>API 키</FormLabel>
              <FormControl>
                <Input type="password" autoComplete="off" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="apiSecret"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{SECRET_LABEL[provider] ?? "API Secret"}</FormLabel>
              <FormControl>
                <Input type="password" autoComplete="off" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="senderNumber"
          render={({ field }) => (
            <FormItem>
              <FormLabel>발신번호</FormLabel>
              <FormControl>
                <Input placeholder="02-123-4567" {...field} />
              </FormControl>
              <FormDescription>
                통신사에 사전등록된 자사 발신번호만 사용할 수 있습니다 (법적
                의무). 등록 방법은{" "}
                <a
                  href="https://solapi.com/guides/senderid"
                  target="_blank"
                  rel="noreferrer"
                  className="font-medium text-brand underline-offset-4 hover:underline"
                >
                  솔라피 발신번호 등록 가이드 ↗
                </a>
                를 참고하세요.
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        <Button type="submit" className="w-full" disabled={pending}>
          {pending ? "저장 중..." : "발송 설정 저장"}
        </Button>
      </form>
    </Form>
  );
}
