# 전문가 포털 점검 결과 + 단계 21·26 보류 기록

작성일: 2026-08-12
판정 근거: 사용자 지시 — "21단계, 26단계는 잠시 보류로 기록하고 다음 과제들을
수행하세요! 그리고 특히 전문가들의 로그인 후 대시보드와 데이터 송수신/인증/연동/
권한 등이 제대로 구현되어야 합니다"

## 1. 보류 기록 (Hold)

| 단계 | 내용 | 상태 | 사유 |
|------|------|------|------|
| 단계 21 | 네이버웍스 연동 (BYO 커넥터) | **보류** | 사용자 지시. 외부 커넥터 계약·인증 선결 필요 |
| 단계 26 | AI 음성 업무보고/지시 PoC (임원) | **보류** | 사용자 지시. AI 경계(14-1) 재검토 후 별도 착수 |

두 단계는 삭제가 아니라 보류다(작업 목록에 `[보류]`로 표기, 상태 pending 유지).
재개 시 이 문서를 갱신한다.

## 2. 전문가 포털 점검 결과 (Audit)

전문가 로그인 → 대시보드 → 데이터 송수신 → 연동 → 권한 전 구간을 코드·DB(RLS)
양면에서 점검했다. 결론: **핵심 구현은 정상이며 테넌트/전문가 격리가 RLS로
강제되고 있다.** 세부 확인 항목:

### 2.1 인증 (Authentication)
- 전문가 계정은 **휴대폰 OTP 기반**(설계문서 3.2)으로 일관.
  - 등록: `/j/{token}` → `signInWithOtp(shouldCreateUser=true)` (유효 초대 토큰 필수)
  - 로그인: `/expert/login` → `signInWithOtp(shouldCreateUser=false)` (기존 계정만)
  - 최초 로그인 시 `role=expert`를 **비어 있을 때만** 스탬핑(기존 role 미덮어씀).
- 프로덕션 SMS 발송 훅(`send-sms-hook` Edge Function)이 ACTIVE — 실 발송 경로 확보.
- 미들웨어: `/expert/*` 미인증 접근은 `/expert/login`으로 리다이렉트(레이아웃 가드와 이중).

### 2.2 대시보드 (Dashboard)
- `/expert` — 프로필 카드 + 연결 기업 + 지급 내역(최근 10건).
- 전문가 프로필 미존재 시 안전한 빈 상태 안내.
- 서브 경로 링크: 섭외 요청(`/expert/engagements`), 서류함(`/expert/documents`),
  프로필 수정(`/expert/profile`).

### 2.3 데이터 송수신 (Data flow)
- 섭외 응답: RLS(`is_expert_self`)로 본인 건만 조회·응답. 만료·중복 응답 방지.
- 서류 업로드: 용량·확장자 서버 검증 → service_role 버킷 업로드 → 실패 시 고아 파일 정리
  → 기존 동일 유형 `replaced` 이력 보존 → 감사 로그.
- 서류 열람: RLS로 권한 판정, service_role **만료 서명 URL(60초)**, 전 건 감사 로그.
- 프로필/소득유형 수정: RLS(`experts_update_self`, `expert_tax_profiles_write`) 본인 행만.

### 2.4 연동 (Integration)
- 섭외 수락 = 계약 성립 → 등록 서명·날인으로 섭외수락서 자동 생성(멱등, 실패 무해화).
- 지급 내역은 안전 컬럼 전용 뷰 `expert_portal_payments`로만 노출.

### 2.5 권한·격리 (Permissions / Isolation) — 핵심
- 점검 대상 전 테이블 RLS 활성 확인: experts, expert_documents,
  expert_document_grants, expert_tenant_links, expert_engagements,
  expert_tax_profiles, expert_evaluations, engagement_acceptances,
  document_requests, consents, audit_logs.
- `expert_portal_payments` 뷰는 **`security_invoker=true`** — 하위 테이블
  `expert_payment_items`의 RLS가 그대로 적용된다.
  - SELECT 정책: `tenant_id = app.tenant_id() OR app.is_expert_self(expert_id)`
  - 전문가 세션은 `app.tenant_id()`가 없어 **본인 지급 건만** 노출 →
    타 전문가·타 테넌트 합계·반려사유 유출 없음(설계문서 3.2·CLAUDE.md 4 준수).
- `app.is_expert_self(uuid)`는 `experts.auth_user_id = auth.uid()`로 판정(STABLE, SECURITY DEFINER).

## 3. 발견된 실무 갭 (Gap) — 데모 전문가 로그인 불가

- 데모 시드 전문가 `박현우`(expert@demo.castlog.kr)는 **이메일 계정으로 시드**되어
  **휴대폰 번호가 없다**(`auth.users.phone = null`).
- 전문가 포털 로그인은 **휴대폰 OTP 전용**이므로, 이 계정으로는 로그인 자체가 불가.
- 즉, 코드 결함이 아니라 **시드 데이터가 실제 모델(휴대폰 기반)과 불일치**한 문제.
- 실 운영 경로(전문가가 `/j` 링크로 자기 휴대폰 등록 → 로그인)는 정상 동작.

### 조치 방향(사용자 결정 필요)
1. (권장) 실 휴대폰으로 `/j` 링크 등록 후 로그인 — 프로덕션 정확, 즉시 가능.
2. 데모 전문가 `박현우`에 휴대폰 번호를 부여해 시드 정합성 확보(테스트용).
3. Supabase 테스트 OTP(고정 번호↔고정 코드) 매핑으로 데모 로그인(대시보드 설정 필요).
