"use client";

import { useState, useTransition } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";

import { updateMyProfile } from "./actions";

/** 본인 정보 — 이름·연락처만 바꿀 수 있다 (직급·부서는 인사 권한자 소관) */
export function ProfileForm({
  name,
  phone,
}: {
  name: string;
  phone: string | null;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const { toast } = useToast();

  return (
    <form
      action={(formData) => {
        setError(null);
        startTransition(async () => {
          const result = await updateMyProfile(null, formData);
          if (result.ok) {
            toast({ title: "내 정보를 저장했습니다." });
          } else {
            setError(result.error);
          }
        });
      }}
      className="space-y-4"
    >
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <div className="space-y-1.5">
        <Label htmlFor="me-name">이름</Label>
        <Input id="me-name" name="name" defaultValue={name} required maxLength={50} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="me-phone">휴대폰</Label>
        <Input
          id="me-phone"
          name="phone"
          defaultValue={phone ?? ""}
          inputMode="tel"
          maxLength={20}
          placeholder="010-0000-0000"
        />
        <p className="text-xs text-muted-foreground">
          업무 알림(마감·결재·긴급 취소) 문자를 받는 번호입니다.
        </p>
      </div>
      <Button type="submit" disabled={pending}>
        {pending ? "저장 중…" : "저장"}
      </Button>
    </form>
  );
}
