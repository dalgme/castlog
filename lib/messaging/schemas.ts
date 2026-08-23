import { z } from "zod";

/** SMS 공급자 설정 저장 (총괄관리자 — BYO, CLAUDE.md 5-2) */
export const smsConfigSchema = z.object({
  provider: z.enum(["solapi", "aligo", "nhncloud"], {
    errorMap: () => ({ message: "공급자를 선택하세요." }),
  }),
  apiKey: z.string().min(1, "API 키를 입력하세요.").max(200),
  apiSecret: z.string().max(200).optional(),
  senderNumber: z
    .string()
    .regex(/^[\d-]{8,13}$/, "사전등록 발신번호를 입력하세요 (예: 02-123-4567)."),
});
export type SmsConfigInput = z.infer<typeof smsConfigSchema>;

/** 캐스트로그 발송(b) 신청 — 자사 발신번호 + 담당자가 알려준 이용코드 */
export const platformSmsSchema = z.object({
  senderNumber: z
    .string()
    .regex(/^[\d-]{8,13}$/, "자사 발신번호를 입력하세요 (예: 02-123-4567)."),
  accessCode: z.string().max(100).optional(),
});
export type PlatformSmsInput = z.infer<typeof platformSmsSchema>;

/** 발송 실행 (관리자 이상) — 유형 선택 필수, 기본값은 광고성(안전한 쪽) */
export const messageSendSchema = z
  .object({
    channel: z.enum(["sms", "email"]),
    messageType: z.enum(["transactional", "advertising"]),
    // 발송 제목 — 이력(로그) 목록에 표시할 이름 (기획 확정 2026-08-23)
    title: z
      .string()
      .trim()
      .min(1, "발송 제목을 입력하세요 (이력에 표시됩니다).")
      .max(80, "발송 제목은 80자 이내로 입력하세요."),
    subject: z.string().max(150, "제목은 150자 이내로 입력하세요.").optional(),
    body: z
      .string()
      .min(1, "내용을 입력하세요.")
      .max(1800, "내용은 1800자 이내로 입력하세요."),
    expertIds: z.array(z.string().uuid()).min(1, "수신 대상을 선택하세요."),
    // 발신번호 선택(선택) — 서버가 등록 목록과 대조해 목록 밖 값은 무시한다
    senderNumber: z
      .string()
      .regex(/^[\d-]{8,13}$/)
      .optional(),
    // 서명 문구(선택) — 문자 하단에 자동 추가 (예: "(주)렛츠 김예나 선임연구원")
    signature: z.string().trim().max(100, "서명 문구는 100자 이내로 입력하세요.").optional(),
    // 예약발송 (KST, datetime-local 형식 "YYYY-MM-DDTHH:mm") — 문자만
    scheduledAt: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, "예약 시각 형식이 올바르지 않습니다.")
      .optional(),
    // MMS 이미지 (기획 확정 2026-08-23) — 업로드 액션이 발급한 공급자 이미지 id
    imageId: z.string().max(200).optional(),
    imageName: z.string().max(200).optional(),
  })
  .refine((v) => v.channel !== "email" || (v.subject && v.subject.length > 0), {
    message: "이메일은 제목이 필요합니다.",
    path: ["subject"],
  })
  .refine((v) => v.channel === "sms" || !v.scheduledAt, {
    message: "예약발송은 문자(SMS)에서만 지원합니다.",
    path: ["scheduledAt"],
  })
  .refine((v) => v.channel === "sms" || !v.imageId, {
    message: "이미지 첨부는 문자(SMS)에서만 지원합니다.",
    path: ["imageId"],
  });
export type MessageSendInput = z.infer<typeof messageSendSchema>;
