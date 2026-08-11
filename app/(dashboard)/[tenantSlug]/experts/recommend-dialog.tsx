"use client";

import { useState, useTransition } from "react";
import { Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";

import {
  recommendExperts,
  draftEngagementRationale,
} from "./recommend-actions";
import type { ExpertCandidate } from "@/lib/integrations/recommendations";

/**
 * 단계 25: 전문가 후보 추천 + 섭외 사유 초안.
 * 순위는 시스템이 자사 평판·프로필로 결정론적 계산(설명 가능). AI는 사유 초안만.
 * 결정·비용은 담당자 몫 — 초안은 검토·수정 후 사용.
 */
export function ExpertRecommendDialog() {
  const [open, setOpen] = useState(false);
  const [keyword, setKeyword] = useState("");
  const [candidates, setCandidates] = useState<ExpertCandidate[] | null>(null);
  const [aiConfigured, setAiConfigured] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [pending, startTransition] = useTransition();
  const [draftingId, setDraftingId] = useState<string | null>(null);
  const { toast } = useToast();

  function onSearch() {
    startTransition(async () => {
      const res = await recommendExperts({ keyword: keyword.trim() || undefined });
      if (res.ok) {
        setCandidates(res.candidates);
        setAiConfigured(res.aiConfigured);
      } else {
        toast({ variant: "destructive", description: res.error });
      }
    });
  }

  function onDraft(expertId: string) {
    setDraftingId(expertId);
    startTransition(async () => {
      const res = await draftEngagementRationale({
        expertId,
        roleDescription: keyword.trim() || "전문가 섭외",
      });
      setDraftingId(null);
      if (res.ok) {
        setDrafts((prev) => ({ ...prev, [expertId]: res.text }));
      } else {
        toast({ variant: "destructive", description: res.error });
      }
    });
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast({ description: "사유 초안을 복사했습니다." });
    } catch {
      toast({ variant: "destructive", description: "복사에 실패했습니다." });
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Sparkles className="mr-1.5 h-4 w-4" />
          후보 추천
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>전문가 후보 추천</DialogTitle>
          <DialogDescription>
            자사 평판·프로필로 순위를 계산합니다(설명 가능). 섭외 사유 초안은 AI가
            문장화하며, 결정·비용은 담당자가 확정합니다.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-2">
          <Input
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="역할/분야 키워드 (예: 창업 멘토, 마케팅)"
            onKeyDown={(e) => {
              if (e.key === "Enter") onSearch();
            }}
          />
          <Button type="button" onClick={onSearch} disabled={pending}>
            {pending && draftingId === null ? "검색 중..." : "추천"}
          </Button>
        </div>

        {candidates !== null && candidates.length === 0 && (
          <p className="py-6 text-center text-sm text-muted-foreground">
            연결된 전문가가 없습니다. 먼저 전문가를 연결·등록하세요.
          </p>
        )}

        {candidates && candidates.length > 0 && (
          <ul className="space-y-3">
            {candidates.map((c, i) => (
              <li key={c.expertId} className="rounded-md border p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-mono text-muted-foreground">
                    {i + 1}
                  </span>
                  <span className="font-semibold">{c.name}</span>
                  {c.specialty && (
                    <span className="text-sm text-muted-foreground">
                      {c.specialty}
                    </span>
                  )}
                  {c.avgScore !== null ? (
                    <Badge className="ml-auto">
                      평판 {c.avgScore.toFixed(1)}/10
                    </Badge>
                  ) : (
                    <Badge variant="secondary" className="ml-auto">
                      평가 없음
                    </Badge>
                  )}
                </div>
                <p className="mt-1.5 text-xs text-muted-foreground">
                  {c.reasons.join(" · ")}
                </p>

                <div className="mt-2">
                  {aiConfigured ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={pending}
                      onClick={() => onDraft(c.expertId)}
                    >
                      {draftingId === c.expertId ? "초안 생성 중..." : "AI 사유 초안"}
                    </Button>
                  ) : (
                    <span className="text-xs text-muted-foreground">
                      AI 사유 초안 미설정
                    </span>
                  )}
                </div>

                {drafts[c.expertId] && (
                  <div className="mt-2 space-y-1.5">
                    <Textarea
                      value={drafts[c.expertId]}
                      onChange={(e) =>
                        setDrafts((prev) => ({
                          ...prev,
                          [c.expertId]: e.target.value,
                        }))
                      }
                      rows={4}
                      className="text-sm"
                    />
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">
                        AI 초안 — 검토·수정 후 사용하세요.
                      </span>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => copy(drafts[c.expertId] ?? "")}
                      >
                        복사
                      </Button>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}
