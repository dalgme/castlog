# 섭외 사후보고 모드 — 설계 (2026-08-30 확정)

상태: **확정 — 제안대로 채택 (기본 특례 문턱 대리 · 금액 상한 없음 · 피드백은
프로젝트 배너 코랄 표기 · 보고는 확정 시 1회). 구현: 마이그레이션 0011 +
lib/integrations/engagement-post-report.ts + 기업관리 설정 카드.**

## 1. 요구

소규모 회사는 팀장·대리급이 섭외 후보를 정리한 뒤 **별도 승인 없이 섭외를
진행하고, 사후에 상급자에게 보고(확인·피드백 수준)** 한다. 인력·직급 구조상
사전 결재는 병목이다. 이 방식을 대표가 "CEO 설정"에서 켤 수 있어야 하며,
기존 6단계 권한·전결규정·릴레이 결재와 충돌하지 않아야 한다.

## 2. 지금 구조에서 부딪히는 지점

| 장치 | 현재 동작 | 사후보고와의 관계 |
|---|---|---|
| approvals 모듈 스위치 | 끄면 계획 품의 자체가 없음(`submitEngagementPlan`이 즉시 `plan_approved`) | 전부 없애는 것이라 "사후 보고"가 남지 않음. 지급 품의까지 사라짐 → 부적합 |
| 실행 권한(EXEC_FEATURES + tenant_exec_overrides) | `planSubmit`·`engagementRequest` 최소 직급 = 대리(회사별 조정 가능) | **그대로 둔다.** "누가 실행할 수 있나"는 이 축이 계속 판정 |
| 결재라인 결정(plan-actions `resolveLine`) | 직접 선택+임원 tail → 릴레이 → 임원선 → 전결규정 → 에스컬레이션 | **보고 수신자 결정에 그대로 재사용** — 새 라인 규칙을 만들지 않는다 |
| 전결규정(approval_rules, type='project') | 금액 구간별 결재선. 임원 계정이 있으면 사실상 폴백 | 규정이 **명시한 금액 구간은 규정 우선**(사전 품의)으로 충돌을 없앤다 |
| 계획 게이트(evaluatePlanGate / assertEngagementAllowed) | 계획 `approved` + 지문 일치 + 커버리지 안 세션만 발송 허용 | 게이트 함수는 손대지 않는다 — 사후보고는 계획을 **즉시 approved로 고정**할 뿐 |
| 부PM 게이트(project_action_requests) | 부PM은 PM 승인 1건 소진 후 실행 | 무관(프로젝트 내부 위임). 그대로 |
| 지급 품의(closing-actions) | 항상 사전 결재 | **변경 없음.** 돈이 나가는 결재는 사후보고 대상이 아니다 |

핵심 판단: **"승인"과 "보고"를 같은 문서 엔진(approvals)에 태우되 문서의 성격만
다르게 한다.** 결재 목록·내 차례 배지·대결·릴레이·감사로그가 전부 재사용되고,
상급자는 늘 보던 화면에서 확인·피드백한다.

## 3. 설계

### 3-1. 설정 (CEO 설정 = 기업관리 > 권한·결재, approvals 위임 스코프)

`tenants.feature_flags.engagement_post_report` (JSON, 미설정 = 꺼짐):

```json
{
  "enabled": true,
  "min_grade": "deputy",      // 이 직급 이상만 사후보고로 진행 (기본: 대리)
  "max_amount": 3000000,      // 계획 섭외비 상한 (null = 무제한). 초과 시 사전 품의
}
```
전결규정('프로젝트' 유형)이 잡는 금액 구간은 **항상 사전 품의**다 (설정 불가, 코드 고정).

- 켜고 끄기·상한 변경은 **개정 이력**(audit_logs `tenant.post_report_mode`)에 남긴다(§14-5).
- 실행 권한(`planSubmit`)은 별개다. 사후보고 `min_grade`는 그 위에 얹는 **특례 문턱**:
  `planSubmit` 문턱은 넘지만 `min_grade`에 못 미치는 직원은 지금처럼 사전 품의로 간다.

### 3-2. 판정 — 사전 품의 vs 사후보고 (서버 단일 함수)

`lib/integrations/engagement-post-report.ts` → `decidePlanFlow(tenantId, requester, amount)`:

```
1. 모드 꺼짐                                   → pre_approval
2. 상신자 직급 < min_grade                      → pre_approval
3. max_amount 있고 amount > max_amount          → pre_approval
4. rule_priority && matchApprovalRule('project', amount) 존재 → pre_approval
5. 그 외                                       → post_report
```

화면 버튼과 서버 액션이 같은 함수를 본다(라벨: "섭외 품의 상신" ↔ "섭외 확정 (사후보고)").
왜 사전 품의로 떨어지는지 사유를 버튼 아래에 적는다(§12-9). 세션을 부분 선택하면 금액이
달라지므로 대화상자가 선택할 때마다 `previewPlanFlow`로 다시 판정해 문구를 맞추고,
사후보고 확정은 2단계 확인(§14-3)을 거친다. 상신 결과(즉시 확정 / 사전 품의)는 토스트로 알린다.

### 3-3. 사후보고 흐름

```
후보 배정 완료 → [섭외 확정 (사후보고)]
  ├ engagement_plans: status='approved', approved_at=now, submitted_by=나   (지문·커버리지 고정)
  ├ projects.engagement_stage='plan_approved'  (기존 단계 기계 그대로)
  ├ approvals 1건 생성: approval_kind='report', 결재선 = resolveLine(...)   ← 보고 수신자
  │    · 릴레이 ON → 직급 단계 / OFF → 상무이사→대표 고정선 / 임원 없음 → 에스컬레이션
  └ audit_logs 'engagement_plan.post_report'
→ 승인 목록 및 섭외 진행 탭에서 바로 섭외 문자 발송
→ 상급자: 전자결재 [내 차례]에 "사후보고" 배지로 표시 → [확인] 또는 [피드백]
```

보고 문서의 처리 의미:

| 행위 | 사전 품의(decision) | 사후보고(report) |
|---|---|---|
| 승인 | 계획 approved·단계 전이 | **확인** — 문서만 종결, 계획·단계 변화 없음 |
| 반려 | 계획 draft 복귀·단계 assigning | **피드백** — 사유 필수, `engagement_plans.feedback_note`에 (작성자 표기로) 누적 기록. **문서를 종결하지 않고 다음 단계(고정 임원 tail 포함)로 계속 전달**된다 — 팀장 피드백 한 번으로 임원이 섭외를 모르게 되지 않는다. **되돌리지 않는다** (이미 문자가 나갔을 수 있다). 상신자 알림은 화면 표시(프로젝트 배너·섭외 진행 탭·결재 목록)로 대신하며 별도 푸시는 없다 |
| 회수(상신 취소) | 아무도 처리 전이면 가능 | **불가** — 보고가 사라지면 승인도 보고도 없는 확정 섭외가 된다 |
| 결재 훅(`onEngagementPlanApprovalResolved`, `onProjectEngagementApprovalResolved`) | 동작 | `approval_kind='report'`면 **건너뜀** |

보완(추가) 품의·변경 품의도 같은 판정을 탄다 — 추가 세션 금액을 합산해 상한을 다시 본다.

### 3-4. 데이터 변경 (추가 전용·멱등, 0011)

- `approvals.approval_kind text not null default 'decision' check in ('decision','report')`
- `engagement_plans.feedback_note text`, `engagement_plans.flow text default 'pre_approval'` ('pre_approval'|'post_report' — 통계·감사용)
- RLS 변경 없음(approvals 정책이 그대로 적용). 신규 컬럼 참조 코드는 42703 폴백.

### 3-5. 화면

- **기업관리 > 권한·결재**: "섭외 사후보고 모드" 카드 — 스위치, 최소 직급 select, 금액 상한, 안내
  ("지급 품의는 그대로 사전 결재", "전결규정이 잡는 구간은 사전 품의"). 켤 때 2단계 확인(§14-3).
- **섭외후보 등록**: 버튼 라벨·다이얼로그 문구 분기("확정 즉시 발송 가능, 상급자에게 사후보고 문서가 갑니다").
  사전 품의로 떨어지는 경우 사유 표기.
- **승인 목록 및 섭외 진행**: 리비전 상태에 "사후보고(확인 대기/확인 완료/피드백)" 표시, 피드백 문구 노출.
- **전자결재**: 목록·상세에 "사후보고" 배지, 버튼 "확인"/"피드백", 상세 문구 "이 문서는 승인이 아니라 확인입니다".
  내 차례 배지에는 포함(확인이 필요한 일이므로).
- 대시보드·임원 현황: "확인 대기 사후보고 N건" 타일(선택).

### 3-6. 충돌·경계 점검

- 6단계 권한: 실행은 `planSubmit`/`engagementRequest` 그대로, 특례 문턱은 위에 얹음 → 낮아지는 권한 없음.
- 전결규정: `rule_priority`로 규정이 명시한 구간은 사전 품의 → 규정을 무력화하지 않음.
- 릴레이: 보고 수신자 라인에 그대로 사용 → 두 스위치가 독립적으로 조합됨(릴레이 ON+사후보고 = 직급 단계 확인).
- 임원 고정(30번): 보고 라인의 tail도 상무이사→대표 → 임원이 모르는 섭외가 생기지 않음.
- 지급 품의·주민번호(계약 게이트): 무관. 전문가 수락 = 계약 성립 원칙 유지.
- 모듈: approvals 모듈이 꺼진 회사는 지금처럼 문서 없이 진행(모드 자체가 의미 없음 → 설정 카드 숨김).
- 모드 전환 시 진행 중 문서: 켜기 전 사전 품의 건은 그대로 결재, 끈 뒤 남은 보고 문서는 확인만 남음.

### 3-7. 대안 검토 (제외)

- **알림만 보내고 문서를 만들지 않는다** — 확인·피드백 이력이 남지 않아 "보고"가 되지 않음. 제외.
- **approvals 모듈 OFF로 대체** — 지급 품의까지 사라지고 보고도 없음. 제외.
- **전결규정에 '0단계 규칙'을 넣어 자동 승인** — 규정 테이블 의미가 오염되고 보고 수신자가 없음. 제외.

## 4. 구현 규모 (확정 시)

마이그레이션 1건(0011) + 설정 카드·액션 + `decidePlanFlow` + plan-actions/position-assign-actions 분기 +
approvals 액션의 report 분기(반려→피드백, 훅 스킵) + 라벨·배지 5화면. 1개 배치, 리뷰 포함 반나절~1일.

## 5. 확정이 필요한 질문

1. 기본 특례 문턱: **대리(deputy)** 로 둘지, 팀장(team_lead)으로 둘지.
2. 금액 상한 기본값: 없음(무제한)으로 두고 회사가 정하게 할지.
3. 피드백(반려에 해당)이 왔을 때 화면 강조 수준: 프로젝트 단계 배너에 코랄 표기 정도면 충분한지.
4. 보고 시점: 섭외 **확정 시 1회**(제안)인지, 회신 결과가 모이면 **자동 갱신 요약**까지 넣을지(2차).
