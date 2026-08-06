# 단계 19 — 배포 준비 · 운영 런북

작성: 2026-08-06 · 설계문서 13.4 / CLAUDE.md 2·3·5-2·14

이 문서는 castlog를 프로덕션에 올리기 위한 **재현 가능한 절차**와, 코드/DB로
자동화한 부분과 **사람이 자격증명·도메인을 쥐고 수행해야 하는 부분**을 구분한다.

## 0. 이번 단계에서 자동으로 끝낸 것 (검증 완료)

| 항목 | 상태 |
|---|---|
| 프로덕션 빌드 (`next build`) | ✅ 통과 (정적 14/14, 컴파일 성공) |
| 타입체크 `tsc --noEmit` / `next lint` | ✅ 통과 (기존 폰트 경고만) |
| Supabase 보안 어드바이저 **ERROR** | ✅ 0건 (아래 §1 참조) |
| 원격 마이그레이션 동기화 | ✅ 로컬 12개 == 원격 12개 (+ `portal_view_invoker`) |
| 전역 보안 헤더 | ✅ `next.config.mjs`에 HSTS·X-Frame-Options·nosniff 등 |

남은 어드바이저(비차단):
- **INFO** `tax_project_grants` 무정책 — **의도된 설계**. 이 테이블은 RLS로 전 세션
  접근을 차단하고 분리된 복호화 서비스(service_role)만 접근한다(CLAUDE.md 5).
- **WARN** 유출 비밀번호 보호 비활성 — 프로덕션 전환 시 대시보드에서 켠다(§4).

## 1. 보안 어드바이저 ERROR 해소 기록 (0010 security_definer_view)

단계 18에서 만든 `expert_portal_payments`는 `security_invoker=false`(DEFINER)라
Supabase 린터가 ERROR로 플래그했다. DEFINER 뷰는 밑단 RLS를 우회하므로,
명시적 필터가 있어도 거버넌스상 프로덕션에 남기지 않는다.

→ `20260806000003_portal_view_invoker.sql`에서 **INVOKER 뷰로 재설계**:
- 뷰를 `security_invoker=true`로 전환 → 호출자 RLS 적용.
- `expert_payment_items`(기존 `is_expert_self` SELECT 정책)·`tenants`(기존
  `tenants_select_linked_expert`)는 호출자 정책으로 자연 스코프.
- `expert_payment_batches`는 전문가 SELECT 정책이 없다(total_*·last_rejection_note
  누출 때문에 단계 18에서 의도적으로 제거). 배치의 **비민감 생애주기 필드**
  (status·paid_at·confirmed_at)만 전용 함수 `app.expert_batch_meta(uuid)`로 브리지.
  이 함수는 `set search_path=''` + "해당 배치에 본인 라인이 있는 전문가"에게만
  값을 반환(이중 방어). 합계·내부 반려사유는 어떤 경로로도 노출되지 않는다.

검증: 전문가 세션 시뮬레이션으로 뷰 조회 → 본인 2개 라인만(status/tenant 정상),
어드바이저 재실행 → ERROR 0건.

## 2. 환경변수 매트릭스 (Vercel Project Settings → Environment Variables)

**공개(클라이언트 번들 포함) — `NEXT_PUBLIC_` 접두사:**
| 키 | 값 출처 | 비고 |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase 프로젝트 URL | 공개 안전 |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon/publishable 키 | RLS로 보호, 공개 안전 |
| `NEXT_PUBLIC_BASE_URL` | `https://castlog.kr` | 공개 매직링크(/e /j /d /u) 생성 기준. **하드코딩 금지 원칙의 단일 진실원** |

**비밀(서버 전용) — 절대 `NEXT_PUBLIC_` 금지:**
| 키 | 값 출처 | 비고 |
|---|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase Settings→API | 노출 시 전체 데이터 유출. Preview/Prod만, 로그 금지 |
| `SECRETS_ENCRYPTION_KEY` | `openssl rand -base64 32` | 테넌트 SMS API 키 암호화. **분실=전 테넌트 재등록**. 한 번 정하면 회전 주의 |
| `RESEND_API_KEY` | Resend 대시보드 | 미설정 시 이메일 테스트 모드(기록만) |
| `RESEND_FROM` | `"CASTLOG <no-reply@castlog.kr>"` | 도메인 인증(SPF/DKIM) 후 |
| `SMS_TEST_MODE` | 프로덕션 `false` / 스테이징 `true` | true면 실발송 없이 기록만 |

주의: **`SECRETS_ENCRYPTION_KEY`와 `SUPABASE_SERVICE_ROLE_KEY`는 이 세션에 없다.**
사람이 직접 Vercel에 입력한다(챗·커밋·로그에 남기지 말 것).

## 3. Vercel 배포 (Git 연결 방식 권장)

MCP 자동화 한계: 사용 가능한 Vercel 도구로는 **환경변수 주입·GitHub 리포 연결·
도메인 연결**을 수행할 수 없다. 시크릿 없는 배포는 런타임이 깨진 더미가 되므로
(CLAUDE.md 14.7) 자동 배포하지 않고, 아래 절차를 사람이 1회 수행한다.

1. Vercel → Add New Project → Import `dalgme/castlog` (team: dalgme's projects).
2. Framework Preset: **Next.js** (자동 감지). Root: repo 루트.
3. Build Command 기본값(`next build`), Install `npm install`, Output 자동.
4. **Region: `icn1`(서울)** — Supabase 서울 리전과 동일 리전으로 지연·데이터 경계 정합.
5. Environment Variables: §2 매트릭스대로 Production/Preview에 입력.
6. Deploy → 프리뷰 URL에서 §6 스모크 테스트 → 문제없으면 Production Promote.
7. Preview 배포는 **Deployment Protection(Vercel Authentication)** 켜서 비공개 유지.

## 4. Supabase 프로덕션 설정 (대시보드)

1. **Auth → Password Security**: "Leaked password protection" **ON**(어드바이저 WARN 해소).
   직원 이메일 로그인 대상. 전문가는 SMS OTP라 무관.
2. **Auth → URL Configuration**: Site URL = `https://castlog.kr`,
   Redirect URLs에 프로덕션·프리뷰 도메인 추가.
3. **Auth → Providers**: 이메일(직원)만 사용. 불필요한 소셜 프로바이더 비활성.
   이메일 회원가입 자체 오픈 금지 — 계정은 테넌트 관리자 초대로만 생성(단계 8 정책).
4. **인증 OTP SMS Hook**(전문가): `supabase/functions/send-sms-hook` 배포 후
   Auth → Hooks → Send SMS에 훅 URL·시크릿 등록. 배포:
   ```
   supabase functions deploy send-sms-hook --project-ref tvltecsvtozijotmcoqs
   supabase secrets set --project-ref tvltecsvtozijotmcoqs \
     SOLAPI_API_KEY=... SOLAPI_API_SECRET=... SOLAPI_SENDER=... \
     SEND_SMS_HOOK_SECRET=v1,whsec_...
   ```
   훅 시크릿은 **fail-closed**(단계 18 A-4): 미설정 시 검증 실패로 발송 거부되므로
   반드시 `SEND_SMS_HOOK_SECRET`을 세팅해야 OTP가 나간다.
5. **Storage**: 민감서류 버킷 비공개·서명 URL(60초)만 열람(기존 정책 유지 확인).
6. **DB → Backups**: PITR/일일 백업 활성 확인(지급·세무 데이터 보존).

## 5. 도메인·DNS 컷오버 (castlog.kr)

1. Vercel Project → Settings → Domains → `castlog.kr`, `www.castlog.kr` 추가.
2. DNS(등록기관)에서 Vercel 안내대로 A/CNAME 설정. SSL 자동 발급 대기.
3. 인증서 발급·도메인 검증 완료 후 `NEXT_PUBLIC_BASE_URL=https://castlog.kr` 확정.
   **주의**: 이미 인쇄된 QR·발송된 문자의 공개링크는 회수 불가. base URL을 바꾸면
   기존 경로가 살아있도록 리다이렉트를 유지한다(CLAUDE.md 1-1).

## 6. 배포 후 스모크 테스트 (프로덕션 승격 전 프리뷰에서)

- [ ] 직원 이메일 로그인 → 대시보드 진입, 잘못된 테넌트 슬러그 접근 시 리다이렉트.
- [ ] 전문가 휴대폰 OTP 수신·로그인 → 포털 지급내역(뷰) 본인 라인만 표시.
- [ ] 공개링크 /e(섭외동의)·/j(전문가등록)·/d(서류제출)·/u(수신거부) 렌더·토큰 검증.
- [ ] 서류 업로드(리사이즈·용량 검증)·서명 URL 만료 동작.
- [ ] 결재 상신→승인 1건, 자기결재 차단 확인.
- [ ] 지급 배치 생성→(approvals 활성 시)품의→확정, 엑셀 내보내기.
- [ ] 보안 헤더 응답 확인: `curl -sI https://<preview> | grep -i "strict-transport\|x-frame"`.
- [ ] 응답에 service_role/암호화 키 문자열 부재, `_next/static`에 시크릿 부재.

## 7. 롤백 절차

- **앱(Vercel)**: 이전 배포로 즉시 롤백 — Deployments → 직전 정상 배포 → Promote.
  환경변수 변경이 원인이면 되돌린 뒤 재배포.
- **DB 마이그레이션**: 파괴적 롤백 금지(삭제보다 비활성화 원칙, CLAUDE.md 14.4).
  스키마 되돌림이 필요하면 **역방향 마이그레이션을 새로 작성**해 적용한다
  (`drop`으로 데이터 소실 금지). 이번 `portal_view_invoker`는 뷰·함수 교체라
  역방향도 `create or replace`로 안전.
- **Edge Function**: `supabase functions deploy`로 이전 버전 재배포. 시크릿은 유지.

## 8. 배포 후 남은 후속 과제

- **CSP 본격 도입**: 현재 `frame-ancestors 'none'`만. 서명 캔버스·Supabase·(Phase 2)
  지도 도메인을 실측해 script-src/connect-src를 좁힌 CSP를 Report-Only로 먼저 관찰
  후 강제 전환.
- 단계 18 문서의 **D-1~D-7**(tax_profiles grant 통일, tenants 컬럼 축소 뷰,
  approvals WITH CHECK 무결성 등) 별도 단계로 처리.
- **환경변수 유효성 서버 부팅 검증**: 필수 키 누락 시 명시적 실패(D-4, fail-closed 강화).
