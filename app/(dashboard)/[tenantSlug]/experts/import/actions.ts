"use server";

import { revalidatePath } from "next/cache";
import * as XLSX from "xlsx";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { generateLinkToken, hashLinkToken } from "@/lib/auth/tokens";
import { roleFromUser, tenantIdFromUser } from "@/lib/auth/tenant";
import { buildPublicLink } from "@/lib/routing/links";
import { getTenantModules } from "@/lib/modules/server";
import { INVITATION_EXPIRES_DAYS } from "@/lib/experts/invitations";
import { normalizeKrMobileE164 } from "@/lib/auth/phone";
import {
  classifyImportRows,
  IMPORT_HEADERS,
  restoreLeadingZero,
  IMPORT_MAX_FILE_BYTES,
  IMPORT_MAX_ROWS,
  type ImportDupMode,
  type ImportPreviewRow,
} from "@/lib/experts/import";

export type ParseImportResult =
  | { ok: true; rows: ImportPreviewRow[] }
  | { ok: false; error: string };

export type CommitImportResult =
  | {
      ok: true;
      created: { name: string; phone: string; url: string }[];
      skipped: number;
    }
  | { ok: false; error: string };

type Gate =
  | {
      ok: true;
      supabase: ReturnType<typeof createClient>;
      tenantId: string;
      role: string;
      userId: string;
    }
  | { ok: false; error: string };

/** 공통 게이트 — tenant_id는 JWT에서만, 모듈 서버 강제 (CLAUDE.md 3·1-2) */
async function gate(): Promise<Gate> {
  if (!hasSupabaseEnv()) {
    return { ok: false, error: "서버 설정이 완료되지 않았습니다." };
  }
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const tenantId = tenantIdFromUser(user);
  const role = roleFromUser(user);
  if (!user || !tenantId || !role || !["org_admin", "manager"].includes(role)) {
    return { ok: false, error: "일괄 등록 권한이 없습니다." };
  }

  const modules = await getTenantModules();
  if (!modules.experts) {
    return { ok: false, error: "전문가 모듈이 비활성화된 테넌트입니다." };
  }

  return { ok: true, supabase, tenantId, role, userId: user.id };
}

/** RLS 범위(자사)에서 연결됨·대기중 번호 집합 조회 */
async function loadDupSets(supabase: ReturnType<typeof createClient>) {
  const [{ data: links }, { data: invitations }] = await Promise.all([
    supabase
      .from("expert_tenant_links")
      .select("status, experts (phone)")
      .in("status", ["active", "pending"]),
    supabase
      .from("expert_invitations")
      .select("invited_phone, status, expires_at")
      .eq("status", "pending"),
  ]);

  // 저장 형식이 섞여 있어도(E.164/국내 표기) 판정이 어긋나지 않게 정규화해 비교
  const toE164 = (value: string) =>
    normalizeKrMobileE164(restoreLeadingZero(value)) ?? value;

  const linkedPhones = new Set<string>();
  for (const link of links ?? []) {
    if (link.experts?.phone) linkedPhones.add(toE164(link.experts.phone));
  }

  const pendingPhones = new Set<string>();
  const nowMs = Date.now();
  for (const inv of invitations ?? []) {
    if (inv.invited_phone && new Date(inv.expires_at).getTime() > nowMs) {
      pendingPhones.add(toE164(inv.invited_phone));
    }
  }

  return { linkedPhones, pendingPhones };
}

/**
 * 1단계: 업로드 파일 파싱 + 검증 미리보기.
 * 셀은 문자열로 읽어(raw:false) 휴대폰 앞자리 0 유실을 방지한다.
 */
export async function parseExpertImport(
  formData: FormData
): Promise<ParseImportResult> {
  const g = await gate();
  if (!g.ok) return g;

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "엑셀 파일을 선택하세요." };
  }
  if (file.size > IMPORT_MAX_FILE_BYTES) {
    return { ok: false, error: "파일이 너무 큽니다 (최대 2MB)." };
  }
  if (!/\.(xlsx|xls)$/i.test(file.name)) {
    return { ok: false, error: "엑셀 파일(.xlsx)만 업로드할 수 있습니다." };
  }

  let sheetRows: Record<string, string>[];
  try {
    const workbook = XLSX.read(new Uint8Array(await file.arrayBuffer()), {
      type: "array",
    });
    const sheetName = workbook.SheetNames[0];
    const sheet = sheetName ? workbook.Sheets[sheetName] : undefined;
    if (!sheet) return { ok: false, error: "시트가 비어 있습니다." };
    sheetRows = XLSX.utils.sheet_to_json<Record<string, string>>(sheet, {
      raw: false,
      defval: "",
    });
  } catch {
    return { ok: false, error: "엑셀 파일을 읽을 수 없습니다. 템플릿 형식을 확인하세요." };
  }

  if (sheetRows.length === 0) {
    return { ok: false, error: "데이터 행이 없습니다. 템플릿에 명단을 채워 업로드하세요." };
  }
  if (sheetRows.length > IMPORT_MAX_ROWS) {
    return {
      ok: false,
      error: `한 번에 최대 ${IMPORT_MAX_ROWS}행까지 처리됩니다 (현재 ${sheetRows.length}행). 나눠서 업로드하세요.`,
    };
  }

  const [nameHeader, phoneHeader] = IMPORT_HEADERS;
  const firstRow = sheetRows[0] ?? {};
  if (!(nameHeader in firstRow) || !(phoneHeader in firstRow)) {
    return {
      ok: false,
      error: `첫 행 머리글이 템플릿과 다릅니다. '${nameHeader}', '${phoneHeader}' 컬럼이 필요합니다.`,
    };
  }

  const rawRows = sheetRows.map((row) => ({
    name: String(row[nameHeader] ?? ""),
    phone: String(row[phoneHeader] ?? ""),
  }));

  const { linkedPhones, pendingPhones } = await loadDupSets(g.supabase);
  return { ok: true, rows: classifyImportRows(rawRows, linkedPhones, pendingPhones) };
}

const commitSchema = z.object({
  rows: z
    .array(z.object({ name: z.string(), phone: z.string() }))
    .min(1, "등록할 행이 없습니다.")
    .max(IMPORT_MAX_ROWS),
  dupMode: z.enum(["skip", "reissue"]),
});

/**
 * 2단계: 확인 후 일괄 생성. 클라이언트가 돌려준 행을 신뢰하지 않고
 * 서버에서 다시 검증·중복 판정한 뒤, 단일 insert(원자적)로 생성한다.
 */
export async function commitExpertImport(input: {
  rows: { name: string; phone: string }[];
  dupMode: ImportDupMode;
}): Promise<CommitImportResult> {
  const g = await gate();
  if (!g.ok) return g;

  const parsed = commitSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "입력값을 확인하세요.",
    };
  }

  const { linkedPhones, pendingPhones } = await loadDupSets(g.supabase);
  const rows = classifyImportRows(parsed.data.rows, linkedPhones, pendingPhones);

  const reissue = parsed.data.dupMode === "reissue";
  const targets = rows.filter(
    (row) => row.status === "ok" || (reissue && row.status === "dup_pending")
  );
  const skipped = rows.length - targets.length;

  if (targets.length === 0) {
    return { ok: false, error: "등록 요청을 생성할 대상이 없습니다 (전부 중복 또는 오류)." };
  }

  // 재발급: 같은 번호의 기존 대기중 요청을 먼저 회수 (링크 이중 유효 방지)
  if (reissue) {
    const reissuePhones = targets
      .filter((row) => row.status === "dup_pending")
      .map((row) => row.phone as string);
    if (reissuePhones.length > 0) {
      const { error: revokeError } = await g.supabase
        .from("expert_invitations")
        .update({ status: "revoked" })
        .eq("status", "pending")
        .in("invited_phone", reissuePhones);
      if (revokeError) {
        return { ok: false, error: "기존 요청 회수에 실패했습니다. 다시 시도하세요." };
      }
    }
  }

  const expiresAt = new Date(
    Date.now() + INVITATION_EXPIRES_DAYS * 24 * 60 * 60 * 1000
  ).toISOString();

  const prepared = targets.map((row) => ({
    name: row.name,
    phone: row.phone as string,
    token: generateLinkToken(),
  }));

  // 단일 insert = 단일 문장 — 부분 실패 없이 전체 성공/전체 실패 (트랜잭션 요구)
  const { error: insertError } = await g.supabase.from("expert_invitations").insert(
    prepared.map((row) => ({
      tenant_id: g.tenantId,
      token_hash: hashLinkToken(row.token),
      invited_name: row.name,
      invited_phone: row.phone,
      expires_at: expiresAt,
      created_by: g.userId,
    }))
  );
  if (insertError) {
    return { ok: false, error: "등록 요청 생성에 실패했습니다. 다시 시도하세요." };
  }

  await g.supabase.from("audit_logs").insert({
    tenant_id: g.tenantId,
    actor_auth_user_id: g.userId,
    actor_role: g.role,
    action: "expert_invitation.bulk_create",
    resource_type: "expert_invitation",
    after_data: { count: prepared.length, dup_mode: parsed.data.dupMode },
  });

  const created = prepared.map((row) => ({
    name: row.name,
    phone: row.phone,
    url: buildPublicLink("expertJoin", row.token),
  }));

  revalidatePath("/[tenantSlug]/experts", "page");
  return { ok: true, created, skipped };
}
