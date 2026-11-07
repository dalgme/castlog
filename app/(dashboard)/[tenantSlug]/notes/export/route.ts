import { NextResponse, type NextRequest } from "next/server";

import { requireRole } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { xlsxResponse } from "@/lib/exports/xlsx";
import { logAudit } from "@/lib/audit/log";
import { loadNotesSnapshot } from "@/lib/notes/server";
import { formatKstTime, kstDateKey } from "@/lib/notes/types";

/** 내 쪽지 엑셀 내보내기 (§12-6) — 날짜·시간순. 보낸 쪽지·받은 쪽지 모두, 내 쪽에서 숨긴 것은 제외 */
export async function GET(request: NextRequest, { params }: { params: { tenantSlug: string } }) {
  const user = await requireRole(["platform_admin", "org_admin", "manager", "staff"]);
  if (!hasSupabaseEnv() || !user) {
    return NextResponse.redirect(new URL(`/${params.tenantSlug}/notes`, request.url));
  }
  const snapshot = await loadNotesSnapshot(user.id);
  if (!snapshot.ready) {
    return NextResponse.redirect(new URL(`/${params.tenantSlug}/notes`, request.url));
  }
  const nameOf = new Map(snapshot.users.map((u) => [u.id, u.name]));
  const projectOf = new Map(snapshot.projects.map((p) => [p.id, p]));
  const rows = snapshot.notes.map((n) => {
    const project = n.projectId ? projectOf.get(n.projectId) : null;
    return {
      날짜: kstDateKey(n.createdAt),
      시간: formatKstTime(n.createdAt),
      구분: n.senderId === user.id ? "보냄" : "받음",
      보낸사람: nameOf.get(n.senderId) ?? "",
      받는사람: nameOf.get(n.recipientId) ?? "",
      사업연도: project?.businessYear ?? "",
      주제: n.topicKind === "project" ? project?.name ?? "(삭제된 프로젝트)" : `기타사항${n.topicLabel ? ` · ${n.topicLabel}` : ""}`,
      내용: n.body,
      읽음: n.readAt ? "읽음" : "",
    };
  });

  const supabase = createClient();
  await logAudit(supabase, user, {
    action: "export.staff_notes",
    resourceType: "export",
    afterData: { rows: rows.length },
  });
  return xlsxResponse("쪽지", [["쪽지", rows]]);
}
