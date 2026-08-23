"use client";

/**
 * 24시간제 일시 입력 (기획 확정 2026-08-23 — 시간 기능은 전부 24시간 기준).
 * datetime-local은 브라우저 로캘에 따라 오전/오후로 표시되어 쓰지 않는다.
 * 값 형식은 기존과 동일한 "YYYY-MM-DDTHH:mm" — 서버 액션 수정 없이 교체된다.
 */
const HOURS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, "0"));
const MINUTES = ["00", "10", "20", "30", "40", "50"];

export function DateTime24Input({
  id,
  value,
  onChange,
}: {
  id?: string;
  /** "YYYY-MM-DDTHH:mm" 또는 빈 문자열 */
  value: string;
  onChange: (next: string) => void;
}) {
  const [datePart, timePart] = value ? value.split("T") : ["", ""];
  const date = datePart ?? "";
  const [hourPart, minutePart] = timePart ? timePart.split(":") : ["", ""];
  const hour = hourPart ?? "";
  const minute = minutePart ?? "";

  function emit(nextDate: string, nextHour: string, nextMinute: string) {
    if (nextDate && nextHour !== "" && nextMinute !== "") {
      onChange(`${nextDate}T${nextHour}:${nextMinute}`);
    } else {
      onChange("");
    }
  }

  const selectCls =
    "h-9 rounded-md border bg-background px-2 text-sm";

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <input
        id={id}
        type="date"
        value={date}
        onChange={(e) => emit(e.target.value, hour || "09", minute || "00")}
        className={selectCls}
      />
      <select
        aria-label="시 (24시간)"
        value={hour}
        onChange={(e) => emit(date, e.target.value, minute || "00")}
        className={selectCls}
      >
        <option value="">시</option>
        {HOURS.map((h) => (
          <option key={h} value={h}>
            {h}시
          </option>
        ))}
      </select>
      <select
        aria-label="분"
        value={minute}
        onChange={(e) => emit(date, hour || "09", e.target.value)}
        className={selectCls}
      >
        <option value="">분</option>
        {MINUTES.map((m) => (
          <option key={m} value={m}>
            {m}분
          </option>
        ))}
      </select>
      <span className="text-xs text-muted-foreground">(24시간제)</span>
    </div>
  );
}

/**
 * 24시간제 시각(시:분) 입력 — 날짜 없이 시간만 고르는 자리용 (세션 시작·종료 등).
 * 값 형식은 "HH:mm" 또는 빈 문자열 — 기존 type="time" 값 계약과 동일해
 * 서버 액션 수정 없이 교체된다. 분은 10분 단위 (DateTime24Input과 동일).
 */
export function Time24Input({
  id,
  value,
  onChange,
  ariaLabel,
}: {
  id?: string;
  /** "HH:mm" 또는 빈 문자열 */
  value: string;
  onChange: (next: string) => void;
  ariaLabel?: string;
}) {
  const [hourPart, minutePart] = value ? value.split(":") : ["", ""];
  const hour = hourPart ?? "";
  const minute = minutePart ?? "";

  function emit(nextHour: string, nextMinute: string) {
    if (nextHour !== "" && nextMinute !== "") {
      onChange(`${nextHour}:${nextMinute}`);
    } else {
      onChange("");
    }
  }

  const selectCls = "h-9 rounded-md border bg-background px-2 text-sm";

  return (
    <div className="flex items-center gap-1" id={id}>
      <select
        aria-label={`${ariaLabel ?? "시각"} — 시 (24시간)`}
        value={hour}
        onChange={(e) => emit(e.target.value, e.target.value ? minute || "00" : "")}
        className={selectCls}
      >
        <option value="">시</option>
        {HOURS.map((h) => (
          <option key={h} value={h}>
            {h}시
          </option>
        ))}
      </select>
      <select
        aria-label={`${ariaLabel ?? "시각"} — 분`}
        value={minute}
        onChange={(e) => emit(hour || "09", e.target.value)}
        className={selectCls}
      >
        <option value="">분</option>
        {MINUTES.map((m) => (
          <option key={m} value={m}>
            {m}분
          </option>
        ))}
      </select>
    </div>
  );
}
