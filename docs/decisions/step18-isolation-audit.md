# 단계 18 — 실사이클 테스트 + 테넌트 격리·권한 감사 기록

작성: 2026-08-06 · 설계문서 13.4 / CLAUDE.md 3·5·7·11·14

전체 코드베이스를 3축(① service_role 클라이언트 사용처, ② 서버 액션·라우트 권한,
③ RLS 정책·함수 커버리지)으로 감사하고, 로컬에 테넌트 B(`rival`)를 만들어 실제
교차 접근을 시도했다. 이 문서는 발견·판정·조치를 심각도 순으로 남긴다.

## 0. 런타임 교차 접근 테스트 결과 (테넌트 A=demo → B=rival)

로그인한 A 관리자 세션으로 B 자원 접근을 전수 시도. **누출 0건.**

| 시도 | 결과 |
|---|---|
| `/rival`, `/rival/projects`, `/rival/approvals`, `/rival/admin/org/*` | 307 → 내 슬러그(`/demo/...`)로 리다이렉트 (middleware) |
| `/demo/projects/{B의 project id}` | 404 (RLS가 타 테넌트 행 차단) |
| `/demo/approvals/{B의 approval id}` | 404 (RLS) |
| `/rival/*/export` (엑셀) | 307 리다이렉트 — B 데이터 미포함 |
| org_admin → `/platform-admin`, `/platform-admin/usage` | 307 → `/` (역할 게이트) |

슬러그는 표시용, 권한 경계는 JWT `app_metadata.tenant_id` 기반 RLS임을 재확인.
빌드 산출물(.next/static)에 `service_role`·`SECRETS_ENCRYPTION_KEY` 문자열 없음,
`.env*.local` 미추적, `NEXT_PUBLIC_*`에 민감값 없음.

## 1. 이번 단계에서 수정한 결함

### 🔴 R-1. 전문가의 섭외 의뢰비용 직접 수정 → 지급액 조작
`expert_engagements_update` RLS의 WITH CHECK이 "본인 섭외인가"만 재검증해
전문가가 PostgREST로 `fee_amount`를 올리면 그대로 지급 라인에 반영되었다
(`payments/actions.ts`가 `engagement.fee_amount`로 gross/withholding/net 산출).
→ **BEFORE UPDATE 트리거 `app.guard_engagement_expert_update()`**: 자사 관리자
세션이 아니면 status·responded_at·response_note 외 컬럼 변경을 예외로 차단.
로컬 검증: 전문가 세션 `fee_amount` UPDATE → 예외, `status='accepted'` → 성공.

### 🔴 R-2. 전문가에게 지급 배치 전체 행 노출
`expert_payment_batches_select_expert`가 배치에 본인 라인이 있으면 그 행 전체
(타 전문가 합계 `total_*`, 내부 반려사유 `last_rejection_note`)를 노출했다.
→ 정책 철회 + **안전 컬럼 전용 뷰 `expert_portal_payments`**(security_invoker=false,
`app.is_expert_self` 필터) 신설. 포털 페이지를 이 뷰 조회로 교체.
로컬 검증: 전문가 세션 `select * from expert_payment_batches` → 0행, 뷰는 본인 라인만.

### 🟠 R-3. 전문가의 연결 테넌트 이전 (임의 테넌트 이동)
`expert_tenant_links_update_expert`가 `is_expert_self`만 검사해 전문가가 자기 링크의
`tenant_id`를 초대받지 않은 테넌트로 바꿀 수 있었다(연결 목록 오염 + 자동 노출).
→ **트리거 `app.guard_link_immutable_keys()`**: tenant_id·expert_id 변경 전면 차단.
로컬 검증: 전문가 세션 링크 `tenant_id` 변경 → 예외.

### 🟠 R-4. sms/email 로그 전문이 staff에게 노출
`sms_logs_select`/`email_logs_select`가 `tenant_id`만 검사해 자사 전 직원(staff 포함)이
수신번호·본문 전량을 열람했다(INSERT는 이미 관리자 이상).
→ SELECT에 `app.user_role() in ('org_admin','manager')` 역할 게이트 추가.

### 🔴 A-1. 기업측 서류 열람 라우트 무가드
`experts/documents/[documentId]/view/route.ts`에 `requireRole`·`requireModule` 부재.
experts 모듈 비활성 테넌트의 직원도 URL 직접 호출로 통장사본·신분증 서명 URL 발급 가능.
→ `requireRole(["platform_admin","org_admin","manager"])` + `requireModule("experts")` 추가
(형제 export 라우트와 동일 패턴). staff 제외 — CLAUDE.md 5절(지급 단계 열람) 정합.

### 🔴 A-2. 자기결재(self-approval) 가능
전결규정 미매칭 유형에서 상신자가 자신을 단독 결재자로 지정 후 즉시 승인 가능.
→ `validateLineSteps`에 상신자==결재자 차단 추가. 상신 시점에 검사하므로 수동라인·규정
매칭 경로 모두에서 걸린다(규정 정의 시점에는 상신자 맥락이 없어 건너뜀).

### 🟠 A-3. 직원 계정의 전문가 등록으로 인한 역할 혼선
`/j` 등록이 현재 세션 사용자가 이미 다른 테넌트의 직원(role 보유)인지 검사하지 않아,
직원 계정에 전문가 링크가 붙으면 role 유지한 채 타 테넌트 접근이 열렸다.
→ `/j` 등록 시 `app_metadata.role`이 존재하고 `expert`가 아니면 거부(별도 계정 안내).
→ `lib/auth/switch-tenant.ts`(현재 미배선)에도 `role==='expert'` 가드 + role 명시 고정 선반영.

### 🟠 A-4. send-sms-hook 서명검증 fail-open
`SEND_SMS_HOOK_SECRET` 미설정 시 `return true`로 검증을 생략 → 훅 URL을 아는 제3자가
운영사 발신번호로 임의 문자 발송 가능.
→ `return false`(fail-closed)로 변경.

### 🟡 A-5. 오픈 리다이렉트 (백슬래시 우회)
`sanitizeNextPath`가 `/\evil.com`류 백슬래시 경로를 통과시켰다.
→ 제어문자(0x00–0x1F)·역슬래시 포함 시 거부. 하이픈·정상 경로는 유지.

## 2. 후속 과제로 남긴 항목 (별도 단계 권고)

DB 뷰 재설계·플로우 영향 분석이 필요해 이번 단계 범위 밖으로 분리한다. 모두
**테넌트 교차 노출이 아닌 테넌트 내부 컬럼 과다노출/구조 개선**이라 우선순위 하위.

- **D-1. `expert_tax_profiles` grants 우회** — 연결만으로 `business_registration_number`
  열람. 다른 서류는 `expert_document_grants` 경유인데 이 테이블만 링크 기반. 지급·세무
  플로우 영향 확인 후 grant 모델로 통일 필요.
- **D-2. `tenants` 전체 행이 연결(pending 포함) 전문가에게 노출** — 전문가는 name·logo만
  필요하나 BRN·plan·contract까지 열림. 컬럼 제한 뷰로 좁힐 것.
- **D-3. `approvals`/`approval_steps` UPDATE WITH CHECK 컬럼 무결성** — 결재자가 승인
  권한으로 title/amount/approver 등을 변경 가능(테넌트 내 한정). 트리거로 불변 강제 권고.
- **D-4. `hasSupabaseEnv()` fail-open** — 환경변수 누락 시 인증·모듈 게이트가 통과.
  현재 모든 호출자가 fail-closed로 감싸 실피해 없음. 단계 19(배포) 환경변수 검증으로 대응.
- **D-5. `retention_policies` anon SELECT**(플랫폼 기본값 4행), **`tenant_sms_configs`
  `for all`이 SELECT 포함**, **DEFINER 함수 3종 `search_path=''` 미적용** — 저위험, 정리 대상.
- **D-6. `/j` 번호 미지정 링크** — `invited_phone` null이면 링크 소지자 누구나 연결 획득.
  발급 UX에서 번호 필수화 또는 만료·1회성 강화 권고.
- **D-7. 광고성 발송 대상 필터가 세션 클라이언트로 `ad_consents` 조회** → RLS상 항상 빈
  배열 → 광고 발송 불가(기능 결함, fail-closed라 보안 문제 아님). 발송 파이프라인 점검 시 수정.

## 3. 잘 되어 있는 부분 (회귀 방지 기준)

- `tenant_id`를 JWT `app_metadata`에서만 읽는 원칙이 전 액션에서 예외 없이 지켜짐.
- 32개 테이블 전부 RLS 활성, `user_metadata`/`using(true)` 참조 0건.
- `audit_logs` 3중 방어(정책 부재 + BEFORE UPDATE/DELETE 트리거 + revoke).
- 공개 매직링크(/e /j /d /u) 전부 SHA-256 해시 대조, 원문 미저장. `/e`는 모듈 게이트까지.
- 서명 URL 60초 만료 + 열람 전건 audit_logs.
- `confirmBatchSimple`이 approvals 활성 테넌트에서 스스로 거부해 결재 우회 봉쇄.
- 결재 차례·대결 유효기간이 액션과 RLS 양쪽에 중복 구현.
