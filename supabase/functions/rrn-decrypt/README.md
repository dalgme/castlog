# rrn-decrypt (주민등록번호 복호화 서비스) — Phase 2.3 스캐폴드

플랫폼 전체에서 **유일한 복호화 주체**. 메인 앱은 복호화 능력이 없고, 이 서비스에
**1건 단위 서명 요청**만 보낸다. 설계: `docs/decisions/rrn-phase2-secure-subsystem.md`.

## ⚠️ 아직 배포하지 않는다 (활성화 게이트)

아래가 모두 충족되기 전에는 배포·활성화하지 않는다:

1. **저장소 B(별도 Supabase 프로젝트, 서울) 프로비저닝** — 뒷조각(`rrn_fragments_back`)
   전용. 메인 DB와 물리 분리, 별도 자격증명·별도 키.
2. **Edge Function 시크릿 설정**
   - `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` (메인 DB — 앞조각·요청·로그)
   - `RRN_STORE_B_URL` / `RRN_STORE_B_SERVICE_KEY` (저장소 B — 뒷조각)
   - `RRN_SERVICE_SHARED_SECRET` (메인 앱 ↔ 서비스 상호 인증)
3. **Argon2id 파라미터·핀 고정**, 조회 비밀번호 유도키 검증 경로 테스트.
4. **지급명세서 파일 생성**(기본 경로) 구현 + 전문가 통지 배선.

## 현재 구현된 보안 불변식 (스캐폴드)

- 서비스 상호 인증(`x-rrn-service-secret`) 실패 시 거부
- `tax_access_requests.approval_id`(승인된 지급 결재) 미연결 시 거부 — 상시 조회 없음
- 프로젝트당 2회 한도(초과는 대표 승인 필요), 시간당 상한 + 자동 잠금
- 조회 성공 시 `tax_access_logs` 기록(파일 생성도 조회로 간주) + 전문가 통지(배선 예정)

## 활성화 전까지의 동작

저장소 B 미연결 상태에서는 복호화를 수행하지 않고 `501`(scaffold)로 응답한다.
메인 앱에는 이 서비스를 호출하는 "조회하기" UI를 노출하지 않는다(더미 금지, §14-7).
