"use client";

import { useMemo, useState } from "react";
import { Download, Eye, Mail } from "lucide-react";
import * as XLSX from "xlsx";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import {
  MAIL_DELIVERY_LABELS,
  MAIL_PURPOSE_LABELS,
  MAIL_SEND_STATUS_LABELS,
  mailProviderLabel,
  type MailLedgerData,
  type MailLedgerRow,
} from "@/lib/integrations/mail-ledger-shared";

const TONE: Record<"ok" | "warn" | "bad" | "muted", string> = {
  ok: "bg-emerald-100 text-emerald-800",
  warn: "bg-amber-100 text-amber-900",
  bad: "bg-red-100 text-red-800",
  muted: "bg-secondary text-muted-foreground",
};

/**
 * 이메일 대장 탭 (기획 지시 2026-11-08) — 이 프로젝트의 담당자들이 보낸 모든 메일.
 * 발송자·수신자·종류·제목·발송 상태·수신 상태(공급자 웹훅)·발송 내용(HTML/평문) + 엑셀 내보내기(§12-6).
 */
export function MailLedgerTab({ projectName, data }: { projectName: string; data: MailLedgerData }) {
  const [purpose, setPurpose] = useState<string>("all");
  const [query, setQuery] = useState("");
  const [openRow, setOpenRow] = useState<MailLedgerRow | null>(null);

  const purposes = useMemo(() => Array.from(new Set(data.rows.map((r) => r.purpose))), [data.rows]);
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return data.rows.filter((r) => {
      if (purpose !== "all" && r.purpose !== purpose) return false;
      if (!q) return true;
      return [r.recipientName ?? "", r.recipientEmail, r.subject, r.senderName ?? ""].join(" ").toLowerCase().includes(q);
    });
  }, [data.rows, purpose, query]);

  const counts = useMemo(() => {
    const c = { total: data.rows.length, failed: 0, delivered: 0, opened: 0, bounced: 0, unknown: 0 };
    for (const r of data.rows) {
      if (r.sendStatus === "failed") c.failed += 1;
      if (r.deliveryStatus === "delivered") c.delivered += 1;
      if (r.deliveryStatus === "opened") c.opened += 1;
      if (r.deliveryStatus === "bounced" || r.deliveryStatus === "complained" || r.deliveryStatus === "failed") c.bounced += 1;
      if (r.sendStatus === "sent" && (!r.deliveryStatus || r.deliveryStatus === "queued")) c.unknown += 1;
    }
    return c;
  }, [data.rows]);

  function exportExcel() {
    const sheetRows = rows.map((r) => ({
      발송일시: fmt(r.createdAt),
      발송자: r.senderName ?? "",
      수신자: r.recipientName ?? "",
      이메일: r.recipientEmail,
      종류: MAIL_PURPOSE_LABELS[r.purpose] ?? r.purpose,
      제목: r.subject,
      발송상태: MAIL_SEND_STATUS_LABELS[r.sendStatus] ?? r.sendStatus,
      발송경로: mailProviderLabel(r.provider) ?? "",
      수신상태: deliveryLabel(r),
      전달시각: r.deliveredAt ? fmt(r.deliveredAt) : "",
      열람시각: r.openedAt ? fmt(r.openedAt) : "",
      반송시각: r.bouncedAt ? fmt(r.bouncedAt) : "",
      사유: r.errorMessage ?? r.deliveryDetail ?? "",
      본문: r.body,
    }));
    const ws = XLSX.utils.json_to_sheet(sheetRows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "이메일 대장");
    XLSX.writeFile(wb, `${projectName}_이메일대장_${new Date().toISOString().slice(0, 10)}.xlsx`);
  }

  if (!data.ready) {
    return (
      <Card>
        <CardHeader><CardTitle className="text-sm">이메일 대장</CardTitle></CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          이메일 대장이 아직 열리지 않았습니다 (데이터베이스 마이그레이션 0016 적용 전). 관리자에게 적용을 요청해 주세요.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0 pb-3">
          <CardTitle className="flex items-center gap-1.5 text-sm"><Mail className="h-4 w-4" aria-hidden /> 이메일 대장 · {counts.total}건</CardTitle>
          <Button type="button" size="sm" variant="outline" onClick={exportExcel} disabled={rows.length === 0}>
            <Download className="mr-1 h-3.5 w-3.5" aria-hidden /> 엑셀 내보내기 ({rows.length}건)
          </Button>
        </CardHeader>
        <CardContent className="space-y-3 text-xs text-muted-foreground">
          <p>
            이 프로젝트에서 담당자들이 전문가에게 보낸 메일(섭외 요청·수락서 송부 등)의 발송 내용과 수신 상태입니다.
            수신 상태는 메일 공급자가 알려 주는 <b>수신 서버 전달·열람·반송</b> 기준이며, 전문가가 실제로 읽었는지는 ‘열람 확인’으로만 짐작할 수 있습니다.
          </p>
          <div className="flex flex-wrap gap-2">
            <Stat label="발송" value={counts.total} />
            <Stat label="전달됨" value={counts.delivered + counts.opened} tone="ok" />
            <Stat label="열람" value={counts.opened} tone="ok" />
            <Stat label="반송·실패" value={counts.bounced + counts.failed} tone={counts.bounced + counts.failed > 0 ? "bad" : "muted"} />
            <Stat label="전달 확인 전" value={counts.unknown} tone="muted" />
          </div>
          {!data.providerConfigured && (
            <p className="rounded-md border border-amber-300 bg-amber-50 p-2 text-amber-900">
              메일 공급자(Resend)가 설정되지 않아 메일은 <b>테스트 모드(기록만)</b>로 남습니다. 실제 발송은 RESEND_API_KEY 설정 뒤에 시작됩니다.
            </p>
          )}
          {data.providerConfigured && !data.webhookConfigured && (
            <p className="rounded-md border border-amber-300 bg-amber-50 p-2 text-amber-900">
              수신 상태 웹훅(RESEND_WEBHOOK_SECRET)이 설정되지 않아 ‘전달됨·열람·반송’이 들어오지 않습니다. 발송 성공 여부만 보입니다.
              설정: Resend 대시보드 → Webhooks → <code>/api/webhooks/resend</code> 등록 후 서명 비밀을 환경변수에 넣습니다.
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="수신자 · 이메일 · 제목 · 발송자 검색" className="h-8 w-72 text-xs" />
            <select value={purpose} onChange={(e) => setPurpose(e.target.value)} className="h-8 rounded-md border bg-background px-2 text-xs" aria-label="종류 필터">
              <option value="all">종류 전체</option>
              {purposes.map((p) => (
                <option key={p} value={p}>{MAIL_PURPOSE_LABELS[p] ?? p}</option>
              ))}
            </select>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {rows.length === 0 ? (
            <p className="p-5 text-sm text-muted-foreground">
              {data.rows.length === 0 ? "이 프로젝트에서 보낸 메일 기록이 없습니다. (0016 적용 이전에 보낸 메일은 프로젝트와 연결되지 않아 여기 나오지 않습니다 — 발송 메뉴의 최근 기록에서 볼 수 있습니다.)" : "조건에 맞는 메일이 없습니다."}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-secondary/60 text-[11px] text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-left font-semibold">발송일시</th>
                    <th className="px-3 py-2 text-left font-semibold">발송자</th>
                    <th className="px-3 py-2 text-left font-semibold">수신자</th>
                    <th className="px-3 py-2 text-left font-semibold">종류</th>
                    <th className="px-3 py-2 text-left font-semibold">제목</th>
                    <th className="px-3 py-2 text-left font-semibold">발송</th>
                    <th className="px-3 py-2 text-left font-semibold">수신 상태</th>
                    <th className="px-3 py-2 text-left font-semibold">내용</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {rows.map((r) => {
                    const d = r.deliveryStatus ? MAIL_DELIVERY_LABELS[r.deliveryStatus] : null;
                    return (
                      <tr key={r.id} className={cn(r.sendStatus === "failed" && "bg-red-50")}>
                        <td className="whitespace-nowrap px-3 py-2 text-xs tabular-nums">{fmt(r.createdAt)}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-xs">
                          {r.senderName ?? "-"}
                          {mailProviderLabel(r.provider) && (
                            <span className="block text-[10px] text-muted-foreground" title={r.deliveryDetail ?? undefined}>{mailProviderLabel(r.provider)}</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-xs">
                          <span className="font-medium">{r.recipientName ?? "-"}</span>
                          <span className="block text-muted-foreground">{r.recipientEmail}</span>
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-xs">{MAIL_PURPOSE_LABELS[r.purpose] ?? r.purpose}</td>
                        <td className="max-w-[18rem] truncate px-3 py-2 text-xs" title={r.subject}>{r.subject}</td>
                        <td className="whitespace-nowrap px-3 py-2">
                          <Badge variant={r.sendStatus === "failed" ? "destructive" : r.sendStatus === "test" ? "outline" : "secondary"} className="text-[10px]">
                            {MAIL_SEND_STATUS_LABELS[r.sendStatus] ?? r.sendStatus}
                          </Badge>
                          {r.errorMessage && <span className="block max-w-[14rem] truncate text-[11px] text-destructive" title={r.errorMessage}>{r.errorMessage}</span>}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-xs">
                          {r.sendStatus !== "sent" ? (
                            <span className="text-muted-foreground">-</span>
                          ) : d ? (
                            <span className={cn("rounded px-1.5 py-0.5 font-semibold", TONE[d.tone])} title={r.deliveryDetail ?? undefined}>
                              {d.label}
                            </span>
                          ) : (
                            <span className="text-muted-foreground" title={r.trackable ? "공급자 웹훅 수신 전" : r.provider?.startsWith("personal:") ? "개인 메일 계정 발송은 전달·열람 추적이 되지 않습니다" : "공급자 메시지 id가 없어 추적 불가"}>
                              {r.trackable ? "확인 전" : r.provider?.startsWith("personal:") ? "개인 계정 — 추적 없음" : "추적 불가"}
                            </span>
                          )}
                          {(r.openedAt || r.deliveredAt || r.bouncedAt) && (
                            <span className="block text-[11px] text-muted-foreground">
                              {r.openedAt ? `열람 ${fmt(r.openedAt)}` : r.deliveredAt ? `전달 ${fmt(r.deliveredAt)}` : r.bouncedAt ? `반송 ${fmt(r.bouncedAt)}` : ""}
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-[11px]" onClick={() => setOpenRow(r)}>
                            <Eye className="mr-1 h-3.5 w-3.5" aria-hidden /> 보기
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {openRow && (
        <Dialog open onOpenChange={(v) => { if (!v) setOpenRow(null); }}>
          <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
            <DialogHeader>
              <DialogTitle className="text-base">{openRow.subject}</DialogTitle>
              <DialogDescription>
                {fmt(openRow.createdAt)} · {openRow.senderName ?? "담당자"} → {openRow.recipientName ?? ""} &lt;{openRow.recipientEmail}&gt; · {MAIL_PURPOSE_LABELS[openRow.purpose] ?? openRow.purpose}
                {" · "}{MAIL_SEND_STATUS_LABELS[openRow.sendStatus] ?? openRow.sendStatus}
                {openRow.sendStatus === "sent" ? ` · ${deliveryLabel(openRow)}` : ""}
              </DialogDescription>
            </DialogHeader>
            <Tabs defaultValue={openRow.bodyHtml ? "html" : "text"}>
              <TabsList className="h-8">
                <TabsTrigger value="html" className="h-7 text-xs" disabled={!openRow.bodyHtml}>보낸 모양(HTML)</TabsTrigger>
                <TabsTrigger value="text" className="h-7 text-xs">평문</TabsTrigger>
              </TabsList>
              <TabsContent value="html">
                {openRow.bodyHtml ? (
                  <iframe title="메일 본문" srcDoc={openRow.bodyHtml} sandbox="" className="h-[560px] w-full rounded-md border bg-[#f3f4f6]" />
                ) : (
                  <p className="text-xs text-muted-foreground">HTML 본문이 저장되지 않은 메일입니다.</p>
                )}
              </TabsContent>
              <TabsContent value="text">
                <pre className="max-h-[560px] overflow-y-auto whitespace-pre-wrap rounded-md bg-secondary/50 p-3 text-xs leading-relaxed">{openRow.body}</pre>
              </TabsContent>
            </Tabs>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

function Stat({ label, value, tone = "muted" }: { label: string; value: number; tone?: "ok" | "bad" | "muted" }) {
  return (
    <span className={cn("rounded-md border px-2 py-1 text-xs", tone === "ok" && "border-emerald-200 bg-emerald-50 text-emerald-900", tone === "bad" && "border-red-200 bg-red-50 text-red-900")}>
      {label} <b className="tabular-nums">{value}</b>
    </span>
  );
}

function deliveryLabel(r: MailLedgerRow): string {
  if (r.sendStatus !== "sent") return "";
  if (r.deliveryStatus) return MAIL_DELIVERY_LABELS[r.deliveryStatus]?.label ?? r.deliveryStatus;
  return r.trackable ? "확인 전" : "추적 불가";
}

function fmt(iso: string): string {
  return new Date(iso).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", hour12: false, year: "2-digit", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
}
