import "server-only";

import type { User } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/server";
import {
  gradeFromLegacyRole,
  isUserGrade,
  type UserGrade,
} from "@/lib/auth/grades";

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

/**
 * 세션 사용자 역할 (실행 권한 축).
 *
 * users.grade(권한 6단계)에서 DB 트리거가 파생시키는 값이다 — 직접 쓰지 않는다.
 * 사람이 보는 권한단계는 lib/auth/grades.ts 의 UserGrade 를 쓴다.
 */
export type UserRole =
  | "platform_admin" // 플랫폼관리자 (넥스트랩)
  | "org_admin" // 대표 (회사 총괄관리자)
  | "manager" // 이사·팀장
  | "staff" // 대리·주임·사원
  | "expert"; // 전문가

export function roleFromUser(user: User | null): UserRole | null {
  if (!user) return null;
  const role = user.app_metadata?.role;
  return typeof role === "string" ? (role as UserRole) : null;
}

/**
 * JWT app_metadata.grade — 권한 6단계.
 * 클레임이 아직 없는 기존 세션은 role에서 역산한다(DB app.user_grade와 동일 규칙).
 */
export function gradeFromUser(user: User | null): UserGrade | null {
  if (!user) return null;
  const grade = user.app_metadata?.grade;
  if (isUserGrade(grade)) return grade;
  const role = roleFromUser(user);
  if (role === "expert" || role === "platform_admin" || !role) return null;
  return gradeFromLegacyRole(role);
}

/**
 * 활성 테넌트 전환 (전문가처럼 여러 테넌트에 연결된 계정용)
 *
 * 서버가 다음을 검증한 뒤 app_metadata.tenant_id를 갱신한다:
 *  1) 요청 사용자가 대상 테넌트에 실제로 연결되어 있는가 (expert_tenant_links)
 *  2) 연결 상태가 활성인가
 *
 * 구현: lib/auth/switch-tenant.ts (단계 6)
 */
export type SwitchActiveTenantResult =
  | { ok: true; tenantId: string }
  | { ok: false; error: "not_linked" | "link_inactive" | "unauthorized" };

export type SwitchActiveTenant = (
  targetTenantId: string
) => Promise<SwitchActiveTenantResult>;
