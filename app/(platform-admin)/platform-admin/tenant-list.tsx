import { Building2, Mail, Phone, User } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  MODULE_KEYS,
  MODULE_LABELS,
  MODULE_NUMBERS,
  type ModuleFlags,
} from "@/lib/modules/modules";

import { TenantModulesDialog } from "./modules-dialog";
import { TenantStatusButton } from "./tenant-status-button";

export type TenantAdminRow = {
  id: string;
  name: string;
  slug: string;
  status: string;
  planName: string | null;
  modules: ModuleFlags;
  createdAt: string;
  /** 가입 시 받은 기업 정보 */
  representativeName: string | null;
  businessRegistrationNumber: string | null;
  contactPhone: string | null;
  industry: string | null;
  address: string | null;
  termsAgreedAt: string | null;
  /** 이 회사의 대표(org_admin) 계정 — 지원 연락처의 출발점 */
  ceoName: string | null;
  ceoEmail: string | null;
  ceoPhone: string | null;
  ceoActive: boolean | null;
};

const STATUS_LABEL: Record<string, string> = {
  active: "활성",
  suspended: "중지",
  terminated: "해지",
};

function Field({
  label,
  value,
  mono,
}: {
  label: string;
  value: string | null;
  mono?: boolean;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] text-muted-foreground">{label}</dt>
      <dd
        className={
          mono
            ? "truncate font-mono text-xs"
            : value
              ? "truncate text-sm"
              : "truncate text-sm text-muted-foreground"
        }
        title={value ?? undefined}
      >
        {value || "미입력"}
      </dd>
    </div>
  );
}

/**
 * 가입 기업 목록 (관리모드).
 *
 * 표로 두면 가입 정보(대표자·사업자번호·연락처·업종·주소)가 다 들어가지 않아
 * 가로 스크롤이 생기고, 그러면 정작 봐야 할 CEO 연락처가 화면 밖으로 밀린다.
 * 회사 하나를 카드 하나로 두고 그 안에서 정렬한다 — 지원 문의가 들어왔을 때
 * '이 회사가 누구고 누구에게 연락하나'를 한 카드에서 끝낼 수 있어야 한다.
 *
 * 모듈은 **번호**로 먼저 보여 준다. 이름표는 길어서 조합 비교가 안 된다.
 */
export function TenantList({ rows }: { rows: TenantAdminRow[] }) {
  return (
    <div className="space-y-3">
      {rows.map((tenant) => {
        const enabled = MODULE_KEYS.filter((key) => tenant.modules[key]);
        return (
          <Card
            key={tenant.id}
            className={tenant.status !== "active" ? "border-destructive/40" : undefined}
          >
            <CardContent className="space-y-3 pt-5">
              {/* 머리 — 회사 식별 + 상태 */}
              <div className="flex flex-wrap items-center gap-2">
                <Building2 className="h-4 w-4 shrink-0 text-brand" aria-hidden />
                <span className="text-sm font-bold text-brand-navy">
                  {tenant.name}
                </span>
                <code className="rounded bg-secondary px-1.5 py-0.5 text-[11px]">
                  {tenant.slug}
                </code>
                <Badge
                  variant={tenant.status === "active" ? "default" : "destructive"}
                >
                  {STATUS_LABEL[tenant.status] ?? tenant.status}
                </Badge>
                {tenant.planName && (
                  <span className="text-xs text-muted-foreground">
                    {tenant.planName}
                  </span>
                )}
                <span className="ml-auto text-xs text-muted-foreground">
                  가입 {new Date(tenant.createdAt).toLocaleDateString("ko-KR")}
                </span>
              </div>

              {/* 대표 계정 — 지원 연락의 출발점이라 가장 위에 둔다 */}
              <div className="rounded-lg border bg-secondary/30 p-2.5">
                <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                  <span className="inline-flex items-center gap-1.5 font-semibold">
                    <User className="h-3.5 w-3.5 text-brand" aria-hidden />
                    {tenant.ceoName ?? "대표 계정 없음"}
                  </span>
                  {tenant.ceoEmail && (
                    <a
                      href={`mailto:${tenant.ceoEmail}`}
                      className="inline-flex items-center gap-1.5 text-brand underline-offset-2 hover:underline"
                    >
                      <Mail className="h-3.5 w-3.5" aria-hidden />
                      {tenant.ceoEmail}
                    </a>
                  )}
                  {tenant.ceoPhone && (
                    <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                      <Phone className="h-3.5 w-3.5" aria-hidden />
                      {tenant.ceoPhone}
                    </span>
                  )}
                  {tenant.ceoActive === false && (
                    <Badge variant="destructive" className="text-[10px]">
                      계정 비활성
                    </Badge>
                  )}
                </p>
              </div>

              {/* 가입 시 받은 기업 정보 */}
              <dl className="grid gap-x-4 gap-y-2 sm:grid-cols-3">
                <Field label="대표자명" value={tenant.representativeName} />
                <Field
                  label="사업자등록번호"
                  value={tenant.businessRegistrationNumber}
                  mono
                />
                <Field label="대표 연락처" value={tenant.contactPhone} />
                <Field label="업종" value={tenant.industry} />
                <Field
                  label="약관 동의"
                  value={
                    tenant.termsAgreedAt
                      ? new Date(tenant.termsAgreedAt).toLocaleDateString("ko-KR")
                      : null
                  }
                />
                <Field label="주소" value={tenant.address} />
              </dl>

              {/* 모듈 번호 + 조작 버튼 */}
              <div className="flex flex-wrap items-center gap-2 border-t pt-3">
                <span className="text-[11px] text-muted-foreground">허가 모듈</span>
                {enabled.length === 0 ? (
                  <span className="text-xs text-muted-foreground">
                    공통 기반만
                  </span>
                ) : (
                  <span className="flex flex-wrap items-center gap-1">
                    {enabled.map((key) => (
                      <span
                        key={key}
                        title={MODULE_LABELS[key]}
                        className="inline-flex h-6 min-w-6 items-center justify-center rounded-md bg-brand px-1.5 text-xs font-bold text-white"
                      >
                        {MODULE_NUMBERS[key]}
                      </span>
                    ))}
                    <span className="ml-1 text-[11px] text-muted-foreground">
                      {enabled.map((key) => MODULE_LABELS[key]).join(" · ")}
                    </span>
                  </span>
                )}

                <div className="ml-auto flex flex-wrap gap-2">
                  <TenantModulesDialog
                    tenantId={tenant.id}
                    tenantName={tenant.name}
                    modules={tenant.modules}
                  />
                  <TenantStatusButton
                    tenantId={tenant.id}
                    tenantName={tenant.name}
                    status={tenant.status}
                  />
                </div>
              </div>
            </CardContent>
          </Card>
        );
      })}

      <p className="text-[11px] text-muted-foreground">
        모듈 번호 —{" "}
        {MODULE_KEYS.map(
          (key) => `${MODULE_NUMBERS[key]} ${MODULE_LABELS[key]}`
        ).join(" · ")}
      </p>
    </div>
  );
}
