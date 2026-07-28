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

전문가 휴대폰 OTP 로그인은 Supabase 대시보드에서 Phone 인증 활성화와
SMS Hook(알리고/NHN Cloud 연동, 단계 14) 설정이 필요하다. 신규 전문가 가입은
등록 링크(`/j`)로만 이뤄지며 로그인 OTP는 기존 계정에만 발송된다(`shouldCreateUser=false`).

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
- [ ] 단계 6 — 전문가 소유 신원 모델
- [ ] 단계 7 — 서류 업로드·암호화·자동파기
- [ ] 단계 8~19 — 실행계획서 참조

## 브랜드 디자인 토큰

`app/globals.css`의 CSS 변수로 관리한다. `--brand-*`는 테넌트 화이트라벨
런타임 주입 지점이므로 컴포넌트에 색상값을 하드코딩하지 않는다.

| 토큰 | 값 | 용도 |
|---|---|---|
| `--brand` | `#246BFF` | 프라이머리 블루 |
| `--brand-navy` | `#0B1D3A` | 딥 네이비 |
| `--brand-sky` | `#6CA8FF` | 라이트 블루 |
| `--brand-amber` | `#FFB000` | 앰버 |
