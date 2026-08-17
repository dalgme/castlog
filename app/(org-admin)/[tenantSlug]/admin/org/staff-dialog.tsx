"use client";

import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { UserPlus, Copy, Check } from "lucide-react";

import { staffCreateSchema, type StaffCreateInput } from "@/lib/admin/schemas";
import {
  GRADE_DESCRIPTIONS,
  GRADE_LABELS,
  USER_GRADES,
} from "@/lib/auth/grades";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { createStaffUser } from "./actions";

/** 직원 계정 생성 다이얼로그 — 임시 비밀번호 1회 표시 */
export function CreateStaffDialog({
  positions,
}: {
  positions: { id: string; name: string }[];
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [serverError, setServerError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    email: string;
    tempPassword: string;
  } | null>(null);
  const [copied, setCopied] = useState(false);

  const form = useForm<StaffCreateInput>({
    resolver: zodResolver(staffCreateSchema),
    defaultValues: {
      name: "",
      email: "",
      grade: "staff",
      department: "",
      positionId: "",
    },
  });

  function onSubmit(values: StaffCreateInput) {
    setServerError(null);
    startTransition(async () => {
      const res = await createStaffUser(values);
      if (res.ok) {
        setResult({ email: res.email, tempPassword: res.tempPassword });
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
        <Button size="sm">
          <UserPlus className="mr-1.5 h-4 w-4" />
          직원 추가
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>직원 계정 생성</DialogTitle>
          <DialogDescription>
            직원 계정을 만들고 임시 비밀번호를 전달하세요 (초대 메일 발송은
            발송 인프라 구축 후 제공).
          </DialogDescription>
        </DialogHeader>

        {result ? (
          <div className="space-y-3">
            <Alert>
              <AlertDescription>
                계정이 생성되었습니다. 임시 비밀번호는{" "}
                <strong>이 화면에서만 표시</strong>되며 저장되지 않습니다.
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
                    <FormLabel>이메일</FormLabel>
                    <FormControl>
                      <Input type="email" placeholder="name@company.com" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="grid grid-cols-2 gap-3">
                <FormField
                  control={form.control}
                  name="grade"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>권한단계</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="권한단계 선택" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {USER_GRADES.map((grade) => (
                            <SelectItem key={grade} value={grade}>
                              {GRADE_LABELS[grade]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <p className="text-xs text-muted-foreground">
                        {GRADE_DESCRIPTIONS[field.value]}
                      </p>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="positionId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>직급 (선택)</FormLabel>
                      <Select
                        onValueChange={(value) =>
                          field.onChange(value === "none" ? "" : value)
                        }
                        value={field.value || "none"}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="직급 선택" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="none">미지정</SelectItem>
                          {positions.map((p) => (
                            <SelectItem key={p.id} value={p.id}>
                              {p.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <FormField
                control={form.control}
                name="department"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>부서 (선택)</FormLabel>
                    <FormControl>
                      <Input placeholder="사업기획팀" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <Button type="submit" className="w-full" disabled={pending}>
                {pending ? "생성 중..." : "계정 생성"}
              </Button>
            </form>
          </Form>
        )}
      </DialogContent>
    </Dialog>
  );
}
