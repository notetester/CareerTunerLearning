# 요금제와 기능 게이팅

> CareerTuner는 "무료는 첨삭 1회·공고분석 3건"처럼 플랜마다 AI 기능 사용 한도를 다르게 둔다. 이 한도를 코드에 박지 않고 `subscription_benefit_policy` 테이블의 데이터로 표현하고, 사용권(ticket) 잔액을 원자적으로 차감해 게이팅한다.

## 1. 한 줄 정의와 이 페이지가 답하는 면접 질문

**기능 게이팅(plan gating)** 이란 "어떤 플랜의 사용자가 어떤 AI 기능을 이번 달에 몇 번 쓸 수 있는가"를 정하고, 그 한도를 넘으면 막거나(BLOCK), 크레딧으로 대체 차감하거나(CREDIT), 상위 플랜으로 유도(UPGRADE)하는 메커니즘이다.

이 페이지가 답하는 면접 질문:

- "무료 사용자와 유료 사용자를 어떻게 구분해서 기능을 제한하나요?"
- "요금제별 사용 한도를 `if (plan == FREE)` 같은 코드로 분기했나요, 아니면 다른 방식인가요?"
- "사용 한도를 초과하면 어떤 일이 일어나나요? 동시에 두 번 요청하면 한도를 우회할 수 있나요?"
- "플랜에 없는 기능(예: FREE의 음성면접)을 호출하면 어떻게 처리하나요?"

:::tip 핵심 한 줄
게이팅은 **코드 분기가 아니라 데이터(정책 테이블) + 원자적 조건부 차감**으로 구현했다. 그래서 코드 배포 없이 DML만으로 "무료 첨삭 1회 → 2회"로 바꿀 수 있다.
:::

## 2. 왜 이렇게 설계했나 (의도와 트레이드오프)

### 2-1. 한도를 코드가 아니라 테이블로 — "정책의 데이터화"

가장 단순한 게이팅은 서비스 코드에 `if (plan.equals("FREE") && count >= 1) throw ...` 를 박는 것이다. CareerTuner는 이를 의도적으로 피했다. 이유:

| 코드 분기 방식 | 정책 데이터화 방식 (채택) |
| --- | --- |
| 한도를 바꾸려면 코드 수정·재배포 | `UPDATE subscription_benefit_policy SET quantity=2 ...` 한 줄 |
| 플랜·기능 조합이 늘면 분기 폭발 | 행 하나 추가로 새 조합 표현 |
| "FREE 첨삭 1회"가 코드 곳곳에 흩어짐 | 한 테이블이 단일 근거(source of truth) |
| 관리자가 운영 중 못 바꿈 | `billing_policy_change`로 예약 변경까지 가능 |

대가는 복잡도다. 한도 한 줄이 정책 테이블 → 사용권 잔액 테이블 → 차감 트랜잭션이라는 세 단계로 늘어난다. CareerTuner는 결제·과금의 무결성·감사·정책 유연성이 단순함보다 중요하다고 보고 이 복잡도를 받아들였다. (분담표 초기 계획은 테이블 6종이었으나 실제 구현은 12종 이상으로 정교화됐다.)

### 2-2. "한도 초과 = 무조건 차단"이 아니다 — 3가지 초과 정책

각 정책 행에는 `overage_policy` 컬럼이 있다. 한도를 다 쓴 뒤의 행동을 셋 중 하나로 정한다:

- **`BLOCK`** — 그냥 막는다. (예: 공고분석권 `APPLICATION_ANALYSIS`)
- **`CREDIT`** — 사용권이 0이면 크레딧으로 대신 차감한다. (예: 첨삭권 `CORRECTION`)
- **`UPGRADE`** — 그 플랜엔 아예 없는 기능. 상위 플랜으로 유도. (예: FREE의 음성면접 `VOICE_INTERVIEW`, quantity 0)

이 설계 덕분에 "무료라서 막힘"과 "한도 다 썼으니 크레딧으로 더 써라"와 "이건 유료 전용이에요"를 한 테이블에서 표현한다.

### 2-3. 동시성·우회 방지를 락 없이

"동시에 두 번 요청하면 1회 한도를 2번 통과하지 않나?"는 게이팅의 핵심 약점이다. CareerTuner는 비관적 락 대신 **조건부 원자적 UPDATE**(`WHERE remaining_quantity > 0`)와 **DB 유니크 제약**으로 막는다. 자세한 동작은 4절.

## 3. 어떤 기술로 구현했나 (실제 클래스·테이블 근거)

### 3-1. 게이팅을 떠받치는 두 정책 테이블

게이팅은 2단 정책 모델로 표현된다. "기능"과 "혜택 풀(benefit pool)"을 분리한 게 핵심이다.

| 테이블 | 역할 | 게이팅에서의 의미 |
| --- | --- | --- |
| `ai_feature_benefit_policy` | AI 기능(feature_type) → 혜택코드(benefit_code) 매핑 | "이 기능은 어떤 사용권 풀에서 빠지나" |
| `subscription_benefit_policy` | 플랜(plan_code) + 혜택코드별 월 수량·초과정책 | "이 플랜은 그 풀을 한 달에 몇 번 쓰나" |

예를 들어 첨삭 4종(`CORRECTION_INTERVIEW_ANSWER` 등)은 전부 `feature → benefit_code='CORRECTION'` 으로 매핑되고, FREE 플랜의 `CORRECTION` 사용권은 월 1회다. 즉 **무료 첨삭 1회 제한은 코드가 아니라 이 두 행의 곱**이다.

### 3-2. 실제 seed된 게이팅 표 (schema.sql 근거)

`subscription_benefit_policy`에 실제로 들어 있는 시드 값(`schema.sql:929-968`). 무료 vs 유료의 차이가 그대로 보인다:

| benefit_code (기능군) | FREE | BASIC | PRO | PREMIUM | overage(FREE) |
| --- | --- | --- | --- | --- | --- |
| `APPLICATION_ANALYSIS` (공고/지원건 분석) | **3** | 20 | 60 | 150 | CREDIT* |
| `MOCK_INTERVIEW` (모의면접) | **1** | 10 | 30 | 60 | CREDIT* |
| `CORRECTION` (AI 첨삭) | **1** | 10 | 30 | 60 | CREDIT |
| `PROFILE_AI` (프로필 AI) | 3 | 20 | 60 | 150 | CREDIT |
| `CAREER_STRATEGY` (커리어 전략) | 2 | 15 | 60 | 100 | CREDIT |
| `VOICE_INTERVIEW` (음성면접) | **0** | 0 | 5 | 15 | UPGRADE |
| `VIDEO_ANALYSIS` (영상분석) | **0** | 0 | 1 | 5 | UPGRADE |
| `AVATAR_INTERVIEW` (아바타면접) | **0** | 0 | 0 | 5 | UPGRADE |

`*` quantity가 0보다 큰 분석/면접권은 후속 `UPDATE`(`schema.sql:979-990`)로 overage가 `CREDIT`+크레딧 단가로 바뀐다. quantity 0인 음성/영상/아바타는 그대로 `UPGRADE`로 남아 "유료 전용" 신호가 된다.

:::tip "무료=첨삭 1회·공고분석 3건"의 정확한 출처
과제에서 말한 무료 제한은 바로 이 시드의 `('FREE','CORRECTION',...,1,...)`(첨삭 월 1회)과 `('FREE','APPLICATION_ANALYSIS',...,3,...)`(공고/지원건 분석 월 3건)이다. 숫자가 코드가 아니라 데이터라는 점이 면접 포인트다.
:::

### 3-3. 차감을 수행하는 클래스들

- `BillingPolicyService.activeFeatureBenefitPolicy(userId, featureType)` — 사용자의 활성 구독(없으면 FREE)을 기준으로 그 기능에 적용할 정책을 찾는다. 유료 플랜에 정책이 없으면 **FREE 정책으로 폴백**(`:139-142`, `:180-181`)해 "모든 사용자는 최소 FREE 혜택"을 보장한다.
- `BillingServiceImpl.consumeByFeature(...)`(`AiBenefitUsageService` 구현, `:262-309`) — 실제 사용권 1장 차감.
- `AiChargeServiceImpl.charge(AiChargeCommand)`(`:32-75`) — 사용권 시도 → 부족 시 overage 정책 보고 크레딧 폴백 또는 차단까지 묶는 최상위 디스패처.
- `user_benefit_balance` — 기간별 잔액 인스턴스. `uk(user, benefit, period_start)` 유니크.

## 4. 동작 원리 (흐름·표·작은 코드)

### 4-1. 한 번의 AI 호출이 게이팅을 통과하는 전체 흐름

```text
AI 기능 호출 (예: 첨삭)
   │
   ▼ AiChargeService.charge(featureType="CORRECTION_SELF_INTRO", ...)
   │
   ├─ ① 기능 정책 조회: activeFeatureBenefitPolicy
   │     └─ 없거나 includedInTicket=false → 크레딧만 차감하고 끝 (NO_TICKET_POLICY)
   │
   ├─ ② 사용권 차감 시도: consumeByFeature
   │     ├─ 이번 기간 잔액 보장: ensureBalances (없으면 GRANT 생성)
   │     ├─ 중복차감 검사: existsConsumeTransaction (이미 있으면 ALREADY_CONSUMED)
   │     ├─ 잔액 0 → INSUFFICIENT_CREDIT 던짐
   │     └─ 조건부 차감: consumeBenefitIfEnough (WHERE remaining_quantity > 0)
   │           └─ 성공 → benefit_transaction(CONSUME, -1) 기록 → ticket 결과
   │
   └─ ③ 사용권 부족(INSUFFICIENT_CREDIT) 잡힘
         ├─ overage_policy 가 CREDIT/FALLBACK_CREDIT 이면 → 크레딧 폴백 차감
         └─ 아니면(BLOCK/UPGRADE) → 그대로 throw → 사용자에게 "한도 초과/유료 전용"
```

### 4-2. 한도 결정: "기간"이 먼저다

잔액은 "이번 기간(period)"별로 따로 잡힌다.

- 활성 구독이 있으면 → **구독 기간**(period_start ~ period_end)
- 없으면(=FREE) → **캘린더 월**(1일 0시 ~ 익월 1일) — `currentBenefitPeriod`

`ensureBalances`(`:334-373`)가 해당 기간에 `user_benefit_balance` 행이 없으면 정책의 `quantity`만큼 채운 GRANT 행을 만든다. 그래서 매달 첫 호출 때 자동으로 한도가 리셋되는 효과가 난다. 별도 월초 배치(cron)는 없고, **읽을 때(첫 사용 때) 잔액을 보장하는 lazy 방식**이다.

### 4-3. 우회 방지: 조건부 UPDATE + 유니크 제약

게이팅이 동시 요청에 뚫리지 않는 이유. 핵심은 잔액 검사와 차감을 **하나의 원자적 SQL**로 묶은 것이다.

```sql
-- consumeBenefitIfEnough: 검사와 차감이 한 문장 (락 불필요)
UPDATE user_benefit_balance
   SET remaining_quantity = remaining_quantity - 1,
       used_quantity      = used_quantity + 1
 WHERE id = ?
   AND remaining_quantity > 0;   -- 0이면 0행 → 부족으로 판정
```

두 요청이 동시에 들어와도 DB가 행 단위로 직렬화하므로 `remaining=1`에서 한쪽만 성공하고 다른 쪽은 0행(부족)으로 떨어진다. 여기에 더해 같은 작업(refType+refId)에 대한 중복 차감은 `benefit_transaction`의 `uq_benefit_consume_ref` 유니크와 `existsConsumeTransaction` 선검사로 이중 방어한다. 즉 **재시도/더블클릭으로 사용권을 두 번 빼는 일이 없다.**

### 4-4. overage 분기 (AiChargeServiceImpl 발췌 의미)

사용권이 0일 때 무엇을 하느냐는 `allowsCreditFallback`이 결정한다:

```java
// overage_policy 가 CREDIT 또는 FALLBACK_CREDIT 일 때만 크레딧으로 대체
boolean allowsCreditFallback(SubscriptionBenefitPolicy policy) {
    String overage = policy.getOveragePolicy().trim().toUpperCase();
    return "CREDIT".equals(overage) || "FALLBACK_CREDIT".equals(overage);
}
```

- 첨삭(`CORRECTION`, overage=CREDIT): 무료 1회를 다 쓰면 → 크레딧 2 차감으로 계속 사용 가능.
- 공고분석(`APPLICATION_ANALYSIS`, overage=BLOCK이었다가 시드 UPDATE로 CREDIT): 마찬가지로 크레딧 대체.
- 음성면접(`VOICE_INTERVIEW`, overage=UPGRADE): 폴백 불가 → `INSUFFICIENT_CREDIT` throw → "상위 플랜으로 업그레이드" 안내.

## 5. 구현 상태 — 됨 vs 계획 (정직한 구분)

:::warning 가장 중요한 사실: 게이팅 엔진은 완성됐지만 AI 실행과 아직 배선되지 않았다
차감 엔진(`AiChargeService.charge` / `consumeByFeature` / `deductByAiUsageLog`)은 원자성·멱등성까지 갖춰 단위 테스트(`AiChargeServiceImplTest` 5케이스)를 통과한다. 하지만 grep 결과 이 메서드들의 **운영 호출처는 `src/test`에만 있다.** 즉 지금 첨삭을 실행해도 `ai_usage_log`와 `correction_request` 행만 쌓이고 `user_benefit_balance`·`users.credit`은 **실제로 차감되지 않는다.** 게이팅 로직은 "준비 완료, 미연결" 상태다.
:::

### 구현 완료 (코드·시드 실재)

- 2단 정책 테이블(`ai_feature_benefit_policy`, `subscription_benefit_policy`)과 4플랜 전체 시드.
- 무료/유료 한도 데이터(FREE 첨삭 1·공고분석 3, 음성/영상/아바타 0 등).
- 사용권 차감 엔진: 기간 결정, 잔액 lazy 보장, 조건부 원자 차감, 중복차감 이중 방어, FREE 폴백.
- overage 3정책(BLOCK/CREDIT/UPGRADE)과 사용권→크레딧 폴백 디스패처(`AiChargeService`).
- 정책 스냅샷 동결 + 예약 정책변경(read-time lazy 반영).

### 계획/미연결 (근거 있는 갭)

1. **게이팅 ↔ AI 실행 미배선** — 위 경고 박스. 가장 큰 갭.
2. **첨삭 프론트는 정적 플레이스홀더** — `Correction.tsx`는 API 호출 0건, 크레딧 단가가 클라이언트 상수로 하드코딩(서버 정책과 비동기화). 게이팅 결과가 화면에 반영되는 경로 없음.
3. **사용량 기반 요금제 추천(#28) 미구현** — 추천에 쓸 데이터(`getMonthlyUsage`/`listPlans`)는 준비됐으나 산출 로직 없음.
4. **예약 정책변경 applyMode 차등 미완** — applyMode는 저장만, read-time 평가는 일괄 즉시 반영.

## 6. 면접 답변 3단계

**1단계 (한 문장):**
"요금제별 기능 한도를 코드에 박지 않고 `subscription_benefit_policy` 테이블의 데이터로 표현했고, 사용권 잔액을 조건부 원자 UPDATE로 차감해 게이팅합니다. 예를 들어 무료 첨삭 1회는 시드 행 하나(`FREE/CORRECTION/quantity=1`)입니다."

**2단계 (구조):**
"기능→혜택코드 매핑(`ai_feature_benefit_policy`)과 플랜별 한도(`subscription_benefit_policy`)를 분리한 2단 정책 모델입니다. 한도 초과 시 행동은 `overage_policy` 컬럼으로 BLOCK·CREDIT·UPGRADE 중 정하고, FREE에 없는 기능은 quantity 0 + UPGRADE로 유료 전용을 표현합니다. 차감은 `WHERE remaining_quantity > 0` 한 문장으로 검사와 차감을 묶어 락 없이 동시성을 막습니다."

**3단계 (트레이드오프·상태):**
"테이블로 관리하니 코드 배포 없이 DML로 한도를 바꿀 수 있고 관리자 예약 변경도 됩니다. 대신 복잡도가 늘어 정책 6종 계획이 12종 이상으로 커졌죠. 솔직히 말하면 차감 엔진은 멱등·원자성까지 갖춰 테스트를 통과하지만 아직 AI 실행 경로와 배선되지 않아, 현재는 사용량 로그만 쌓이고 실제 차감은 일어나지 않는 '준비 완료·미연결' 상태입니다."

## 7. 꼬리질문 + 모범답안

:::details Q1. "무료/유료를 `if (plan == FREE)`로 분기하지 않았다면, 어디서 무료 한도를 읽나요?"
`BillingPolicyService.activeFeatureBenefitPolicy(userId, featureType)`가 사용자의 활성 구독을 보고 plan_code를 정한 뒤(구독 없으면 FREE), 그 plan_code+benefit_code로 `subscription_benefit_policy` 행을 조회합니다. "무료 한도"는 그 행의 `quantity` 값일 뿐이고, 코드에는 플랜 이름 분기가 없습니다. 유료 플랜에 특정 정책이 빠져 있으면 FREE 정책으로 폴백해 최소 혜택을 보장합니다.
:::

:::details Q2. "동시에 두 번 요청하면 무료 1회 한도를 2번 통과하지 않나요?"
막힙니다. 잔액 검사와 차감이 분리돼 있으면 그 사이에 경합이 생기지만, 여기서는 `UPDATE ... SET remaining = remaining - 1 WHERE remaining > 0` 한 문장으로 묶었습니다. DB가 같은 행에 대한 두 UPDATE를 직렬화하므로 `remaining=1`이면 한쪽만 1행 성공, 다른 쪽은 0행(부족)으로 판정됩니다. 추가로 같은 작업의 재시도는 `uq_benefit_consume_ref` 유니크로 중복 차감을 막습니다.
:::

:::details Q3. "한도를 다 쓰면 항상 막히나요?"
아니요. `overage_policy`에 따라 다릅니다. BLOCK은 차단, CREDIT은 사용권이 0일 때 크레딧으로 대체 차감(예: 첨삭), UPGRADE는 그 플랜에 아예 없는 유료 전용 기능(예: FREE의 음성면접, quantity 0)이라 상위 플랜으로 유도합니다. `AiChargeService`가 사용권 부족 예외를 잡아 overage가 CREDIT/FALLBACK_CREDIT일 때만 크레딧 폴백을 시도합니다.
:::

:::details Q4. "월이 바뀌면 한도가 어떻게 리셋되나요? 월초 배치가 도나요?"
배치(cron)는 없습니다. `currentBenefitPeriod`로 이번 기간(구독 기간 또는 캘린더 월)을 정하고, 그 기간에 `user_benefit_balance` 행이 없으면 `ensureBalances`가 정책 quantity만큼 채운 GRANT 행을 그 자리에서 만듭니다. 즉 새 달의 첫 호출이 들어오는 순간 lazy하게 잔액이 생겨 리셋된 것처럼 동작합니다. 동시 초기화 경합은 `uk(user, benefit, period_start)` 유니크 + `DuplicateKeyException` 무시로 처리합니다.
:::

:::details Q5. "관리자가 다음 달부터 무료 첨삭을 2회로 늘리고 싶으면 코드를 고치나요?"
아니요. 한도가 데이터라 `subscription_benefit_policy`의 quantity를 바꾸면 됩니다. 즉시가 아니라 예약 변경이 필요하면 `billing_policy_change`에 SCHEDULED로 등록하고, 조회 시점에 `effective_from <= now`인 변경을 read-time으로 덮어 적용합니다. 다만 applyMode별 차등 적용은 아직 미완이라 현재는 활성 조회에 일괄 즉시 반영됩니다.
:::

:::details Q6. "정책을 바꾸면 이미 구독한 사용자의 한도도 바뀌나요?"
구독·결제 시점의 정책을 `policy_snapshot_json`으로 동결하므로, 가입 시점 혜택이 구독 기간 내내 유지됩니다(소급 변경 없음). 새 가격·한도는 다음 기간이나 신규 구매부터 적용하도록 설계했습니다. 기존 구매자 보호와 정책 유연성을 동시에 노린 결정입니다.
:::

## 8. 직접 말해보기

다음을 막힘없이 90초 안에 설명할 수 있으면 이 주제를 이해한 것이다:

1. "무료 첨삭 1회"라는 한 줄 제한이 코드가 아니라 어떤 테이블의 어떤 행인지.
2. `ai_feature_benefit_policy`와 `subscription_benefit_policy`를 분리한 이유.
3. `overage_policy`의 세 값과 각각의 사용자 경험(차단/크레딧 대체/업그레이드 유도).
4. 동시 요청을 락 없이 막는 한 문장 SQL과 거기에 더한 유니크 제약.
5. 지금 이 게이팅이 "엔진 완성, AI 실행과 미배선" 상태라는 정직한 현황.

## 퀴즈

<QuizBox question="FREE 플랜에서 'AI 첨삭'의 월 사용 한도(quantity)는 실제 시드 데이터 기준 몇 회인가?" :choices="['0회 (유료 전용)', '1회', '3회', '무제한']" :answer="1" explanation="subscription_benefit_policy 시드에서 ('FREE','CORRECTION',...,quantity=1,...) 이므로 무료 첨삭은 월 1회다. 공고/지원건 분석(APPLICATION_ANALYSIS)이 3회이고, 음성/영상/아바타 면접은 quantity 0(유료 전용)이다." />

<QuizBox question="동시에 같은 무료 사용자가 두 번 요청해도 1회 한도를 2번 통과하지 못하게 막는 핵심 기법은?" :choices="['요청마다 비관적 행 락(SELECT FOR UPDATE)을 건다', '검사와 차감을 WHERE remaining_quantity > 0 조건의 단일 원자 UPDATE로 묶는다', '애플리케이션 메모리에 잔액을 캐시해 검사한다', '플랜이 FREE면 if 문으로 차단한다']" :answer="1" explanation="consumeBenefitIfEnough가 'UPDATE ... SET remaining = remaining - 1 WHERE id=? AND remaining > 0' 한 문장으로 검사·차감을 합쳐, DB의 행 단위 직렬화로 한쪽만 성공시킨다. 락 없이 동시성을 막고, 중복 작업은 uq_benefit_consume_ref 유니크로 추가 방어한다." />

<QuizBox question="FREE 플랜에서 quantity가 0이고 overage_policy가 UPGRADE인 음성면접 기능을 호출하면 게이팅 결과는?" :choices="['크레딧으로 자동 대체 차감되어 실행된다', '사용권 부족 예외가 발생하고 상위 플랜 업그레이드로 유도된다', '무료라서 무제한 실행된다', 'ai_usage_log에 성공으로 기록되고 첨삭처럼 처리된다']" :answer="1" explanation="overage_policy가 UPGRADE면 allowsCreditFallback이 false라 크레딧 폴백을 허용하지 않는다. 잔액 0 + 폴백 불가이므로 INSUFFICIENT_CREDIT을 throw하고, 사용자에게는 '유료 전용/업그레이드'로 안내된다. 크레딧 대체는 overage_policy가 CREDIT/FALLBACK_CREDIT일 때만 일어난다." />
