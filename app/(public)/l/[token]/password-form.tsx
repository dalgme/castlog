"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { KeyRound } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { verifyClientReviewPassword } from "./actions";

export function ClientPasswordForm({ token }: { token: string }) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const r = await verifyClientReviewPassword(token, password);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      {error && (
        <Alert variant="destructive">
          <AlertDescription className="text-xs">{error}</AlertDescription>
        </Alert>
      )}
      <div className="flex gap-2">
        <Input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="비밀번호"
          autoComplete="off"
          autoFocus
          maxLength={64}
          className="h-11 text-base"
        />
        <Button type="submit" disabled={pending || !password} className="h-11 shrink-0">
          <KeyRound className="mr-1 h-4 w-4" aria-hidden /> {pending ? "확인 중…" : "열기"}
        </Button>
      </div>
    </form>
  );
}
