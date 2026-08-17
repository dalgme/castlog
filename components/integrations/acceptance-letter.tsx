import { formatKrw } from "@/lib/approvals/constants";
import { PAYMENT_TYPE_LABELS, type PaymentType } from "@/lib/payments/tax";
import {
  formatEventSchedule,
  roleTypeLabel,
} from "@/lib/integrations/engagement-roles";
import type { AcceptanceAttachmentView } from "@/lib/integrations/acceptance-view";
import type { Tables } from "@/lib/supabase/database.types";

import { AcceptanceAttachments } from "./acceptance-attachments";

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-3">
      <dt className="w-20 shrink-0 text-muted-foreground">{label}</dt>
      <dd className="flex-1 whitespace-pre-wrap break-words">{value}</dd>
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
  mapUrl = null,
  attachments = [],
}: {
  acceptance: Tables<"engagement_acceptances">;
  signatureUrl: string | null;
  sealUrl: string | null;
  mapUrl?: string | null;
  attachments?: AcceptanceAttachmentView[];
}) {
  const a = acceptance;
  const acceptedAt = new Date(a.accepted_at).toLocaleString("ko-KR");
  const schedule = formatEventSchedule(
    a.starts_on,
    a.ends_on,
    a.starts_time,
    a.ends_time
  );

  return (
    <div className="rounded-lg border bg-white p-6 text-sm text-foreground shadow-sm">
      <div className="text-center">
        <h1 className="text-lg font-bold tracking-tight">섭외 수락서</h1>
        <p className="mt-1 text-xs text-muted-foreground">
          문서번호 {a.letter_no}
          {a.position_code && (
            <>
              {" · "}
              <span className="font-mono">{a.position_code}</span>
            </>
          )}
        </p>
      </div>

      <dl className="mt-6 space-y-2">
        <Row label="기업" value={a.tenant_name} />
        {a.program_name && <Row label="사업명" value={a.program_name} />}
        {!a.program_name && a.project_name && (
          <Row label="프로젝트" value={a.project_name} />
        )}
        {a.session_name && <Row label="세션" value={a.session_name} />}
        <Row label="전문가" value={a.expert_name} />
        <Row
          label="구분"
          value={
            [roleTypeLabel(a.role_type), a.role_description]
              .filter(Boolean)
              .join(" · ") || a.role_description
          }
        />
        {schedule ? (
          <Row label="일정" value={schedule} />
        ) : (
          (a.starts_on || a.ends_on) && (
            <Row label="일정" value={`${a.starts_on ?? "?"} ~ ${a.ends_on ?? "?"}`} />
          )
        )}
        {a.location_name && (
          <Row
            label="장소"
            value={
              a.location_address
                ? `${a.location_name} (${a.location_address})`
                : a.location_name
            }
          />
        )}
        {a.event_summary && <Row label="주제" value={a.event_summary} />}
        {a.special_notes && <Row label="특기사항" value={a.special_notes} />}
        {a.fee_amount !== null && (
          <Row label="의뢰비용" value={formatKrw(a.fee_amount)} />
        )}
        <Row label="수락일시" value={acceptedAt} />
      </dl>

      {/* 지급 정보 — 주민등록번호·전체 계좌번호는 표기하지 않는다(§5) */}
      {(a.payment_type ||
        a.bank_name ||
        a.payment_due_note ||
        a.submission_docs) && (
        <dl className="mt-5 space-y-2 border-t pt-4">
          {a.payment_type && (
            <Row
              label="소득구분"
              value={
                PAYMENT_TYPE_LABELS[a.payment_type as PaymentType] ?? a.payment_type
              }
            />
          )}
          {a.bank_name && (
            <Row
              label="입금계좌"
              value={[
                a.bank_name,
                a.account_last4 ? `****${a.account_last4}` : null,
                a.account_holder,
              ]
                .filter(Boolean)
                .join(" · ")}
            />
          )}
          {a.payment_due_note && (
            <Row label="입금예정" value={a.payment_due_note} />
          )}
          {a.submission_docs && <Row label="제출서류" value={a.submission_docs} />}
          <p className="pt-1 text-xs text-muted-foreground">
            ※ 지급 시 소득 구분에 따라 원천징수 후 지급됩니다. 주민등록번호는 이 문서에
            기재되지 않으며, 지급명세서 작성 시점에 별도의 보안 절차로만 확인합니다.
          </p>
        </dl>
      )}

      {a.guide_note && (
        <div className="mt-5 rounded-md border bg-muted/30 p-3">
          <p className="mb-1 text-xs font-semibold text-muted-foreground">안내 사항</p>
          <p className="whitespace-pre-wrap leading-relaxed">{a.guide_note}</p>
        </div>
      )}

      {mapUrl && (
        <div className="mt-4">
          <p className="mb-1 text-xs font-semibold text-muted-foreground">
            찾아오는 길
          </p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={mapUrl}
            alt="찾아오는 길 약도"
            className="w-full rounded-md border object-contain"
          />
        </div>
      )}

      <AcceptanceAttachments attachments={attachments} />

      <p className="mt-6 leading-relaxed text-muted-foreground">
        본인은 위 조건의 섭외 요청을 확인하고 이를 수락합니다. 아래 서명·날인은
        수락 시점에 등록된 본인의 서명·날인입니다.
      </p>
      {a.signed_at && (
        <p className="mt-1 text-xs text-muted-foreground">
          전자서명 확인: {new Date(a.signed_at).toLocaleString("ko-KR")}
        </p>
      )}

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
