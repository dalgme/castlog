"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Mail, Power, Trash2 } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import {
  MAIL_PROVIDERS,
  MAIL_PROVIDER_PRESETS,
  type MailAccountStatus,
  type MailProvider,
} from "@/lib/email/mail-accounts-shared";

import { deleteMyMailAccount, saveAndVerifyMyMailAccount, setMyMailAccountActive } from "./mail-account-actions";

/**
 * 내 메일 계정으로 발송 (기획 지시 2026-11-08).
 * 프리셋 선택 → 메일 주소·앱 비밀번호 → '저장하고 테스트 발송' → 본인 주소로 테스트 메일이 오면 활성.
 * 비밀번호는 저장 후 다시 보이지 않는다. 회사가 허용하지 않았으면 안내만.
 */
export function MailAccountPanel({ status }: { status: MailAccountStatus }) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState(status.account === null);
  const [provider, setProvider] = useState<MailProvider>(status.account?.provider ?? "naverworks");
  const [fromEmail, setFromEmail] = useState(status.account?.fromEmail ?? "");
  const [username, setUsername] = useState(status.account?.username ?? "");
  const [password, setPassword] = useState("");
  const [smtpHost, setSmtpHost] = useState(status.account?.smtpHost ?? "");
  const [smtpPort, setSmtpPort] = useState(String(status.account?.smtpPort ?? 465));
  const [smtpSecure, setSmtpSecure] = useState(status.account?.smtpSecure ?? true);
  const [error, setError] = useState<string | null>(null);
  const preset = MAIL_PROVIDER_PRESETS[provider];

  if (!status.ready) {
    return <p className="text-sm text-muted-foreground">개인 메일 계정 발송 기능이 아직 열리지 않았습니다 (데이터베이스 마이그레이션 0018 적용 전).</p>;
  }
  if (!status.allowed) {
    return (
      <div className="space-y-2 text-sm text-muted-foreground">
        <p>
          회사가 <b>직원 개인 메일 계정 발송</b>을 아직 허용하지 않았습니다. 지금은 섭외·수락서 메일이 플랫폼 계정(no-reply)에서 회사 이름·담당자 이름으로 나갑니다.
        </p>
        <p>대표 또는 발송 설정 담당자가 설정 &gt; 발송에서 ‘직원 개인 계정 발송 허용’을 켜면 여기서 내 계정을 연결할 수 있습니다.</p>
      </div>
    );
  }

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, okMsg: string) => {
    setError(null);
    startTransition(async () => {
      const r = await fn();
      if (!r.ok) setError(r.error ?? "실패했습니다.");
      else {
        toast({ description: okMsg });
        router.refresh();
      }
    });
  };

  function save() {
    setError(null);
    startTransition(async () => {
      const r = await saveAndVerifyMyMailAccount({
        provider,
        fromEmail,
        username,
        password,
        smtpHost,
        smtpPort: Number(smtpPort) || undefined,
        smtpSecure,
      });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      toast({ description: "연결되었습니다. 본인 메일함에 테스트 메일이 도착했는지 확인하세요." });
      setPassword("");
      setEditing(false);
      router.refresh();
    });
  }

  return (
    <div className="space-y-3 text-sm">
      <p className="text-xs leading-relaxed text-muted-foreground">
        연결하면 내가 보내는 섭외 요청·수락서 안내 메일이 <b>내 메일 계정에서</b> 나가고 보낸편지함에도 남습니다. 비밀번호는 암호화되어 저장되고 다시 보이지 않으며, 변경·테스트는 기록에 남습니다.
        {!status.canStoreSecrets && <span className="block text-amber-800">서버에 암호화 키가 없어 지금은 저장할 수 없습니다 (운영자 문의).</span>}
      </p>

      {status.account && !editing && (
        <div className="space-y-2 rounded-lg border p-3">
          <div className="flex flex-wrap items-center gap-2">
            <Mail className="h-4 w-4 text-muted-foreground" aria-hidden />
            <span className="font-medium">{status.account.fromEmail}</span>
            <Badge variant="secondary">{MAIL_PROVIDER_PRESETS[status.account.provider].label}</Badge>
            {status.account.isActive && status.account.verifiedAt ? (
              <Badge className="bg-emerald-600 hover:bg-emerald-600"><CheckCircle2 className="mr-1 h-3 w-3" aria-hidden /> 사용 중</Badge>
            ) : (
              <Badge variant="outline">꺼짐</Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            {status.account.smtpHost}:{status.account.smtpPort} · 테스트 {status.account.verifiedAt ? fmt(status.account.verifiedAt) : "미통과"}
            {status.account.lastUsedAt ? ` · 마지막 발송 ${fmt(status.account.lastUsedAt)}` : ""}
          </p>
          {status.account.lastError && (
            <p className="rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900">
              최근 발송 실패: {status.account.lastError} — 그 메일은 플랫폼 계정으로 대신 나갔습니다. 비밀번호가 바뀌었으면 다시 연결하세요.
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => run(() => setMyMailAccountActive(!status.account?.isActive), status.account?.isActive ? "개인 계정 발송을 껐습니다. 플랫폼 계정으로 나갑니다." : "개인 계정 발송을 켰습니다.")}>
              <Power className="mr-1 h-3.5 w-3.5" aria-hidden /> {status.account.isActive ? "끄기" : "켜기"}
            </Button>
            <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => { setEditing(true); setPassword(""); }}>
              다시 연결 (비밀번호 변경)
            </Button>
            <Button type="button" size="sm" variant="ghost" className="text-destructive" disabled={pending} onClick={() => { if (window.confirm("연결을 삭제할까요? 이후 메일은 플랫폼 계정으로 나갑니다.")) run(() => deleteMyMailAccount(), "연결을 삭제했습니다."); }}>
              <Trash2 className="mr-1 h-3.5 w-3.5" aria-hidden /> 삭제
            </Button>
          </div>
        </div>
      )}

      {editing && (
        <div className="space-y-3 rounded-lg border p-3">
          {error && <Alert variant="destructive"><AlertDescription className="text-xs">{error}</AlertDescription></Alert>}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="ma-provider">메일 서비스</Label>
              <select id="ma-provider" value={provider} onChange={(e) => setProvider(e.target.value as MailProvider)} className="h-9 w-full rounded-md border bg-background px-2 text-sm">
                {MAIL_PROVIDERS.map((p) => (
                  <option key={p} value={p}>{MAIL_PROVIDER_PRESETS[p].label}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="ma-email">내 메일 주소 (보낸 사람)</Label>
              <Input id="ma-email" type="email" value={fromEmail} onChange={(e) => setFromEmail(e.target.value)} placeholder="name@letsedu.kr" autoComplete="email" />
            </div>
            {!preset.usernameIsEmail && (
              <div className="space-y-1">
                <Label htmlFor="ma-user">로그인 아이디 <span className="text-xs text-muted-foreground">(비우면 메일 주소 @ 앞부분)</span></Label>
                <Input id="ma-user" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="off" />
              </div>
            )}
            <div className="space-y-1">
              <Label htmlFor="ma-pass">앱 비밀번호</Label>
              <Input id="ma-pass" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" placeholder={status.account ? "새 비밀번호 입력" : ""} />
            </div>
            {provider === "custom" && (
              <>
                <div className="space-y-1">
                  <Label htmlFor="ma-host">SMTP 서버</Label>
                  <Input id="ma-host" value={smtpHost} onChange={(e) => setSmtpHost(e.target.value)} placeholder="smtp.example.com" />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label htmlFor="ma-port">포트</Label>
                    <Input id="ma-port" inputMode="numeric" value={smtpPort} onChange={(e) => setSmtpPort(e.target.value.replace(/\D/g, ""))} />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="ma-secure">보안</Label>
                    <select id="ma-secure" value={smtpSecure ? "ssl" : "starttls"} onChange={(e) => setSmtpSecure(e.target.value === "ssl")} className="h-9 w-full rounded-md border bg-background px-2 text-sm">
                      <option value="ssl">SSL (465)</option>
                      <option value="starttls">STARTTLS (587)</option>
                    </select>
                  </div>
                </div>
              </>
            )}
          </div>
          <p className="rounded-md bg-secondary/50 p-2 text-xs leading-relaxed text-muted-foreground">
            <b>앱 비밀번호 발급:</b> {preset.passwordHint}
            {preset.host && <span className="block">서버: {preset.host}:{preset.port} ({preset.secure ? "SSL" : "STARTTLS"}) — 자동 설정됩니다.</span>}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" disabled={pending || !status.canStoreSecrets || !fromEmail || !password} onClick={save}>
              {pending ? "연결 확인 중…" : "저장하고 테스트 발송"}
            </Button>
            {status.account && (
              <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => { setEditing(false); setError(null); }}>취소</Button>
            )}
          </div>
          <p className="text-[11px] text-muted-foreground">저장 시 실제 로그인을 확인하고 내 주소로 테스트 메일 1통을 보냅니다. 실패하면 저장되지 않습니다.</p>
        </div>
      )}
    </div>
  );
}

function fmt(iso: string): string {
  return new Date(iso).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", hour12: false, month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
}
