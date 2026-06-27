# 크레딧 시스템 — 거래 장부

> 크레딧은 잔액 숫자 하나가 아니라, 모든 변동을 한 줄씩 쌓는 **원장(ledger)** 으로 관리한다. `credit_transaction` 한 줄 한 줄이 "왜·얼마·언제·차감 후 얼마"를 증명한다.

## 1. 한 줄 정의 · 이 페이지가 답하는 면접 질문

크레딧 시스템은 사용자가 보유한 **소비형 재화(`users.credit`)** 와, 그 잔액이 변한 **모든 사건의 영구 기록(`credit_transaction`)** 을 함께 다루는 과금 토대다. 한 쪽은 "지금 얼마"를 빠르게 답하는 캐시 값이고, 다른 한 쪽은 "어쩌다 그 값이 됐는지"를 한 줄씩 증명하는 장부다.

이 페이지가 답하는 면접 질문:

- "크레딧 잔액을 그냥 `UPDATE` 로 더하고 빼면 되는데, 왜 거래 테이블을 따로 두나요?"
- "크레딧 차감은 정확히 언제 일어납니까? AI 호출이 실패하면 돈이 빠지나요?"
- "같은 요청이 두 번 들어와도 두 번 차감되지 않게 어떻게 막았습니까?"
- "지급(충전)·차감·환불·관리자 조정을 한 테이블에서 어떻게 구분합니까?"

:::tip 이 페이지의 핵심 한 문장
**잔액은 결과이고, 장부가 진실이다.** `users.credit` 은 빠른 조회용 합계일 뿐, 정확성의 기준(source of truth)은 `credit_transaction` 의 누적 행들이다.
:::

## 2. 왜 이렇게 설계했나 (의도 · 트레이드오프)

### 2-1. 왜 단순 잔액이 아니라 원장인가

가장 단순한 설계는 `users.credit` 에 직접 더하고 빼는 것이다. 하지만 크레딧은 **돈에 준하는 재화**라서 다음을 만족해야 한다.

| 요구 | 단순 잔액 | 원장 방식 |
| --- | --- | --- |
| "이 사용자가 지난달에 뭘로 얼마 썼나" | 알 수 없음 | 행을 필터링하면 즉시 |
| 잔액 불일치 의심 시 검증 | 불가능(과거가 없음) | `amount` 합 == `credit` 인지 대조 |
| 환불·관리자 보정 추적 | 덮어쓰면 사라짐 | REFUND / ADMIN_ADJUST 행으로 남음 |
| "이 차감이 어느 AI 호출 때문인지" | 연결 끊김 | `ai_usage_log_id` FK로 추적 |

DB 설계서가 명시한 원칙이 **"원장(ledger) 분리"** 다. 잔액을 직접 갱신하는 대신 **변동분(`amount`)과 변동 후 잔액(`balance_after`)을 행 단위로 같이 기록**한다. 그래서 어느 시점의 잔액이든 그 직전 거래 행의 `balance_after` 로 재구성·검증할 수 있다.

### 2-2. 트레이드오프

- **얻는 것:** 감사 추적(audit trail), 분쟁 대응, 사후 검증, 사용량 분석(`feature_type`별 집계)이 전부 한 테이블에서 나온다.
- **내주는 것:** 쓰기가 두 번(잔액 `UPDATE` + 장부 `INSERT`)이고, 테이블이 빠르게 커진다. 그래서 잔액은 `credit_transaction` 합산이 아니라 **`users.credit` 캐시 컬럼**으로 따로 두어 조회를 O(1)로 유지한다 — 장부는 진실, 잔액은 빠른 답.

:::warning 잔액과 장부의 역할 분리
`users.credit` 는 "장부를 매번 다 더하지 않으려고 둔 캐시"다. 둘이 어긋나면 장부가 옳다. 그래서 차감/지급 코드는 **항상 둘을 같은 트랜잭션 안에서 함께 갱신**한다(한쪽만 바뀌는 경로를 만들지 않는다).
:::

## 3. 어떤 기술로 구현했나 (실제 클래스 · 테이블 근거)

### 3-1. 소유 테이블 `credit_transaction`

`backend/src/main/resources/db/schema.sql:1061`:

| 컬럼 | 의미 |
| --- | --- |
| `id` | PK |
| `user_id` | 소유자. `ON DELETE CASCADE` |
| `ai_usage_log_id` | 차감을 유발한 AI 사용 로그. `ON DELETE SET NULL`(로그 지워져도 장부 보존) |
| `type` | `AI_USAGE` / `CHARGE` / `REFUND` / `ADMIN_ADJUST` |
| `amount` | 변동분. **충전·환불은 양수, AI 사용은 음수** |
| `balance_after` | **이 거래 직후 잔액**(시점 스냅샷) |
| `feature_type` | 어떤 AI 기능 때문인지(예: `CORRECTION_SELF_INTRO`) |
| `reason` | 사람이 읽을 사유 문자열 |
| `created_at` | 기록 시각 |

핵심 제약:

```sql
UNIQUE KEY uq_credit_transaction_ai_usage_type (ai_usage_log_id, type)
```

이 유니크가 **"한 AI 사용 로그는 AI_USAGE 차감을 단 한 번만 만들 수 있다"** 를 DB 레벨에서 보장한다(멱등성의 마지막 방어선). 패치 주석이 의도를 그대로 적어둔다 — "하나의 AI 사용량 로그는 AI_USAGE 차감을 한 번만 만들 수 있고, 이후 REFUND·ADMIN_ADJUST 같은 별도 거래 유형은 분리해서 기록할 수 있게 둔다"(`patches/20260610_e_credit_transaction.sql`).

### 3-2. 핵심 클래스

| 클래스 | 역할 |
| --- | --- |
| `CreditServiceImpl.deductByAiUsageLog(...)` | 차감 엔진. 5단 가드 + 조건부 원자적 차감 + 장부 기록 |
| `CreditTransaction`(domain) | 원장 행 엔티티(빌더). 주석: "충전, 차감, 환불, 관리자 조정 내역을 남기는 원장 엔티티" |
| `CreditDeductionResult`(record) | 차감 결과. `deducted(...)` / `skipped(...)` 두 정적 팩토리 |
| `CreditMapper` (+`CreditMapper.xml`) | 조건부 UPDATE·EXISTS·원장 INSERT SQL |
| `CreditAiUsageLog`(domain) | 차감 근거가 되는 `ai_usage_log` 조회 모델 |
| `BillingServiceImpl.grantCreditsAfterPayment(...)` | 결제 후 **CHARGE** 행 기록(지급 경로) |

차감과 지급이 서로 다른 도메인에 있다는 점에 주목할 것: **차감(AI_USAGE)은 `credit` 도메인**, **지급(CHARGE)은 `billing` 도메인**(결제 후처리). 둘 다 같은 `credit_transaction` 테이블에 같은 빌더로 행을 넣는다.

## 4. 동작 원리 (흐름 · 표 · 작은 코드)

### 4-1. 차감은 "AI 호출 성공"을 기준으로 한다

차감의 단일 근거는 잔액도, 요청도 아니라 **`ai_usage_log` 한 행**이다. `CreditServiceImpl.deductByAiUsageLog` 의 5단 가드(`CreditServiceImpl.java:38-90`):

```text
1. 로그 조회         → 없으면 NOT_FOUND
2. status != SUCCESS → skipped("NOT_SUCCESS")   ← 실패한 AI 호출은 무료
3. 이미 차감됨?      → skipped("ALREADY_DEDUCTED") (EXISTS로 선검사)
4. creditUsed <= 0   → skipped("NO_CREDIT_USED")
5. 조건부 차감        → SET credit = credit - X WHERE id=? AND credit >= X
                       0행이면 INSUFFICIENT_CREDIT, 성공이면 장부 INSERT
```

2번이 면접에서 자주 묻는 지점이다. **AI 호출이 실패하면(`status='FAILED'`) 차감하지 않는다.** 실패 로그는 `credit_used=0` 으로 남고(감사용), 차감 엔진은 `NOT_SUCCESS` 로 건너뛴다. 즉 **차감 기준 = AI 요청 성공**이고, 사용자는 실패한 호출에 비용을 내지 않는다.

5번의 조건부 UPDATE가 음수 잔액과 동시성을 락 없이 막는다(`CreditMapper.xml:37`):

```sql
UPDATE users SET credit = credit - #{creditUsed}
 WHERE id = #{userId} AND credit >= #{creditUsed}
```

`WHERE credit >= X` 덕분에 두 요청이 동시에 들어와도 잔액이 음수로 내려가지 않는다. 영향 행이 0이면 잔액 부족으로 판단해 `INSUFFICIENT_CREDIT` 을 던진다.

### 4-2. 장부 행을 쓰는 순간

차감이 실제로 일어난 경우에만(`updated != 0`) 장부에 `AI_USAGE` 행을 남긴다(`CreditServiceImpl.java:78-89`):

```java
int balanceAfter = requireCurrentCredit(userId);   // 차감 직후 잔액 재조회
creditMapper.insertCreditTransaction(CreditTransaction.builder()
    .userId(userId)
    .aiUsageLogId(aiUsageLogId)
    .type("AI_USAGE")
    .amount(-creditUsed)           // 음수
    .balanceAfter(balanceAfter)    // 시점 스냅샷
    .featureType(usageLog.getFeatureType())
    .reason("AI 사용량 기반 크레딧 차감")
    .build());
```

`balance_after` 를 **차감 후 다시 조회한 실제 잔액**으로 박는 것이 포인트다. 계산값(`잔액 - amount`)을 믿지 않고 DB가 확정한 값을 기록해, 장부만으로 잔액 변천사를 재구성·검증할 수 있게 한다.

### 4-3. 거래 유형 4종과 부호 규약

| type | 의미 | amount 부호 | 기록 위치(구현 상태) |
| --- | --- | --- | --- |
| `CHARGE` | 결제로 충전 | 양수 | `BillingServiceImpl.grantCreditsAfterPayment`(구현됨) |
| `AI_USAGE` | AI 기능 사용 차감 | 음수 | `CreditServiceImpl.deduct`(구현·테스트 통과, 운영 미배선) |
| `REFUND` | 환불 | 양수 | 스키마·타입만 존재, 코드 경로 없음 |
| `ADMIN_ADJUST` | 관리자 보정 | 양수/음수 | 스키마·타입만 존재, 코드 경로 없음 |

지급(CHARGE) 행은 결제 후처리에서 잔액 증가와 함께 한 트랜잭션으로 남는다(`BillingServiceImpl.java:209-220`):

```java
billingMapper.increaseUserCredit(userId, creditAmount);         // 잔액 +
int balanceAfter = balanceOf(userId);
billingMapper.insertCreditTransaction(CreditTransaction.builder()
    .userId(userId).type("CHARGE").amount(creditAmount)
    .balanceAfter(balanceAfter)
    .reason(productCode + " 결제 충전").build());
```

이 메서드는 **Toss confirm 후처리와 DEV provider 즉시결제가 함께 재사용**하는 공통 지급 지점이다. 결제 경로가 둘이어도 "크레딧을 실제로 만드는" 코드는 한 곳뿐이다.

### 4-4. 토큰 → 크레딧 환산식

차감 금액은 토큰 사용량에서 나온다(`CorrectionAiUsageLogService.java:54-58`):

```java
creditUsed = (totalTokens <= 0) ? 0
           : Math.max(1, (int) Math.ceil(totalTokens / 1000.0));
```

**1000토큰당 1크레딧, 최소 1크레딧**(올림). 이 값이 `ai_usage_log.credit_used` 에 기록되고, 차감 엔진은 이를 그대로 읽어 차감하거나(`deductByAiUsageLog(id)`), 호출자가 명시한 금액으로 덮어쓴다(`deductByAiUsageLog(id, creditUsed)` — 이때 로그의 `credit_used` 도 같은 값으로 맞춘다).

## 5. 구현 상태 (됨 vs 계획) — 정직한 구분

:::warning 가장 중요한 사실 — 차감 엔진은 완성됐지만 AI 실행과 배선되지 않았다
`CreditServiceImpl.deductByAiUsageLog` 는 단위 테스트(`CreditServiceImplTest`)에서만 호출된다. 운영 호출처는 `AiChargeServiceImpl.charge` 뿐인데, **그 `charge` 역시 테스트에서만 호출**된다(첨삭 등 실제 AI 실행 경로 어디에서도 호출하지 않음). 따라서 **현재 첨삭을 실행해도 `users.credit` 는 줄지 않는다.** `ai_usage_log` 와 `correction_request` 행만 쌓인다.
:::

| 항목 | 상태 |
| --- | --- |
| `credit_transaction` 테이블·유니크·FK | 구현 완료(스키마+패치) |
| 차감 엔진(5단 가드·조건부 원자 UPDATE·멱등) | 구현 완료, 단위 테스트 통과 |
| CHARGE 지급 행(결제 후처리) | 구현 완료, 운영 경로 연결됨 |
| 사용권→크레딧 폴백(`AiChargeService`) | 구현·테스트 통과, **운영 미배선** |
| **AI 실행 → 차감 호출** | **미연결**(실제 차감 안 일어남) |
| REFUND / ADMIN_ADJUST | 스키마·타입만, 코드 경로 없음 |
| 거래 내역 조회 API `getMyCreditTransactions` | 백엔드 구현됨, **프론트 화면 미노출**(미사용 자산) |

즉 "장부 인프라와 차감 로직은 완성, 트리거 배선과 환불·조정 경로는 미구현"이 정확한 현재 그림이다. 면접에서 이 갭을 숨기지 말고 **"엔진은 완성·검증됐고 호출 지점만 연결하면 된다"** 로 설명하는 편이 신뢰를 준다.

## 6. 면접 답변 3단계

**1단계 (한 문장):**
"크레딧은 잔액 컬럼 하나가 아니라 모든 변동을 한 줄씩 쌓는 원장으로 관리했고, 차감은 AI 호출이 성공했을 때만 일어나도록 사용량 로그를 단일 근거로 삼았습니다."

**2단계 (구조):**
"`users.credit` 은 빠른 조회용 캐시이고, 정확성의 기준은 `credit_transaction` 입니다. 각 행에 변동분(`amount`)과 변동 후 잔액(`balance_after`), 사유, 어느 AI 호출 때문인지(`ai_usage_log_id`)를 남겨서 잔액을 언제든 재구성·검증할 수 있습니다. 차감은 `deductByAiUsageLog` 가 로그의 `status='SUCCESS'` 와 `credit_used` 를 보고, 잔액이 충분할 때만 `WHERE credit >= X` 조건부 UPDATE로 차감한 뒤 음수 `amount` 행을 남깁니다."

**3단계 (트레이드오프·정직):**
"실패한 호출은 차감하지 않고, 같은 로그가 두 번 차감되지 않도록 애플리케이션 EXISTS 선검사와 DB 유니크 키로 이중 방어했습니다. 다만 현재는 차감 엔진이 완성·테스트만 통과한 상태이고, 실제 AI 실행 경로와 연결하는 배선과 환불·관리자 조정 경로는 아직 구현 전입니다."

## 7. 꼬리질문 + 모범답안

:::details Q1. 잔액을 `credit_transaction` 합산으로 구하지 않고 `users.credit` 캐시를 둔 이유는?
장부를 매번 다 더하면 사용자마다 거래가 누적될수록 조회가 느려진다. 그래서 잔액은 별도 컬럼으로 캐시해 조회를 O(1)로 유지하고, 장부는 진실·감사용으로 둔다. 둘이 어긋나면 장부가 옳다는 전제로, 차감/지급 코드가 **같은 트랜잭션 안에서 둘을 함께** 갱신해 정합을 유지한다. 한쪽만 바뀌는 경로를 의도적으로 만들지 않는 게 핵심이다.
:::

:::details Q2. AI 호출이 실패하면 크레딧이 빠지나요?
빠지지 않는다. 차감 기준은 `ai_usage_log.status` 이고, `SUCCESS` 가 아니면 차감 엔진이 `NOT_SUCCESS` 로 건너뛴다(`skipped`). 실패 로그는 `credit_used=0` 으로 남아 감사 추적에는 보존되지만 과금되지 않는다. 사용자는 성공한 호출에 대해서만 비용을 낸다.
:::

:::details Q3. 같은 요청이 재시도되거나 중복 호출돼도 두 번 차감되지 않는 이유는?
이중 멱등이다. 애플리케이션 레벨에서 `existsTransactionByAiUsageLogIdAndType` 로 같은 로그·타입의 행이 이미 있는지 선검사하고(`ALREADY_DEDUCTED`), DB 레벨에서 `uq_credit_transaction_ai_usage_type(ai_usage_log_id, type)` 유니크가 경쟁 상황의 중복 INSERT를 마지막에 차단한다. 선검사를 통과한 두 트랜잭션이 동시에 INSERT를 시도해도 하나는 유니크 위반으로 실패한다.
:::

:::details Q4. `skipped` 는 에러인가요? 왜 예외로 던지지 않나요?
에러가 아니라 **정상 결과**다. `CreditDeductionResult` 는 `deducted` / `skipped` 두 갈래의 record이고, `skipped` 는 사유 코드(`NOT_SUCCESS`, `ALREADY_DEDUCTED`, `NO_CREDIT_USED`)를 담는다. 상위의 `AiChargeService` 가 "이미 충전됨/0크레딧/실패" 같은 분기를 정상 흐름으로 처리해야 하므로, 이걸 예외로 던지면 정상 케이스마다 try/catch가 필요해진다. 진짜 실패인 잔액 부족(`INSUFFICIENT_CREDIT`)과 로그 없음(`NOT_FOUND`)만 예외로 던진다.
:::

:::details Q5. `balance_after` 를 굳이 행마다 저장하는 이유는? amount만 있으면 되지 않나?
시점 잔액을 박아두면 장부만으로 어느 거래 직후의 잔액이든 즉시 알 수 있고, 잔액 캐시(`users.credit`)와 대조해 정합 검증이 가능하다. 그리고 그 값을 계산(`전 잔액 - amount`)이 아니라 **차감 직후 DB에서 재조회한 실제 값**으로 넣어, 중간에 다른 트랜잭션이 끼어들어 잔액이 달라진 경우에도 그 거래가 본 진짜 잔액을 남긴다.
:::

:::details Q6. 환불(REFUND)이나 관리자 보정(ADMIN_ADJUST)은 어떻게 처리하나요?
현재는 **타입과 스키마만 준비**돼 있고 실행 코드는 없다. 설계 의도는 명확하다 — 잔액을 직접 되돌리지 않고 **반대 부호의 새 행을 추가**한다(환불은 양수 amount의 REFUND 행). 유니크 키가 `(ai_usage_log_id, type)` 조합이라 같은 로그에 대해 AI_USAGE 차감 1건과 REFUND 1건이 공존할 수 있다. 즉 차감을 지우는 게 아니라 상쇄 행을 쌓아 이력을 보존하는 append-only 방식이다. (정직하게: 이 경로는 아직 미구현이다.)
:::

## 8. 직접 말해보기

아래를 막힘없이 설명할 수 있으면 이 주제는 통과다.

1. `users.credit` 와 `credit_transaction` 의 역할 차이를 한 문장으로.
2. 차감이 일어나는 정확한 조건 4가지(로그 존재 / SUCCESS / 미차감 / 잔액 충분)와, 각각 실패 시 결과.
3. `WHERE credit >= X` 조건부 UPDATE가 막아주는 두 가지(음수 잔액 · 동시성).
4. 멱등성을 두 층(애플리케이션 EXISTS + DB 유니크)으로 건 이유.
5. `amount` 부호 규약(충전/환불 양수, AI 사용 음수)과 `balance_after` 의 의미.
6. "차감 엔진은 완성됐지만 AI 실행과 미배선"이라는 현재 상태를 한 문장으로 정직하게.

## 퀴즈

<QuizBox question="크레딧 차감(AI_USAGE)이 실제로 일어나는 기준은 무엇인가?" :choices="['사용자가 첨삭 버튼을 누른 순간', 'ai_usage_log의 status가 SUCCESS인 경우에만', 'OpenAI에 요청을 보낸 순간 무조건', '결제가 완료된 순간']" :answer="1" explanation="차감의 단일 근거는 ai_usage_log 한 행이다. status가 SUCCESS가 아니면 차감 엔진은 NOT_SUCCESS로 건너뛰고(skipped), 실패한 호출은 credit_used=0으로 남아 과금되지 않는다." />

<QuizBox question="credit_transaction을 잔액 컬럼 하나 대신 원장(ledger)으로 둔 가장 핵심적인 이유는?" :choices="['잔액 조회를 더 빠르게 하려고', '변동분과 변동 후 잔액을 행마다 남겨 감사·검증·이력 추적이 가능하므로', 'JPA가 그렇게 강제해서', '크레딧을 음수로 만들 수 있게 하려고']" :answer="1" explanation="원장 분리 원칙이다. amount와 balance_after를 행 단위로 남기면 어느 시점 잔액이든 재구성·검증할 수 있고 환불·관리자 조정도 상쇄 행으로 추적된다. 빠른 조회는 오히려 users.credit 캐시 컬럼이 담당한다." />

<QuizBox question="같은 ai_usage_log가 두 번 차감되는 것을 막는 장치를 모두 고르면?" :choices="['애플리케이션의 existsTransactionByAiUsageLogIdAndType 선검사만', 'DB의 uq_credit_transaction_ai_usage_type 유니크 키만', '둘 다 — 애플리케이션 EXISTS 선검사와 DB 유니크 키의 이중 방어', '아무 장치도 없다']" :answer="2" explanation="이중 멱등이다. 코드에서 EXISTS로 먼저 거르고(ALREADY_DEDUCTED), 경쟁 상황에서 둘 다 통과해 INSERT를 시도해도 (ai_usage_log_id, type) 유니크가 마지막에 중복을 차단한다." />
