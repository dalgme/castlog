import { notFound } from "next/navigation";

import { requireRole } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { gradeLabel, GRADE_SHORT_TAGS, isUserGrade } from "@/lib/auth/grades";
import { PageHeader } from "@/components/layout/header";
import { EmptyState } from "@/components/layout/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import { PasswordSupportActions } from "@/components/admin/password-support-actions";

import { issueTempPassword, sendUserResetEmail } from "../actions";

export const metadata = { title: "기업 이용자 — 캐스트로그 관리모드" };
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const JOINED_LABEL: Record<string, string> = {
  admin_created: "관리자 생성",
  self_signup: "직접 가입",
};

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "-";
  return new Date(iso).toLocaleString("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "2-digit",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * 한 회사의 이용자 목록 (기획 지시 2026-09-11).
 *
 * service_role 조회다 — users는 테넌트 RLS라 관리모드 세션으로는 읽히지 않는다.
 * 가져오는 것은 계정 식별·연락·상태뿐이며, 주민번호·계좌 같은 비밀정보는
 * 이 화면과 무관하다(§5). '최근 로그인'과 '임시 비밀번호 상태'는 auth 쪽에서
 * 가져온다 — "이 사람이 들어오긴 했나"가 지원 문의의 첫 질문이라서다.
 */
export default async function TenantUsersPage({
  params,
}: {
  params: { tenantId: string };
}) {
  await requireRole(["platform_admin"]);
  if (!UUID.test(params.tenantId)) notFound();

  const backButton = (
    <Button asChild variant="outline" size="sm">
      <a href="/platform-admin/users">← 기업 목록</a>
    </Button>
  );

  if (!hasSupabaseEnv()) {
    return (
      <main className="p-6">
        <PageHeader title="기업 이용자" actions={backButton} />
        <EmptyState title="서버 설정이 완료되지 않았습니다" />
      </main>
    );
  }

  const admin = createAdminClient();
  const { data: tenant } = await admin
    .from("tenants")
    .select("id, name, slug, status")
    .eq("id", params.tenantId)
    .maybeSingle();
  if (!tenant) notFound();

  const { data: users } = await admin
    .from("users")
    .select(
      "id, name, email, phone, department, grade, role, is_active, joined_via, created_at, positions (name)"
    )
    .eq("tenant_id", tenant.id)
    .order("is_active", { ascending: false })
    .order("created_at", { ascending: true });
  const rows = users ?? [];

  // auth 메타 — 최근 로그인·임시 비밀번호 여부. 계정 수가 수십이라 건별 조회로 충분하다.
  const authMeta = new Map<string, { lastSignIn: string | null; mustChange: boolean; isPlatformAdmin: boolean }>();
  await Promise.all(
    rows.map(async (u) => {
      const { data } = await admin.auth.admin.getUserById(u.id);
      const meta = data?.user?.app_metadata ?? {};
      authMeta.set(u.id, {
        lastSignIn: data?.user?.last_sign_in_at ?? null,
        mustChange: meta.must_change_password === true,
        isPlatformAdmin: meta.role === "platform_admin",
      });
    })
  );

  const activeCount = rows.filter((u) => u.is_active).length;

  return (
    <div className="min-h-screen bg-secondary/50">
      <PageHeader title={`${tenant.name} — 이용자`} actions={backButton} />
      <main className="space-y-3 p-5">
        <p className="text-xs text-muted-foreground">
          <span className="font-mono">/{tenant.slug}</span> · 계정 {rows.length}명 (활성 {activeCount}명)
        </p>
        {tenant.status !== "active" && (
          <p className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
            이 기업은 현재 {tenant.status === "suspended" ? "중지" : "해지"} 상태입니다.
            {tenant.status === "terminated" && " 해지된 기업의 계정에는 비밀번호 지원을 할 수 없습니다."}
          </p>
        )}
        <p className="text-xs text-muted-foreground">
          <b>재설정 메일</b>은 본인이 링크에서 직접 새 비밀번호를 정합니다(권장).{" "}
          <b>임시 비밀번호</b>는 메일을 못 받는 경우의 예비 수단으로, 한 번만 표시되고 다음 로그인에서 반드시 바꾸게 됩니다.
          두 조치 모두 감사로그에 남습니다.
        </p>

        {rows.length === 0 ? (
          <EmptyState title="계정이 없습니다" />
        ) : (
          <div className="overflow-x-auto rounded-lg border bg-background">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>이름</TableHead>
                  <TableHead>아이디(이메일)</TableHead>
                  <TableHead>직급 · 권한</TableHead>
                  <TableHead>부서 · 연락처</TableHead>
                  <TableHead>상태</TableHead>
                  <TableHead>최근 로그인</TableHead>
                  <TableHead>가입</TableHead>
                  <TableHead className="text-right">비밀번호 지원</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((u) => {
                  const meta = authMeta.get(u.id);
                  const position = (u.positions as { name: string } | null)?.name ?? null;
                  const grade = isUserGrade(u.grade) ? u.grade : null;
                  return (
                    <TableRow key={u.id} className={u.is_active ? undefined : "opacity-60"}>
                      <TableCell className="whitespace-nowrap font-medium">
                        {u.name}
                        {u.role === "org_admin" && (
                          <Badge className="ml-1.5 h-4 px-1 text-[10px]">대표</Badge>
                        )}
                        {meta?.isPlatformAdmin && (
                          <Badge variant="outline" className="ml-1.5 h-4 px-1 text-[10px]">플랫폼관리자</Badge>
                        )}
                      </TableCell>
                      <TableCell className="whitespace-nowrap font-mono text-xs">{u.email}</TableCell>
                      <TableCell className="whitespace-nowrap text-xs">
                        <span>{position ?? "-"}</span>
                        <span className="ml-1 text-muted-foreground" title={grade ? GRADE_SHORT_TAGS[grade] : undefined}>
                          · {gradeLabel(u.grade)}
                        </span>
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-xs">
                        {u.department ?? "-"}
                        <span className="ml-1 text-muted-foreground">{u.phone ?? ""}</span>
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        <Badge variant={u.is_active ? "default" : "destructive"} className="h-5 text-[10px]">
                          {u.is_active ? "활성" : "비활성"}
                        </Badge>
                        {meta?.mustChange && (
                          <Badge variant="outline" className="ml-1 h-5 border-amber-400 text-[10px] text-amber-700">
                            임시 비밀번호
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                        {meta?.lastSignIn ? fmtDate(meta.lastSignIn) : "로그인 기록 없음"}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                        {fmtDate(u.created_at).slice(0, 10)}
                        <span className="ml-1">{JOINED_LABEL[u.joined_via] ?? u.joined_via}</span>
                      </TableCell>
                      <TableCell className="text-right">
                        <PasswordSupportActions
                          userId={u.id}
                          userName={u.name}
                          email={u.email}
                          disabled={!u.is_active || tenant.status === "terminated" || meta?.isPlatformAdmin === true}
                          sendReset={sendUserResetEmail}
                          issueTemp={issueTempPassword}
                        />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </main>
    </div>
  );
}
