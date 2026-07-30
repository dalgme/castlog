# CASTLOG 캐스트로그

창업교육·창업컨설팅 기업을 위한 멀티테넌트 B2B SaaS — 프로젝트 관리부터 전자결재까지, 한 번에.

- 설계 기준: 설계문서 v1.8 · Phase 1 실행계획서 v1.4
- 작업 규칙: [CLAUDE.md](./CLAUDE.md) (멀티테넌시·민감정보·발송 분리 등 하드 규칙 포함)

## 기술 스택

| 영역 | 선택 |
|---|---|
| 프레임워크 | Next.js 14 App Router + TypeScript (strict) |
| 스타일 | Tailwind CSS + shadcn/ui (수동 벤더링) + Pretendard |
| DB / 인증 | Supabase (서울 리전) — RLS 멀티테넌시, tenant_id는 JWT app_metadata |
| 호스팅 | Vercel |

## 시작하기

```bash
npm install
cp .env.example .env.local   # Supabase 키·base URL 입력
npm run dev
```

DB 스키마는 `supabase/migrations/`의 SQL을 Supabase 프로젝트(서울 리전)에 순서대로 적용한다.

### SMS 구조 (CLAUDE.md 5-2 — 플랫폼 일괄 공급 안 함)

- **업무·광고 SMS**: 테넌트별 BYO 공급자 — 각 테넌트가 공급자(솔라피/알리고/NHN 등)와
  자사 API 키·발신번호를 등록해 발송 (어댑터 + `tenant_sms_configs`, 단계 14).
- **인증 OTP**(전문가 로그인·등록): 전역 발송 — Supabase Send SMS Hook
  (`supabase/functions/send-sms-hook`) → 플랫폼 운영사(넥스트랩) 솔라피 계정.
  현재는 개발용 스텁이 배포되어 있으며 단계 14에서 실연동으로 교체한다.
  개발·테스트는 대시보드 Test Phone Numbers로 진행한다(Hook 미경유).
- 신규 전문가 가입은 등록 링크(`/j`)로만 이뤄지며 로그인 OTP는 기존 계정에만
  발송된다(`shouldCreateUser=false`).

### 최초 플랫폼관리자 부트스트랩 (1회)

직원·관리자 계정은 셀프 가입이 없다. 첫 플랫폼관리자만 수동으로 만든다:

1. Supabase 대시보드 → Authentication → Users → **Add user** (이메일·비밀번호)
2. SQL Editor에서 역할 스탬핑:
   ```sql
   update auth.users
   set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb)
     || '{"role":"platform_admin"}'::jsonb
   where email = '관리자이메일';
   ```
3. `/login` 로그인 → `/platform-admin`에서 테넌트 생성 시작

이후 테넌트·기업총괄관리자·직원 계정은 전부 화면에서 생성한다.

## 기능 모듈 구조 (테넌트별 선택 사용)

플랫폼 기능은 "공통 기반 + 선택 모듈 3축"으로 나뉘며, 각 테넌트는 모듈을
하나만 쓰거나 조합해 쓸 수 있다 (CLAUDE.md 1-2).

| 축 | 내용 |
|---|---|
| 공통 기반 (항상 활성) | 계정·권한, 테넌트 설정, 발송 인프라, 감사로그 |
| `experts` | 전문가 섭외·관리 — 풀·등록·서류·섭외·지급/세무 |
| `approvals` | 품의·전자결재 — 품의서·결재라인·전결규정·대결 |
| `operations` | 프로젝트·행사 운영 — 21스텝·일정·공개링크 |

활성 여부는 `tenants.feature_flags.modules`(JSONB)로 관리하며 미설정 시 전부
활성이다. 모듈 게이트는 서버에서 강제한다 (`lib/modules`).

## 라우팅 구조

| 경로 | 대상 |
|---|---|
| `/` | 랜딩페이지 (Claude Design v2 시안) |
| `/{tenant-slug}/dashboard` | 직원·관리자 대시보드 |
| `/{tenant-slug}/admin/org` | 기업총괄관리자 |
| `/platform-admin` | 플랫폼관리자 (전역) |
| `/expert` | 전문가 포털 (전역 — 테넌트 비종속) |
| `/e /j /d /u` + `/{token}` | 공개 매직링크 (섭외동의·전문가등록·서류제출·수신거부) |

테넌트 슬러그는 영문 소문자 kebab-case만 허용하며 a~z 단일 문자 26개 전부와
시스템 경로가 예약어로 차단된다 (`lib/routing/reserved-slugs.ts`).

## Phase 1 진행 현황 (실행계획서 기준)

- [x] 단계 1 — 프로젝트 초기화 (TS strict, shadcn/ui, Pretendard)
- [x] 단계 2 — Supabase 클라이언트 3종 + tenant_id 주입 구조
- [x] 단계 3 — 라우팅 셸 + 공개 경로 + 슬러그 검증 + 디자인 토큰 + 랜딩 포팅
- [x] 단계 4 — DB 1차 마이그레이션 + RLS (로컬 PG16에서 격리 검증 완료, 원격 적용 완료)
- [x] 단계 5 — 인증 흐름 (직원 이메일 `/login` · 전문가 휴대폰 OTP `/expert/login` · 미들웨어+레이아웃 이중 가드)
- [x] 단계 6 — 전문가 소유 신원 모델 (등록 링크 `/j/{token}` · 기업 전문가 목록 · 전문가 포털 프로필/연결 · 활성 테넌트 전환)
- [x] 단계 6.5 — 기능 모듈 구조 (테넌트별 experts/approvals/operations 선택 사용, `lib/modules`)
- [x] 단계 7 — 서류함 (비공개 버킷·만료 서명 URL·기업별 열람 허용·전 건 열람 로그. 자동파기 스케줄러는 단계 16)
- [x] 단계 8 — 테넌트 생성(모듈 조합 선택)·직원 계정·직급 관리 (임시 비밀번호 1회 표시, 초대 메일은 단계 14)
- [x] 단계 9 — 프로젝트 기본 구조 (사업연도 축·기본 21스텝 라이프사이클·스텝 상태 관리)
- [ ] 단계 10~19 — 실행계획서 참조

## 브랜드 디자인 토큰

`app/globals.css`의 CSS 변수로 관리한다. `--brand-*`는 테넌트 화이트라벨
런타임 주입 지점이므로 컴포넌트에 색상값을 하드코딩하지 않는다.

| 토큰 | 값 | 용도 |
|---|---|---|
| `--brand` | `#246BFF` | 프라이머리 블루 |
| `--brand-navy` | `#0B1D3A` | 딥 네이비 |
| `--brand-sky` | `#6CA8FF` | 라이트 블루 |
| `--brand-amber` | `#FFB000` | 앰버 |
