"use client";

import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Handshake, Copy, Check, CalendarClock } from "lucide-react";

import {
  engagementCreateSchema,
  type EngagementCreateInput,
} from "@/lib/integrations/schemas";
import type { ScreenResult } from "@/lib/integrations/expert-availability";
import { ENGAGEMENT_ROLE_TYPES } from "@/lib/integrations/engagement-roles";
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
  screenExpertAvailability,
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
  const [screen, setScreen] = useState<ScreenResult | null>(null);
  const [screenFrom, setScreenFrom] = useState("");
  const [screenTo, setScreenTo] = useState("");

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
      programName: "",
      roleType: "",
      startsTime: "",
      endsTime: "",
      locationName: "",
      locationAddress: "",
      eventSummary: "",
      specialNotes: "",
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
      setScreen(null);
      setScreenFrom("");
      setScreenTo("");
    }
  }

  const expertId = form.watch("expertId");

  function runScreening() {
    if (!expertId || !screenFrom) return;
    setScreen(null);
    const from = new Date(screenFrom);
    const to = screenTo ? new Date(screenTo) : new Date(from.getTime() + 60 * 60 * 1000);
    startAvail(async () => {
      const result = await screenExpertAvailability(
        expertId,
        from.toISOString(),
        to.toISOString()
      );
      setScreen(result);
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

              {/* 섭외 전 일정 스크리닝 — 특정 일시 범위의 겹침 여부 1차 확인 */}
              {expertId && (
                <div className="space-y-2 rounded-lg border bg-secondary/30 p-3">
                  <p className="text-xs font-semibold text-brand-navy">
                    일정 스크리닝 (특정 일시 겹침 확인)
                  </p>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <div>
                      <label className="text-[11px] text-muted-foreground">시작 일시</label>
                      <Input
                        type="datetime-local"
                        value={screenFrom}
                        onChange={(e) => setScreenFrom(e.target.value)}
                      />
                    </div>
                    <div>
                      <label className="text-[11px] text-muted-foreground">종료 일시 (선택)</label>
                      <Input
                        type="datetime-local"
                        value={screenTo}
                        onChange={(e) => setScreenTo(e.target.value)}
                      />
                    </div>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={runScreening}
                    disabled={availPending || !screenFrom}
                    className="w-full"
                  >
                    <CalendarClock className="mr-1 h-3.5 w-3.5" />
                    {availPending ? "확인 중..." : "스크리닝"}
                  </Button>

                  {screen && !screen.ok && (
                    <p className="text-xs text-destructive">{screen.error}</p>
                  )}
                  {screen && screen.ok && (
                    <div className="space-y-2">
                      {!screen.hasConflict ? (
                        <p className="rounded-md bg-green-50 px-2 py-1.5 text-xs font-medium text-green-700">
                          입력하신 일시에 겹치는 일정이 없습니다.
                        </p>
                      ) : (
                        <>
                          {screen.ownConflicts.length > 0 && (
                            <div className="rounded-md bg-brand/5 p-2">
                              <p className="mb-1 text-[11px] font-semibold text-brand-navy">
                                자사 섭외와 겹침
                              </p>
                              <ul className="space-y-0.5">
                                {screen.ownConflicts.map((c, i) => (
                                  <li key={i} className="text-xs text-brand-navy">
                                    {new Date(c.startsOn).toLocaleDateString("ko-KR")}
                                    {c.endsOn
                                      ? `–${new Date(c.endsOn).toLocaleDateString("ko-KR")}`
                                      : ""}
                                    {" · "}
                                    {c.roleDescription ?? "섭외"}
                                    {c.status === "accepted" ? " (확정)" : " (요청중)"}
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}
                          {screen.blindConflictCount > 0 && (
                            <p className="rounded-md bg-brand-amber/10 px-2 py-1.5 text-xs text-[#8A6A00]">
                              이 일시에 <b>다른 일정 {screen.blindConflictCount}건</b>과
                              겹칩니다. (다른 회사 섭외 또는 전문가 개인 일정 — 상세는
                              공개되지 않습니다)
                            </p>
                          )}
                        </>
                      )}
                      <p className="text-[11px] text-muted-foreground">
                        참고용 1차 판독입니다. 실제 가능 여부는 전문가 회신으로 확정됩니다.
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
                name="programName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>사업명 / 프로그램명</FormLabel>
                    <FormControl>
                      <Input placeholder="2026 세종 UNION 청년창업캠프" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="grid grid-cols-2 gap-3">
                <FormField
                  control={form.control}
                  name="roleType"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>구분</FormLabel>
                      <Select
                        onValueChange={field.onChange}
                        value={field.value || undefined}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="선택" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {Object.entries(ENGAGEMENT_ROLE_TYPES).map(([k, label]) => (
                            <SelectItem key={k} value={k}>
                              {label}
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
                  name="roleDescription"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>세부 역할</FormLabel>
                      <FormControl>
                        <Input placeholder="멘토 / 심사위원 / 강사" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
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
              <div className="grid grid-cols-2 gap-3">
                <FormField
                  control={form.control}
                  name="startsTime"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>시작 시각 (선택)</FormLabel>
                      <FormControl>
                        <Input type="time" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="endsTime"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>종료 시각 (선택)</FormLabel>
                      <FormControl>
                        <Input type="time" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <FormField
                control={form.control}
                name="locationName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>장소 (선택)</FormLabel>
                    <FormControl>
                      <Input placeholder="홍익대학교 국제연수원" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="locationAddress"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>장소 주소 (선택)</FormLabel>
                    <FormControl>
                      <Input placeholder="세종 조치원읍 안터길 89" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="eventSummary"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>주제 / 행사 내용 (선택)</FormLabel>
                    <FormControl>
                      <Textarea
                        rows={2}
                        placeholder="[강의] 비즈니스 시뮬레이션 플랫폼 활용"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="specialNotes"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>특기사항 (선택)</FormLabel>
                    <FormControl>
                      <Textarea
                        rows={2}
                        placeholder="대상·진행 방식·도출물 등"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
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
