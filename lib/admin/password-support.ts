/**
 * 비밀번호 지원 결과 타입 — 관리모드(플랫폼)와 임직원 관리(기업) 액션이 같은
 * 화면 컴포넌트(components/admin/password-support-actions)를 쓰기 위한 공통 계약.
 * 클라이언트에서도 import 하므로 server-only 코드를 두지 않는다.
 */

export type TempPasswordResult =
  | { ok: true; tempPassword: string; email: string }
  | { ok: false; error: string };

export type ResetEmailResult =
  | { ok: true; email: string }
  | { ok: false; error: string };
