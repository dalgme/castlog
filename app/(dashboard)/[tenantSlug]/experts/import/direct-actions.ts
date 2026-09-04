"use server";

import { revalidatePath } from "next/cache";
import * as XLSX from "xlsx";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { roleFromUser, tenantIdFromUser } from "@/lib/auth/tenant";
import { deniedExec } from "@/lib/monitoring/action-denials";
import { canExecTenant } from "@/lib/auth/exec-policy";
import { getTenantModules } from "@/lib/modules/server";
import { isPracticeMode } from "@/lib/practice/server";
import { encryptSecret, hasSecretsKey } from "@/lib/crypto/secrets";
import { describeDbError } from "@/lib/supabase/db-errors";
import {
  classifyDirectImportRows,
  DIRECT_IMPORT_HEADERS,
  DIRECT_IMPORT_MAX_FILE_BYTES,
  DIRECT_IMPORT_MAX_ROWS,
  type DirectImportPreviewRow,
  type DirectImportRowInput,
} from "@/lib/experts/direct-import";

/**
 * 보유자료로 전문가 가입/등록 (기획 개정 2026-08-22)
 *
 * 등록 요청 링크 발급(actions.ts)과 달리 experts 레코드를 직접 만든다.
 * 전역 테이블 쓰기이므로 admin 클라이언트를 쓰되, 게이트는 동일하게
 * JWT(tenant_id·role) + 모듈 서버 강제. 이미 있는 전문가는 데이터를
 * 덮어쓰지 않고 자사 관계만 추가한다 (전문가 소유 원칙 §4).
 */

export type ParseDirectImportResult =
  | { ok: true; rows: DirectImportPreviewRow[] }
  | { ok: false; error: string };

export type CommitDirectImportResult =
  | { ok: true; created: number; linked: number; skipped: number }
  | { ok: false; error: string };

type Gate =
  | { ok: true; tenantId: string; userId: string; tenantName: string }
  | { ok: false; error: string };

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
  if (!user || !tenantId || !role) {
    return { ok: false, error: "로그인이 필요합니다." };
  }
  // service_role 경로라 RLS가 아닌 이 게이트가 유일한 강제 지점 — 회사 조정 반영
  if (!(await canExecTenant("bulkImport", user))) {
    return { ok: false, error: await deniedExec("bulkImport") };
  }

  const modules = await getTenantModules();
  if (!modules.experts) {
    return { ok: false, error: "전문가 모듈이 비활성화된 테넌트입니다." };
  }

  // 연습모드 차단 — 실제 전역 전문가 레코드가 생기는 작업이다
  if (await isPracticeMode()) {
    return {
      ok: false,
      error: "연습모드에서는 보유자료 등록을 사용할 수 없습니다. 연습모드를 종료한 뒤 진행하세요.",
    };
  }

  const { data: tenant } = await supabase
    .from("tenants")
    .select("name")
    .eq("id", tenantId)
    .maybeSingle();

  return { ok: true, tenantId, userId: user.id, tenantName: tenant?.name ?? "" };
}

/** 전역 experts·자사 관계 번호 집합 (전역 판정이라 admin 클라이언트 필요) */
async function loadPhoneSets(tenantId: string) {
  const admin = createAdminClient();
  const [{ data: experts }, { data: links }] = await Promise.all([
    admin.from("experts").select("phone, name, email").eq("is_practice", false),
    admin
      .from("expert_tenant_links")
      .select("status, experts (phone)")
      .eq("tenant_id", tenantId)
      .in("status", ["active", "pending"]),
  ]);

  const existingPhones = new Set<string>();
  // 이름·이메일 대조 색인 — 번호가 바뀐 동일인 재확인용 (기획 2026-08-30 — 24번)
  const existingNames = new Set<string>();
  const existingEmails = new Set<string>();
  for (const row of experts ?? []) {
    if (row.phone) existingPhones.add(row.phone);
    if (row.name) existingNames.add(row.name.trim());
    if (row.email) existingEmails.add(row.email.trim().toLowerCase());
  }
  const linkedPhones = new Set<string>();
  for (const link of links ?? []) {
    if (link.experts?.phone) linkedPhones.add(link.experts.phone);
  }
  return {
    existingPhones,
    linkedPhones,
    similar: { names: existingNames, emails: existingEmails },
  };
}

const HEADER_TO_KEY: Record<string, keyof DirectImportRowInput | "expertiseFieldsText"> = {
  이름: "name",
  소속: "organization",
  직위: "jobTitle",
  이메일: "email",
  핸드폰번호: "phone",
  은행명: "bankName",
  계좌번호: "accountNumber",
  예금주: "accountHolder",
  거주지: "residence",
  "최종학위 및 자격증": "degreeCertifications",
  "강의(멘토링) 가능분야": "expertiseFieldsText",
  "간략 이력": "bio",
};

/** 1단계: 파일 파싱 + 검증 미리보기 */
export async function parseDirectImport(
  formData: FormData
): Promise<ParseDirectImportResult> {
  const g = await gate();
  if (!g.ok) return g;

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "엑셀 파일을 선택하세요." };
  }
  if (file.size > DIRECT_IMPORT_MAX_FILE_BYTES) {
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
    return { ok: false, error: "데이터 행이 없습니다. 템플릿에 명단을 채워 주세요." };
  }
  if (sheetRows.length > DIRECT_IMPORT_MAX_ROWS) {
    return { ok: false, error: `한 번에 최대 ${DIRECT_IMPORT_MAX_ROWS}행까지 등록할 수 있습니다.` };
  }

  // 머리글 검사 — 최소한 이름·핸드폰번호 컬럼은 템플릿 그대로여야 한다
  const keys = Object.keys(sheetRows[0] ?? {});
  if (!keys.includes("이름") || !keys.includes("핸드폰번호")) {
    return {
      ok: false,
      error: `템플릿 형식이 아닙니다. 머리글이 ${DIRECT_IMPORT_HEADERS.join(", ")} 인지 확인하세요.`,
    };
  }

  const mapped = sheetRows.map((raw) => {
    const out: Record<string, string> = {};
    for (const [header, key] of Object.entries(HEADER_TO_KEY)) {
      out[key] = raw[header] ?? "";
    }
    return out;
  });

  const { existingPhones, linkedPhones, similar } = await loadPhoneSets(
    g.tenantId
  );
  return {
    ok: true,
    rows: classifyDirectImportRows(mapped, existingPhones, linkedPhones, similar),
  };
}

/** 2단계: 확정 등록 — 서버에서 재검증·재판정 후 생성 */
export async function commitDirectImport(
  rows: Record<string, string>[]
): Promise<CommitDirectImportResult> {
  const g = await gate();
  if (!g.ok) return g;

  if (!Array.isArray(rows) || rows.length === 0) {
    return { ok: false, error: "등록할 행이 없습니다." };
  }
  if (rows.length > DIRECT_IMPORT_MAX_ROWS) {
    return { ok: false, error: `한 번에 최대 ${DIRECT_IMPORT_MAX_ROWS}행까지 등록할 수 있습니다.` };
  }

  const { existingPhones, linkedPhones } = await loadPhoneSets(g.tenantId);
  const judged = classifyDirectImportRows(rows, existingPhones, linkedPhones);
  // 이름·이메일 대조(similar)는 확정 판정에 쓰지 않는다 — 재확인은 미리보기
  // 단계의 UX이고, 같은 이름의 실제 다른 사람 등록을 서버가 막으면 안 된다.

  const actionable = judged.filter(
    (r) => r.status === "create" || r.status === "link"
  );
  if (actionable.length === 0) {
    return { ok: false, error: "등록 가능한 행이 없습니다 (전부 중복이거나 오류)." };
  }

  // 계좌번호가 하나라도 있으면 암호화 키가 필수 — 평문 저장은 하지 않는다
  const hasAccount = actionable.some(
    (r) => r.status === "create" && r.input.accountNumber.replace(/\D/g, "").length > 0
  );
  if (hasAccount && !hasSecretsKey()) {
    return {
      ok: false,
      error:
        "계좌번호 암호화 키(SECRETS_ENCRYPTION_KEY)가 서버에 설정되지 않았습니다. 캐스트로그에 알려 주세요.",
    };
  }

  const admin = createAdminClient();

  // 분야 마스터 정리 — 파일에 나온 분야 중 없는 것은 마스터에 추가한다
  // (엑셀의 쉼표 분리 값을 '각각의 항목'으로 승격 — 관리모드에서 정리 가능)
  const allFieldNames = Array.from(
    new Set(actionable.flatMap((r) => r.expertiseFields))
  );
  const fieldIdByName = new Map<string, string>();
  if (allFieldNames.length > 0) {
    await admin
      .from("expertise_fields")
      .upsert(
        allFieldNames.map((name) => ({ name })),
        { onConflict: "name", ignoreDuplicates: true }
      );
    const { data: fields, error: fieldsError } = await admin
      .from("expertise_fields")
      .select("id, name")
      .in("name", allFieldNames);
    if (fieldsError) {
      return { ok: false, error: describeDbError(fieldsError.message, "분야 목록 처리에 실패했습니다.") };
    }
    for (const f of fields ?? []) fieldIdByName.set(f.name, f.id);
  }

  let created = 0;
  let linked = 0;
  const nowIso = new Date().toISOString();

  for (const row of actionable) {
    if (!row.phoneE164) continue;

    let expertId: string;

    if (row.status === "create") {
      const { data: insertedExpert, error: expertError } = await admin
        .from("experts")
        .insert({
          auth_user_id: null, // 본인이 휴대폰 인증으로 로그인할 때 클레임된다
          name: row.input.name,
          organization: row.input.organization || null,
          job_title: row.input.jobTitle || null,
          phone: row.phoneE164,
          email: row.input.email || null,
          region: row.input.residence || null,
          degree_certifications: row.input.degreeCertifications || null,
          bio: row.input.bio || null,
        })
        .select("id")
        .single();
      if (expertError || !insertedExpert) {
        return {
          ok: false,
          error: describeDbError(
            expertError?.message,
            `${row.input.name}(${row.input.phone}) 등록 중 실패했습니다. 이전 행까지는 등록되었습니다.`
          ),
        };
      }
      expertId = insertedExpert.id;
      created += 1;

      // 계좌 정보 (암호화 저장 — 전문가 프로필과 동일 형식)
      const accountDigits = row.input.accountNumber.replace(/\D/g, "");
      if (row.input.bankName || row.input.accountHolder || accountDigits) {
        await admin.from("expert_bank_accounts").upsert(
          {
            expert_id: expertId,
            bank_name: row.input.bankName || null,
            account_holder: row.input.accountHolder || null,
            account_number_enc: accountDigits
              ? encryptSecret(row.input.accountNumber)
              : null,
            account_last4: accountDigits ? accountDigits.slice(-4) : null,
          },
          { onConflict: "expert_id" }
        );
      }

      // 강의분야 연결
      const junctions = row.expertiseFields
        .map((name) => fieldIdByName.get(name))
        .filter((id): id is string => Boolean(id))
        .map((fieldId) => ({ expert_id: expertId, field_id: fieldId }));
      if (junctions.length > 0) {
        await admin
          .from("expert_expertise_fields")
          .upsert(junctions, { ignoreDuplicates: true });
      }
    } else {
      // 기존 전문가 — 데이터는 건드리지 않고 관계만 추가한다.
      // 이용 중지 전문가에게는 신규 관계도 만들지 않는다 (관리모드 중지, 리뷰 4)
      const { data: existing, error: existingError } = await admin
        .from("experts")
        .select("id, is_active")
        .eq("phone", row.phoneE164)
        .maybeSingle();
      if (existingError?.code === "42703") {
        // 부재 폴백 (§14-10) — 컬럼 미적용 환경에서만 (리뷰 12)
        const { data: legacy } = await admin
          .from("experts")
          .select("id")
          .eq("phone", row.phoneE164)
          .maybeSingle();
        if (!legacy) continue;
        expertId = legacy.id;
        linked += 1;
      } else {
        if (!existing) continue;
        if (existing.is_active === false) continue;
        expertId = existing.id;
        linked += 1;
      }
    }

    // 관계기업 — 자사 링크 (revoked였던 링크는 되살린다)
    const { error: linkError } = await admin.from("expert_tenant_links").upsert(
      {
        expert_id: expertId,
        tenant_id: g.tenantId,
        status: "active",
        accepted_at: nowIso,
        revoked_at: null,
        relation_source: "bulk_registered",
      },
      { onConflict: "expert_id,tenant_id" }
    );
    if (linkError) {
      return {
        ok: false,
        error: describeDbError(
          linkError.message,
          `${row.input.name} 관계 등록 중 실패했습니다. 이전 행까지는 등록되었습니다.`
        ),
      };
    }
  }

  await admin.from("audit_logs").insert({
    tenant_id: g.tenantId,
    actor_auth_user_id: g.userId,
    action: "expert.bulk_register",
    resource_type: "expert",
    after_data: { created, linked, skipped: judged.length - actionable.length },
  });

  revalidatePath("/[tenantSlug]/experts", "page");
  return {
    ok: true,
    created,
    linked,
    skipped: judged.length - actionable.length,
  };
}
