"use client";

import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import { delegationSchema, type DelegationInput } from "@/lib/approvals/schemas";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";

import { createDelegation, endDelegation } from "../actions";

type UserOption = { id: string; name: string };

/** 대결·위임 설정 폼 — 기간 내 대결자가 내 결재를 처리할 수 있다 */
export function DelegationForm({ users }: { users: UserOption[] }) {
  const [pending, startTransition] = useTransition();
  const [serverError, setServerError] = useState<string | null>(null);
  const { toast } = useToast();

  const form = useForm<DelegationInput>({
    resolver: zodResolver(delegationSchema),
    defaultValues: { delegateUserId: "", startsOn: "", endsOn: "", reason: "" },
  });

  function onSubmit(values: DelegationInput) {
    setServerError(null);
    startTransition(async () => {
      const result = await createDelegation(values);
      if (result.ok) {
        toast({ description: "대결이 설정되었습니다." });
        form.reset();
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
        <FormField
          control={form.control}
          name="delegateUserId"
          render={({ field }) => (
            <FormItem>
              <FormLabel>대결자</FormLabel>
              <Select onValueChange={field.onChange} value={field.value}>
                <FormControl>
                  <SelectTrigger>
                    <SelectValue placeholder="대결자 선택" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {users.map((u) => (
                    <SelectItem key={u.id} value={u.id}>
                      {u.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
                <FormLabel>시작일</FormLabel>
                <FormControl>
                  <Input type="date" {...field} />
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
                <FormLabel>종료일</FormLabel>
                <FormControl>
                  <Input type="date" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
        <FormField
          control={form.control}
          name="reason"
          render={({ field }) => (
            <FormItem>
              <FormLabel>사유 (선택)</FormLabel>
              <FormControl>
                <Input placeholder="휴가, 출장 등" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <Button type="submit" className="w-full" disabled={pending}>
          {pending ? "설정 중..." : "대결 설정"}
        </Button>
      </form>
    </Form>
  );
}

/** 대결 종료 버튼 */
export function EndDelegationButton({ delegationId }: { delegationId: string }) {
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();

  function onEnd() {
    startTransition(async () => {
      const result = await endDelegation(delegationId);
      if (result.ok) {
        toast({ description: "대결을 종료했습니다." });
      } else {
        toast({ variant: "destructive", description: result.error });
      }
    });
  }

  return (
    <Button
      type="button"
      size="sm"
      variant="ghost"
      className="text-destructive hover:text-destructive"
      disabled={pending}
      onClick={onEnd}
    >
      {pending ? "처리 중..." : "종료"}
    </Button>
  );
}
