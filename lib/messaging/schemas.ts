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

/** 발송 실행 (관리자 이상) — 유형 선택 필수, 기본값은 광고성(안전한 쪽) */
export const messageSendSchema = z
  .object({
    channel: z.enum(["sms", "email"]),
    messageType: z.enum(["transactional", "advertising"]),
    subject: z.string().max(150, "제목은 150자 이내로 입력하세요.").optional(),
    body: z
      .string()
      .min(1, "내용을 입력하세요.")
      .max(1800, "내용은 1800자 이내로 입력하세요."),
    expertIds: z.array(z.string().uuid()).min(1, "수신 대상을 선택하세요."),
  })
  .refine((v) => v.channel !== "email" || (v.subject && v.subject.length > 0), {
    message: "이메일은 제목이 필요합니다.",
    path: ["subject"],
  });
export type MessageSendInput = z.infer<typeof messageSendSchema>;
