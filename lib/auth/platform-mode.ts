import "server-only";

import type { User } from "@supabase/supabase-js";

/**
 * 캐스트로그 관리모드 전환 허용 명단.
 *
 * 넥스트랩(운영사) 임직원도 평소에는 자기 회사의 테넌트 계정으로 일한다. 그러다
 * 다른 회사의 테넌트를 만들거나 모듈 요청을 승인해야 할 때만 관리모드로 올라간다.
 * 그래서 '관리자 계정'을 따로 두는 대신 **같은 계정이 모드를 바꾸는** 구조다.
 *
 * 명단을 DB가 아니라 환경변수에 두는 이유: 관리모드는 모든 테넌트의 경계를 넘는
 * 권한이다. 그 명단이 DB 안에 있으면, DB에 쓸 수 있게 된 공격자가 자기 자신을
 * 명단에 넣어 승격할 수 있다. 배포 환경변수는 앱 밖에 있어 그 경로가 막힌다.
 *
 * 설정: PLATFORM_ADMIN_EMAILS="a@x.com,b@y.com" (쉼표 구분, 대소문자 무시)
 * 미설정이면 아무도 전환할 수 없다 — 조용히 열어 두지 않는다.
 */

function allowlist(): string[] {
  return (process.env.PLATFORM_ADMIN_EMAILS ?? "")
    .split(",")
    .map((v) => v.trim().toLowerCase())
    .filter((v) => v.length > 0);
}

/** 이 계정이 관리모드로 올라갈 수 있는가 */
export function canEnterPlatformMode(user: User | null): boolean {
  const email = user?.email?.toLowerCase();
  if (!email) return false;
  return allowlist().includes(email);
}

/** 관리모드 진입 전 원래 자리 — 나갈 때 그대로 되돌리기 위해 보관한다 */
export type PriorContext = {
  role: string;
  tenant_id: string | null;
  tenant_slug: string | null;
};

export function readPriorContext(user: User | null): PriorContext | null {
  const raw = user?.app_metadata?.platform_mode_prior;
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  const role = value.role;
  if (typeof role !== "string") return null;
  return {
    role,
    tenant_id: typeof value.tenant_id === "string" ? value.tenant_id : null,
    tenant_slug: typeof value.tenant_slug === "string" ? value.tenant_slug : null,
  };
}
