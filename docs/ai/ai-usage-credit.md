# AI 사용량·크레딧 관리

> AI 호출 한 번마다 토큰·모델·비용을 `ai_usage_log`에 남기고, 그 로그를 근거로 크레딧을 원자적으로 차감하며, 잔액이 모자라면 `INSUFFICIENT_CREDIT(402)`로 막는 구조다. "비용을 보이게 하고 남용을 막는다"가 한 문장 요약.

## 1. 한 줄 정의

**AI 사용량·크레딧 관리**는 모든 AI 호출의 토큰/모델/상태를 로그로 적재하고(`ai_usage_log`), 그 로그를 단일 진실 원천(source of truth)으로 삼아 사용자 크레딧을 차감·집계하는 과금/통제 계층이다.

## 2. 단어 뜻 (약자/어원 풀이)

| 단어 | 뜻 |
| --- | --- |
| 토큰(token) | LLM이 텍스트를 쪼개는 최소 단위. 과금/비용의 기본 척도. `input_tokens` + `output_tokens` = `token_usage` |
| 크레딧(credit) | 서비스 내부 화폐 단위. 사용자가 충전(`CHARGE`)하고 AI 사용 시 차감(`AI_USAGE`)된다 |
| feature_type | 어떤 AI 기능이 호출됐는지 분류 키. `JOB_ANALYSIS`, `COMPANY_RESEARCH`, `JOB_POSTING_OCR`, `INTERVIEW` 등 |
| 멱등(idempotent) | 같은 요청을 여러 번 해도 결과가 한 번 한 것과 같음. 중복 차감 방지의 핵심 개념 |
| overage | 정액(사용권/ticket) 소진 후 초과분. CareerTuner는 초과분을 크레딧으로 폴백(`FALLBACK_CREDIT`) 가능 |

:::tip 토큰과 크레딧은 다르다
토큰은 LLM 제공자가 매기는 원가 척도이고, 크레딧은 우리가 사용자에게 노출하는 정가 단위다. CareerTuner는 `creditUsed = ceil(totalTokens / 1000)`(최소 1)처럼 토큰을 크레딧으로 환산한다. 즉 "토큰을 기록하고, 크레딧으로 청구"한다.
:::

## 3. 왜 필요한가 (없으면 무슨 문제가 생기나)

AI 호출은 외부 LLM 비용이 직접 발생하는 유일한 지점이다. 사용량 추적·과금 계층이 없으면:

- **비용 블랙박스**: 누가 어떤 기능으로 얼마를 썼는지 모른 채 OpenAI 청구서만 늘어난다.
- **남용 무방비**: 무료/저비용 사용자가 무한 호출해도 막을 수단이 없다.
- **중복 과금/이중 호출**: 재시도·동시요청 시 같은 작업에 크레딧이 두 번 빠지거나, 잔액 음수가 난다.
- **운영 사각지대**: 관리자가 "오늘 실패율은? 가장 비싼 기능은?"에 답할 수 없다.

CareerTuner는 이를 (1) 모든 호출을 `ai_usage_log`에 적재 → (2) 로그 기준 크레딧 차감 → (3) `INSUFFICIENT_CREDIT`로 사전 차단 → (4) 관리자 통계로 가시화, 4단계로 해결한다.

## 4. CareerTuner에서 어디에 썼나 (실제 클래스/파일/테이블)

AI 영역(본인=C 담당이지만 과금 코어는 공통/E와 협업). 구현 완료된 부분이 대부분이다.

| 계층 | 클래스/파일 | 역할 |
| --- | --- | --- |
| 테이블 | `ai_usage_log` (`schema.sql`) | 호출 1건 = 1 row. user/case/feature/status/model/tokens/credit_used/error_message |
| 테이블 | `credit_transaction` (`schema.sql`) | 크레딧 변동 원장. `type`(AI_USAGE/CHARGE/REFUND/ADMIN_ADJUST), `amount`, `balance_after` |
| 차감 코어 | `credit/service/CreditServiceImpl` | `deductByAiUsageLog(logId[, creditUsed])` — 로그 기준 차감 |
| 매퍼 | `mapper/credit/CreditMapper.xml` | `deductUserCreditIfEnough`(원자적 조건부 UPDATE) 등 |
| 과금 정책 | `billing/service/AiChargeServiceImpl` | 사용권(ticket) 우선 → 부족 시 크레딧 폴백 결정 |
| 기록(면접) | `interview/service/InterviewAiUsageLogService` | 성공/실패 로그 적재, 토큰→크레딧 환산 |
| 에러코드 | `common/exception/ErrorCode` | `INSUFFICIENT_CREDIT(PAYMENT_REQUIRED 402)` |
| 관리자 API | `admin/aiusage/controller/AdminAiUsageController` | `GET /api/admin/ai-usage/b`, `/b/summary` |
| 관리자 서비스 | `admin/aiusage/service/AdminAiUsageService` | feature/status/model/기간 필터, 정렬, 페이징 |
| 관리자 DTO | `AdminAiUsageLogRow`, `AdminAiUsageSummary` | 로그 행 / 집계(총건수·성공·실패·토큰·크레딧·기능별) |
| 프론트 | `admin/features/job-analysis/pages/AdminAiUsagePage.tsx` | 관리자 AI 사용량 대시보드 화면 |

:::warning 구현/설계 단계 정직 구분
- **구현됨**: `ai_usage_log`·`credit_transaction` 테이블, `CreditServiceImpl` 차감, `AiChargeServiceImpl` 정책, `AdminAiUsage*` 통계 API/화면, 단위테스트(`CreditServiceImplTest`, `AdminAiUsageServiceTest`, `AiChargeServiceImplTest`).
- **부분/기능별 차이**: `feature_type` 값 집합이 코드마다 약간 다르다(관리자 필터는 B 영역 4종 화이트리스트, 면접은 `INTERVIEW`). 통일은 진행형.
:::

## 5. 핵심 동작 원리 (표/작은 코드/단계)

### 5-1. 기록(write) — 호출 직후 로그 적재

면접 AI 호출을 예로 들면, 성공 시 토큰을 받아 크레딧으로 환산해 한 줄 적재한다. 별도 트랜잭션(`REQUIRES_NEW`)이라 본 작업이 롤백돼도 로그는 남는다.

```java
// InterviewAiUsageLogService
private int creditUsed(int totalTokens) {
    if (totalTokens <= 0) return 0;
    return Math.max(1, (int) Math.ceil(totalTokens / 1000.0)); // 1000토큰=1크레딧, 최소 1
}
// 실패 시: status=FAILED, creditUsed=0, errorMessage(최대 1000자) 기록
```

### 5-2. 차감(deduct) — 로그를 근거로 한 멱등 차감

`CreditServiceImpl.deduct()`의 방어 단계가 면접 단골이다.

| 단계 | 분기 | 결과 |
| --- | --- | --- |
| 1 | 로그 없음 | `NOT_FOUND` 예외 |
| 2 | `status != SUCCESS` | skip(NOT_SUCCESS) — 실패 호출엔 과금 안 함 |
| 3 | 이미 차감됨(트랜잭션 존재) | skip(ALREADY_DEDUCTED) — **멱등** |
| 4 | creditUsed ≤ 0 | skip(NO_CREDIT_USED) |
| 5 | 잔액 부족 | `INSUFFICIENT_CREDIT` 예외 |
| 6 | 정상 | 차감 + `credit_transaction` 원장 기록 |

핵심은 **원자적 조건부 UPDATE**다. 잔액을 읽고 비교한 뒤 빼는 게 아니라, "충분할 때만 빼라"를 DB 한 문장으로 처리한다.

```sql
UPDATE users SET credit = credit - #{creditUsed}
 WHERE id = #{userId} AND credit >= #{creditUsed}
```

`affected rows = 0`이면 잔액 부족이라는 뜻이고, 그때 `INSUFFICIENT_CREDIT`을 던진다. 동시 요청이 와도 음수 잔액이 생기지 않는다.

### 5-3. 멱등성 보장 — 중복 차감 차단

`credit_transaction`의 `UNIQUE KEY (ai_usage_log_id, type)`이 DB 레벨 안전망이다. 같은 로그를 `AI_USAGE`로 두 번 차감하려 하면 유니크 제약이 막고, 서비스는 사전에 `existsTransactionByAiUsageLogIdAndType`로 확인해 skip한다.

### 5-4. 과금 정책 — 사용권 우선, 크레딧 폴백

`AiChargeServiceImpl.charge()`: 구독 사용권(ticket)이 있으면 그걸 먼저 소진하고, 없거나 소진되면 `overagePolicy`가 `CREDIT`/`FALLBACK_CREDIT`일 때만 크레딧으로 넘어간다. 둘 다 안 되면 `INSUFFICIENT_CREDIT`.

### 5-5. 집계(read) — 관리자 통계

`AdminAiUsageService`가 `feature_type`·`status`·`model`·기간으로 필터링하고, `AdminAiUsageSummary`로 총건수/성공/실패/누적토큰/누적크레딧/기능별 건수를 한 번에 내려준다. 정렬은 화이트리스트(`CREATED_AT_DESC`, `TOKEN_USAGE_DESC` 등)만 허용해 SQL 인젝션을 차단한다.

## 6. 면접 답변 3단계

- **초간단(1문장)**: "AI 호출마다 토큰·모델을 `ai_usage_log`에 기록하고, 그 로그를 근거로 크레딧을 원자적으로 차감하며, 모자라면 402 `INSUFFICIENT_CREDIT`으로 막습니다."
- **기본**: "기록은 호출 직후 별도 트랜잭션으로 남겨 본 작업이 실패해도 로그가 보존됩니다. 차감은 `credit >= 차감액`을 조건으로 건 단일 UPDATE라 동시성에서도 음수 잔액이 안 생기고, `credit_transaction`의 (로그ID, type) 유니크 제약으로 중복 차감을 막아 멱등합니다. 관리자에겐 기능별·기간별 집계를 제공해 비용을 가시화합니다."
- **꼬리질문 대응**: "사용권→크레딧 폴백 같은 과금 정책은 `AiChargeServiceImpl`이 분리해서 담당하고, 차감 코어(`CreditService`)는 '로그 기준 차감'만 책임지게 단일 책임으로 쪼갰습니다. 실패 호출(`status=FAILED`)엔 과금하지 않아 사용자가 손해 보지 않습니다."

## 7. 자주 나오는 꼬리질문 + 모범답안

:::details Q. 동시에 여러 요청이 오면 잔액이 음수가 될 수 있지 않나요?
아니요. 잔액을 읽고-비교하고-쓰는 3단계로 하면 race condition이 나지만, CareerTuner는 `UPDATE users SET credit = credit - ? WHERE id = ? AND credit >= ?` 한 문장으로 처리합니다. DB가 행 잠금으로 직렬화하므로 "충분할 때만 차감"이 원자적으로 보장되고, 영향 행 수가 0이면 부족으로 판단해 `INSUFFICIENT_CREDIT`을 던집니다.
:::

:::details Q. 같은 작업이 두 번 호출되면 크레딧이 두 번 빠지나요?
멱등 처리로 막습니다. 차감 전 `credit_transaction`에 해당 `ai_usage_log_id` + `AI_USAGE` 트랜잭션이 이미 있는지 확인해 있으면 skip(ALREADY_DEDUCTED)하고, 최후 방어선으로 DB에 `UNIQUE(ai_usage_log_id, type)` 제약을 걸어두었습니다. 애플리케이션 체크가 경합에 뚫려도 DB 제약이 두 번째 삽입을 거부합니다.
:::

:::details Q. AI 호출이 실패했는데도 크레딧이 빠지면 사용자가 손해 아닌가요?
실패는 과금하지 않습니다. 로그는 `status=FAILED`, `creditUsed=0`, `errorMessage`와 함께 남기지만, 차감 로직 2단계에서 `status != SUCCESS`면 즉시 skip합니다. 실패 로그를 남기는 이유는 관리자 통계에서 실패율·오류 원인을 추적하기 위해서입니다.
:::

:::details Q. 왜 토큰만 안 쓰고 크레딧이라는 별도 단위를 두나요?
토큰은 LLM 제공자의 원가 척도라 모델·제공자가 바뀌면 의미가 흔들리고, 사용자에게 직관적이지 않습니다. 크레딧은 우리가 통제하는 추상 단위라 "기능당 N크레딧" 같은 정책을 자유롭게 설계하고, 충전·환불·관리자 조정(`CHARGE`/`REFUND`/`ADMIN_ADJUST`)을 한 원장에서 일관되게 다룰 수 있습니다.
:::

:::details Q. 사용량 로그를 본 트랜잭션 안에 넣지 않고 분리한 이유는?
로그는 비용·운영 데이터라 본 작업의 성패와 독립적으로 남아야 합니다. `@Transactional(propagation = REQUIRES_NEW)`로 별도 트랜잭션을 열어, 본 비즈니스 로직이 롤백되더라도 "이 호출이 발생했다"는 사실은 보존되게 했습니다. 사후 정산·실패 분석에 필수입니다.
:::

## 8. 직접 말해보기 (말하기 훈련용)

1. 화이트보드에 `ai_usage_log → CreditService → credit_transaction` 흐름을 그리고, 차감이 멱등하고 동시성 안전한 이유 두 가지(유니크 제약, 조건부 UPDATE)를 각각 한 문장으로 설명해 보라.
2. "관리자가 '이번 달 가장 비싼 AI 기능과 실패율을 보고 싶다'고 하면 어떤 테이블·컬럼·API로 답하나?"를 `AdminAiUsageSummary` 필드를 짚어가며 말해 보라.

## 퀴즈

<QuizBox question="AI 호출 시 크레딧이 모자라면 반환되는 에러코드와 HTTP 상태는?" :choices="['INVALID_INPUT / 400', 'INSUFFICIENT_CREDIT / 402', 'FORBIDDEN / 403', 'AI_UNAVAILABLE / 502']" :answer="1" explanation="ErrorCode.INSUFFICIENT_CREDIT는 HttpStatus.PAYMENT_REQUIRED(402)에 매핑되어 있다. 잔액 부족은 결제가 필요한 상황이라는 의미." />

<QuizBox question="동시 요청에서도 크레딧 잔액이 음수가 되지 않게 보장하는 핵심 메커니즘은?" :choices="['Java synchronized 블록으로 차감 메서드 잠금', '읽기-비교-쓰기를 애플리케이션에서 3단계로 수행', 'WHERE credit >= 차감액 조건을 건 단일 UPDATE의 원자성', 'Redis 분산락']" :answer="2" explanation="deductUserCreditIfEnough는 조건부 UPDATE 한 문장으로 처리해 DB가 직렬화한다. 영향 행 0이면 부족으로 판단해 INSUFFICIENT_CREDIT을 던진다." />

<QuizBox question="같은 ai_usage_log에 대한 중복 크레딧 차감을 막는 안전장치 두 가지를 설명하라." explanation="첫째, 애플리케이션 레벨: 차감 전 credit_transaction에 해당 ai_usage_log_id + AI_USAGE 타입 행이 이미 존재하는지 확인해 있으면 ALREADY_DEDUCTED로 skip한다. 둘째, DB 레벨: credit_transaction에 UNIQUE(ai_usage_log_id, type) 제약이 걸려 있어, 경합으로 애플리케이션 체크가 뚫려도 두 번째 삽입이 거부된다. 두 겹으로 멱등성을 보장한다." />
