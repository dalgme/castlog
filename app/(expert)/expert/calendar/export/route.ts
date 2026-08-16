import { getCalendarEvents } from "../actions";

/** iCal 텍스트 이스케이프(RFC5545). */
function esc(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** 종일: YYYYMMDD (로컬 날짜). */
function dateOnly(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
}

/** 시간 지정: UTC 타임스탬프 YYYYMMDDTHHMMSSZ. */
function dateTimeUtc(iso: string): string {
  const d = new Date(iso);
  return (
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
  );
}

function addOneDay(iso: string): string {
  const d = new Date(iso);
  d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
}

/**
 * 전문가 활동 캘린더 iCal(.ics) 내보내기 — 개인 캘린더 가져오기/구독용.
 * 로그인 전문가 본인 이벤트만(캐스트로그 섭외 + 외부 일정).
 */
export async function GET() {
  const events = await getCalendarEvents();
  const stamp = dateTimeUtc(new Date().toISOString());

  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//CASTLOG//Expert Calendar//KO",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:CASTLOG 활동 캘린더",
  ];

  for (const ev of events) {
    const desc = [ev.source === "castlog" ? "[캐스트로그 섭외]" : "[외부 일정]", ev.orgName, ev.memo]
      .filter(Boolean)
      .join(" · ");
    lines.push("BEGIN:VEVENT");
    lines.push(`UID:${ev.source}-${ev.id}@castlog.kr`);
    lines.push(`DTSTAMP:${stamp}`);
    if (ev.allDay) {
      lines.push(`DTSTART;VALUE=DATE:${dateOnly(ev.start)}`);
      lines.push(`DTEND;VALUE=DATE:${addOneDay(ev.end ?? ev.start)}`);
    } else {
      lines.push(`DTSTART:${dateTimeUtc(ev.start)}`);
      if (ev.end) lines.push(`DTEND:${dateTimeUtc(ev.end)}`);
    }
    lines.push(`SUMMARY:${esc(ev.title)}`);
    if (ev.location) lines.push(`LOCATION:${esc(ev.location)}`);
    if (desc) lines.push(`DESCRIPTION:${esc(desc)}`);
    lines.push("END:VEVENT");
  }

  lines.push("END:VCALENDAR");
  const body = lines.join("\r\n");

  return new Response(body, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'attachment; filename="castlog-calendar.ics"',
      "Cache-Control": "no-store",
    },
  });
}
