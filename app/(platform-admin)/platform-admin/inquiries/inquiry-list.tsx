"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Mail, Phone } from "lucide-react";

import {
  INQUIRY_STATUSES,
  INQUIRY_STATUS_LABELS,
  type InquiryStatus,
} from "@/lib/inquiries/status";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { CreateTenantDialog } from "../create-tenant-dialog";
import { setInquiryStatus } from "./actions";
import type { AdminInquiry } from "./actions";

const STATUS_VARIANT: Record<InquiryStatus, "default" | "secondary" | "outline"> = {
  new: "default",
  contacted: "secondary",
  converted: "outline",
  closed: "outline",
};

const ALL = "all";

/**
 * 도입 문의·무료 체험 신청 처리 목록.
 *
 * 신청이 들어와도 볼 화면이 없으면 접수는 사실상 사라진다. 여기서 상태를
 * 관리하고, 진행하기로 한 건은 곧바로 테넌트 생성으로 이어지게 한다
 * (기업명·담당자명·이메일이 신청서에서 채워진다).
 */
export function InquiryList({ inquiries }: { inquiries: AdminInquiry[] }) {
  const router = useRouter();
  const [filter, setFilter] = useState<string>(ALL);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const counts = useMemo(() => {
    const map: Record<string, number> = { [ALL]: inquiries.length };
    for (const s of INQUIRY_STATUSES) {
      map[s] = inquiries.filter((i) => i.status === s).length;
    }
    return map;
  }, [inquiries]);

  const visible = useMemo(
    () => (filter === ALL ? inquiries : inquiries.filter((i) => i.status === filter)),
    [inquiries, filter]
  );

  function changeStatus(id: string, next: string) {
    setError(null);
    startTransition(async () => {
      const res = await setInquiryStatus(id, next);
      if (res.ok) router.refresh();
      else setError(res.error);
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1.5">
        <FilterChip
          active={filter === ALL}
          label={`전체 ${counts[ALL] ?? 0}`}
          onClick={() => setFilter(ALL)}
        />
        {INQUIRY_STATUSES.map((s) => (
          <FilterChip
            key={s}
            active={filter === s}
            label={`${INQUIRY_STATUS_LABELS[s]} ${counts[s] ?? 0}`}
            onClick={() => setFilter(s)}
          />
        ))}
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {visible.length === 0 ? (
        <p className="rounded-md border bg-card p-6 text-center text-sm text-muted-foreground">
          해당 상태의 신청이 없습니다.
        </p>
      ) : (
        <div className="space-y-3">
          {visible.map((inq) => (
            <Card key={inq.id}>
              <CardContent className="space-y-3 pt-6">
                <div className="flex flex-wrap items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold">{inq.companyName}</span>
                      <Badge variant="secondary" className="text-[10px]">
                        {inq.typeLabel}
                      </Badge>
                      <Badge variant={STATUS_VARIANT[inq.status]} className="text-[10px]">
                        {INQUIRY_STATUS_LABELS[inq.status]}
                      </Badge>
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {inq.contactName} ·{" "}
                      {new Date(inq.createdAt).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}
                      {inq.source && ` · 유입 ${inq.source}`}
                      {inq.handledByName && ` · 처리 ${inq.handledByName}`}
                    </p>
                  </div>

                  <Select
                    value={inq.status}
                    onValueChange={(v) => changeStatus(inq.id, v)}
                    disabled={pending}
                  >
                    <SelectTrigger className="h-8 w-[132px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {INQUIRY_STATUSES.map((s) => (
                        <SelectItem key={s} value={s}>
                          {INQUIRY_STATUS_LABELS[s]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
                  <a
                    className="inline-flex items-center gap-1 text-primary hover:underline"
                    href={`mailto:${inq.email}`}
                  >
                    <Mail className="h-3.5 w-3.5" />
                    {inq.email}
                  </a>
                  {inq.phone && (
                    <a
                      className="inline-flex items-center gap-1 text-primary hover:underline"
                      href={`tel:${inq.phone}`}
                    >
                      <Phone className="h-3.5 w-3.5" />
                      {inq.phone}
                    </a>
                  )}
                </div>

                {inq.message && (
                  <p className="whitespace-pre-wrap rounded-md bg-secondary/50 p-3 text-sm">
                    {inq.message}
                  </p>
                )}

                {inq.status !== "converted" && (
                  <div className="flex justify-end">
                    <CreateTenantDialog
                      triggerLabel="이 신청으로 테넌트 생성"
                      triggerVariant="outline"
                      inquiryId={inq.id}
                      defaults={{
                        name: inq.companyName,
                        orgAdminName: inq.contactName,
                        orgAdminEmail: inq.email,
                      }}
                    />
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function FilterChip({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      size="sm"
      variant={active ? "default" : "outline"}
      className="h-7 px-2.5 text-xs"
      onClick={onClick}
    >
      {label}
    </Button>
  );
}
