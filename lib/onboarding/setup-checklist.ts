import "server-only";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { isAiConfigured } from "@/lib/ai/client";
import type { ModuleFlags } from "@/lib/modules/modules";

/**
 * 대표 최초 설정 점검 (CLAUDE.md §14-2 운영 설정화)
 *
 * 가입 직후에 반드시 잡아야 하는 설정을 한 화면에 모으고, 끝나지 않은 항목이
 * 남아 있으면 대시보드 상단에 계속 띄운다. "설정 어딘가에 있다"는 것과
 * "설정하도록 안내한다"는 다르다 — 안 하면 실제로 일이 막히는 항목들이다.
 *
 * 항목은 두 등급으로 나눈다.
 *  - required: 없으면 핵심 업무가 실제로 막히거나 법적 의무 미이행이다.
 *  - recommended: 없어도 돌아가지만 실무에서 곧 필요해진다.
 *
 * 모듈이 꺼진 테넌트에는 그 모듈의 항목을 만들지 않는다. 쓰지도 않을 설정을
 * 미완료로 띄우면 체크리스트 전체가 무시당한다.
 */

export type SetupItem = {
  key: string;
  title: string;
  /** 왜 필요한가 — 안 했을 때 무엇이 막히는지 구체적으로 */
  why: string;
  done: boolean;
  required: boolean;
  href: string;
  /** 대표만 할 수 있는 설정인가 (위임 대상이 아닌 항목) */
  ceoOnly?: boolean;
  /** 화면에서 처리하지 않는 항목(플랫폼 운영 영역 등)의 안내 문구 */
  note?: string;
};

export type SetupStatus = {
  items: SetupItem[];
  requiredRemaining: number;
  recommendedRemaining: number;
  /** 전부 끝났는가 (권장 포함) */
  allDone: boolean;
};

export async function getSetupStatus(
  tenantId: string,
  tenantSlug: string,
  modules: ModuleFlags
): Promise<SetupStatus> {
  const empty: SetupStatus = {
    items: [],
    requiredRemaining: 0,
    recommendedRemaining: 0,
    allDone: true,
  };
  if (!hasSupabaseEnv()) return empty;

  const supabase = createClient();
  const admin = createAdminClient();

  const [
    { data: tenant },
    { count: staffCount },
    { count: positionCount },
    { count: delegationCount },
    { count: smsCount },
    { count: ruleCount },
    { count: taxGranteeCount },
    { count: rrnKeyCount },
  ] = await Promise.all([
    supabase
      .from("tenants")
      .select("privacy_officer_name, business_registration_number")
      .maybeSingle(),
    supabase
      .from("users")
      .select("id", { count: "exact", head: true })
      .eq("is_active", true),
    supabase.from("positions").select("id", { count: "exact", head: true }),
    supabase
      .from("tenant_admin_grants")
      .select("id", { count: "exact", head: true })
      .is("revoked_at", null),
    // SMS 자격증명은 암호화 저장이라 세션 클라이언트로 읽지 않는다 — 존재만 센다.
    admin
      .from("tenant_sms_configs")
      .select("tenant_id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("is_active", true),
    modules.approvals
      ? supabase
          .from("approval_rules")
          .select("id", { count: "exact", head: true })
          .eq("is_active", true)
      : Promise.resolve({ count: 0 }),
    supabase
      .from("tax_access_grants")
      .select("id", { count: "exact", head: true })
      .is("revoked_at", null),
    admin
      .from("tenant_rrn_keys")
      .select("tenant_id", { count: "exact", head: true })
      .eq("tenant_id", tenantId),
  ]);

  const base = `/${tenantSlug}`;
  const items: SetupItem[] = [];

  // --- 1. 사용 기능 조합 (1~3영역) -------------------------------------------
  // 조합 자체는 계약 정보라 캐스트로그 관리모드가 확정한다. 대표가 여기서 하는 일은
  // '지금 무엇이 켜져 있는지 확인'과 '추가 요청'이다.
  const activeModules = [
    modules.experts ? "전문가 섭외" : null,
    modules.approvals ? "전자결재" : null,
    modules.operations ? "행사 운영" : null,
  ].filter(Boolean);
  items.push({
    key: "modules",
    title: `사용 기능 확인 (${activeModules.length > 0 ? activeModules.join(" · ") : "선택 안 됨"})`,
    why:
      "어떤 영역을 쓰는지에 따라 화면과 메뉴가 달라집니다. 지금 조합이 맞는지 확인하고, 필요하면 추가를 요청하세요. 나중에 추가해도 기존 데이터는 그대로 이어집니다.",
    done: activeModules.length > 0,
    required: true,
    href: `${base}/admin/org`,
  });

  // --- 2. 기업 정보 · 개인정보 보호책임자 -------------------------------------
  items.push({
    key: "privacy_officer",
    title: "개인정보 보호책임자 지정",
    why:
      "개인정보보호법 제31조가 정한 의무입니다. 임직원·전문가의 개인정보를 처리하는 주체는 캐스트로그가 아니라 우리 회사이므로, 회사가 직접 지정하고 공개해야 합니다.",
    done: Boolean(tenant?.privacy_officer_name),
    required: true,
    href: `${base}/admin/org`,
    ceoOnly: true,
  });
  items.push({
    key: "company_profile",
    title: "사업자 정보 등록",
    why: "사업자등록번호·대표자·주소는 계약과 세금계산서 발행에 필요합니다.",
    done: Boolean(tenant?.business_registration_number),
    required: false,
    href: `${base}/admin/org`,
  });

  // --- 3. 조직 ----------------------------------------------------------------
  items.push({
    key: "staff",
    title: "임직원 계정 등록",
    why:
      "대표 혼자서는 프로젝트 PM·부PM을 배정할 수 없습니다. ‘설정 > 임직원 설정’에서 직접 추가하거나, 가입 신청 링크를 공유해 신청받은 뒤 승인하세요.",
    done: (staffCount ?? 0) > 1,
    required: true,
    href: `${base}/admin/staff`,
  });
  items.push({
    key: "positions",
    title: "직급 등록",
    why:
      "권한단계(대표~사원)와 별개로, 회사가 실제로 쓰는 직급 표기를 등록해 두면 결재선·명부에 그대로 쓰입니다.",
    done: (positionCount ?? 0) > 0,
    required: false,
    href: `${base}/admin/staff`,
  });
  items.push({
    key: "delegation",
    title: "관리 권한 위임",
    why:
      "설정·직원관리·발송·감사·지급 권한을 임원에게 나눠 두지 않으면 모든 관리 업무가 대표 계정에 몰립니다. 세무(주민번호) 조회 지정과 위임 권한 자체는 위임할 수 없습니다.",
    done: (delegationCount ?? 0) > 0,
    required: false,
    href: `${base}/admin/staff`,
    ceoOnly: true,
  });

  // --- 4. 발송 ---------------------------------------------------------------
  items.push({
    key: "sms",
    title: "문자 발송 설정 (솔라피 등)",
    why:
      "섭외 요청·세션 안내 문자는 회사 명의 발신번호로 나갑니다. 공급자 API 키와 사전등록한 발신번호를 등록해야 발송이 됩니다. 등록 전에는 문자가 나가지 않습니다.",
    done: (smsCount ?? 0) > 0,
    required: true,
    href: `${base}/settings`,
  });

  // --- 5. 결재 (approvals 모듈) ----------------------------------------------
  if (modules.approvals) {
    items.push({
      key: "approval_rules",
      title: "전결규정 등록",
      why:
        "금액 구간·결재유형별 결재선을 정해 두지 않으면 품의를 올릴 때마다 결재자를 손으로 지정해야 합니다.",
      done: (ruleCount ?? 0) > 0,
      required: true,
      href: `${base}/approvals/rules`,
    });
  }

  // --- 6. 세무·주민번호 (experts 모듈) ----------------------------------------
  if (modules.experts) {
    items.push({
      key: "tax_grants",
      title: "주민등록번호 조회 지정자 지정",
      why:
        "지급명세서 작성 시 조회할 사람을 지정해야 합니다. 지정하지 않으면 아무도 조회할 수 없습니다. 최대 3명이며, 이 권한은 위임 대상이 아니라 대표만 지정할 수 있습니다.",
      done: (taxGranteeCount ?? 0) > 0,
      required: false,
      href: `${base}/admin/org`,
      ceoOnly: true,
    });
    items.push({
      key: "rrn_key",
      title: "주민등록번호 조회 비밀번호 설정",
      why:
        "조회 비밀번호에서 유도한 키로 자료를 감싸 둡니다. 이 비밀번호는 어디에도 저장되지 않으며, 설정하지 않으면 지급명세서를 만들 수 없습니다.",
      done: (rrnKeyCount ?? 0) > 0,
      required: false,
      href: `${base}/admin/org`,
      ceoOnly: true,
    });
  }

  // --- 7. AI --------------------------------------------------------------
  // 현재 설계에서 AI는 플랫폼(넥스트랩) 키로 제공된다. 기업이 자사 키를 넣는
  // 구조가 아니므로 '대표가 할 일'이 아니라 상태 확인 항목으로만 둔다.
  items.push({
    key: "ai",
    title: "AI 보조 기능",
    why:
      "보고서 문장 다듬기·제안서 검수를 돕습니다. AI는 설명과 문장화만 담당하며 결재 승인·지급 확정·권한 판정의 근거로 쓰이지 않습니다.",
    done: isAiConfigured(),
    required: false,
    href: `${base}/settings`,
    note: isAiConfigured()
      ? "캐스트로그가 제공하는 AI가 연결되어 있습니다. 회사에서 별도로 키를 등록할 필요가 없습니다."
      : "아직 연결되지 않았습니다. 회사가 등록하는 항목이 아니라 캐스트로그 운영 설정이므로, 필요하시면 지원으로 문의해 주세요.",
  });

  const requiredRemaining = items.filter((i) => i.required && !i.done).length;
  const recommendedRemaining = items.filter((i) => !i.required && !i.done).length;

  return {
    items,
    requiredRemaining,
    recommendedRemaining,
    allDone: requiredRemaining === 0 && recommendedRemaining === 0,
  };
}
