import { createBrowserClient } from "@supabase/ssr";

import type { Database } from "./database.types";

/**
 * 브라우저(클라이언트 컴포넌트)용 Supabase 클라이언트.
 *
 * 주의: tenant_id는 서버가 JWT app_metadata에 심은 값만 유효하다.
 * 클라이언트에서 tenant_id를 읽거나 서버로 보내는 코드를 작성하지 말 것 (설계문서 3.6).
 */
export function createClient() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
