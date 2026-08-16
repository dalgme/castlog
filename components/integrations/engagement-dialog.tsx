"use client";

import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Handshake, Copy, Check, CalendarClock } from "lucide-react";

import {
  engagementCreateSchema,
  type EngagementCreateInput,
} from "@/lib/integrations/schemas";
import type { BusyItem } from "@/lib/integrations/expert-availability";
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
import { Textarea } from "@/components/ui/textarea";

import {
  createEngagement,
  checkExpertAvailability,
} from "@/app/(dashboard)/[tenantSlug]/experts/engagement-actions";

type Option = { id: string; name: string };

/**
 * 섭외 요청 다이얼로그 (experts ↔ operations 연동 UI)
 * projects=null이면 operations 비활성 — 프로젝트 없는 단독 섭외 경로.
 * 생성된 /e 동의 링크는 복사해 전달한다 (SMS 발송은 단계 14).
 */
export function EngagementDialog({
  experts,
  projects,
  defaultProjectId,
  triggerLabel = "섭외 요청",
}: {
  experts: Option[];
  projects: Option[] | null;
  defaultProjectId?: string;
  triggerLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [serverError, setServerError] = useState<string | null>(null);
  const [createdUrl, setCreatedUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const [availPending, startAvail] = useTransition();
  const [avail, setAvail] = useState<
    { items: BusyItem[] } | { error: string } | null
  >(null);

  const form = useForm<EngagementCreateInput>({
    resolver: zodResolver(engagementCreateSchema),
    defaultValues: {
      expertId: "",
      projectId: defaultProjectId ?? "",
      roleDescription: "",
      feeAmount: "",
      startsOn: "",
      endsOn: "",
      message: "",
      responseDeadline: "",
    },
  });

  function onSubmit(values: EngagementCreateInput) {
    setServerError(null);
    startTransition(async () => {
      const result = await createEngagement(values);
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

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      form.reset();
      setServerError(null);
      setCreatedUrl(null);
      setCopied(false);
      setAvail(null);
    }
  }

  const expertId = form.watch("expertId");

  function checkAvailability() {
    if (!expertId) return;
    setAvail(null);
    const start = form.getValues("startsOn");
    const from = start ? new Date(start) : new Date();
    from.setHours(0, 0, 0, 0);
    const to = new Date(from);
    to.setDate(to.getDate() + 90);
    startAvail(async () => {
      const result = await checkExpertAvailability(
        expertId,
        from.toISOString(),
        to.toISOString()
      );
      if (result.ok) setAvail({ items: result.items });
      else setAvail({ error: result.error });
    });
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <Handshake className="mr-1.5 h-4 w-4" />
          {triggerLabel}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>전문가 섭외 요청</DialogTitle>
          <DialogDescription>
            전문가가 동의 링크에서 수락하면 계약이 성립합니다. 섭외 요청은
            업무연락으로 사전 수신동의가 필요하지 않습니다.
          </DialogDescription>
        </DialogHeader>

        {createdUrl ? (
          <div className="space-y-3">
            <Alert>
              <AlertDescription>
                섭외 동의 링크가 생성되었습니다 (유효기간 14일). 전문가에게
                전달하세요.
              </AlertDescription>
            </Alert>
            <div className="flex items-center gap-2">
              <Input readOnly value={createdUrl} className="font-mono text-xs" />
              <Button type="button" size="sm" variant="outline" onClick={copyUrl}>
                {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
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
                name="expertId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>전문가</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="연결된 전문가 선택" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {experts.map((e) => (
                          <SelectItem key={e.id} value={e.id}>
                            {e.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* 섭외 전 가용성 사전 확인 */}
              {expertId && (
                <div className="rounded-lg border bg-secondary/30 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-semibold text-brand-navy">
                      일정 가능 여부 확인
                    </p>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={checkAvailability}
                      disabled={availPending}
                    >
                      <CalendarClock className="mr-1 h-3.5 w-3.5" />
                      {availPending ? "확인 중..." : "향후 90일 확인"}
                    </Button>
                  </div>
                  {avail && "error" in avail && (
                    <p className="mt-2 text-xs text-destructive">{avail.error}</p>
                  )}
                  {avail && "items" in avail && (
                    <div className="mt-2">
                      {avail.items.length === 0 ? (
                        <p className="text-xs text-muted-foreground">
                          공유된 외부 일정·자사 섭외 기준으로 바쁜 날이 없습니다.
                        </p>
                      ) : (
                        <ul className="max-h-40 space-y-1 overflow-y-auto">
                          {avail.items.map((it, i) => (
                            <li
                              key={i}
                              className="flex items-center gap-2 text-xs"
                            >
                              <span
                                className={
                                  "h-2 w-2 shrink-0 rounded-full " +
                                  (it.source === "own_engagement"
                                    ? "bg-brand"
                                    : "bg-brand-amber")
                                }
                              />
                              <span className="font-medium text-brand-navy">
                                {new Date(it.start).toLocaleDateString("ko-KR")}
                                {it.end && it.end !== it.start
                                  ? `–${new Date(it.end).toLocaleDateString("ko-KR")}`
                                  : ""}
                              </span>
                              <span className="text-muted-foreground">{it.label}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                      <p className="mt-1.5 text-[11px] text-muted-foreground">
                        전문가가 공유한 외부 일정과 자사 섭외만 표시됩니다(타 기업 일정은
                        표시되지 않음). 참고용이며 실제 가능 여부는 전문가 회신으로
                        확정됩니다.
                      </p>
                    </div>
                  )}
                </div>
              )}

              {projects && (
                <FormField
                  control={form.control}
                  name="projectId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>연결 프로젝트 (선택)</FormLabel>
                      <Select
                        onValueChange={(value) =>
                          field.onChange(value === "none" ? "" : value)
                        }
                        value={field.value || "none"}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="프로젝트 선택" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="none">연결 안 함</SelectItem>
                          {projects.map((p) => (
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
              )}
              <FormField
                control={form.control}
                name="roleDescription"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>요청 역할</FormLabel>
                    <FormControl>
                      <Input placeholder="멘토 / 심사위원 / 강사" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="feeAmount"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>의뢰비용 (원, 선택)</FormLabel>
                    <FormControl>
                      <Input inputMode="numeric" placeholder="500000" {...field} />
                    </FormControl>
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
                      <FormLabel>종료일 (선택)</FormLabel>
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
                name="responseDeadline"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>회신 마감일시 (선택)</FormLabel>
                    <FormControl>
                      <Input type="datetime-local" {...field} />
                    </FormControl>
                    <p className="text-xs text-muted-foreground">
                      미입력 시 기본 14일 후로 설정됩니다. 이 시각까지 전문가가 회신할
                      수 있습니다.
                    </p>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="message"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>요청 내용 (선택)</FormLabel>
                    <FormControl>
                      <Textarea
                        rows={3}
                        placeholder="일정·장소·요청 사항을 안내해 주세요."
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <Button type="submit" className="w-full" disabled={pending}>
                {pending ? "생성 중..." : "동의 링크 생성"}
              </Button>
            </form>
          </Form>
        )}
      </DialogContent>
    </Dialog>
  );
}
