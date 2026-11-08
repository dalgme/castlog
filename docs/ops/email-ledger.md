# 이메일 대장 · 수신 상태 웹훅 (2026-11-08)

기획 지시: 섭외·수락서 메일을 **보내기 전에 미리 보고**(강조 표시 포함), PL이 **프로젝트별 '이메일 대장'** 에서
담당자들이 보낸 모든 메일의 발송 내용과 수신 여부를 확인할 수 있게 한다. 마이그레이션 0016.

## 구성

| 조각 | 위치 | 역할 |
|---|---|---|
| 메일 작성기 | `lib/email/mail-templates.ts` | 섭외 요청(단건·묶음)·수락서 안내의 **text + html** 을 같은 함수로 만든다. 서버·클라이언트 공용(순수 함수). 회신 마감은 붉게, 금액·일정은 굵게, 링크는 버튼. 머리는 회사 이름(§16) |
| 발송 | `lib/email/send.ts` → `lib/email/provider.ts` | html 전송, 공급자 메시지 id(provider_message_id) 기록, 이메일 대장 연결(project_id·engagement_ids·purpose·body_html) |
| 미리보기 | `projects/[projectId]/mail-preview-actions.ts` + `components/integrations/message-preview.tsx` | 발송 대상·입력값으로 실제 작성기를 돌려 전문가별 메일(iframe)·문자를 보여 준다. 링크는 자리표시 |
| 대장 | `lib/integrations/mail-ledger.ts` + `mail-ledger-tab.tsx` (프로젝트 탭 '이메일 대장') | 발송자·수신자·종류·제목·발송 상태·수신 상태·내용(HTML/평문)·엑셀 내보내기 |
| 웹훅 | `app/api/webhooks/resend/route.ts` | Resend(Svix 서명) 이벤트로 `delivery_status`·`delivered_at`·`opened_at`·`bounced_at` 갱신 |

## 운영 설정 (Resend)

1. Resend 대시보드 → Webhooks → Endpoint 추가: `https://castlog.kr/api/webhooks/resend`
2. 이벤트: `email.sent`, `email.delivered`, `email.delivery_delayed`, `email.bounced`, `email.complained`, `email.opened`, `email.clicked`
3. 서명 비밀(`whsec_…`)을 Vercel 환경변수 `RESEND_WEBHOOK_SECRET`에 넣고 재배포.
4. 비밀이 없으면 웹훅 요청은 401로 거부된다(서명 없는 수신 상태는 조작 가능). 이때 대장은 발송 성공 여부만 보이고
   화면에 설정 안내가 뜬다.

## 발신자 표시 (2026-11-08 개정)

- 수신함의 보낸 사람은 **"회사명 · 담당자 이름 (담당자 이메일)"** 으로 보인다. 예: `"렛츠 · 김성민 (kim@lets.co.kr)" <no-reply@castlog.kr>`.
  답장(Reply-To)은 담당자 이메일로 간다. 발신 **주소**는 인증 도메인(castlog.kr)이어야 SPF/DKIM/DMARC를 통과하므로 env(EMAIL_FROM) 주소를 그대로 쓴다.
- 담당자의 실제 회사 주소를 발신 주소로 쓰려면 그 회사 도메인을 메일 공급자에 인증(SPF/DKIM)해야 한다 — 테넌트 도메인 작업(§1-1 tenant_domains)과 함께 다룬다.
- 섭외 요청 메일에는 **수락 / 거절 버튼**이 있다. 버튼은 `/e/{token}?intent=accept|decline` 로 열리며 확인 화면에서 한 번 더 눌러야 확정된다 — 메일 스캐너가 링크를 자동으로 열어도 계약이 성립하지 않는다.

## 직원 개인 메일 계정 발송 (2026-11-08, 렛츠 요구 — 마이그레이션 0018)

- 회사 스위치: 설정 > 발송 > '이메일 발송 — 직원 개인 계정' (대표 또는 sending 위임자). `tenant_email_settings.personal_mail_allowed`.
- 직원 설정: 설정 > 내 설정 > '내 메일 계정으로 발송' — 메일 서비스 프리셋(네이버웍스·Google·하이웍스·네이버·다음·카카오·기타), 메일 주소, 앱 비밀번호.
  **저장 = 실제 로그인 확인 + 본인 주소로 테스트 메일 1통 성공**일 때만 저장·활성(`user_mail_accounts.verified_at`). 비밀번호는 AES-256-GCM 암호화, 재표시 없음, 본인 행만 RLS.
- 발송(`lib/email/send.ts`): 회사 허용 + 본인 계정 활성·검증이면 **nodemailer SMTP로 직원 계정에서** 나간다(From = 직원 주소, 보낸편지함에 남음).
  실패하면 플랫폼 계정으로 **자동 폴백**하고 대장에 "개인 계정 발송 실패 → 플랫폼 계정" 사유를 남기며 계정 행 `last_error`에 기록한다. 광고성 발송·연습모드는 개인 계정을 쓰지 않는다.
- 개인 계정 발송은 공급자 웹훅이 없어 전달·열람 추적이 되지 않는다 — 대장에 "개인 계정 — 추적 없음"으로 표시.
- 메일 서비스별 전제: 네이버웍스는 관리자가 외부 메일 앱(IMAP/SMTP)을 허용하고 사용자가 앱 비밀번호를 발급해야 한다. Google은 2단계 인증 + 앱 비밀번호. 로그인 비밀번호로는 되지 않는다.
- 운영 환경 전제: 서버리스(Vercel)에서 SMTP 465/587 아웃바운드가 열려 있어야 한다. 연결 제한 시간 12초.

## 후속 확인·마무리 목록 (2026-11-08 기록 — 추후 다시 확인)

사용자 지시: "메일 관련하여 작업 남아있는 것은 추후 다시 확인/마무리". 아래가 그 목록이다. 끝나면 줄을 지우지 말고 ✅와 날짜를 적는다.

| # | 항목 | 상태 | 비고 |
|---|---|---|---|
| M1 | **Resend 웹훅 등록 + `RESEND_WEBHOOK_SECRET`** (운영 설정, 넥스트랩 명의 1회) | ⬜ 미설정 | 설정 전까지 이메일 대장은 발송 성공 여부만 표시. 절차는 위 '운영 설정' 절 |
| M2 | **렛츠 직원 개인 계정 연결 실동작 확인** — 첫 직원의 '저장하고 테스트 발송' 결과 | ⬜ 미확인 | 이 개발 환경은 SMTP 아웃바운드 차단. 실패 시 표시 사유(로그인/연결)로 원인 판정. letsedu.kr 메일 호스트 미확인(프리셋 선택에 따름) |
| M3 | **Vercel 서버리스에서 SMTP 465/587 아웃바운드 동작 확인** | ⬜ 미확인 | M2와 함께 확인. 막히면 포트 587(STARTTLS) 또는 공급자 API 어댑터로 대안 |
| M4 | **묶음 섭외 메일(/b)의 수락/거절 버튼** — 현재 단일 버튼(건별 선택 필요) | ⬜ 보류 | 건별 수락/거절 링크(`/b/{token}?pick=…`) 설계 뒤 결정 |
| M5 | **담당자 회사 주소를 발신 주소로** (현재 표시 이름 + Reply-To) | ⬜ 보류 | 회사 도메인 SPF/DKIM 인증 필요 — 테넌트 자체 도메인 작업(§1-1 tenant_domains)과 함께 |
| M6 | **발주처 검토 링크 문자·메일 자동 발송** | ⬜ 보류 | 발주처 담당자 연락처 표 설계 선행 (docs/decisions/engagement-review-flow.md §3) |
| M7 | **국내 메일 공급자 어댑터**(데이터레지던시) | ⬜ 보류 | docs/decisions/email-residency.md. 전환 시 웹훅 라우트도 그 공급자용 추가 |
| M8 | 개인 계정 발송의 **전달·열람 상태** 미제공 안내가 충분한지 사용자 피드백 확인 | ⬜ 미확인 | 필요하면 IMAP '보낸편지함' 확인 링크 안내 정도만 |
| M9 | 이메일 대장 — **0016 이전 발송분**은 프로젝트 미연결(대장에 없음) 안내 유지 여부 | ⬜ 확인 | 필요 시 engagement_ids 기준 소급 연결 스크립트 |

## 한계·주의

- '열람 확인'은 공급자의 열람 추적(이미지 픽셀) 기준이다. 이미지 차단 메일 앱에서는 열람해도 잡히지 않는다 → "읽지 않았다"의 근거로 쓰지 않는다.
- 0016 적용 이전에 보낸 메일은 project_id가 없어 대장에 나오지 않는다(발송 메뉴 최근 기록에서 확인).
- 수신 상태 갱신은 service_role로만 이뤄진다(웹훅). 앱 사용자 세션은 email_logs를 읽기만 한다.
- 데이터레지던시: Resend는 미국 인프라 — docs/decisions/email-residency.md 의 교체 계획은 그대로다. 국내 어댑터로 바꾸면 웹훅 라우트도 그 공급자용으로 하나 더 둔다(이벤트 → delivery_status 매핑만 다르다).
