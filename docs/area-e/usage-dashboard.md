# AI 사용량 대시보드

> 모든 영역의 AI 호출은 단 하나의 테이블 `ai_usage_log` 에 쌓이고, 영역 E는 이 로그를 집계해 "이번 달 무엇을 얼마나 썼고 크레딧을 얼마나 소모했는지" 보여 주는 전사(全社) 사용량 가시화 화면을 책임진다.

## 1. 한 줄 정의와 이 페이지가 답하는 면접 질문

AI 사용량 대시보드는 **`ai_usage_log` 한 테이블을 기능별로 집계해, 사용자에게 "이번 달 AI 사용 현황"을 보여 주는 조회 화면**이다. 결제 화면(`Billing.tsx`)의 `usage` 탭이 그 본체다.

이 페이지가 답할 수 있어야 하는 면접 질문:

- "여러 영역의 AI 기능 사용량을 어떻게 한곳에서 집계하나요?"
- "사용량 집계의 단일 근거(source of truth)는 무엇이고 왜 그렇게 두었나요?"
- "토큰과 크레딧은 어떤 관계이고, 화면에서 어떻게 보여 주나요?"
- "사용자 대시보드와 관리자 사용량 화면은 어떻게 다른가요? 현재 어디까지 구현돼 있나요?"

핵심 어휘를 미리 못 박아 둔다.

| 용어 | 의미 |
| --- | --- |
| `ai_usage_log` | 모든 영역의 AI 호출 1건 = 1행. 공동 소유 테이블 |
| `feature_type` | 호출한 AI 기능 식별자(예: `JOB_ANALYSIS`, `CORRECTION_SELF_INTRO`) |
| `token_usage` / `credit_used` | 호출의 토큰 합계 / 환산 크레딧 |
| `UsageRow` | "기능 1종에 대한 이번 달 집계 한 줄" DTO |

## 2. 왜 이렇게 설계했나 (의도·트레이드오프)

### 2-1. 사용량을 "한 테이블"로 모은 이유

AI 기능은 6개 영역(A~F)에 흩어져 있다. 만약 영역마다 사용량 테이블을 따로 두면, "이 사용자가 이번 달 AI를 얼마나 썼나"를 알려면 6개 테이블을 join 해야 한다. 그래서 **모든 AI 호출이 `ai_usage_log` 한 테이블에 기록**되도록 했다. 영역 E의 첨삭 기능도 예외가 아니라서, 첨삭 도메인은 자기 전용 로그 테이블을 만들지 않고 `applicationcase` 도메인의 `AiUsageLog` 클래스를 **재사용**해 같은 테이블에 쌓는다.

이 한 테이블이 두 가지를 동시에 떠받친다.

1. **사용량 가시화** — 이 페이지의 주제. `GROUP BY feature_type` 한 번이면 전사 집계가 끝난다.
2. **과금의 단일 근거** — 크레딧/사용권 차감 엔진도 이 로그를 차감의 근거로 본다(설계). 즉 "보여 주는 숫자"와 "돈 빠지는 근거"가 같은 행이라, 둘이 어긋날 수 없다.

:::tip 왜 "로그를 단일 근거로" 두는 게 중요한가
사용량 표시와 과금이 서로 다른 데이터를 보면, "화면엔 10회 썼다는데 크레딧은 12회분 빠진" 식의 불일치가 생긴다. 같은 `ai_usage_log` 행을 둘 다 보면 그런 모순이 구조적으로 불가능하다.
:::

### 2-2. 트레이드오프

- **장점:** 영역이 늘어도 집계 코드는 그대로다. 새 기능은 `feature_type` 문자열만 추가하면 자동으로 대시보드에 잡힌다.
- **비용:** `feature_type` 이 문자열이라 표시 라벨 매핑(`FEATURE_LABEL`)을 프런트가 따로 관리해야 한다. 매핑에 없는 코드는 코드 문자열 그대로 노출된다(아래 5절의 실제 갭).
- **공동 소유의 리스크:** 한 테이블을 6개 영역이 함께 쓰므로, 컬럼 변경은 영역 E 단독으로 못 한다(공통 영역 = 팀장 승인 대상).

## 3. 어떤 기술로 구현했나 (실제 클래스·테이블 근거)

### 3-1. 집계 쿼리 — `BillingMapper.monthlyUsage`

사용자 대시보드의 데이터 한 줄은 전부 이 SQL 하나에서 나온다.

```sql
-- mapper/billing/BillingMapper.xml  (monthlyUsage)
SELECT feature_type                  AS featureType,
       COUNT(*)                      AS used,
       COALESCE(SUM(credit_used), 0) AS creditUsed
  FROM ai_usage_log
 WHERE user_id = #{userId}
   AND created_at >= #{from}        -- 이번 달 1일 0시
 GROUP BY feature_type
 ORDER BY used DESC
```

세 가지를 한 번에 한다. (1) `feature_type` 별 그룹핑, (2) 호출 횟수(`COUNT(*)`), (3) 크레딧 합계(`SUM(credit_used)`, NULL은 0으로). `created_at >= 이번 달 1일` 로 월 단위를 자른다.

### 3-2. 기간 경계 — `BillingServiceImpl.getMonthlyUsage`

```java
public List<UsageRow> getMonthlyUsage(Long userId) {
    LocalDateTime monthStart =
        LocalDate.now().withDayOfMonth(1).atStartOfDay();   // 이번 달 1일 0시
    return billingMapper.monthlyUsage(userId, monthStart);
}
```

여기서 쓰는 "이번 달 1일 0시"는 **캘린더 월** 경계다. 주의할 점: 사용권(티켓) 시스템의 "혜택 기간"은 구독이 있으면 구독 기간을 쓰지만(영역 E의 `currentBenefitPeriod`), 이 사용량 집계는 구독과 무관하게 항상 달력 월로 자른다. 즉 **사용량 표시 기간과 혜택 차감 기간이 반드시 일치하지는 않는다** — 면접에서 종종 파고드는 포인트다.

### 3-3. 전송 DTO — `UsageRow`

```java
// billing/dto/UsageRow.java — "기능 1종, 이번 달 집계 한 줄"
public class UsageRow {
    private String featureType;  // 예: CORRECTION_SELF_INTRO
    private int    used;         // 호출 횟수
    private int    creditUsed;   // 크레딧 합계
}
```

쿼리 결과가 그대로 `UsageRow` 리스트로 매핑되고, `ApiResponse<List<UsageRow>>` envelope에 담겨 프런트로 간다.

### 3-4. 로그가 쌓이는 지점 — `CorrectionAiUsageLogService`

대시보드가 집계하려면 먼저 로그가 쌓여야 한다. 영역 E의 첨삭 호출은 이 서비스가 로그를 남긴다. 두 가지 설계 포인트가 있다.

```java
@Transactional(propagation = Propagation.REQUIRES_NEW)   // ① 별도 트랜잭션
public Long recordSuccess(...) { /* status=SUCCESS, creditUsed(totalTokens) */ }

@Transactional(propagation = Propagation.REQUIRES_NEW)
public Long recordFailure(...) { /* status=FAILED, creditUsed=0 */ }

private int creditUsed(int totalTokens) {                 // ② 토큰→크레딧 환산
    if (totalTokens <= 0) return 0;
    return Math.max(1, (int) Math.ceil(totalTokens / 1000.0));  // 1000토큰당 1, 최소 1
}
```

① **`REQUIRES_NEW`** — AI 호출이 실패해 본 트랜잭션이 롤백돼도, 실패 로그(`status=FAILED`, `credit_used=0`)는 독립적으로 커밋된다. 그래서 대시보드는 성공뿐 아니라 "시도했지만 실패한" 흔적도 빠짐없이 본다(감사 추적).
② **토큰→크레딧 환산식** `max(1, ceil(totalTokens / 1000))` — 이 값이 `ai_usage_log.credit_used` 에 기록되고, 대시보드의 `creditUsed` 가 곧 이 값들의 합이다.

## 4. 동작 원리 (흐름·표·작은 코드)

### 4-1. 로그 생성 → 집계 → 화면 (전체 흐름)

```text
[AI 호출]  CorrectionService.create() …등 각 영역의 AI 서비스
   │  성공: recordSuccess(featureType, usage)  → ai_usage_log (SUCCESS, credit_used=ceil(tok/1000))
   └  실패: recordFailure(featureType, msg)    → ai_usage_log (FAILED,  credit_used=0)
                                   │
                                   ▼
[집계]  GET /billing/usage → getMonthlyUsage(userId)
        → monthlyUsage SQL: WHERE user_id, created_at>=달1일  GROUP BY feature_type
                                   │  List<UsageRow>
                                   ▼
[화면]  Billing.tsx  usage 탭
        FEATURE_LABEL[featureType] · used회 · 크레딧 creditUsed
        Progress 바 = used / (화면 내 최대 used) × 100
```

### 4-2. 프런트 렌더 — `Billing.tsx` 의 usage 탭

화면은 `getMonthlyUsage()` 가 준 `UsageRow[]` 를 그대로 그린다. 핵심 로직 두 줄.

```tsx
// 막대 길이의 기준 = "이번 달 가장 많이 쓴 기능" (절대 최대치가 아니라 상대 비율)
const max = Math.max(...usage.map((r) => r.used), 1);
...
<span>{FEATURE_LABEL[row.featureType] ?? row.featureType}</span>
<span>{row.used}회 · 크레딧 {row.creditUsed}</span>
<Progress value={Math.round((row.used / max) * 100)} />
```

여기서 알아 둘 두 가지:

- **Progress 바는 상대 비율이다.** "전체 한도 대비 몇 %"가 아니라 "이번 달 내 기능들 중 1등 대비 몇 %"다. 즉 가장 많이 쓴 기능은 항상 막대가 꽉 찬다. 절대 한도 게이지가 아니라 **분포 시각화**임에 유의.
- **라벨은 매핑 우선, 없으면 코드 그대로.** `FEATURE_LABEL[코드] ?? 코드` 라서, 매핑에 없는 `feature_type` 은 영문 코드가 그대로 노출된다.

### 4-3. 옆 카드 — 보유 크레딧

usage 탭은 좌측 2/3가 기능별 막대, 우측 1/3이 **보유 크레딧 카드**(`billing?.creditBalance ?? 0`)다. "이번 달 얼마나 썼나(로그 집계)"와 "지금 잔액이 얼마인가(`users.credit`)"를 한 화면에 나란히 둬서, 충전 동선(`충전하러 가기` → `?tab=credits`)으로 자연스럽게 잇는다.

### 4-4. 로딩 정책

usage 데이터는 인증 사용자만 보인다. `Billing.tsx` 는 로그인 시 `loadMine()` 에서 `Promise.all([getMyBilling, getMonthlyUsage, getMyPayments])` 로 한 번에 받고, **실패하면 조용히 무시**(빈 배열)한다. 그래서 비로그인/실패 시엔 "로그인하면 이번 달 AI 사용량이 표시됩니다" 안내만 뜬다.

## 5. 구현 상태 — 됨 vs 계획 (정직한 구분)

| 항목 | 상태 | 근거 |
| --- | --- | --- |
| `ai_usage_log` 기능별 월 집계 쿼리 | ✅ 구현 | `BillingMapper.monthlyUsage`, `UsageRow` |
| 사용자 대시보드(usage 탭) 실 API 연동 | ✅ 구현 | `Billing.tsx` `getMonthlyUsage` 호출 |
| 토큰→크레딧 환산 기록 | ✅ 구현 | `creditUsed = max(1, ceil(tok/1000))` |
| 실패 호출도 로그에 남김 | ✅ 구현 | `recordFailure` + `REQUIRES_NEW` |
| 첨삭 라벨이 사용자 대시보드에 표시 | ⚠️ 부분 | `Billing.tsx` 의 `FEATURE_LABEL` 에 `CORRECTION_*` 없음 → 코드 문자열로 노출 |
| 관리자 사용량 화면에 E(첨삭) 포함 | ⚠️ 미포함 | 관리자 AI 사용량 화면은 area B 4종만(`FEATURE_OPTIONS`: JOB_ANALYSIS / COMPANY_RESEARCH / JOB_POSTING_OCR / JOB_POSTING_METADATA) |
| 사용량 기반 요금제 추천(#28) | ❌ 미구현 | 추천 산출 서비스 없음, 정책 seed row만 존재 |
| 사용량과 실제 크레딧 차감 연결 | ❌ 미배선 | 차감 엔진은 test에서만 호출 — 로그는 쌓이나 잔액은 안 빠짐 |

이 표에서 면접에 가장 중요한 세 가지를 짚는다.

:::warning ① 라벨 갭 — 첨삭은 코드 문자열로 보인다
사용자 결제 화면의 `FEATURE_LABEL` 매핑에는 area B/D/A 계열 라벨만 있고 **`CORRECTION_*` 4종이 없다.** 그래서 첨삭을 쓰면 사용량 표에 `CORRECTION_SELF_INTRO` 같은 영문 코드가 그대로 뜬다. (한글 첨삭 라벨은 `Pricing.tsx` 의 비교표에는 정의돼 있으나, 대시보드 매핑과는 별개다.) "왜 안 보이냐"가 아니라 "라벨 매핑이 분산돼 있고 대시보드 쪽이 아직 안 채워졌다"가 정확한 설명이다.
:::

:::warning ② 관리자 사용량 화면은 area B 전용이다
관리자 AI 사용량 페이지는 `admin/features/job-analysis/pages/AdminAiUsagePage.tsx`(=area B 폴더)에 있고, 필터(`FEATURE_OPTIONS`)가 공고/기업/OCR/메타데이터 4종뿐이다. 즉 **전사 로그를 다 보는 통합 관리자 사용량 콘솔은 아직 없다.** E의 첨삭/사용량 전용 관리자 화면(`admin/correction`, `admin/credit`)은 빈 패키지(`package-info.java`)다.
:::

:::warning ③ "본다" ≠ "빠진다"
대시보드는 `credit_used` 합을 보여 주지만, **실제 크레딧/사용권 차감은 일어나지 않는다.** 차감 엔진(`deductByAiUsageLog`, `consumeByFeature`, `AiChargeService.charge`)은 완성·테스트 통과 상태지만 운영 코드 어디서도 호출되지 않는다(전부 `src/test` 에서만 호출). 그래서 지금은 로그(`ai_usage_log`)와 결과 행(`correction_request`)만 쌓이고 `users.credit` 은 줄지 않는다. 대시보드의 `creditUsed` 는 "만약 차감했다면 이만큼"의 예상치에 가깝다.
:::

## 6. 면접 답변 3단계

1. **무엇:** "AI 사용량 대시보드는 모든 영역의 AI 호출이 쌓이는 `ai_usage_log` 한 테이블을 기능별로 집계해, 사용자에게 이번 달 사용 현황을 보여 주는 조회 화면입니다. 결제 화면의 usage 탭이 본체입니다."
2. **어떻게:** "`BillingMapper.monthlyUsage` 쿼리가 `WHERE user_id, created_at >= 이번 달 1일` 로 자르고 `GROUP BY feature_type` 으로 호출 횟수와 크레딧 합계를 한 번에 냅니다. 결과는 `UsageRow` 리스트로, 프런트는 기능별 막대와 보유 크레딧 카드로 그립니다. 막대는 절대 한도가 아니라 그 달 내 최대 사용 기능 대비 상대 비율입니다."
3. **왜·한계:** "사용량 표시와 과금이 같은 `ai_usage_log` 행을 보게 해 둘이 어긋날 수 없게 한 게 핵심 설계입니다. 다만 현재는 차감 경로가 운영에 배선되지 않아 로그만 쌓이고 잔액은 줄지 않으며, 관리자 통합 사용량 콘솔과 첨삭 라벨 매핑은 아직 미완입니다."

## 7. 꼬리질문 + 모범답안

::: details Q1. 여러 영역의 AI 사용량을 어떻게 한곳에서 봅니까?
모든 영역의 AI 호출이 `ai_usage_log` 한 테이블에 1건=1행으로 기록되기 때문입니다. 영역마다 로그 테이블을 따로 두지 않고, 첨삭(E)도 `applicationcase` 도메인의 `AiUsageLog` 를 재사용해 같은 테이블에 씁니다. 그래서 집계는 `GROUP BY feature_type` 한 번으로 끝나고, 영역이 늘어도 집계 코드는 바뀌지 않습니다.
:::

::: details Q2. Progress 막대가 "이번 달 한도"를 의미하나요?
아니요. 막대 기준은 `Math.max(...usage.map(r => r.used), 1)` 즉 "그 달 가장 많이 쓴 기능의 호출 수"입니다. 한도 대비 소진율이 아니라 기능 간 분포 시각화라, 1등 기능은 항상 막대가 꽉 찹니다. 한도 게이지로 바꾸려면 플랜 혜택 수량(`subscription_benefit_policy.quantity`)을 분모로 가져와야 하는데, 현재 화면은 그렇게 하지 않습니다.
:::

::: details Q3. 사용량의 기간 경계는 어떻게 정합니까? 혜택 기간과 같나요?
사용량은 항상 `LocalDate.now().withDayOfMonth(1)`, 즉 캘린더 월 1일 0시로 자릅니다. 반면 사용권(티켓) 차감의 "혜택 기간"은 활성 구독이 있으면 구독 기간을 쓰고 없을 때만 달력 월을 씁니다(`currentBenefitPeriod`). 그래서 구독 주기가 월초가 아니면 사용량 표시 기간과 혜택 소진 기간이 어긋날 수 있고, 이는 의도된 단순화입니다.
:::

::: details Q4. 실패한 AI 호출도 사용량에 잡히나요? 크레딧은요?
잡힙니다. `recordFailure` 가 `status=FAILED`, `credit_used=0` 으로 로그를 남기되, `@Transactional(REQUIRES_NEW)` 라 본 트랜잭션이 롤백돼도 실패 로그는 독립 커밋됩니다. 따라서 대시보드의 호출 횟수(`COUNT(*)`)에는 실패도 포함되지만 크레딧 합계(`SUM(credit_used)`)에는 실패가 0으로 들어가 영향이 없습니다. "실패한 호출은 무료"라는 과금 원칙이 집계에도 그대로 반영됩니다.
:::

::: details Q5. 화면에 보이는 크레딧만큼 잔액이 줄어드나요?
지금은 줄지 않습니다. `creditUsed` 는 `ai_usage_log.credit_used` 의 합일 뿐이고, 실제 차감을 수행하는 `deductByAiUsageLog`/`AiChargeService.charge` 는 운영 경로에 연결돼 있지 않습니다(테스트에서만 호출). 차감 엔진 자체는 원자적(`WHERE credit >= X`)·멱등(`uq(ai_usage_log_id, type)`)으로 완성돼 있어, 배선만 하면 동작합니다. 그래서 현재 대시보드 숫자는 "차감했다면 이만큼"의 예상치 성격입니다.
:::

::: details Q6. 첨삭 사용량이 표에 영문 코드로 뜨는 이유는?
사용자 대시보드(`Billing.tsx`)의 `FEATURE_LABEL` 매핑에 `CORRECTION_*` 4종이 아직 없어, `FEATURE_LABEL[코드] ?? 코드` 규칙에 따라 `CORRECTION_SELF_INTRO` 같은 원본 코드가 그대로 노출되기 때문입니다. 라벨 매핑이 화면별로 분산돼 있고(비교표는 `Pricing.tsx` 에 정의) 대시보드 쪽 매핑이 미완인 갭입니다. 매핑에 4줄만 추가하면 해소됩니다.
:::

::: details Q7. 관리자도 전사 AI 사용량을 한 번에 봅니까?
아직 아닙니다. 관리자 AI 사용량 화면은 area B 폴더(`job-analysis/AdminAiUsagePage.tsx`)에 있고 필터가 공고/기업/OCR/메타데이터 4종으로 한정돼, 첨삭 등 다른 영역 로그를 노출하지 않습니다. E의 관리자 첨삭/크레딧 화면은 빈 패키지 상태입니다. 같은 `ai_usage_log` 를 보므로 통합 콘솔로 확장하기는 쉽지만, 현재는 영역별로 분리돼 있습니다.
:::

## 8. 직접 말해보기

다음을 막힘없이 1분 안에 설명할 수 있으면 이 페이지를 이해한 것이다.

- `ai_usage_log` 가 공동 소유 테이블인 이유와, 그게 집계·과금에 주는 이점
- `monthlyUsage` 쿼리가 하는 일 세 가지(그룹핑·횟수·크레딧 합)와 기간 경계
- usage 탭의 Progress 바가 "상대 비율"이지 "한도 소진율"이 아니라는 점
- 토큰→크레딧 환산식 `max(1, ceil(tok/1000))` 과 그 값이 어디 기록되는지
- "로그는 쌓이지만 잔액은 안 빠진다"는 현재 미배선 상태를 정직하게

관련 페이지: [크레딧 시스템](/area-e/credit-system) · [결제 흐름](/area-e/payment-flow) · [요금제 게이팅](/area-e/plan-gating) · [영역 E 개요](/area-e/)

## 퀴즈

<QuizBox question="AI 사용량 대시보드가 기능별 집계의 단일 근거로 삼는 테이블은?" :choices="['correction_request', 'ai_usage_log', 'credit_transaction', 'user_benefit_balance']" :answer="1" explanation="모든 영역의 AI 호출이 ai_usage_log 한 테이블에 1건=1행으로 쌓이고, monthlyUsage 쿼리가 이를 feature_type별로 GROUP BY 한다. 표시와 과금이 같은 행을 보게 해 둘이 어긋나지 않는 것이 핵심 설계다." />

<QuizBox question="Billing.tsx usage 탭의 Progress 막대 길이는 무엇을 기준으로 계산되는가?" :choices="['플랜이 제공하는 월 한도 대비 소진율', '그 달 사용량이 가장 많은 기능 대비 상대 비율', '전체 사용자 평균 대비 비율', '보유 크레딧 대비 사용 크레딧 비율']" :answer="1" explanation="코드의 max = Math.max(...usage.map(r => r.used), 1) 처럼, 분모가 그 달 내 최대 used다. 즉 한도 게이지가 아니라 기능 간 분포 시각화이며 1등 기능은 항상 막대가 꽉 찬다." />

<QuizBox question="현재 구현 상태로 옳은 것은?" :choices="['사용량을 보여 주는 만큼 users.credit이 실제로 차감된다', '관리자 화면이 전사 AI 사용량을 통합해 보여 준다', '로그는 쌓이지만 실제 크레딧/사용권 차감은 운영 경로에 배선되지 않았다', '첨삭 사용량은 대시보드에 한글 라벨로 정확히 표시된다']" :answer="2" explanation="차감 엔진(deductByAiUsageLog 등)은 테스트에서만 호출되어, 현재는 ai_usage_log와 correction_request만 쌓이고 잔액은 줄지 않는다. 관리자 사용량 화면은 area B 4종 전용이며, 대시보드의 FEATURE_LABEL에는 CORRECTION_* 라벨이 없어 영문 코드로 노출된다." />
