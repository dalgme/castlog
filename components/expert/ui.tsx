import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * 전문가 포털 공용 UI — CASTLOG 랜딩페이지 디자인 언어(eyebrow·네이비 타이틀·
 * 소프트 컬러 태그)를 포털 전 탭에 일관되게 적용하기 위한 조각들.
 */

/** 페이지 상단 인트로 — 블루 eyebrow + 네이비 타이틀 + 설명 (랜딩 values-eyebrow 계열) */
export function PageIntro({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        {eyebrow && (
          <p className="text-xs font-extrabold tracking-wide text-brand">
            {eyebrow}
          </p>
        )}
        <h1 className="mt-1 text-xl font-bold text-brand-navy sm:text-2xl">
          {title}
        </h1>
        {description && (
          <p className="mt-1.5 text-sm text-muted-foreground">{description}</p>
        )}
      </div>
      {action}
    </div>
  );
}

/** 랜딩 .tag 계열 소프트 컬러 태그 */
const TAG_STYLES = {
  blue: "bg-[#E8F0FF] text-[#1D4FD8]",
  amber: "bg-[#FFF3D6] text-[#8A6A00]",
  green: "bg-[#E6F6EC] text-[#1E7E45]",
  red: "bg-[#FDECEA] text-[#C0392B]",
  gray: "bg-[#EEF1F6] text-[#3D4A60]",
  wait: "bg-[#F3F5F9] text-[#8A93A3]",
} as const;

export type TagTone = keyof typeof TAG_STYLES;

export function Tag({
  tone = "gray",
  className,
  children,
}: {
  tone?: TagTone;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center whitespace-nowrap rounded-md px-2 py-0.5 text-xs font-bold",
        TAG_STYLES[tone],
        className
      )}
    >
      {children}
    </span>
  );
}

/** 라벨 + 값 한 줄 (섭외/프로젝트 상세의 메타 표기) */
export function MetaRow({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <p className="text-sm">
      <span className="mr-2 text-muted-foreground">{label}</span>
      <span className="font-medium text-brand-navy">{children}</span>
    </p>
  );
}

/** 섭외 상태 → 태그 톤 (랜딩 색 어휘에 매핑) */
export const ENGAGEMENT_TONE: Record<string, TagTone> = {
  requested: "amber",
  accepted: "green",
  declined: "red",
  canceled: "gray",
  expired: "wait",
};
