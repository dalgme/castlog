"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Sparkles, X } from "lucide-react";

import { MODULE_LABELS, type ModuleKey } from "@/lib/modules/modules";
import { Button } from "@/components/ui/button";

import { ackModuleOnboarding } from "@/app/(dashboard)/[tenantSlug]/settings/module-actions";

/**
 * 모듈이 새로 켜졌을 때 한 번 보여주는 안내.
 *
 * 모듈을 켜면 메뉴만 늘어나고, 기존 데이터를 어떻게 이어야 하는지는 아무도
 * 알려주지 않았다. '무엇이 열렸는지'와 '무엇을 이어야 하는지'를 함께 띄우고
 * 확인하면 사라진다. 사용자별로 기록하므로 사람마다 한 번씩 본다.
 */
export function ModuleOnboarding({
  moduleKey,
  hints,
}: {
  moduleKey: ModuleKey;
  hints: readonly string[];
}) {
  const router = useRouter();
  const [hidden, setHidden] = useState(false);
  const [pending, startTransition] = useTransition();

  if (hidden) return null;

  function dismiss() {
    setHidden(true);
    startTransition(async () => {
      await ackModuleOnboarding(moduleKey);
      router.refresh();
    });
  }

  return (
    <div className="border-b bg-brand/5 px-4 py-3">
      <div className="flex items-start gap-2.5">
        <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-brand" />
        <div className="min-w-0 flex-1 space-y-1">
          <p className="text-sm font-semibold text-brand-navy">
            ‘{MODULE_LABELS[moduleKey]}’ 기능이 활성화되었습니다
          </p>
          <ul className="space-y-0.5">
            {hints.map((hint) => (
              <li key={hint} className="text-xs text-muted-foreground">
                · {hint}
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground">
            기존 프로젝트·전문가·이력은 그대로 있습니다. 기능만 열렸습니다.
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-7 shrink-0 gap-1 text-xs"
          disabled={pending}
          onClick={dismiss}
        >
          <X className="h-3.5 w-3.5" />
          확인
        </Button>
      </div>
    </div>
  );
}
