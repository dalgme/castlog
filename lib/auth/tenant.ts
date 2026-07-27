import "server-only";

import type { User } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/server";

/**
 * tenant_id 주입 구조 (설계문서 3.6 — 보안 필수)
 *
 * - tenant_id는 Supabase Auth JWT의 **app_metadata에만** 존재하며 서버(service_role)만
 *   수정할 수 있다.
 * - 요청 파라미터·URL 슬러그·user_metadata에서 tenant_id를 읽는 코드는 보안 결함이다.
 * - URL의 테넌트 슬러그는 표시·네비게이션 용도일 뿐, 권한 판정은 항상 이 모듈을 거친다.
 */

/** JWT app_metadata에서 활성 tenant_id를 읽는다. 없으면 null (전문가 전역 계정 등). */
export function tenantIdFromUser(user: User | null): string | null {
  if (!user) return null;
  const tenantId = user.app_metadata?.tenant_id;
  return typeof tenantId === "string" && tenantId.length > 0 ? tenantId : null;
}

/**
 * 서버 컴포넌트·서버 액션에서 현재 세션의 tenant_id를 얻는다.
 * 인증 서버 검증(getUser)을 거친 값만 사용한다 — getSession의 미검증 클레임을 쓰지 않는다.
 */
export async function getTenantId(): Promise<string | null> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return tenantIdFromUser(user);
}

/** 세션 사용자 역할 (설계문서 3.1 — 5단계 권한 체계) */
export type UserRole =
  | "platform_admin" // 플랫폼관리자
  | "org_admin" // 기업총괄관리자
  | "manager" // 관리자
  | "staff" // 직원
  | "expert"; // 전문가

export function roleFromUser(user: User | null): UserRole | null {
  if (!user) return null;
  const role = user.app_metadata?.role;
  return typeof role === "string" ? (role as UserRole) : null;
}

/**
 * 활성 테넌트 전환 (전문가처럼 여러 테넌트에 연결된 계정용)
 *
 * 서버가 다음을 검증한 뒤 app_metadata.tenant_id를 갱신한다:
 *  1) 요청 사용자가 대상 테넌트에 실제로 연결되어 있는가 (expert_tenant_links)
 *  2) 연결 상태가 활성인가
 *
 * 구현은 단계 6(전문가 소유 신원 모델)에서 진행한다 — 지금은 시그니처만 확정.
 */
export type SwitchActiveTenantResult =
  | { ok: true; tenantId: string }
  | { ok: false; error: "not_linked" | "link_inactive" | "unauthorized" };

export type SwitchActiveTenant = (
  targetTenantId: string
) => Promise<SwitchActiveTenantResult>;
