# 비즈로그 설계 초안

작성일: 2026-09-09 · 대상: 별도 레포(Python) · 계약: bizlog-contract.md

## 0. 한 줄 요약

캐스트로그의 **지급 확정 내역**을 당겨와, 로컬에만 두는 **회계·인사·경영정보**와
결합하는 소기업용 로컬 프로그램. 주민번호는 직원·주주에 한해 암호화 보유하고,
전문가 주민번호는 절대 받지 않는다.

## 1. 단계

| 단계 | 내용 | 완료 기준 |
|---|---|---|
| 1 | 캐스트로그 엑셀 '연동' 시트 임포터 + `cl_*` 미러 + 조회 CLI | 같은 파일 두 번 넣어도 중복 0건 |
| 2 | `biz_employees` + 키 관리 + 원천징수영수증 생성 | 평문이 DB·로그에 없음을 테스트가 증명 |
| 3 | 전표·계정과목 + 지급 건 ↔ 전표 연결 | 전표 발행 후 원천 변경 시 차이 화면 표시 |
| 4 | 퇴사 처리·파기 일정·월간 로그 검토 | 퇴사 순서 강제 테스트 통과 |
| 5 | 주주명부·주식변동명세 | 명부 본체에 주민번호 없음 |
| 6 | (캐스트로그 2단계 API 후) 토큰 당김 + 이체 완료 밀어 올림 | — |

각 단계마다 실제로 쓰이는지 확인하고 다음으로 간다.

## 2. 테이블

접두어가 원천이다. `cl_`은 캐스트로그 미러(임포터만 씀), `biz_`는 이 프로그램의 원천.

### 2-1. 미러 (`cl_`)

```sql
cl_projects      (castlog_project_id TEXT PK, code, name, synced_at)
cl_experts       (castlog_expert_id  TEXT PK, name, synced_at)
                 -- 연락처·계좌·주민번호 칼럼 없음. 이름은 표시용
cl_payments      (castlog_item_id    TEXT PK,
                  castlog_batch_id, castlog_engagement_id,
                  castlog_project_id → cl_projects, castlog_expert_id → cl_experts,
                  payment_type,               -- business_income | other_income | business
                  gross, income_tax NULL, local_tax NULL, withholding, net,
                  status,                     -- confirmed | paid | canceled
                  confirmed_at, paid_at,
                  synced_at, source_confirmed_at)
```

### 2-2. 원천 (`biz_`)

```sql
biz_employees    (employee_no TEXT PK,        -- 화면·검색·조인은 전부 이것
                  name, hired_at, left_at NULL, status,   -- active | left
                  castlog_user_email NULL,    -- 캐스트로그 계정 연결(선택)
                  rrn_enc BLOB NULL,          -- AES-GCM, 화이트리스트 ①
                  rrn_masked TEXT NULL,       -- 890101-1******
                  purge_due_at NULL)          -- left_at + 보존기간
biz_shareholders (shareholder_no TEXT PK, name, address, share_class, shares,
                  employee_no NULL → biz_employees,   -- 직원 겸 주주면 연결
                  rrn_enc BLOB NULL,          -- 화이트리스트 ②
                  rrn_masked, purge_due_at)
biz_vouchers     (voucher_no PK, date, account_code, debit, credit, memo,
                  castlog_item_id NULL → cl_payments,
                  snapshot_gross, snapshot_withholding, snapshot_net,  -- 전표 시점 고정
                  snapshot_confirmed_at)
biz_accounts     (account_code PK, name, kind)
biz_transfers    (transfer_no PK, castlog_item_id → cl_payments,
                  transferred_at, bank_ref, fee, pushed_to_castlog_at NULL)
biz_doc_templates(template_id PK, name, rrn_required INTEGER DEFAULT 0)
```

### 2-3. 보안·운영

```sql
biz_key_holders  (holder_no PK, employee_no → biz_employees,
                  wrapped_master BLOB, kdf_salt BLOB, kdf_params TEXT,
                  created_at, revoked_at NULL)
biz_access_logs  (id PK, at, holder_no, subject_kind,   -- employee | shareholder
                  subject_no, action,                   -- generate | view
                  doc_kind NULL, reason_code, reason_text, watermark_id)
                  -- 2년 보존. 계정 삭제와 무관하게 남긴다
biz_import_logs  (id PK, at, filename, sheet, rows_in, rows_upserted, rows_skipped)
biz_purge_logs   (id PK, at, subject_kind, subject_no, approved_by, reason)
```

## 3. 키 관리

```
권한자 비밀번호 ──Argon2id──▶ KEK ──unwrap──▶ 마스터키 ──▶ rrn_enc 복호화
(저장 안 함)     (salt는 DB)   (메모리만)    (메모리만, N분 후 폐기)
```

- 마스터키는 한 개. 권한자마다 자기 비밀번호로 감싼 사본(`biz_key_holders`)을 갖는다.
  둘 중 하나만 있으면 열린다 — 에스크로 없이 이중화.
- 프로그램 시작 시 비밀번호 1회 입력 → 마스터키 메모리 보관 → 유휴 N분(기본 10) 후
  폐기, 다음 복호화 때 재입력.
- 디스크는 BitLocker/FileVault. 파일 권한 600. DB 파일만 복사해 가면 못 읽는다.
- `keyring`은 salt·파라미터가 아니라 **"마지막으로 잠근 시각" 같은 부가정보**에만.
  마스터키를 OS 키체인에 그대로 넣으면 로그인된 PC에서 자동으로 열려 "자리 비움"
  방어가 사라진다 — 비밀번호 입력을 유지한다.

## 4. 주민번호 흐름

**생성 경로(기본):**
```python
def generate_withholding_receipt(employee_no, year, *, holder, reason) -> Path:
    log_access(holder, "employee", employee_no, "generate", "원천징수영수증", reason)
    rrn = _decrypt_rrn(employee_no)          # 이 함수 안에서만 존재
    try:
        return _render_receipt(..., rrn=rrn)  # 파일 생성
    finally:
        del rrn                                # 리턴하지 않는다
```
- 생성된 파일은 `out/` 에 두고 **제출 후 삭제**를 안내한다. 프로그램이 보관하지 않는다.

**조회 경로(예외):**
- 사유 코드(목록: 주식변동명세 작성 / 세무서 소명 / 4대보험 정정 / 기타) + 서술 필수
- 화면에 `조회자 · 시각` 워터마크, 30초 후 자동 재마스킹
- `biz_access_logs.action = 'view'`

**월간 검토:** 매월 1일 첫 실행 시 지난달 `biz_access_logs`를 대표 화면에 띄운다.
확인 버튼을 누르기 전에는 다른 작업으로 넘어가지 않는다.

## 5. 서류별 주민번호 필요 여부

| 서류 | 주민번호 | 근거 | 비고 |
|---|---|---|---|
| 원천징수영수증 | 필요 | 소득세법 §164 | 생성 경로 |
| 원천징수이행상황신고서 | 필요 | 소득세법 §128 | 소득세·지방소득세 분리 |
| 지급명세서 (직원) | 필요 | 소득세법 §164 | 생성 경로 |
| 지급명세서 (전문가) | **캐스트로그가 생성** | §5 | 비즈로그는 받지도 저장하지도 않음 |
| 4대보험 취득·상실 신고 | 필요 | 각 법 | 생성 경로 |
| 연말정산 | 필요 | 소득세법 §137 | 홈택스 간소화 활용 시 접점 축소 |
| 주식등변동상황명세서 | 필요 (주주) | 법인세법 §119 | 사업연도 종료 후 1회 |
| 주주명부 | **불필요** | 상법 §352 기재사항 아님 | §396 열람청구 대비 본체에 넣지 않음 |
| 근로계약서 | 불필요 | 근로기준법 §17 | 생년월일로 충분 |
| 재직·경력증명서 | 불필요 | — | `rrn_required=0` 기본 |
| 보안·청렴서약서 | 원칙 불필요 | — | 발주처 요구 시 생성 후 사본 미보관 |

## 6. 퇴사 처리 절차 (코드가 순서를 강제)

1. `biz_employees.status = left`, `left_at`, `purge_due_at = left_at + 보존기간` 계산
2. 캐스트로그 계정 연결이 있으면 비활성화 안내 (2단계 API 전에는 사람이 손으로)
3. 그 사람이 `biz_key_holders`에 있으면:
   a. 남은 활성 권한자가 1명 이하면 **후임 지정을 먼저 요구** (진행 차단)
   b. 후임 비밀번호로 새 래핑 추가
   c. 퇴사자 래핑 `revoked_at` 기록
   d. **남은 권한자 전원 비밀번호 교체 + 마스터키 교체 + `rrn_enc` 전건 재암호화**
      — 퇴사자가 알던 비밀번호로는 복사본도 열리지 않게
4. `biz_access_logs`는 그대로 둔다 (2년)
5. 퇴직자의 주민번호는 **삭제하지 않는다** — `purge_due_at`까지 보존 (재발급·정정 대응)

## 7. 파기

- 매월 첫 실행 시 `purge_due_at <= today` 목록 표시 → 대표 확인 → `rrn_enc`·`rrn_masked`
  NULL 처리 + `biz_purge_logs` 기록. 레코드 자체(이름·재직기간)는 남긴다.
- 보존기간 기본값: 직원 5년(원천징수 관련이 근로자명부 3년보다 길다), 주주는
  주식 처분 후 5년. 설정 테이블로 조정 가능.

## 8. 임포트 (1단계)

```
bizlog import payments <xlsx>
  → 시트 '연동' 읽기
  → 지급ID 기준 upsert (cl_payments), 프로젝트ID·전문가ID upsert
  → status=canceled 인 건은 cl_payments.status 갱신만 (삭제 안 함)
  → 전표가 이미 있는 건: snapshot_* 과 새 값이 다르면 '차이' 목록에 추가
  → biz_import_logs 기록
```

## 9. 테스트 (처음부터)

- `test_schema_guard.py` — 전 테이블 칼럼명에 `rrn|jumin|resident|ssn` 이 화이트리스트
  두 곳 밖에 없음, 전 TEXT 칼럼 값에 `\d{6}-?\d{7}` 패턴 없음
- `test_import_idempotent.py` — 같은 파일 2회 임포트 → 행 수 불변
- `test_no_plaintext.py` — 문서 생성 후 로그·DB 덤프에 평문 주민번호 없음
- `test_offboarding_order.py` — 권한자 1명 남는 상태에서 퇴사 처리 시 차단
- `test_mirror_readonly.py` — 임포터 외 경로에서 `cl_*` 쓰기 시 예외
