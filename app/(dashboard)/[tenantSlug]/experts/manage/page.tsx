import Link from "next/link";

import { requireRole, getSessionUser } from "@/lib/auth/session";
import { requireModule } from "@/lib/modules/server";
import { createClient } from "@/lib/supabase/server";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { canExecTenant } from "@/lib/auth/exec-policy";
import { PageHeader } from "@/components/layout/header";
import { EmptyState } from "@/components/layout/empty-state";
import { Button } from "@/components/ui/button";

import {
  ManageClient,
  type ManagedExpertRow,
  type RecruitFieldOption,
} from "./manage-client";

export const metadata = { title: "전문가 관리" };

/**
 * 전문가 관리 탭 (기획 확정 2026-08-22)
 *
 * '관계기업'에 우리 회사가 있는 전문가(= 자사 expert_tenant_links 보유)를
 * 일괄 불러와 평점·메모·섭외분야를 관리한다. 타사 관계는 보이지 않는다(§4).
 * 백오피스 화면 — PC 최적화 (CLAUDE.md 10).
 */
export default async function ExpertManagePage({
  params,
}: {
  params: { tenantSlug: string };
}) {
  await requireRole(["platform_admin", "org_admin", "manager", "staff"]);
  await requireModule("experts");

  const user = await getSessionUser();
  // 평점·메모·섭외분야 수정은 레벨 4(대리)부터 — 서버 게이트(expertRecord)와 같은 기준
  const canEdit = await canExecTenant("expertRecord", user);

  const headerActions = (
    <Button asChild variant="outline" size="sm">
      <Link href={`/${params.tenantSlug}/experts`}>← 전문가 목록</Link>
    </Button>
  );

  if (!hasSupabaseEnv()) {
    return (
      <div>
        <PageHeader title="전문가 관리" actions={headerActions} />
        <main className="p-5">
          <EmptyState
            title="서버 설정 대기 중"
            description="Supabase 환경변수가 설정되면 표시됩니다."
          />
        </main>
      </div>
    );
  }

  const supabase = createClient();

  // 관계기업 = 자사 링크 (RLS가 자사분만 준다). 해제(revoked)는 제외.
  const { data: links } = await supabase
    .from("expert_tenant_links")
    .select(
      "expert_id, status, relation_source, engaged_at, experts (id, name, phone)"
    )
    .in("status", ["active", "pending"]);

  const expertIds = (links ?? [])
    .map((l) => l.experts?.id)
    .filter((id): id is string => Boolean(id));

  const [
    { data: profiles },
    { data: recruitFieldRecords },
    { data: assignments },
    { data: expertiseLinks },
    { data: expertiseFields },
  ] = await Promise.all([
    expertIds.length
      ? supabase
          .from("expert_tenant_profiles")
          .select("expert_id, rating, memo")
          .in("expert_id", expertIds)
      : Promise.resolve({ data: [] as { expert_id: string; rating: number | null; memo: string | null }[] }),
    supabase
      .from("tenant_recruit_fields")
      .select("id, name")
      .eq("is_active", true)
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true }),
    expertIds.length
      ? supabase
          .from("expert_tenant_recruit_fields")
          .select("expert_id, field_id")
          .in("expert_id", expertIds)
      : Promise.resolve({ data: [] as { expert_id: string; field_id: string }[] }),
    expertIds.length
      ? supabase
          .from("expert_expertise_fields")
          .select("expert_id, field_id")
          .in("expert_id", expertIds)
      : Promise.resolve({ data: [] as { expert_id: string; field_id: string }[] }),
    supabase.from("expertise_fields").select("id, name"),
  ]);

  const profileByExpert = new Map(
    (profiles ?? []).map((p) => [p.expert_id, p])
  );
  const recruitByExpert = new Map<string, string[]>();
  for (const a of assignments ?? []) {
    const list = recruitByExpert.get(a.expert_id) ?? [];
    list.push(a.field_id);
    recruitByExpert.set(a.expert_id, list);
  }
  const expertiseNameById = new Map(
    (expertiseFields ?? []).map((f) => [f.id, f.name])
  );
  const expertiseByExpert = new Map<string, string[]>();
  for (const l of expertiseLinks ?? []) {
    const name = expertiseNameById.get(l.field_id);
    if (!name) continue;
    const list = expertiseByExpert.get(l.expert_id) ?? [];
    list.push(name);
    expertiseByExpert.set(l.expert_id, list);
  }

  const rows: ManagedExpertRow[] = (links ?? [])
    .filter((l) => l.experts)
    .map((l) => ({
      expertId: l.experts!.id,
      name: l.experts!.name,
      phone: l.experts!.phone,
      relationSource: l.relation_source ?? "self_join",
      engagedAt: l.engaged_at ?? null,
      expertiseFields: expertiseByExpert.get(l.experts!.id) ?? [],
      rating: profileByExpert.get(l.experts!.id)?.rating ?? null,
      memo: profileByExpert.get(l.experts!.id)?.memo ?? null,
      recruitFieldIds: recruitByExpert.get(l.experts!.id) ?? [],
    }))
    .sort((a, b) => a.name.localeCompare(b.name, "ko"));

  const recruitFields: RecruitFieldOption[] = (recruitFieldRecords ?? []).map(
    (f) => ({ id: f.id, name: f.name })
  );

  return (
    <div>
      <PageHeader title="전문가 관리" actions={headerActions} />
      <main className="mx-auto max-w-6xl space-y-4 p-5">
        {rows.length === 0 ? (
          <EmptyState
            title="관계 전문가가 없습니다"
            description="전문가가 등록 링크로 가입하거나, 일괄 등록(보유자료)으로 등록하면 여기에 나타납니다."
          />
        ) : (
          <ManageClient
            tenantSlug={params.tenantSlug}
            rows={rows}
            recruitFields={recruitFields}
            canEdit={canEdit}
          />
        )}
      </main>
    </div>
  );
}
