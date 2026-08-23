/**
 * 세션 진행 시간 표시 (기획 확정 2026-08-23).
 * "HH:mm"(또는 "HH:mm:ss") 시작·종료에서 진행 시간을 사람이 읽는 문구로 만든다.
 * 클라이언트에서도 쓰므로 server-only를 붙이지 않는다.
 */

function toMinutes(time: string): number | null {
  const m = /^(\d{2}):(\d{2})/.exec(time);
  if (!m) return null;
  const value = Number(m[1]) * 60 + Number(m[2]);
  return Number.isFinite(value) ? value : null;
}

/** 진행 시간 문구 — "3시간" / "2시간 30분" / 계산 불가 시 null */
export function durationLabel(
  start: string | null | undefined,
  end: string | null | undefined
): string | null {
  if (!start || !end) return null;
  const s = toMinutes(start);
  const e = toMinutes(end);
  if (s === null || e === null || e <= s) return null;
  const total = e - s;
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  if (hours === 0) return `${minutes}분`;
  if (minutes === 0) return `${hours}시간`;
  return `${hours}시간 ${minutes}분`;
}
