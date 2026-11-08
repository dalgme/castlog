import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { isMissingColumnError } from "@/lib/supabase/errors";

export const runtime = "nodejs";

/**
 * Resend 수신 상태 웹훅 (기획 지시 2026-11-08 — 이메일 대장의 '수신 여부').
 *
 * Resend는 Svix 서명(svix-id · svix-timestamp · svix-signature)으로 보낸다. 서명 비밀(RESEND_WEBHOOK_SECRET,
 * "whsec_" + base64)이 없으면 **아무 이벤트도 받지 않는다** — 서명 없는 수신 상태는 조작될 수 있다.
 * 이벤트의 data.email_id를 email_logs.provider_message_id와 맞춰 delivery_status·시각을 갱신한다.
 * 본문·수신자 정보는 쓰지 않는다(이미 우리가 기록한 값이 진실). 멱등 — 같은 이벤트가 두 번 와도 결과가 같다.
 */

const TOLERANCE_SECONDS = 5 * 60;

function verifySvix(request: NextRequest, rawBody: string, secret: string): boolean {
  const id = request.headers.get("svix-id");
  const timestamp = request.headers.get("svix-timestamp");
  const signatures = request.headers.get("svix-signature");
  if (!id || !timestamp || !signatures) return false;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > TOLERANCE_SECONDS) return false;
  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const expected = createHmac("sha256", key).update(`${id}.${timestamp}.${rawBody}`).digest();
  // 헤더는 "v1,<base64> v1,<base64>" 형태 — 하나라도 맞으면 유효
  return signatures.split(" ").some((part) => {
    const [version, sig] = part.split(",");
    if (version !== "v1" || !sig) return false;
    let given: Buffer;
    try {
      given = Buffer.from(sig, "base64");
    } catch {
      return false;
    }
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
}

type ResendEvent = {
  type?: string;
  created_at?: string;
  data?: { email_id?: string; bounce?: { message?: string; type?: string; subType?: string }; [k: string]: unknown };
};

const STATUS_BY_TYPE: Record<string, string> = {
  "email.sent": "queued",
  "email.delivered": "delivered",
  "email.delivery_delayed": "delayed",
  "email.bounced": "bounced",
  "email.complained": "complained",
  "email.opened": "opened",
  "email.clicked": "opened",
  "email.failed": "failed",
};

/** 상태 순서 — 뒤에 온 이벤트가 앞 상태를 덮어쓰면 안 되는 경우(열람 뒤 '전달됨')를 막는다 */
const RANK: Record<string, number> = { queued: 1, delayed: 2, delivered: 3, opened: 4, bounced: 5, complained: 5, failed: 5 };

export async function POST(request: NextRequest) {
  if (!hasSupabaseEnv()) return NextResponse.json({ ok: false }, { status: 503 });
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json({ ok: false, error: "webhook secret not configured" }, { status: 401 });
  }
  const rawBody = await request.text();
  if (!verifySvix(request, rawBody, secret)) {
    return NextResponse.json({ ok: false, error: "invalid signature" }, { status: 401 });
  }
  let event: ResendEvent;
  try {
    event = JSON.parse(rawBody) as ResendEvent;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 });
  }
  const type = event.type ?? "";
  const emailId = event.data?.email_id;
  const status = STATUS_BY_TYPE[type];
  if (!emailId || !status) return NextResponse.json({ ok: true, ignored: true });

  const occurredAt = event.created_at && !Number.isNaN(new Date(event.created_at).getTime()) ? new Date(event.created_at).toISOString() : new Date().toISOString();
  const admin = createAdminClient();
  const { data: row, error } = await admin
    .from("email_logs")
    .select("id, delivery_status, delivered_at, opened_at, bounced_at")
    .eq("provider_message_id", emailId)
    .maybeSingle();
  if (error) {
    // 0016 전(컬럼 없음) — 받되 기록할 곳이 없다. 200으로 응답해 재전송 폭주를 막는다
    if (isMissingColumnError(error)) return NextResponse.json({ ok: true, ignored: true });
    return NextResponse.json({ ok: false }, { status: 500 });
  }
  if (!row) return NextResponse.json({ ok: true, unknown: true });

  const current = row.delivery_status ?? "queued";
  const patch: {
    delivery_updated_at: string;
    delivery_status?: string;
    delivered_at?: string;
    opened_at?: string;
    bounced_at?: string;
    delivery_detail?: string;
  } = { delivery_updated_at: occurredAt };
  if ((RANK[status] ?? 0) >= (RANK[current] ?? 0)) patch.delivery_status = status;
  if (status === "delivered" && !row.delivered_at) patch.delivered_at = occurredAt;
  if (status === "opened" && !row.opened_at) patch.opened_at = occurredAt;
  if ((status === "bounced" || status === "complained" || status === "failed") && !row.bounced_at) {
    patch.bounced_at = occurredAt;
    const detail = event.data?.bounce;
    patch.delivery_detail = [detail?.type, detail?.subType, detail?.message].filter(Boolean).join(" · ") || type;
  }
  if (status === "delayed") patch.delivery_detail = "수신 서버가 지연 처리 중";
  await admin.from("email_logs").update(patch).eq("id", row.id);
  return NextResponse.json({ ok: true });
}
