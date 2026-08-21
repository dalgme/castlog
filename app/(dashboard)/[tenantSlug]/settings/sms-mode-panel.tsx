"use client";

import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Building2, KeyRound, Send } from "lucide-react";

import {
  platformSmsSchema,
  type PlatformSmsInput,
} from "@/lib/messaging/schemas";
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
import { useToast } from "@/hooks/use-toast";

import { savePlatformSmsMode } from "./actions";
import { SmsConfigForm } from "./sms-config-form";

export type SmsMode = "byo" | "platform";

/**
 * 발송 방식 선택 — 자사 계정(a) / 캐스트로그 계정(b).
 *
 * 자사 솔라피 가입은 작은 기업에게 도입의 첫 관문에서 그대로 이탈 지점이 된다.
 * 그래서 캐스트로그 계정으로 보내는 길(b)을 함께 연다. 어느 쪽이든 **발신번호는
 * 그 회사의 번호**다 — 문자를 받는 전문가에게 보이는 것은 그 회사다.
 *
 * b의 발신번호는 캐스트로그 솔라피 계정에 사전등록되어야 발송이 통과된다
 * (발신번호 사전등록제 — 법·통신사 규제라 우회가 없다). 그 절차는 캐스트로그
 * 담당자가 진행하므로, 화면은 '무엇을 하면 되는지'를 순서로 보여 준다.
 */
export function SmsModePanel({
  currentMode,
  platformGranted,
  platformOffered,
  currentSenderNumber,
  byoCurrent,
}: {
  /** 저장된 모드 (설정이 없으면 null) */
  currentMode: SmsMode | null;
  /** b 이용코드 승인을 이미 받았는가 — 받았다면 코드 입력을 다시 요구하지 않는다 */
  platformGranted: boolean;
  /**
   * b 방식을 제공 중인가 (기획 보류 상태 관리).
   * 운영에서 이용코드(PLATFORM_SMS_ACCESS_CODE)를 설정하기 전에는 false —
   * 신청해도 진행할 수 없는 선택지를 보여 주면 그게 곧 막다른 길이다(§14-7).
   * 이미 platform 모드인 회사에는 보류와 무관하게 계속 보여 준다.
   */
  platformOffered: boolean;
  currentSenderNumber: string | null;
  byoCurrent: { provider: string; senderNumber: string } | null;
}) {
  const [mode, setMode] = useState<SmsMode>(currentMode ?? "byo");
  const showPlatform = platformOffered || currentMode === "platform";

  if (!showPlatform) {
    return <SmsConfigForm current={byoCurrent} />;
  }

  return (
    <div className="space-y-4">
      {/* 방식 선택 — 라디오 카드 */}
      <div className="grid gap-2 sm:grid-cols-2">
        <ModeCard
          active={mode === "byo"}
          onClick={() => setMode("byo")}
          icon={<KeyRound className="h-4 w-4" aria-hidden />}
          title="자사 계정으로 발송"
          badge={currentMode === "byo" ? "사용 중" : null}
          description="솔라피 등 공급자에 직접 가입해 자사 API 키·발신번호로 보냅니다. 발송 요금이 자사 계정에 청구됩니다."
        />
        <ModeCard
          active={mode === "platform"}
          onClick={() => setMode("platform")}
          icon={<Send className="h-4 w-4" aria-hidden />}
          title="캐스트로그 계정으로 발송"
          badge={currentMode === "platform" ? "사용 중" : null}
          description="공급자 가입 없이 캐스트로그의 솔라피 계정으로 보냅니다. 발신번호는 자사 번호를 그대로 씁니다. 이용은 캐스트로그와 협의 후 시작합니다."
        />
      </div>

      {mode === "byo" ? (
        <SmsConfigForm current={byoCurrent} />
      ) : (
        <PlatformSmsForm
          granted={platformGranted}
          currentSenderNumber={
            currentMode === "platform" ? currentSenderNumber : null
          }
        />
      )}
    </div>
  );
}

function ModeCard({
  active,
  onClick,
  icon,
  title,
  description,
  badge,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  title: string;
  description: string;
  badge: string | null;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={
        "rounded-xl border p-3.5 text-left transition-colors " +
        (active
          ? "border-brand bg-[#F2F6FF]"
          : "border-border bg-white hover:border-brand/40")
      }
    >
      <span className="flex items-center gap-2">
        <span
          className={
            "flex h-7 w-7 items-center justify-center rounded-lg " +
            (active ? "bg-brand text-white" : "bg-secondary text-brand-navy")
          }
        >
          {icon}
        </span>
        <span className="text-sm font-semibold text-brand-navy">{title}</span>
        {badge && (
          <span className="rounded-full bg-brand px-2 py-0.5 text-[10px] font-semibold text-white">
            {badge}
          </span>
        )}
      </span>
      <span className="mt-1.5 block text-xs leading-relaxed text-muted-foreground">
        {description}
      </span>
    </button>
  );
}

/**
 * 캐스트로그 발송 신청 폼.
 *
 * 이용코드는 최초 1회만 받는다 — 승인 흔적이 남으면 발신번호를 바꾸거나
 * 다시 저장할 때 코드를 재입력하지 않는다.
 */
function PlatformSmsForm({
  granted,
  currentSenderNumber,
}: {
  granted: boolean;
  currentSenderNumber: string | null;
}) {
  const [pending, startTransition] = useTransition();
  const [serverError, setServerError] = useState<string | null>(null);
  const { toast } = useToast();

  const form = useForm<PlatformSmsInput>({
    resolver: zodResolver(platformSmsSchema),
    defaultValues: {
      senderNumber: currentSenderNumber ?? "",
      accessCode: "",
    },
  });

  function onSubmit(values: PlatformSmsInput) {
    setServerError(null);
    startTransition(async () => {
      const result = await savePlatformSmsMode(values);
      if (result.ok) {
        toast({ description: "캐스트로그 발송으로 설정되었습니다." });
        form.setValue("accessCode", "");
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

        {/* 발신번호 등록이 왜 필요한지 — 법 제약이라는 것을 먼저 말한다.
            말하지 않으면 '캐스트로그가 귀찮게 한다'로 읽힌다 */}
        <div className="rounded-lg border border-brand/40 bg-[#F2F6FF] p-3 text-sm leading-relaxed text-[#33405A]">
          <p className="flex items-start gap-1.5 font-semibold">
            <Building2 className="mt-0.5 h-4 w-4 flex-none text-brand" aria-hidden />
            문자는 자사 발신번호로 나갑니다
          </p>
          <ol className="mt-1.5 list-decimal space-y-1 pl-5 text-xs">
            <li>아래에 자사 발신번호와 이용코드를 입력해 저장합니다.</li>
            <li>
              캐스트로그 담당자가 그 번호를 발송 계정에 <b>타사 명의 발신번호로
              등록</b>합니다 — 발신번호 사전등록제(법적 의무)라 이 절차 없이는
              어떤 문자도 나가지 않습니다. 등록 심사에 <b>발신번호 사용 위임장,
              사업자등록증 사본, 통신서비스 이용증명원</b>이 필요하니 담당자
              요청에 맞춰 보내 주세요.
            </li>
            <li>
              등록이 끝나면 아래 ‘SMS 연결 상태’에서 <b>테스트 발송</b>으로
              확인합니다.
            </li>
          </ol>
        </div>

        <FormField
          control={form.control}
          name="senderNumber"
          render={({ field }) => (
            <FormItem>
              <FormLabel>자사 발신번호</FormLabel>
              <FormControl>
                <Input placeholder="02-123-4567" {...field} />
              </FormControl>
              <FormDescription>
                전문가에게 표시되는 번호입니다. 회사가 실제 사용하는 번호를
                입력하세요.
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        {granted ? (
          <p className="rounded-md bg-secondary/50 p-2.5 text-xs text-muted-foreground">
            이용 승인이 완료된 회사입니다. 이용코드를 다시 입력할 필요가
            없습니다.
          </p>
        ) : (
          <FormField
            control={form.control}
            name="accessCode"
            render={({ field }) => (
              <FormItem>
                <FormLabel>이용코드</FormLabel>
                <FormControl>
                  <Input type="password" autoComplete="off" {...field} />
                </FormControl>
                <FormDescription>
                  캐스트로그 담당자가 알려드린 코드입니다. 최초 1회만 입력하며,
                  이후에는 필요하지 않습니다. 코드가 없다면 hello@castlog.kr 로
                  문의하세요.
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
        )}

        <Button type="submit" className="w-full" disabled={pending}>
          {pending ? "저장 중..." : "캐스트로그 발송으로 설정"}
        </Button>
      </form>
    </Form>
  );
}
