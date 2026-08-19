"use client";

import { useState } from "react";
import { Check, Copy, ExternalLink } from "lucide-react";

import { Button } from "@/components/ui/button";

/**
 * 우리 회사 전용 주소.
 *
 * 회사마다 자기 주소가 있다는 사실을 알 자리가 필요하다 — 임직원에게 공지하고
 * 즐겨찾기에 넣는 값이라, 어딘가에 적혀 있지 않으면 아무도 쓰지 않는다.
 * 복사 버튼을 붙이는 이유도 같다: 손으로 옮겨 적으면 반드시 틀린다.
 */
export function CompanyAddressCard({
  homeUrl,
  joinUrl,
}: {
  homeUrl: string;
  joinUrl: string;
}) {
  const [copied, setCopied] = useState<"home" | "join" | null>(null);

  async function copy(value: string, key: "home" | "join") {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(key);
      window.setTimeout(() => setCopied(null), 1500);
    } catch {
      // 클립보드가 막힌 환경 — 주소는 화면에 그대로 있으므로 선택해 복사하면 된다
    }
  }

  return (
    <div className="space-y-4">
      <Row
        label="회사 진입 주소"
        hint="임직원·전문가가 여는 우리 회사 첫 화면입니다. 회사 로고와 이름이 표시됩니다."
        value={homeUrl}
        copied={copied === "home"}
        onCopy={() => copy(homeUrl, "home")}
      />
      <Row
        label="임직원 가입 신청 주소"
        hint="계정이 없는 직원에게 보내는 주소입니다. 신청 후 관리자 승인이 필요합니다."
        value={joinUrl}
        copied={copied === "join"}
        onCopy={() => copy(joinUrl, "join")}
      />
      <p className="text-xs text-muted-foreground">
        주소는 회사 식별자(슬러그)로 만들어집니다. 변경하려면 캐스트로그에
        요청하세요 — 이미 배포한 안내문의 주소가 함께 바뀝니다.
      </p>
    </div>
  );
}

function Row({
  label,
  hint,
  value,
  copied,
  onCopy,
}: {
  label: string;
  hint: string;
  value: string;
  copied: boolean;
  onCopy: () => void;
}) {
  return (
    <div>
      <p className="text-sm font-medium text-brand-navy">{label}</p>
      <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>
      <div className="mt-2 flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded-md bg-secondary px-2.5 py-2 text-xs">
          {value}
        </code>
        <Button size="sm" variant="outline" onClick={onCopy}>
          {copied ? (
            <Check className="h-3.5 w-3.5" aria-hidden />
          ) : (
            <Copy className="h-3.5 w-3.5" aria-hidden />
          )}
          <span className="ml-1.5">{copied ? "복사됨" : "복사"}</span>
        </Button>
        <Button size="sm" variant="ghost" asChild>
          <a href={value} target="_blank" rel="noreferrer" aria-label={`${label} 열기`}>
            <ExternalLink className="h-3.5 w-3.5" aria-hidden />
          </a>
        </Button>
      </div>
    </div>
  );
}
