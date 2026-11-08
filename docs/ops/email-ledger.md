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

## 한계·주의

- '열람 확인'은 공급자의 열람 추적(이미지 픽셀) 기준이다. 이미지 차단 메일 앱에서는 열람해도 잡히지 않는다 → "읽지 않았다"의 근거로 쓰지 않는다.
- 0016 적용 이전에 보낸 메일은 project_id가 없어 대장에 나오지 않는다(발송 메뉴 최근 기록에서 확인).
- 수신 상태 갱신은 service_role로만 이뤄진다(웹훅). 앱 사용자 세션은 email_logs를 읽기만 한다.
- 데이터레지던시: Resend는 미국 인프라 — docs/decisions/email-residency.md 의 교체 계획은 그대로다. 국내 어댑터로 바꾸면 웹훅 라우트도 그 공급자용으로 하나 더 둔다(이벤트 → delivery_status 매핑만 다르다).
