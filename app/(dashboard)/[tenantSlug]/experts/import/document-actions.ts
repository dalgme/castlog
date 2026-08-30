"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { roleFromUser, tenantIdFromUser } from "@/lib/auth/tenant";
import { deniedExec } from "@/lib/monitoring/action-denials";
import { canExecTenant } from "@/lib/auth/exec-policy";
import { getTenantModules } from "@/lib/modules/server";
import { isPracticeMode } from "@/lib/practice/server";
import {
  EXPERT_DOCUMENT_BUCKET,
  validateDocumentFile,
} from "@/lib/experts/documents";
import {
  classifyDocFileName,
  extractPhoneTail,
  isBulkDocType,
  nameMatches,
  type BulkDocType,
} from "@/lib/experts/document-import";

/**
 * 파일 일괄 등록 (기획 확정 2026-08-23) — 기업 보유 전문가 서류를
 * 파일명 자동 매칭 → 미리보기 보정 → 확정 업로드로 전문가 서류함에 넣는다.
 *
 * expert_documents는 전문가 소유 전역 테이블이라 기업 세션 RLS 쓰기 경로가
 * 없다 — 보유자료 등록과 동일하게 service_role + 앱 게이트(bulkImport)로만
 * 수행한다. 올린 기업은 출처(uploaded_by_tenant_id) 기준으로 자동 열람,
 * 타 기업에는 기존처럼 전문가의 열람 허용이 필요하다.
 */

type Gate =
  | { ok: true; tenantId: string; userId: string; role: string }
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
  // 실제 전역 서류가 생기는 작업 — 연습모드에서는 막는다
  if (await isPracticeMode()) {
    return {
      ok: false,
      error: "연습모드에서는 파일 일괄 등록을 사용할 수 없습니다. 연습모드를 종료한 뒤 진행하세요.",
    };
  }
  return { ok: true, tenantId, userId: user.id, role };
}

export type DocImportCandidate = { id: string; name: string; phoneTail: string };

export type DocImportRow = {
  fileName: string;
  /** 자동 매칭된 전문가 (없으면 null — 화면에서 직접 선택) */
  expertId: string | null;
  expertName: string | null;
  /** 동명 등으로 후보가 여럿일 때 선택지 */
  candidates: DocImportCandidate[];
  docType: BulkDocType;
  /** 확정 전 알림 — 이미 등록된 서류 등 */
  warning: string | null;
};

export type DocImportAnalysis =
  | { ok: true; rows: DocImportRow[]; experts: DocImportCandidate[] }
  | { ok: false; error: string };

/** 1단계 — 파일명 목록을 받아 매칭 미리보기를 만든다 (파일 본문은 아직 안 받는다) */
export async function analyzeDocumentImport(
  fileNames: string[]
): Promise<DocImportAnalysis> {
  const auth = await gate();
  if (!auth.ok) return auth;
  if (fileNames.length === 0) {
    return { ok: false, error: "파일을 선택하세요." };
  }
  if (fileNames.length > 200) {
    return { ok: false, error: "한 번에 200개까지 올릴 수 있습니다." };
  }

  // 대상 = 자사 관계 전문가 (RLS로 자사분 링크 → admin으로 프로필 확보)
  const supabase = createClient();
  const { data: links } = await supabase
    .from("expert_tenant_links")
    .select("expert_id, status")
    .in("status", ["active", "pending"]);
  const expertIds = Array.from(
    new Set((links ?? []).map((l) => l.expert_id))
  );
  if (expertIds.length === 0) {
    return {
      ok: false,
      error: "자사 관계 전문가가 없습니다. 먼저 보유자료 등록 또는 등록 요청으로 전문가를 연결하세요.",
    };
  }

  const admin = createAdminClient();
  const [{ data: experts }, { data: docs }] = await Promise.all([
    admin
      .from("experts")
      .select("id, name, phone")
      .in("id", expertIds)
      .eq("is_practice", false),
    // 세션 클라이언트(RLS) — 자사가 볼 권리가 있는 서류만 경고 판단에 쓴다.
    // 허용받지 못한 서류의 존재는 여기서 노출하지 않는다 (현황 표와 같은 원칙).
    // 못 본 기존 서류는 업로드 시점의 서버 거부가 단건으로만 알린다.
    supabase
      .from("expert_documents")
      .select("expert_id, document_type, uploaded_by_tenant_id")
      .in("expert_id", expertIds)
      .eq("status", "active"),
  ]);

  const roster: DocImportCandidate[] = (experts ?? []).map((e) => ({
    id: e.id,
    name: e.name,
    phoneTail: e.phone.replace(/\D/g, "").slice(-4),
  }));
  const byTail = new Map<string, DocImportCandidate[]>();
  for (const e of roster) {
    byTail.set(e.phoneTail, [...(byTail.get(e.phoneTail) ?? []), e]);
  }
  const docKey = (expertId: string, type: string) => `${expertId}:${type}`;
  const existing = new Map<string, string | null>();
  for (const d of docs ?? []) {
    existing.set(docKey(d.expert_id, d.document_type), d.uploaded_by_tenant_id);
  }

  const rows: DocImportRow[] = fileNames.map((fileName) => {
    const docType = classifyDocFileName(fileName);
    const tail = extractPhoneTail(fileName);

    let matched: DocImportCandidate | null = null;
    let candidates: DocImportCandidate[] = [];
    if (tail && byTail.has(tail)) {
      const hits = byTail.get(tail)!;
      if (hits.length === 1) matched = hits[0]!;
      else candidates = hits;
    }
    if (!matched && candidates.length === 0) {
      const nameHits = roster.filter((e) => nameMatches(fileName, e.name));
      if (nameHits.length === 1) matched = nameHits[0]!;
      else if (nameHits.length > 1) candidates = nameHits;
    }

    let warning: string | null = null;
    if (matched) {
      const owner = existing.has(docKey(matched.id, docType))
        ? existing.get(docKey(matched.id, docType))
        : undefined;
      if (owner === null) {
        warning = "이미 전문가가 등록한 서류가 있습니다 — 업로드가 취소됩니다.";
      } else if (owner === auth.tenantId) {
        warning = "자사가 올린 기존 파일을 교체합니다.";
      }
    }

    return {
      fileName,
      expertId: matched?.id ?? null,
      expertName: matched?.name ?? null,
      candidates,
      docType,
      warning,
    };
  });

  return { ok: true, rows, experts: roster };
}

export type DocUploadResult =
  | { ok: true; replaced: boolean }
  | { ok: false; error: string };

/** 2단계 — 확정된 한 건 업로드 (클라이언트가 파일별로 순차 호출) */
export async function uploadBulkExpertDocument(
  formData: FormData
): Promise<DocUploadResult> {
  const auth = await gate();
  if (!auth.ok) return auth;

  const expertId = String(formData.get("expertId") ?? "");
  const docType = String(formData.get("docType") ?? "");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(expertId)) {
    return { ok: false, error: "요청 값을 확인하세요." };
  }
  const fileName = String(formData.get("fileName") ?? "");
  const file = formData.get("file");
  if (!expertId || !isBulkDocType(docType) || !(file instanceof File)) {
    return { ok: false, error: "요청 값을 확인하세요." };
  }

  // 자사 관계 전문가만 (RLS 확인)
  const supabase = createClient();
  const { data: link } = await supabase
    .from("expert_tenant_links")
    .select("id, status")
    .eq("expert_id", expertId)
    .in("status", ["active", "pending"])
    .limit(1)
    .maybeSingle();
  if (!link) {
    return { ok: false, error: "자사 관계 전문가가 아닙니다." };
  }

  const valid = validateDocumentFile(
    file.type,
    fileName || file.name,
    file.size
  );
  if (!valid.ok) return { ok: false, error: valid.error };

  const admin = createAdminClient();
  // 같은 유형의 기존 서류 — 본인/타사 등록분이면 취소, 자사분이면 교체
  const { data: prior } = await admin
    .from("expert_documents")
    .select("id, storage_path, uploaded_by_tenant_id")
    .eq("expert_id", expertId)
    .eq("document_type", docType)
    .eq("status", "active");
  for (const p of prior ?? []) {
    if (p.uploaded_by_tenant_id === null) {
      return {
        ok: false,
        error: "권한없음(이미 전문가가 등록) — 전문가 본인이 올린 서류는 덮을 수 없습니다.",
      };
    }
    if (p.uploaded_by_tenant_id !== auth.tenantId) {
      return {
        ok: false,
        error: "다른 기업이 등록한 서류가 있어 업로드할 수 없습니다.",
      };
    }
  }

  const path = `${expertId}/${docType}/${crypto.randomUUID()}.${valid.extension}`;
  const bytes = new Uint8Array(await file.arrayBuffer());
  const { error: storageError } = await admin.storage
    .from(EXPERT_DOCUMENT_BUCKET)
    .upload(path, bytes, { contentType: valid.contentType });
  if (storageError) {
    return { ok: false, error: "파일 저장에 실패했습니다. 잠시 후 다시 시도하세요." };
  }

  const { data: inserted, error: insertError } = await admin
    .from("expert_documents")
    .insert({
      expert_id: expertId,
      document_type: docType,
      storage_path: path,
      file_name: fileName || file.name,
      file_size_bytes: file.size,
      mime_type: valid.contentType,
      uploaded_by_tenant_id: auth.tenantId,
    })
    .select("id")
    .single();
  if (insertError || !inserted) {
    await admin.storage.from(EXPERT_DOCUMENT_BUCKET).remove([path]);
    return { ok: false, error: "서류 등록에 실패했습니다." };
  }

  // 자사가 올린 기존 파일은 교체 처리 (전문가 본인분은 위에서 걸렀다)
  let replaced = false;
  for (const p of prior ?? []) {
    const { error: replaceError } = await admin
      .from("expert_documents")
      .update({ status: "replaced" })
      .eq("id", p.id);
    if (replaceError) {
      // 새 파일은 이미 등록됨 — 이중 활성 상태를 숨기지 않고 알린다
      return {
        ok: false,
        error: "새 파일은 등록됐지만 기존 파일 교체 처리에 실패했습니다. 다시 시도하거나 캐스트로그에 알려 주세요.",
      };
    }
    replaced = true;
  }

  await admin.from("expert_document_history").insert({
    document_id: inserted.id,
    expert_id: expertId,
    action: replaced ? "replaced" : "created",
    actor_auth_user_id: auth.userId,
  });
  await admin.from("audit_logs").insert({
    tenant_id: auth.tenantId,
    actor_auth_user_id: auth.userId,
    actor_role: auth.role,
    action: "expert_document.bulk_upload",
    resource_type: "expert_document",
    resource_id: inserted.id,
    after_data: { expert_id: expertId, document_type: docType, replaced },
  });

  revalidatePath("/[tenantSlug]/experts/import", "page");
  return { ok: true, replaced };
}

export type DocStatusRow = {
  expertId: string;
  name: string;
  organization: string | null;
  jobTitle: string | null;
  phone: string;
  email: string | null;
  hasResume: boolean;
  hasIdCard: boolean;
  hasBank: boolean;
  hasCombined: boolean;
};

/**
 * 누적 현황 — 자사 관계 전문가별 서류 보유 표.
 * 유무 판정은 **자사가 볼 권리가 있는 서류만**(세션 RLS: 자사 제공분 + 전문가가
 * 열람 허용한 유형) 기준이다 — 허용받지 못한 서류의 존재는 노출하지 않는다.
 */
export async function getDocumentImportStatus(): Promise<
  { ok: true; rows: DocStatusRow[] } | { ok: false; error: string }
> {
  const auth = await gate();
  if (!auth.ok) return auth;

  const supabase = createClient();
  const { data: links } = await supabase
    .from("expert_tenant_links")
    .select("expert_id, status")
    .in("status", ["active", "pending"]);
  const expertIds = Array.from(new Set((links ?? []).map((l) => l.expert_id)));
  if (expertIds.length === 0) return { ok: true, rows: [] };

  const admin = createAdminClient();
  const [{ data: experts }, { data: docs }] = await Promise.all([
    admin
      .from("experts")
      .select("id, name, phone, email, organization, job_title")
      .in("id", expertIds)
      .eq("is_practice", false)
      .order("name", { ascending: true }),
    // 세션 클라이언트 — RLS가 '자사가 볼 수 있는 서류'만 돌려준다
    supabase
      .from("expert_documents")
      .select("expert_id, document_type")
      .in("expert_id", expertIds)
      .eq("status", "active"),
  ]);

  const typesByExpert = new Map<string, Set<string>>();
  for (const d of docs ?? []) {
    const set = typesByExpert.get(d.expert_id) ?? new Set<string>();
    set.add(d.document_type);
    typesByExpert.set(d.expert_id, set);
  }

  return {
    ok: true,
    rows: (experts ?? []).map((e) => {
      const set = typesByExpert.get(e.id) ?? new Set<string>();
      return {
        expertId: e.id,
        name: e.name,
        organization: e.organization,
        jobTitle: e.job_title,
        phone: e.phone,
        email: e.email,
        hasResume: set.has("resume"),
        hasIdCard: set.has("id_card_copy"),
        hasBank: set.has("bank_account_copy"),
        hasCombined: set.has("combined"),
      };
    }),
  };
}
