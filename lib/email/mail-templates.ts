/**
 * 섭외 워크플로우 메일 작성기 — 서버·클라이언트 공용 (기획 지시 2026-11-08).
 *
 * 왜 공용인가: 발송 전 **미리보기**(04번 원칙 — 보내기 전에 본다)와 실제 발송이 같은 함수를 써야
 * "본 것 = 나간 것"이 된다. 서버 액션이 데이터를 모아 넘기고, 이 파일은 순수하게 문장과 HTML만 만든다.
 *
 * 두 가지 본문을 함께 만든다:
 *  - text: 종전과 같은 평문 (메일 클라이언트 폴백·이메일 대장 검색)
 *  - html: 강조 표시가 있는 본문 — 회신 마감·금액은 굵게/색으로, 링크는 버튼으로.
 * 전문가가 만나는 상대는 그 회사다(§16) — 머리에 회사 이름을 두고 캐스트로그는 꼬리 고지로만 둔다.
 */

export type MailRow = {
  label: string;
  value: string;
  /** 강조 — 금액·마감처럼 놓치면 안 되는 줄 */
  emphasis?: "strong" | "deadline";
};

export type MailDoc = {
  subject: string;
  text: string;
  html: string;
};

export type MailSpec = {
  /** 메일 제목 — HTML <title>에도 쓴다 */
  subject?: string;
  /** 머리 — 회사 이름 (§16 화이트라벨) */
  tenantName: string;
  /** 제목 아래 큰 글씨 */
  heading: string;
  /** 인사 줄 (예: "홍길동 전문가님, 섭외를 요청드립니다.") */
  greeting: string | null;
  /** 표로 보여 줄 항목 */
  rows: MailRow[];
  /** 표 아래 단락들 (평문 그대로, 줄바꿈 유지) */
  paragraphs?: string[];
  /** 행동 버튼 */
  cta?: { label: string; url: string; note?: string | null } | null;
  /** 꼬리 안내 (작은 글씨) */
  footnotes?: string[];
};

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function nl2br(s: string): string {
  return escapeHtml(s).replace(/\n/g, "<br />");
}

/** 공용 HTML 뼈대 — 인라인 스타일만(메일 클라이언트는 외부 CSS를 버린다). 모바일 폭 600px */
export function renderMailHtml(spec: MailSpec): string {
  const rowsHtml = spec.rows
    .map((r) => {
      const valueStyle =
        r.emphasis === "deadline"
          ? "color:#b91c1c;font-weight:700;"
          : r.emphasis === "strong"
            ? "color:#111827;font-weight:700;"
            : "color:#111827;";
      return (
        `<tr>` +
        `<td style="padding:7px 10px;border-bottom:1px solid #eef0f3;color:#6b7280;font-size:13px;white-space:nowrap;vertical-align:top;width:92px;">${escapeHtml(r.label)}</td>` +
        `<td style="padding:7px 10px;border-bottom:1px solid #eef0f3;font-size:14px;line-height:1.55;${valueStyle}">${nl2br(r.value)}</td>` +
        `</tr>`
      );
    })
    .join("");
  const paragraphsHtml = (spec.paragraphs ?? [])
    .filter((p) => p.trim().length > 0)
    .map((p) => `<p style="margin:0 0 12px;font-size:14px;line-height:1.65;color:#111827;">${nl2br(p)}</p>`)
    .join("");
  const ctaHtml = spec.cta
    ? `<div style="margin:22px 0 8px;text-align:center;">` +
      `<a href="${escapeHtml(spec.cta.url)}" style="display:inline-block;background:#1d4ed8;color:#ffffff;text-decoration:none;font-weight:700;font-size:15px;padding:13px 26px;border-radius:8px;">${escapeHtml(spec.cta.label)}</a>` +
      (spec.cta.note ? `<p style="margin:10px 0 0;font-size:12px;color:#6b7280;">${nl2br(spec.cta.note)}</p>` : "") +
      `<p style="margin:8px 0 0;font-size:11px;color:#9ca3af;word-break:break-all;">버튼이 열리지 않으면: ${escapeHtml(spec.cta.url)}</p>` +
      `</div>`
    : "";
  const footHtml = (spec.footnotes ?? [])
    .map((f) => `<p style="margin:4px 0;font-size:12px;line-height:1.55;color:#6b7280;">${nl2br(f)}</p>`)
    .join("");
  return (
    `<!doctype html><html lang="ko"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>${escapeHtml(spec.subject ?? spec.heading)}</title></head>` +
    `<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Apple SD Gothic Neo','Malgun Gothic','Noto Sans KR',Segoe UI,Roboto,sans-serif;">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:20px 10px;"><tr><td align="center">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb;">` +
    `<tr><td style="background:#0f172a;color:#ffffff;padding:14px 20px;font-size:13px;font-weight:700;letter-spacing:0.2px;">${escapeHtml(spec.tenantName)}</td></tr>` +
    `<tr><td style="padding:22px 20px 6px;">` +
    `<h1 style="margin:0 0 10px;font-size:20px;line-height:1.35;color:#0f172a;">${escapeHtml(spec.heading)}</h1>` +
    (spec.greeting ? `<p style="margin:0 0 14px;font-size:14px;line-height:1.65;color:#111827;">${nl2br(spec.greeting)}</p>` : "") +
    `</td></tr>` +
    (rowsHtml
      ? `<tr><td style="padding:0 20px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-radius:8px;border-collapse:separate;overflow:hidden;">${rowsHtml}</table></td></tr>`
      : "") +
    `<tr><td style="padding:16px 20px 4px;">${paragraphsHtml}${ctaHtml}</td></tr>` +
    `<tr><td style="padding:10px 20px 20px;border-top:1px solid #eef0f3;">${footHtml}</td></tr>` +
    `</table>` +
    `<p style="margin:12px 0 0;font-size:11px;color:#9ca3af;">이 메일은 ${escapeHtml(spec.tenantName)}의 업무연락입니다. 발송 시스템: CASTLOG</p>` +
    `</td></tr></table></body></html>`
  );
}

type MailSpecWithSubject = MailSpec & { subject: string };

function textFromSpec(spec: MailSpecWithSubject): string {
  const rows = spec.rows.map((r) => `· ${r.label}: ${r.value}`);
  return [
    spec.greeting,
    "",
    ...rows,
    ...(spec.paragraphs && spec.paragraphs.length > 0 ? ["", ...spec.paragraphs] : []),
    ...(spec.cta ? ["", `${spec.cta.label}: ${spec.cta.url}`, spec.cta.note ?? null] : []),
    ...(spec.footnotes && spec.footnotes.length > 0 ? ["", ...spec.footnotes] : []),
  ]
    .filter((v): v is string => v !== null && v !== undefined)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** 섭외 요청 — 단건(/e) */
export function composeEngagementRequestMail(params: {
  tenantName: string;
  expertName: string | null;
  programName: string | null;
  sessionName: string | null;
  roleLabel: string | null;
  /** 정식 일정 표기 ("2026년 09월 07일(월) 10:30~14:30") */
  schedule: string | null;
  /** 조건 줄들 (진행 방식·회차·시간 / 의뢰비용) — feeTermsLines */
  termLines: string[];
  /** 조건에 비용이 없을 때의 폴백 한 줄 ("의뢰비용: 300,000원" 또는 미정 안내) */
  feeFallbackLine: string | null;
  locationLine: string | null;
  eventSummary?: string | null;
  specialNotes?: string | null;
  /** 회신 마감 표기 ("2026년 11월 21일(토) 18:00") */
  deadlineText: string | null;
  url: string;
}): MailDoc {
  const subject = `[섭외 요청] ${params.programName?.trim() || params.sessionName || "섭외"}`;
  const rows: MailRow[] = [];
  if (params.programName) rows.push({ label: "사업명", value: params.programName });
  if (params.sessionName) rows.push({ label: "세션", value: params.sessionName });
  if (params.roleLabel) rows.push({ label: "역할", value: params.roleLabel });
  if (params.schedule) rows.push({ label: "일정", value: params.schedule, emphasis: "strong" });
  for (const line of params.termLines) {
    const idx = line.indexOf(":");
    const label = idx > 0 ? line.slice(0, idx).trim() : "조건";
    const value = idx > 0 ? line.slice(idx + 1).trim() : line;
    rows.push({ label, value, emphasis: label.includes("비용") ? "strong" : undefined });
  }
  if (params.feeFallbackLine) {
    const idx = params.feeFallbackLine.indexOf(":");
    rows.push({
      label: idx > 0 ? params.feeFallbackLine.slice(0, idx).trim() : "의뢰비용",
      value: idx > 0 ? params.feeFallbackLine.slice(idx + 1).trim() : params.feeFallbackLine,
      emphasis: "strong",
    });
  }
  if (params.locationLine) rows.push({ label: "장소", value: params.locationLine });
  if (params.eventSummary?.trim()) rows.push({ label: "행사 내용", value: params.eventSummary.trim() });
  if (params.specialNotes?.trim()) rows.push({ label: "안내", value: params.specialNotes.trim() });
  if (params.deadlineText) rows.push({ label: "회신 마감", value: `${params.deadlineText}까지`, emphasis: "deadline" });
  const spec: MailSpecWithSubject = {
    subject,
    tenantName: params.tenantName,
    heading: "섭외 요청",
    greeting: `${params.expertName ? `${params.expertName} 전문가님, ` : ""}${params.roleLabel ? `${params.roleLabel} ` : ""}섭외를 요청드립니다. 아래 내용을 확인하시고 회신 마감 전에 수락 또는 거절해 주세요.`,
    rows,
    paragraphs: [],
    cta: { label: "수락 / 거절하기", url: params.url, note: "링크에서 상세 내용을 확인한 뒤 수락 또는 거절을 선택할 수 있습니다." },
    footnotes: ["문의는 이 메일에 회신하시거나 요청 기업 담당자에게 연락해 주세요.", "회신 마감이 지나면 링크가 만료되고 요청이 자동 종료됩니다."],
  };
  return { subject, text: textFromSpec(spec), html: renderMailHtml(spec) };
}

/** 섭외 요청 — 묶음(/b, 한 전문가·여러 세션) */
export function composeEngagementBundleMail(params: {
  tenantName: string;
  expertName: string | null;
  programName: string | null;
  items: { sessionName: string | null; schedule: string | null; terms: string | null; location: string | null; fee: string | null }[];
  eventSummary?: string | null;
  specialNotes?: string | null;
  deadlineText: string | null;
  url: string;
}): MailDoc {
  const count = params.items.length;
  const subject = `[섭외 요청 ${count}건] ${params.programName?.trim() || "프로젝트 섭외"}`;
  const rows: MailRow[] = [];
  if (params.programName) rows.push({ label: "사업명", value: params.programName });
  params.items.forEach((it, i) => {
    rows.push({
      label: `세션 ${i + 1}`,
      value: [it.sessionName, it.schedule, it.terms, it.location, it.fee].filter(Boolean).join("\n"),
      emphasis: "strong",
    });
  });
  if (params.eventSummary?.trim()) rows.push({ label: "행사 내용", value: params.eventSummary.trim() });
  if (params.specialNotes?.trim()) rows.push({ label: "안내", value: params.specialNotes.trim() });
  if (params.deadlineText) rows.push({ label: "회신 마감", value: `${params.deadlineText}까지`, emphasis: "deadline" });
  const spec: MailSpecWithSubject = {
    subject,
    tenantName: params.tenantName,
    heading: `섭외 요청 ${count}건`,
    greeting: `${params.expertName ? `${params.expertName} 전문가님, ` : ""}아래 ${count}건의 섭외를 요청드립니다. 건별로 수락 또는 거절하실 수 있습니다.`,
    rows,
    cta: { label: "각 건 확인 · 수락 / 거절하기", url: params.url, note: "링크 하나에서 모든 건을 확인하고 건별로 회신합니다." },
    footnotes: ["문의는 이 메일에 회신하시거나 요청 기업 담당자에게 연락해 주세요.", "회신 마감이 지나면 링크가 만료되고 요청이 자동 종료됩니다."],
  };
  return { subject, text: textFromSpec(spec), html: renderMailHtml(spec) };
}

/** 수락서 송부 안내 — 수락서 자체는 포털에서 열린다 */
export function composeAcceptanceLetterMail(params: {
  tenantName: string;
  expertName: string | null;
  projectName: string;
  memo?: string | null;
  url: string;
  /** 단건 재송부 등 — 제목 접미 */
  subjectSuffix?: string;
}): MailDoc {
  const subject = `[수락서] ${params.projectName} — ${params.subjectSuffix ?? "확인 및 승인(서명) 요청"}`;
  const rows: MailRow[] = [{ label: "사업명", value: params.projectName, emphasis: "strong" }];
  if (params.memo?.trim()) rows.push({ label: "안내", value: params.memo.trim() });
  const spec: MailSpecWithSubject = {
    subject,
    tenantName: params.tenantName,
    heading: "수락서가 도착했습니다",
    greeting: `${params.expertName ? `${params.expertName} 전문가님, ` : ""}${params.tenantName}에서 수락서를 보내드립니다. 내용을 확인하시고 승인(서명)을 완료해 주세요.`,
    rows,
    paragraphs: ["수락서는 전문가 포털 화면에서 확인·승인하실 수 있습니다. 이 메일은 수락서가 도착했다는 안내이며, 수락서 자체는 첨부되지 않습니다."],
    cta: { label: "수락서 확인 · 승인(서명)", url: params.url, note: "※ 전문가 포털 로그인(휴대폰 인증) 후 확인하실 수 있습니다." },
    footnotes: ["문의는 이 메일에 회신하시거나 요청 기업 담당자에게 연락해 주세요."],
  };
  return { subject, text: textFromSpec(spec), html: renderMailHtml(spec) };
}
