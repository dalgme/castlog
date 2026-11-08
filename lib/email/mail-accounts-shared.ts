/**
 * 직원 개인 메일 계정(SMTP) — 서버·클라이언트 공용 프리셋·타입 (기획 지시 2026-11-08).
 * 저장·발송은 lib/email/mail-accounts.ts(server-only).
 */

export const MAIL_PROVIDERS = ["naverworks", "google", "hiworks", "naver", "daum", "kakao", "custom"] as const;
export type MailProvider = (typeof MAIL_PROVIDERS)[number];

export type MailProviderPreset = {
  label: string;
  host: string | null;
  port: number;
  secure: boolean;
  /** 앱 비밀번호 발급 안내 — 메일 서비스마다 경로가 다르다 */
  passwordHint: string;
  /** 로그인 아이디가 메일 주소 전체인가(true) / 아이디만인가(false) */
  usernameIsEmail: boolean;
};

export const MAIL_PROVIDER_PRESETS: Record<MailProvider, MailProviderPreset> = {
  naverworks: {
    label: "네이버웍스 (Naver Works)",
    host: "smtp.worksmobile.com",
    port: 465,
    secure: true,
    passwordHint:
      "네이버웍스 → 내 계정 보안 → 외부 메일 앱(IMAP/SMTP) 사용 설정에서 ‘앱 비밀번호’를 만들어 넣으세요. 관리자가 외부 메일 앱 사용을 허용해야 합니다. 로그인 비밀번호가 아닙니다.",
    usernameIsEmail: true,
  },
  google: {
    label: "Google Workspace / Gmail",
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    passwordHint:
      "Google 계정 → 보안 → 2단계 인증을 켠 뒤 ‘앱 비밀번호’(16자리)를 만들어 넣으세요. 로그인 비밀번호로는 되지 않습니다.",
    usernameIsEmail: true,
  },
  hiworks: {
    label: "하이웍스 (hiworks)",
    host: "smtp.hiworks.com",
    port: 465,
    secure: true,
    passwordHint: "하이웍스 메일 환경설정 → 외부 메일 프로그램(POP3/SMTP) 사용을 켠 뒤 메일 비밀번호(또는 앱 비밀번호)를 넣으세요.",
    usernameIsEmail: true,
  },
  naver: {
    label: "네이버 메일",
    host: "smtp.naver.com",
    port: 465,
    secure: true,
    passwordHint: "네이버 메일 → 환경설정 → POP3/IMAP 설정에서 사용을 켜고, 2단계 인증 사용 시 ‘애플리케이션 비밀번호’를 넣으세요.",
    usernameIsEmail: false,
  },
  daum: {
    label: "다음(카카오) 메일",
    host: "smtp.daum.net",
    port: 465,
    secure: true,
    passwordHint: "다음 메일 → 환경설정 → IMAP/POP3 사용을 켜고 비밀번호를 넣으세요.",
    usernameIsEmail: true,
  },
  kakao: {
    label: "카카오메일",
    host: "smtp.kakao.com",
    port: 465,
    secure: true,
    passwordHint: "카카오메일 → 설정 → IMAP/SMTP 사용을 켜고 비밀번호를 넣으세요.",
    usernameIsEmail: true,
  },
  custom: {
    label: "기타 (직접 입력)",
    host: null,
    port: 465,
    secure: true,
    passwordHint: "회사 메일 관리자에게 SMTP 서버 주소·포트·보안(SSL/TLS) 설정과 발송 계정 비밀번호를 확인하세요.",
    usernameIsEmail: true,
  },
};

/** 화면에 보여 주는 계정 요약 — 비밀번호는 절대 포함하지 않는다 */
export type MailAccountView = {
  provider: MailProvider;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  username: string;
  fromEmail: string;
  isActive: boolean;
  verifiedAt: string | null;
  lastUsedAt: string | null;
  lastError: string | null;
  updatedAt: string;
};

export type MailAccountStatus = {
  /** 표 존재 여부 (마이그레이션 0018) */
  ready: boolean;
  /** 회사가 개인 계정 발송을 허용했는가 */
  allowed: boolean;
  account: MailAccountView | null;
  /** 서버에 암호화 키가 있는가 — 없으면 저장 불가 */
  canStoreSecrets: boolean;
};
