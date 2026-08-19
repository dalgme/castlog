"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  ArrowLeft,
  Check,
  FolderKanban,
  Users,
  FileCheck,
  GraduationCap,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { LogoMark } from "@/components/brand/logo";
import { BotAvatar } from "@/components/support/bot-avatar";
import { ackWelcomeTour } from "@/lib/onboarding/tour-actions";
import { cn } from "@/lib/utils";

/**
 * 첫 로그인 안내 — 미니 페이지 네 장.
 *
 * 글로 길게 설명하면 아무도 읽지 않는다. 장마다 큰 그림 하나와 문장 두어 개만
 * 둔다. 넘기는 데 3초, 전부 읽는 데 30초를 넘기지 않는 것이 목표다.
 *
 * 강제하지 않는다 — 건너뛰어도 다시 뜨지 않는다. 대신 마지막 장에서 도우미
 * 챗봇을 알려 주므로, 건너뛴 사람도 막혔을 때 물어볼 곳을 안다.
 */

type Slide = {
  eyebrow: string;
  title: string;
  body: string;
  /** 장마다 다른 그림 — 텍스트만 늘어놓지 않는다 */
  art: React.ReactNode;
};

function Tile({
  icon: Icon,
  label,
  sub,
  tone,
}: {
  icon: typeof FolderKanban;
  label: string;
  sub: string;
  tone: "brand" | "amber" | "green";
}) {
  const toneClass =
    tone === "amber"
      ? "bg-amber-100 text-amber-900"
      : tone === "green"
        ? "bg-emerald-100 text-emerald-900"
        : "bg-brand/10 text-brand";
  return (
    <div className="flex-1 rounded-xl border bg-white p-3 text-center">
      <span
        className={cn(
          "mx-auto flex h-10 w-10 items-center justify-center rounded-full",
          toneClass
        )}
      >
        <Icon className="h-5 w-5" aria-hidden />
      </span>
      <p className="mt-2 text-xs font-bold text-brand-navy">{label}</p>
      <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
        {sub}
      </p>
    </div>
  );
}

/** 1장 — 먼저 할 일: 순서를 그림으로 */
function SetupArt() {
  const steps = [
    { no: 1, label: "회사 정보" },
    { no: 2, label: "직원 계정" },
    { no: 3, label: "발송 설정" },
  ];
  return (
    <div className="flex items-center justify-center gap-1.5">
      {steps.map((s, i) => (
        <div key={s.no} className="flex items-center gap-1.5">
          <div className="flex w-20 flex-col items-center gap-1.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-brand text-sm font-bold text-white">
              {s.no}
            </span>
            <span className="text-[11px] font-medium text-brand-navy">
              {s.label}
            </span>
          </div>
          {i < steps.length - 1 && (
            <ArrowRight className="h-4 w-4 text-muted-foreground" aria-hidden />
          )}
        </div>
      ))}
    </div>
  );
}

const SLIDES: Slide[] = [
  {
    eyebrow: "STEP 1",
    title: "가장 먼저 설정할 것",
    body: "회사 정보와 로고를 넣고, 함께 일할 직원 계정을 만들고, 문자 발송 설정을 등록하세요. 이 셋이 끝나면 바로 프로젝트를 열 수 있습니다.",
    art: <SetupArt />,
  },
  {
    eyebrow: "STEP 2",
    title: "핵심 기능 세 가지",
    body: "프로젝트를 열고 → 전문가를 섭외하고 → 결재로 확정합니다. 이 흐름이 캐스트로그의 전부입니다.",
    art: (
      <div className="flex gap-2">
        <Tile
          icon={FolderKanban}
          label="프로젝트"
          sub="사업·세션·코드넘버"
          tone="brand"
        />
        <Tile icon={Users} label="전문가 섭외" sub="배정·요청·수락서" tone="green" />
        <Tile icon={FileCheck} label="전자결재" sub="품의·승인·지급" tone="amber" />
      </div>
    ),
  },
  {
    eyebrow: "STEP 3",
    title: "먼저 연습해 보세요",
    body: "상단의 연습모드를 켜면 가상의 프로젝트와 전문가로 전 과정을 그대로 해 볼 수 있습니다. 실제 데이터는 보이지 않고, 문자·이메일도 나가지 않습니다.",
    art: (
      <div className="flex items-center justify-center">
        <span className="inline-flex items-center gap-2 rounded-lg border-2 border-amber-400 bg-amber-100 px-4 py-2.5 text-sm font-bold text-amber-950">
          <GraduationCap className="h-5 w-5" aria-hidden />
          연습모드
        </span>
      </div>
    ),
  },
  {
    eyebrow: "STEP 4",
    title: "막히면 물어보세요",
    body: "화면 오른쪽 위 도우미에게 대화로 물어보면 어디서 무엇을 하면 되는지 알려 드립니다. 불편한 점이나 오류도 그대로 말씀해 주세요 — 개선에 반영됩니다.",
    art: (
      <div className="flex items-end justify-center gap-2">
        <BotAvatar size={44} />
        <span className="rounded-lg rounded-bl-none border bg-white px-3 py-2 text-xs text-muted-foreground">
          수락서는 어디서 보내나요?
        </span>
      </div>
    ),
  },
];

export function WelcomeTour({
  tenantName,
  logoSrc,
}: {
  tenantName: string | null;
  logoSrc: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(true);
  const [index, setIndex] = useState(0);
  const [pending, startTransition] = useTransition();

  if (!open) return null;

  const slide = SLIDES[index]!;
  const last = index === SLIDES.length - 1;

  function finish() {
    startTransition(async () => {
      await ackWelcomeTour();
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-brand-navy/40 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-label="캐스트로그 시작 안내"
        className="w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-2xl"
      >
        {/* 머리 — 회사 로고가 먼저 온다 */}
        <div className="flex items-center gap-2 bg-brand-navy px-4 py-3 text-white">
          <span className="flex h-8 w-8 items-center justify-center rounded bg-white">
            {logoSrc ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={logoSrc}
                alt={tenantName ?? "회사 로고"}
                className="max-h-7 max-w-7 object-contain"
              />
            ) : (
              <LogoMark width={16} height={20} />
            )}
          </span>
          <p className="min-w-0 flex-1 truncate text-sm font-bold">
            {tenantName ?? "캐스트로그"} 시작하기
          </p>
          <button
            type="button"
            onClick={finish}
            disabled={pending}
            aria-label="건너뛰기"
            className="rounded p-1 text-white/80 transition-colors hover:bg-white/10 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* 그림 자리 — 장마다 다르다 */}
        <div className="flex min-h-[9.5rem] items-center justify-center bg-secondary/40 px-5 py-6">
          {slide.art}
        </div>

        <div className="px-5 py-4">
          <p className="text-[11px] font-bold tracking-wider text-brand">
            {slide.eyebrow}
          </p>
          <h2 className="mt-0.5 text-lg font-bold text-brand-navy">
            {slide.title}
          </h2>
          <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
            {slide.body}
          </p>
        </div>

        <div className="flex items-center gap-2 border-t px-5 py-3">
          {/* 점 표시 — 몇 장 남았는지 보이면 끝까지 넘긴다 */}
          <div className="flex flex-1 items-center gap-1.5">
            {SLIDES.map((s, i) => (
              <button
                key={s.eyebrow}
                type="button"
                aria-label={`${i + 1}번째 안내`}
                onClick={() => setIndex(i)}
                className={cn(
                  "h-1.5 rounded-full transition-all",
                  i === index ? "w-5 bg-brand" : "w-1.5 bg-border"
                )}
              />
            ))}
          </div>

          {index > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setIndex((v) => v - 1)}
              disabled={pending}
            >
              <ArrowLeft className="mr-1 h-3.5 w-3.5" />
              이전
            </Button>
          )}
          {last ? (
            <Button size="sm" onClick={finish} disabled={pending}>
              <Check className="mr-1 h-3.5 w-3.5" />
              {pending ? "닫는 중…" : "시작하기"}
            </Button>
          ) : (
            <Button
              size="sm"
              onClick={() => setIndex((v) => v + 1)}
              disabled={pending}
            >
              다음
              <ArrowRight className="ml-1 h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
