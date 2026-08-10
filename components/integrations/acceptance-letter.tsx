import { formatKrw } from "@/lib/approvals/constants";
import type { Tables } from "@/lib/supabase/database.types";

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-3">
      <dt className="w-20 shrink-0 text-muted-foreground">{label}</dt>
      <dd className="flex-1 break-words">{value}</dd>
    </div>
  );
}

/**
 * 단계 28-B: 섭외수락서 문서 표현 (서버 컴포넌트).
 * 서명·날인은 만료 서명 URL(<img>)로만 노출한다. 인쇄 시 그대로 활용 가능.
 */
export function AcceptanceLetter({
  acceptance,
  signatureUrl,
  sealUrl,
}: {
  acceptance: Tables<"engagement_acceptances">;
  signatureUrl: string | null;
  sealUrl: string | null;
}) {
  const a = acceptance;
  const acceptedAt = new Date(a.accepted_at).toLocaleString("ko-KR");

  return (
    <div className="rounded-lg border bg-white p-6 text-sm text-foreground shadow-sm">
      <div className="text-center">
        <h1 className="text-lg font-bold tracking-tight">섭외 수락서</h1>
        <p className="mt-1 text-xs text-muted-foreground">문서번호 {a.letter_no}</p>
      </div>

      <dl className="mt-6 space-y-2">
        <Row label="기업" value={a.tenant_name} />
        {a.project_name && <Row label="프로젝트" value={a.project_name} />}
        <Row label="전문가" value={a.expert_name} />
        <Row label="역할" value={a.role_description} />
        {(a.starts_on || a.ends_on) && (
          <Row label="기간" value={`${a.starts_on ?? "?"} ~ ${a.ends_on ?? "?"}`} />
        )}
        {a.fee_amount !== null && (
          <Row label="의뢰비용" value={formatKrw(a.fee_amount)} />
        )}
        <Row label="수락일시" value={acceptedAt} />
      </dl>

      <p className="mt-6 leading-relaxed text-muted-foreground">
        본인은 위 조건의 섭외 요청을 확인하고 이를 수락합니다. 아래 서명·날인은
        수락 시점에 등록된 본인의 서명·날인입니다.
      </p>

      <div className="mt-6 flex items-end justify-end gap-8">
        {signatureUrl ? (
          <figure className="text-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={signatureUrl}
              alt="전문가 서명"
              className="h-20 w-auto object-contain"
            />
            <figcaption className="mt-1 text-xs text-muted-foreground">서명</figcaption>
          </figure>
        ) : (
          <p className="text-xs text-amber-700">
            ※ 서명이 등록되지 않은 상태로 수락되었습니다.
          </p>
        )}
        {sealUrl && (
          <figure className="text-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={sealUrl}
              alt="전문가 날인"
              className="h-20 w-auto object-contain"
            />
            <figcaption className="mt-1 text-xs text-muted-foreground">날인</figcaption>
          </figure>
        )}
      </div>
    </div>
  );
}
