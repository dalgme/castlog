/**
 * 외부 송신 이메일 본문 프리셋 (클라이언트·서버 공용).
 *
 * AI가 추천하는 기본 본문 3종. 전문가가 즉석에서 수정 후 발송할 수 있고,
 * 수정본을 '사용자 옵션'으로 저장할 수 있다(expert_send_body_presets).
 *
 * 모든 본문에는 반드시 다음 안내가 포함된다(사용자 요구):
 *  - 다운로드 링크는 72시간 임시 주소이며 만료됨
 *  - 직접 첨부한 파일은 만료 기한 없음
 *  - 첨부파일은 수신자 메일 서비스 정책에 따라 제한될 수 있음(예: 다음 대용량 첨부)
 */
import { SEND_EXPIRES_HOURS } from "@/lib/experts/external-send-constants";

/** 표준 서류(클릭 시 임시 URL로 전달) — 5종 */
export const SEND_STANDARD_TYPES: { type: string; label: string }[] = [
  { type: "resume", label: "이력서" },
  { type: "bank_account_copy", label: "통장 사본" },
  { type: "id_card_copy", label: "신분증 사본" },
  { type: "business_card", label: "명함" },
  { type: "business_registration", label: "사업자등록증" },
];

/** 모든 본문 하단에 붙는 공통 안내(기한·첨부 정책). */
export const SEND_NOTICE_BLOCK =
  `※ 안내\n` +
  `- 아래 다운로드 링크는 발송 시각으로부터 ${SEND_EXPIRES_HOURS}시간 동안만 유효한 임시 주소이며, 기한이 지나면 자동으로 만료됩니다. 기한 내 저장 부탁드립니다.\n` +
  `- 이메일에 직접 첨부한 파일은 별도의 만료 기한이 없습니다. 다만 받으시는 메일 서비스의 정책에 따라 다운로드가 제한될 수 있습니다(예: 다음(Daum) 메일의 대용량 첨부는 자체 다운로드 기한이 설정될 수 있음). 참고 부탁드립니다.`;

export type BodyPreset = { key: string; label: string; body: string };

export const DEFAULT_BODY_PRESETS: BodyPreset[] = [
  {
    key: "builtin-1",
    label: "본문 1",
    body:
      `안녕하세요, 요청하신 서류를 보내드립니다.\n\n` +
      `아래 다운로드 링크와 첨부파일을 확인 부탁드립니다. 검토하시고 필요하신 사항이 있으면 언제든 회신 주세요.\n\n` +
      `감사합니다.\n\n` +
      SEND_NOTICE_BLOCK,
  },
  {
    key: "builtin-2",
    label: "본문 2",
    body:
      `안녕하세요. 요청하신 서류 전달드립니다.\n\n` +
      `확인 부탁드리며, 문의사항은 본 메일로 회신 주시면 됩니다.\n\n` +
      SEND_NOTICE_BLOCK,
  },
  {
    key: "builtin-3",
    label: "본문 3",
    body:
      `안녕하세요, 관련하여 요청하신 서류를 보내드립니다.\n\n` +
      `아래 다운로드 링크와 첨부파일을 확인해 주시고, 추가로 필요한 서류나 수정 사항이 있으면 알려주시면 신속히 조치하겠습니다. 협조에 감사드립니다.\n\n` +
      SEND_NOTICE_BLOCK,
  },
];
