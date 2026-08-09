/**
 * 로그인 가능한 데모 기업관리자(org_admin) 계정 생성 스크립트 (1회용)
 *
 * CASTLOG는 셀프 회원가입이 없다 — 계정은 관리자/플랫폼이 발급한다(설계 정책).
 * 이 스크립트는 배포한 Supabase(서울)에 직접 실행해, 데모 테넌트 + 로그인
 * 가능한 org_admin 계정(비밀번호 포함)을 만든다.
 *
 * 보안: service_role 키는 전체 권한이다. 절대 커밋/공유하지 말 것.
 *       이 스크립트는 로컬에서 환경변수로 키를 주입해 1회 실행하고 끝낸다.
 *
 * 실행 예:
 *   SUPABASE_URL="https://<프로젝트ref>.supabase.co" \
 *   SUPABASE_SERVICE_ROLE_KEY="<service_role 키>" \
 *   DEMO_ADMIN_EMAIL="jinkidi@hanmail.net" \
 *   DEMO_ADMIN_PASSWORD="<원하는 비밀번호>" \
 *   node scripts/create-demo-admin.mjs
 *
 * 선택 환경변수:
 *   DEMO_TENANT_SLUG  (기본 "demo")   — 영문 소문자 kebab-case
 *   DEMO_TENANT_NAME  (기본 "데모 컨설팅")
 *   DEMO_ADMIN_NAME   (기본 "데모 관리자")
 */

import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";

const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const email = (process.env.DEMO_ADMIN_EMAIL ?? "jinkidi@hanmail.net").trim().toLowerCase();
const password = process.env.DEMO_ADMIN_PASSWORD;
const tenantSlug = (process.env.DEMO_TENANT_SLUG ?? "demo").trim().toLowerCase();
const tenantName = process.env.DEMO_TENANT_NAME ?? "데모 컨설팅";
const adminName = process.env.DEMO_ADMIN_NAME ?? "데모 관리자";

function fail(msg) {
  console.error(`\n❌ ${msg}\n`);
  process.exit(1);
}

if (!url) fail("SUPABASE_URL(또는 NEXT_PUBLIC_SUPABASE_URL)이 필요합니다.");
if (!serviceKey) fail("SUPABASE_SERVICE_ROLE_KEY가 필요합니다. (Supabase 대시보드 → Project Settings → API → service_role)");
if (!password) fail("DEMO_ADMIN_PASSWORD가 필요합니다. (예: 12자 이상 권장)");
if (password.length < 8) fail("비밀번호는 8자 이상을 권장합니다. (Supabase 정책에 따라 더 길어야 할 수 있음)");
if (!/^[a-z0-9](?:[a-z0-9]|-(?=[a-z0-9])){1,39}$/.test(tenantSlug)) {
  fail(`DEMO_TENANT_SLUG "${tenantSlug}" 형식 오류 — 영문 소문자/숫자 kebab-case만.`);
}

const supabase = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function findAuthUserByEmail(targetEmail) {
  // supabase-js admin에는 email 단건 조회가 없어 페이지네이션으로 탐색
  for (let page = 1; page <= 50; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const hit = data.users.find((u) => (u.email ?? "").toLowerCase() === targetEmail);
    if (hit) return hit;
    if (data.users.length < 200) return null; // 마지막 페이지
  }
  return null;
}

async function main() {
  console.log(`\n▶ 대상 Supabase: ${url}`);
  console.log(`▶ 데모 테넌트: ${tenantName} (slug: ${tenantSlug})`);
  console.log(`▶ 관리자 계정: ${email}\n`);

  // 1) 데모 테넌트 확보 (없으면 생성). feature_flags {} = 전 모듈 활성(CLAUDE.md 1-2)
  let tenantId;
  {
    const { data: existing, error } = await supabase
      .from("tenants")
      .select("id")
      .eq("slug", tenantSlug)
      .maybeSingle();
    if (error) fail(`테넌트 조회 실패: ${error.message}`);

    if (existing) {
      tenantId = existing.id;
      console.log(`• 기존 테넌트 사용: ${tenantId}`);
    } else {
      tenantId = randomUUID();
      const { error: insErr } = await supabase.from("tenants").insert({
        id: tenantId,
        slug: tenantSlug,
        name: tenantName,
        status: "active",
        plan_name: "demo",
        feature_flags: {},
      });
      if (insErr) fail(`테넌트 생성 실패: ${insErr.message}`);
      console.log(`• 테넌트 생성: ${tenantId}`);
    }
  }

  // 2) auth 계정 생성/갱신 — tenant_id·role은 app_metadata에만(CLAUDE.md 3·Hard NO 1)
  const appMetadata = {
    role: "org_admin",
    tenant_id: tenantId,
    tenant_slug: tenantSlug,
    provider: "email",
    providers: ["email"],
  };

  let authUserId;
  {
    const { data: created, error } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true, // 데모 — 이메일 인증 없이 즉시 로그인 가능
      app_metadata: appMetadata,
    });

    if (error) {
      // 이미 존재하면 비밀번호·app_metadata 갱신
      const existing = await findAuthUserByEmail(email);
      if (!existing) fail(`계정 생성 실패(그리고 기존 계정도 못 찾음): ${error.message}`);
      const { data: updated, error: updErr } = await supabase.auth.admin.updateUserById(
        existing.id,
        { password, email_confirm: true, app_metadata: appMetadata },
      );
      if (updErr) fail(`기존 계정 갱신 실패: ${updErr.message}`);
      authUserId = updated.user.id;
      console.log(`• 기존 auth 계정 갱신(비밀번호·권한): ${authUserId}`);
    } else {
      authUserId = created.user.id;
      console.log(`• auth 계정 생성: ${authUserId}`);
    }
  }

  // 3) public.users 프로필 행 upsert (id = auth.users.id)
  {
    const { error } = await supabase.from("users").upsert(
      {
        id: authUserId,
        tenant_id: tenantId,
        name: adminName,
        email,
        role: "org_admin",
        is_active: true,
      },
      { onConflict: "id" },
    );
    if (error) fail(`users 프로필 생성 실패: ${error.message}`);
    console.log(`• users 프로필 upsert 완료`);
  }

  console.log("\n✅ 완료! 아래 정보로 로그인하세요:");
  console.log("────────────────────────────────────────");
  console.log(`  로그인 화면: 배포 주소의 /login → "기업회원" 탭`);
  console.log(`  이메일     : ${email}`);
  console.log(`  비밀번호   : (방금 지정한 DEMO_ADMIN_PASSWORD)`);
  console.log(`  로그인 후  : /${tenantSlug}/dashboard 로 이동`);
  console.log("────────────────────────────────────────\n");
}

main().catch((e) => fail(e?.message ?? String(e)));
