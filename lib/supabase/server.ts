import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import type { Database } from "./database.types";

/**
 * 서버 컴포넌트·서버 액션·라우트 핸들러용 Supabase 클라이언트.
 * Server Component에서는 쿠키 쓰기가 불가능하므로 setAll 실패를 무시한다
 * (미들웨어의 updateSession이 세션 갱신을 담당).
 */
export function createClient() {
  const cookieStore = cookies();

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Server Component에서 호출된 경우 — 미들웨어가 세션을 갱신하므로 무시 가능
          }
        },
      },
    }
  );
}
