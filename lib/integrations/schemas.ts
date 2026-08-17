import { z } from "zod";

/** 섭외 요청 생성 (기업 측 — experts 모듈, 프로젝트 연결은 operations 활성 시) */
export const engagementCreateSchema = z
  .object({
    expertId: z.string().uuid("전문가를 선택하세요."),
    projectId: z.string().uuid().optional().or(z.literal("")),
    roleDescription: z
      .string()
      .min(1, "요청 역할을 입력하세요 (예: 멘토, 심사위원).")
      .max(100, "역할은 100자 이내로 입력하세요."),
    feeAmount: z
      .string()
      .regex(/^\d*$/, "의뢰비용은 숫자만 입력하세요 (원 단위).")
      .optional(),
    startsOn: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional()
      .or(z.literal("")),
    endsOn: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional()
      .or(z.literal("")),
    // 행사 상세 (수락서 양식 대응 — Phase A-2)
    programName: z
      .string()
      .max(150, "사업명은 150자 이내로 입력하세요.")
      .optional(),
    roleType: z
      .enum(["host", "lecturer", "mentor", "judge", "announcer", "assistant", "other"])
      .optional()
      .or(z.literal("")),
    startsTime: z
      .string()
      .regex(/^\d{2}:\d{2}$/)
      .optional()
      .or(z.literal("")),
    endsTime: z
      .string()
      .regex(/^\d{2}:\d{2}$/)
      .optional()
      .or(z.literal("")),
    locationName: z.string().max(150, "장소는 150자 이내로 입력하세요.").optional(),
    locationAddress: z.string().max(200, "주소는 200자 이내로 입력하세요.").optional(),
    eventSummary: z
      .string()
      .max(1000, "주제·행사 내용은 1000자 이내로 입력하세요.")
      .optional(),
    specialNotes: z
      .string()
      .max(2000, "특기사항은 2000자 이내로 입력하세요.")
      .optional(),
    message: z.string().max(2000, "요청 내용은 2000자 이내로 입력하세요.").optional(),
    // 회신 마감일시 (datetime-local: YYYY-MM-DDTHH:mm). 미입력 시 기본 14일.
    responseDeadline: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/)
      .optional()
      .or(z.literal("")),
  })
  .refine(
    (v) => !v.startsOn || !v.endsOn || v.startsOn <= v.endsOn,
    { message: "종료일은 시작일 이후여야 합니다.", path: ["endsOn"] }
  )
  .refine(
    (v) =>
      !v.startsTime ||
      !v.endsTime ||
      (v.endsOn && v.startsOn && v.endsOn !== v.startsOn) ||
      v.startsTime < v.endsTime,
    { message: "종료 시각은 시작 시각 이후여야 합니다.", path: ["endsTime"] }
  )
  .refine(
    (v) => !v.responseDeadline || new Date(v.responseDeadline).getTime() > Date.now(),
    { message: "회신 마감일시는 현재 이후로 설정하세요.", path: ["responseDeadline"] }
  );
export type EngagementCreateInput = z.infer<typeof engagementCreateSchema>;

/** 섭외 응답 (공개 링크·포털 공용) */
export const engagementRespondSchema = z.object({
  decision: z.enum(["accepted", "declined"]),
  responseNote: z.string().max(1000, "의견은 1000자 이내로 입력하세요.").optional(),
});
export type EngagementRespondInput = z.infer<typeof engagementRespondSchema>;
