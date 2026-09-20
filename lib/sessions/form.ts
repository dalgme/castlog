import type { DateKind, DeliveryMode, SessionSchedule } from "./schedule";

/** 세션 추가·수정 팝업의 폼 값 (문자열 기반 — 입력 중 상태) */
export type SessionFormValue = {
  dateKind: DateKind;
  startDate: string;
  startsTime: string;
  endsTime: string;
  endDate: string;
  endStartsTime: string;
  endEndsTime: string;
  dates: { date: string; startsTime: string; endsTime: string }[];
  countMin: string;
  countMax: string;
  onlineCount: string;
  offlineCount: string;
  deliveryMode: DeliveryMode | "";
  sessionName: string;
  roleType: string;
  roleDescription: string;
  requiredCount: string;
  locationName: string;
  notes: string;
  fieldId: string;
};

export function emptySessionForm(over: Partial<SessionFormValue> = {}): SessionFormValue {
  return {
    dateKind: "individual",
    startDate: "",
    startsTime: "",
    endsTime: "",
    endDate: "",
    endStartsTime: "",
    endEndsTime: "",
    dates: [{ date: "", startsTime: "", endsTime: "" }],
    countMin: "",
    countMax: "",
    onlineCount: "",
    offlineCount: "",
    deliveryMode: "",
    sessionName: "",
    roleType: "lecturer",
    roleDescription: "",
    requiredCount: "1",
    locationName: "",
    notes: "",
    fieldId: "",
    ...over,
  };
}

const t = (v: string | null) => (v ? v.slice(0, 5) : "");
const n = (v: number | null) => (v === null ? "" : String(v));

export function formFromSchedule(
  s: SessionSchedule,
  extra: {
    sessionName: string | null;
    roleType: string;
    roleDescription: string | null;
    requiredCount: number;
    locationName: string | null;
    notes: string | null;
    fieldId: string | null;
  }
): SessionFormValue {
  return {
    dateKind: s.dateKind,
    startDate: s.startDate,
    startsTime: t(s.startsTime),
    endsTime: t(s.endsTime),
    endDate: s.endDate ?? "",
    endStartsTime: t(s.endStartsTime),
    endEndsTime: t(s.endEndsTime),
    dates:
      s.dates.length > 0
        ? s.dates.map((d) => ({ date: d.date, startsTime: t(d.startsTime), endsTime: t(d.endsTime) }))
        : [{ date: s.startDate, startsTime: t(s.startsTime), endsTime: t(s.endsTime) }],
    countMin: n(s.countMin),
    countMax: n(s.countMax),
    onlineCount: n(s.onlineCount),
    offlineCount: n(s.offlineCount),
    deliveryMode: s.deliveryMode ?? "",
    sessionName: extra.sessionName ?? "",
    roleType: extra.roleType,
    roleDescription: extra.roleDescription ?? "",
    requiredCount: String(extra.requiredCount),
    locationName: extra.locationName ?? "",
    notes: extra.notes ?? "",
    fieldId: extra.fieldId ?? "",
  };
}
