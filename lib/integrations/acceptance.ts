import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { EXPERT_DOCUMENT_BUCKET } from "@/lib/experts/documents";

/**
 * 단계 28-B: 섭외수락서 자동 생성 (대표 피드백 ②)
 *
 * 전문가 수락(계약 성립) 시점에 등록된 서명·날인을 스냅샷하여 수락서를 만든다.
 * - 서명 이미지는 암호화 버킷의 acceptances/ 경로로 복사(불변 스냅샷).
 * - 생성은 service_role 전용(공개 링크 수락은 세션이 없다).
 * - engagement_id unique 로 멱등 — 중복 호출은 무시된다.
 */

type AdminClient = ReturnType<typeof createAdminClient>;

function letterShortId(uuid: string): string {
  return uuid.replace(/-/g, "").slice(0, 8).toUpperCase();
}

/** 활성 서명/날인 원본을 수락서 전용 경로로 스냅샷 복사. 없으면 null. */
async function snapshotSignatureImage(
  admin: AdminClient,
  expertId: string,
  documentType: "signature" | "seal",
  destPath: string
): Promise<string | null> {
  const { data: doc } = await admin
    .from("expert_documents")
    .select("storage_path")
    .eq("expert_id", expertId)
    .eq("document_type", documentType)
    .eq("status", "active")
    .maybeSingle();
  if (!doc) return null;

  const { data: file, error: downloadError } = await admin.storage
    .from(EXPERT_DOCUMENT_BUCKET)
    .download(doc.storage_path);
  if (downloadError || !file) return null;

  const bytes = Buffer.from(await file.arrayBuffer());
  const { error: uploadError } = await admin.storage
    .from(EXPERT_DOCUMENT_BUCKET)
    .upload(destPath, bytes, { contentType: "image/png", upsert: true });
  if (uploadError) return null;

  return destPath;
}

/**
 * 섭외수락서 생성 (멱등). 수락 처리 훅에서 호출.
 * 실패해도 수락 자체는 유지되도록 호출부에서 예외를 삼킨다.
 */
export async function createEngagementAcceptance(
  engagementId: string,
  signedVia: "public_link" | "portal"
): Promise<void> {
  const admin = createAdminClient();

  // 멱등 — 이미 생성되었으면 종료
  const { data: existing } = await admin
    .from("engagement_acceptances")
    .select("id")
    .eq("engagement_id", engagementId)
    .maybeSingle();
  if (existing) return;

  const { data: eng } = await admin
    .from("expert_engagements")
    .select(
      "id, tenant_id, expert_id, project_id, role_description, fee_amount, starts_on, ends_on, status, program_name, role_type, session_name, position_code, starts_time, ends_time, location_name, location_address, event_summary, special_notes"
    )
    .eq("id", engagementId)
    .maybeSingle();
  if (!eng || eng.status !== "accepted") return;

  const [{ data: tenant }, { data: expert }, projectResult, { data: taxProfile }, { data: bank }] =
    await Promise.all([
      admin.from("tenants").select("name").eq("id", eng.tenant_id).maybeSingle(),
      admin.from("experts").select("name").eq("id", eng.expert_id).maybeSingle(),
      eng.project_id
        ? admin
            .from("projects")
            .select("name")
            .eq("id", eng.project_id)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      // 지급 정보 스냅샷 — 소득구분(원천징수 안내)
      admin
        .from("expert_tax_profiles")
        .select("payment_type")
        .eq("expert_id", eng.expert_id)
        .maybeSingle(),
      // 입금 계좌 — 은행·예금주·뒷4자리만. 전체 계좌번호·주민번호는 스냅샷하지 않는다(§5).
      admin
        .from("expert_bank_accounts")
        .select("bank_name, account_holder, account_last4")
        .eq("expert_id", eng.expert_id)
        .maybeSingle(),
    ]);

  const base = `acceptances/${eng.tenant_id}/${eng.id}`;
  const signaturePath = await snapshotSignatureImage(
    admin,
    eng.expert_id,
    "signature",
    `${base}-signature.png`
  );
  const sealPath = await snapshotSignatureImage(
    admin,
    eng.expert_id,
    "seal",
    `${base}-seal.png`
  );

  const letterNo = `ACC-${new Date()
    .toISOString()
    .slice(0, 10)
    .replace(/-/g, "")}-${letterShortId(eng.id)}`;

  await admin.from("engagement_acceptances").insert({
    tenant_id: eng.tenant_id,
    engagement_id: eng.id,
    expert_id: eng.expert_id,
    letter_no: letterNo,
    role_description: eng.role_description,
    fee_amount: eng.fee_amount,
    starts_on: eng.starts_on,
    ends_on: eng.ends_on,
    project_name: projectResult.data?.name ?? null,
    tenant_name: tenant?.name ?? "",
    expert_name: expert?.name ?? "",
    // 행사 상세 스냅샷 (Phase A-2 — 수락서 양식)
    program_name: eng.program_name,
    role_type: eng.role_type,
    // 어느 세션·어느 넘버링코드 건인지 식별 (수락서 자동 구성의 핵심 키)
    session_name: eng.session_name,
    position_code: eng.position_code,
    starts_time: eng.starts_time,
    ends_time: eng.ends_time,
    location_name: eng.location_name,
    location_address: eng.location_address,
    event_summary: eng.event_summary,
    special_notes: eng.special_notes,
    // 지급 정보 스냅샷 (Phase C-2) — 주민번호·전체 계좌번호는 포함하지 않는다
    payment_type: taxProfile?.payment_type ?? null,
    bank_name: bank?.bank_name ?? null,
    account_holder: bank?.account_holder ?? null,
    account_last4: bank?.account_last4 ?? null,
    signature_path: signaturePath,
    seal_path: sealPath,
    has_signature: signaturePath !== null,
    signed_via: signedVia,
  });

  await admin.from("audit_logs").insert({
    tenant_id: eng.tenant_id,
    actor_auth_user_id: null,
    actor_role: "expert",
    action: "engagement_acceptance.create",
    resource_type: "engagement_acceptance",
    resource_id: eng.id,
    after_data: { letter_no: letterNo, has_signature: signaturePath !== null },
  });
}

/**
 * 연습모드 가상 수락서 보장 (멱등).
 *
 * 연습 데이터의 섭외 건은 '확정' 상태로 심어지지만 수락서 행은 없었다. 그래서
 * 연습모드에서 '수락서 보기'를 누르면 화면이 없다고 나왔다. 연습은 실제 흐름을
 * 그대로 밟아 보는 자리이므로, 확정 건에는 수락서가 있어야 한다.
 *
 * **연습 건에만 적용한다.** 실데이터에서 수락서가 없는 확정 건에 문서를 만들어
 * 주면, 전문가가 서명한 적 없는 문서를 시스템이 지어내는 셈이 된다.
 *
 * @returns 수락서가 존재하게 되었으면 true
 */
export async function ensurePracticeAcceptance(
  engagementId: string
): Promise<boolean> {
  const admin = createAdminClient();

  const { data: eng } = await admin
    .from("expert_engagements")
    .select("id, status, is_practice")
    .eq("id", engagementId)
    .maybeSingle();
  if (!eng || !eng.is_practice || eng.status !== "accepted") return false;

  await createEngagementAcceptance(engagementId, "portal");

  // 연습에서는 송부·확인까지 끝난 모습을 보여 준다 — 실제 확정 건과 같은 화면을
  // 봐야 연습이 의미가 있다.
  const { data: created } = await admin
    .from("engagement_acceptances")
    .select("id, status")
    .eq("engagement_id", engagementId)
    .maybeSingle();
  if (!created) return false;

  if (created.status === "issued") {
    const now = new Date().toISOString();
    await admin
      .from("engagement_acceptances")
      .update({
        status: "confirmed",
        sent_at: now,
        signed_at: now,
        confirmed_at: now,
        guide_note:
          "(연습) 이 수락서는 연습모드에서 자동 생성된 가상 문서입니다. 실제 전문가의 서명·확인이 아닙니다.",
      })
      .eq("id", created.id);
  }

  return true;
}
