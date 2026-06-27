# 영역 E 면접 플레이북

> 첨삭 · 결제 · 크레딧 영역을 1분/3분으로 압축하고, 기술 선택의 "왜"를 설명하며, 단골 꼬리질문 13개에 막힘없이 답하기 위한 종합 페이지.

## 1. 이 페이지가 답하는 면접 질문

이 페이지는 영역 E 전체를 면접에서 설명하기 위한 **종합 대본**이다. 개별 주제(첨삭 원리, 거래 장부, 결제 흐름, 게이팅)는 각 페이지에서 깊게 다루고, 여기서는 그것들을 하나의 이야기로 묶는다. 직접 답해야 하는 핵심 질문은 다음과 같다.

- "영역 E를 1분 안에 설명해 보세요."
- "이 영역에서 가장 어려웠던 / 가장 잘 설계한 부분은?"
- "왜 그렇게 만들었나요?" — 원문 보존, 거래 장부, 성공 기준 차감, 자체 첨삭 모델 같은 선택의 근거.
- "구현 안 된 건 뭔가요?" — 정직하게 갭을 말하면서도 설계 의도를 설명할 수 있는가.

:::tip 면접 톤
"내가 다 만들었다"가 아니라 "이 영역이 왜 이렇게 설계됐고, 어떤 트레이드오프를 의식했는지 정확히 설명할 수 있다"가 목표다. 특히 **구현됨 / 미연결을 정직하게 구분**하는 답변이 신뢰를 만든다.
:::

## 2. 영역 E 1분 / 3분 대본

### 1분 (엘리베이터 피치)

> 영역 E는 **두 축**입니다. 첫째는 **첨삭** — 사용자가 쓴 자기소개서·면접답변·이력서·포트폴리오를 채용공고에 맞게 다듬는 AI 기능 4종이고, 둘째는 그 AI 기능을 쓰기 위한 **결제·크레딧·사용권 인프라**입니다. 첨삭 4종은 입력·출력·검증·과금 흐름이 같아서 모델·서비스·클라이언트를 하나로 두고 `correctionType`으로만 분기합니다. 과금 쪽은 결제(Toss)·크레딧·사용권 티켓을 모두 **거래 장부(ledger) 방식**으로 기록하고, 차감은 `ai_usage_log`라는 사용량 로그를 단일 근거로 삼도록 설계했습니다. 백엔드 첨삭과 결제는 동작하고, **AI 실행과 과금 차감을 잇는 마지막 배선과 요금제 추천(#28)은 설계·테스트까지 끝났지만 아직 연결 전**입니다.

### 3분 (구조 + 의도 + 정직한 갭)

1. **정체성** — 영역 E는 콘텐츠 개선(첨삭 #24~27)과 전사 과금 인프라(#28 + 모든 영역의 과금 토대)를 함께 책임진다. 과금 인프라는 A/B/C/D의 AI 기능도 의존하는 공통 엔진이다.
2. **첨삭** — 단일 `correction` 도메인. `CorrectionAiClient`가 OpenAI Responses API를 `json_schema strict`로 호출해 `improvedText / summary / issues / changeReasons / suggestions` 5필드를 강제로 받고, `correction_request` 테이블에 append-only로 저장한다. 시스템 프롬프트에 "없는 성과를 지어내지 말라"는 가드레일이 박혀 있다.
3. **과금** — 결제는 Toss `ready/confirm` 2단계로 금액 위변조를 차단하고, 크레딧·사용권 차감은 조건부 원자적 UPDATE + 이중 멱등으로 동시성/중복을 막는다. 가격·정책은 코드가 아니라 테이블로 관리(데이터화)하고, 구매 시점 정책을 `policy_snapshot_json`으로 동결한다.
4. **정직한 갭** — 차감 엔진은 완성됐지만 **AI 실행 경로와 아직 배선되지 않았고**, 요금제 추천(#28)은 데이터는 준비됐지만 산출 로직이 없으며, 첨삭 프론트(`Correction.tsx`)는 정적 플레이스홀더다. 자체 LLM 5단 폴백은 진입점만 준비된 상태다.

## 3. 기술 선택의 "왜" — 4개 핵심 결정

면접에서 가장 자주 파고드는 4개 결정이다. 각각 "무엇을 / 왜 / 트레이드오프"를 한 문장씩으로 기억한다.

| 결정 | 무엇 | 왜 | 트레이드오프 / 대안 |
| --- | --- | --- | --- |
| 원문 보존형 첨삭 | 원문을 덮어쓰지 않고 `changeReasons`로 변경 이유를 별도 제공, 근거 없으면 `suggestions`로만 | 허위 성과·과장은 채용 단계에서 치명적 리스크 → 신뢰 우선 | 자동 반영이 더 편하지만 사용자 검증 단계를 의도적으로 강제 |
| 거래 장부(ledger) | 잔액을 직접 갱신하지 않고 변동분 + 변동후잔액을 행 단위로 기록(`credit_transaction`/`benefit_transaction`) | 감사 추적·환불·정산 무결성. "왜 줄었지"를 항상 추적 가능 | 테이블·쓰기 비용 증가 vs `users.credit` 단일 컬럼 갱신 |
| 성공 기준 차감 | `status=SUCCESS`인 `ai_usage_log`만 차감 근거로 인정, 실패는 무료 | AI 호출이 실패했는데 과금하면 신뢰 붕괴. 기록과 차감을 분리해 실패도 로그엔 남김 | 차감 경로가 한 단계 늘지만 "실패 무료" 규칙이 명확 |
| 자체 첨삭 모델(설계) | 4종을 통합 모델 `careertuner-e-correction` 하나로, `CorrectionAiClient`를 폴백 진입점으로 설계 | 입출력이 동일해 모델 분할이 무의미. 향후 자체 LLM 5단 폴백을 한 지점에서 교체 | 현재는 OpenAI 단일 경로 + 3회 재시도(자체 LLM 미연동) |

### 왜 원문 보존인가 (가장 깊게)
첨삭은 "사실 생성" 책임이 무겁다. 없는 경력·지표를 그럴듯하게 추가하면 서류는 좋아 보여도 면접·평판조회에서 무너진다. 그래서 시스템 프롬프트에 `Do not invent achievements, metrics, employers, projects, or experiences`를 명시하고, 더 강한 문장이 근거를 필요로 하면 본문에 넣지 않고 `suggestion`으로 분리한다(`CorrectionPromptCatalog.SYSTEM_PROMPT`). result_json의 `changeReasons`는 사용자가 무엇을 왜 바꿨는지 검증한 뒤 선택 반영하도록 돕는 장치다. 같은 이유로 `correction_request`는 원문을 보존하는 append-only 테이블이고, 지원 건이 삭제돼도 `SET NULL` FK로 본문은 남는다.

## 4. 동작 원리 한눈에 — 첨삭 한 번의 일생

```text
POST /api/corrections
  → CorrectionService.create()
     1. 정규화·검증 (correctionType 화이트리스트, originalText ≤ 12000자)
     2. 소유권 검증 (applicationCaseId 있으면 ApplicationCaseAccessService 위임)
     3. featureType = "CORRECTION_" + correctionType
     4. CorrectionAiClient.correct()  ── OpenAI Responses, json_schema strict, 3회 재시도
        └ 실패 시 recordFailure(REQUIRES_NEW)로 실패 로그 남기고 재throw
     5. recordSuccess(REQUIRES_NEW) → ai_usage_log 행 + aiUsageLogId
     6. correction_request INSERT (original/improved/result_json, status=SUCCESS)
  → CorrectionResponse 반환
  ※ 여기서 끝. 크레딧/사용권 차감은 (현재) 호출되지 않는다.
```

핵심은 **5단계 사용량 로그가 `@Transactional(REQUIRES_NEW)`로 본 트랜잭션과 분리**된다는 점이다. AI 호출이 터져 본 트랜잭션이 롤백돼도 실패 로그(`status=FAILED, credit_used=0`)는 독립 커밋되어 감사 흔적이 남는다.

차감이 배선됐을 때의 설계 경로는 다음과 같다(테스트로만 검증됨).

```text
AiChargeService.charge(command)
  ├ feature 정책 없음 / includedInTicket=false → 크레딧만 차감
  ├ consumeByFeature() 성공 → "ticket" (사용권 1장 소모)
  ├ ALREADY_CONSUMED → skipped (멱등)
  └ 사용권 소진(INSUFFICIENT) → overagePolicy 확인
       CREDIT/FALLBACK_CREDIT → 크레딧 폴백 / BLOCK → 차단(throw)
```

## 5. 구현 상태 — 정직한 구분 (면접 신뢰의 핵심)

면접관이 "이거 진짜 도나요?"라고 물을 때 정확히 답하려면 이 표를 외운다.

| 항목 | 상태 | 한 줄 근거 |
| --- | --- | --- |
| 첨삭 백엔드 4종(생성/목록/단건) | ✅ 동작 | `/api/corrections` 실재, structured output + 3회 재시도 |
| Toss 결제 ready/confirm | ✅ 동작 | 금액 대조 + Idempotency-Key + 3중 멱등 |
| DEV provider 즉시 결제 | ✅ 동작 | 키 없이 구독/충전 흐름 검증(`provider=DEV`) |
| 크레딧/사용권 차감 엔진 | ✅ 완성·테스트 통과 | 조건부 원자적 UPDATE + 이중 멱등 |
| 결제/사용량 프론트(`Billing.tsx` 4탭) | ✅ 실 API 연동 | plans/usage/credits/history |
| **AI 실행 ↔ 과금 차감** | ⚠️ 미연결 | `AiChargeService.charge` 운영 호출처 0건(test에만) |
| **#28 요금제 추천** | ⚠️ 데이터만 준비 | 정책 seed만 존재, 산출 서비스 없음 |
| **첨삭 프론트(`Correction.tsx`)** | ⚠️ 정적 플레이스홀더 | `api()` 호출 0건, 버튼 disabled |
| 자체 LLM 5단 폴백 | ⚠️ 진입점만 | 현재 OpenAI 단일 경로 |
| 환불/관리자 크레딧 조정 | ⚠️ 스키마만 | REFUND/ADMIN_ADJUST 코드 경로 없음 |

:::warning 가장 중요한 한 문장
"차감 엔진은 원자적·멱등으로 완성돼 테스트를 통과하지만, **AI 기능 실행 경로와 아직 배선되지 않았습니다.** 그래서 지금 첨삭을 실행하면 `ai_usage_log`와 `correction_request`만 쌓이고 `users.credit`·`user_benefit_balance`는 차감되지 않습니다." — 이 갭을 먼저 말하면 신뢰가 올라간다.
:::

## 6. 면접 답변 3단계 템플릿

어떤 E 질문이 와도 이 3단계로 답한다.

1. **무엇·왜 (1문장)** — "이건 ~를 위한 ~입니다. ~한 이유로 이렇게 설계했습니다."
2. **어떻게 (실제 근거)** — 클래스/테이블/제약 이름을 하나라도 댄다. `CorrectionAiClient`, `credit_transaction`, `markPaidIfReady`, `uq_credit_transaction_ai_usage_type` 등.
3. **트레이드오프·갭 (정직)** — "대안은 ~였지만 ~를 우선했습니다" 또는 "이 부분은 설계·테스트까지 됐고 배선은 아직입니다."

예시 — "결제 위변조는 어떻게 막나요?"

> (1) 클라이언트가 보낸 금액을 믿지 않는 게 원칙입니다. (2) `ready` 단계에서 서버가 상품 가격을 확정해 `payment` 행을 `READY`로 선기록하고, `confirm`에서 로컬 금액·Toss 응답 `totalAmount`를 **둘 다** 대조한 뒤 `markPaidIfReady`로 `READY→PAID` 조건부 전환합니다. `order_id`·`payment_key` UNIQUE와 Toss `Idempotency-Key`로 중복 승인을 막습니다. (3) AI 호출은 일시 오류에 강하도록 3회 재시도하지만, 결제 confirm은 멱등성을 위해 일부러 재시도하지 않습니다 — 작업 성격이 반대라서요.

## 7. 꼬리질문 + 모범답안

::: details Q1. 첨삭 4종을 왜 한 도메인으로 합쳤나요?
입력(원문 + 컨텍스트)·출력(5필드 JSON)·검증·과금 흐름이 4종 모두 동일하기 때문입니다. 모델·서비스·클라이언트를 4벌로 두면 중복만 늘고, `correctionType`(SELF_INTRO/INTERVIEW_ANSWER/RESUME/PORTFOLIO)으로 분기하면 충분합니다. 과금 정책도 `benefit_code=CORRECTION` 한 풀을 공유해 일관성이 좋습니다. 분기점은 시스템 프롬프트가 아니라 `correctionType` 한 필드와, 사용량 키 `CORRECTION_*`뿐입니다.
:::

::: details Q2. 거래 장부(ledger) 방식이 뭐고 왜 썼나요?
잔액 컬럼을 직접 덮어쓰는 대신, 변동분(`amount`, ±)과 **변동후잔액**(`balance_after`)을 행 단위로 기록하는 방식입니다. `credit_transaction`(AI_USAGE/CHARGE/REFUND/ADMIN_ADJUST), `benefit_transaction`(GRANT/CONSUME)이 이렇게 동작합니다. 이유는 감사 추적과 정산 무결성입니다 — "크레딧이 왜 줄었는지"를 항상 행으로 역추적할 수 있고, 환불·조정도 새 행으로 표현됩니다. 트레이드오프는 쓰기·저장 비용 증가지만, 돈을 다루는 도메인에서는 추적성이 더 가치 있다고 판단했습니다.
:::

::: details Q3. "성공 기준 차감"은 무슨 뜻인가요?
차감의 단일 근거를 `ai_usage_log`로 두되, `status=SUCCESS`인 로그만 과금 대상으로 인정한다는 뜻입니다(`CreditServiceImpl.deductByAiUsageLog`의 가드 중 하나가 `NOT_SUCCESS`면 `skipped`). AI 호출이 실패했는데 돈을 빼면 신뢰가 무너지므로, 실패는 무료로 처리하면서도 실패 로그 자체는 별도 트랜잭션으로 남깁니다. 기록(감사)과 차감(과금)을 분리한 설계의 핵심입니다.
:::

::: details Q4. 동시에 두 번 누르거나 결제 콜백이 중복되면요?
크게 세 층으로 막습니다. (1) **조건부 원자적 UPDATE** — 크레딧은 `SET credit = credit - X WHERE credit >= X`, 사용권은 `WHERE remaining_quantity > 0`, 결제는 `markPaidIfReady`(READY→PAID)로 락 없이 음수·중복을 방지합니다. (2) **애플리케이션 선검사 + DB 유니크 이중 멱등** — 크레딧은 `existsTransaction` + `uq_credit_transaction_ai_usage_type(ai_usage_log_id,type)`, 사용권은 `existsConsumeTransaction` + `uq_benefit_consume_ref`, 결제는 `existsByPaymentKey` + `order_id/payment_key UNIQUE` + Toss Idempotency-Key. (3) 프론트는 `BillingSuccess`가 `useRef`로 confirm을 1회만 호출(StrictMode 중복 방지)하고, 버튼별 busy 키로 동시 클릭을 막습니다.
:::

::: details Q5. 왜 AI 호출은 재시도하고 결제 confirm은 재시도 안 하나요?
두 작업의 멱등성 성격이 반대이기 때문입니다. AI 호출은 일시적 5xx·timeout에 약하지만 재호출해도 부작용이 없으니 `CorrectionAiClient`는 3회 지수 백오프 재시도를 합니다(단, 타임아웃은 즉시 실패). 반대로 결제 승인은 중복 호출이 곧 중복 결제 위험이라, `TossPaymentClient`는 의도적으로 재시도하지 않고 1회만 승인하며 Idempotency-Key로 보호합니다. "재시도 정책이 정반대"라는 점 자체가 설계 의도입니다.
:::

::: details Q6. 가격·요금제 정책을 바꾸려면 코드를 배포해야 하나요?
아니요. 가격·혜택 수량·정책을 코드가 아니라 테이블(`subscription_plan`, `subscription_benefit_policy`, `ai_feature_benefit_policy`, `credit_product`)로 관리합니다(정책의 데이터화). DML만으로 정책을 바꾸되, 이미 구매한 사용자는 구매 시점 정책을 `policy_snapshot_json`으로 동결해 소급 변경되지 않게 보호합니다. 예약 변경은 `billing_policy_change`에 SCHEDULED로 등록하고, 조회 시점에 `effective_from <= now`인 최신 변경을 읽어 덮어쓰는 read-time lazy 방식이라 별도 배치 스케줄러가 없습니다.
:::

::: details Q7. 그럼 발효 시각이 지나면 자동으로 새 가격이 보이나요? 스케줄러 없이 어떻게요?
조회 시점 평가로 구현했습니다. `findLatestEffective(targetType, targetCode, now)`가 `effective_from <= now` AND `status='SCHEDULED'`인 최신 변경을 nextSnapshot으로 반환하므로, 시각이 지난 뒤 첫 조회부터 새 정책이 보입니다. cron 없이 운영 부담을 줄인 선택입니다. 다만 정직히 말하면 `applyMode`(NEXT_SUBSCRIPTION_PERIOD 등)는 저장만 되고 현재 read-time 평가는 모든 활성 조회에 즉시 일괄 반영되어, applyMode별 차등 적용은 아직 미완입니다.
:::

::: details Q8. 사용권(티켓)과 크레딧은 어떻게 다르고 어떻게 연결되나요?
사용권은 플랜이 매달 주는 "기능권 N장"(`user_benefit_balance`, 기간별 잔액)이고, 크레딧은 충전식 범용 화폐(`users.credit`)입니다. AI 기능은 먼저 사용권을 소모(`consumeByFeature`)하고, 사용권이 소진되면 `overagePolicy`가 `CREDIT/FALLBACK_CREDIT`일 때 크레딧으로 폴백합니다 — 이 분기를 `AiChargeService.charge`가 담당합니다. FREE 플랜에도 최소 혜택을 보장하는 FREE 폴백 정책이 있어 모든 사용자가 기본 사용권을 받습니다.
:::

::: details Q9. (정직성 테스트) 지금 첨삭을 실행하면 크레딧이 실제로 빠지나요?
아니요. 차감 엔진(`AiChargeService.charge`/`consumeByFeature`/`deductByAiUsageLog`)은 완성돼 테스트는 통과하지만, 운영 컨트롤러·서비스 어디에서도 호출되지 않습니다(호출처가 전부 `src/test`). 그래서 지금은 `ai_usage_log`와 `correction_request`만 쌓이고 잔액은 차감되지 않습니다. `ai_feature_benefit_policy`에 `CORRECTION_*` 4종(default_credit_cost=2)이 seed돼 있지만 차감을 호출할 지점이 아직 연결되지 않은 상태입니다. 엔진과 정책은 준비됐으니 배선은 한 지점 연결 작업입니다.
:::

::: details Q10. #28 요금제 추천은 어떻게 동작하나요?
설계상 사용량·잔액·최근 패턴을 보고 "결제 강요처럼 보이지 않게" 요금제/충전을 안내하는 기능이고, 1차는 규칙 기반이며 LLM은 설명 문구 초안에만 제한적으로 씁니다. 정직히 말하면 **산출 로직은 아직 없습니다** — `USAGE_PLAN_RECOMMENDATION` 정책 seed row만 있습니다. 다만 재료 데이터는 완비됐습니다: `getMonthlyUsage`(이번 달 feature별 집계), `listPlans`(가격·혜택), `myBenefits`(잔여량). "이번 달 사용량 vs 플랜 혜택" 비교 데이터가 다 있으니, 이를 묶는 규칙 엔진만 추가하면 됩니다.
:::

::: details Q11. 첨삭 화면은 동작하나요? 백엔드와 연결됐나요?
프론트는 아직입니다. `Correction.tsx`는 "첨삭 API 준비 중" 배너가 있는 정적 플레이스홀더로, `api()` 호출이 0건이고 버튼이 disabled이며 크레딧 단가가 클라 상수로 하드코딩돼 있습니다. **백엔드 `/api/corrections`는 실재**하므로, 프론트가 입력을 모아 POST하고 응답을 렌더하도록 연결하는 작업이 남았습니다. 즉 백엔드-프론트 미연결이지 백엔드 부재가 아닙니다.
:::

::: details Q12. 자체 LLM은 어디에 들어가나요?
설계 목표는 파인튜닝한 Qwen3-8B/4B + 공통 3B + 규칙엔진 + OpenAI의 5단 폴백입니다. 현재 코드는 OpenAI Responses 단일 경로 + 3회 재시도이고, `CorrectionAiClient`를 그 폴백 디스패처가 들어갈 단일 진입점으로 설계해 둔 상태입니다. 모델명 `careertuner-e-correction`은 지금은 OpenAI 모델에 매핑됩니다. 첨삭에 mock/룰베이스 폴백을 두지 않은 이유도 같습니다 — 사실 생성 책임이 무거워 더미 응답이 오히려 위험하기 때문입니다.
:::

::: details Q13. 영역 E와 다른 영역의 경계는 어디인가요?
첨삭은 A의 자소서·이력서 원본을 **참조**하지만 덮어쓰지 않고, 면접답변 첨삭(#24)은 D가 소개 탭을 두되 실제 실행은 E의 `/correction`으로 위임합니다(`CorrectionInfoTab`). 지원 건 소유권은 E가 직접 판단하지 않고 `ApplicationCaseAccessService.requireOwned`에 위임합니다. 그리고 `ai_usage_log`와 `ai_feature_benefit_policy`는 모든 영역이 공유하는 공동 자산이라, E의 billing 도메인은 사실상 전사 과금 엔진입니다.
:::

## 8. 직접 말해보기

소리 내어 답해보고, 막히면 해당 페이지로 돌아간다.

1. 영역 E를 1분으로 설명하라. (막히면 [영역 E 개요](/area-e/))
2. 첨삭이 원문을 어떻게 보존하는지 클래스/필드 이름과 함께 말하라. (→ [첨삭 설계 원칙](/area-e/correction-principles))
3. 크레딧 차감이 동시성·중복에 안전한 이유를 SQL 조건과 유니크 제약으로 설명하라. (→ [크레딧 시스템](/area-e/credit-system))
4. 결제 위변조 방지 흐름을 ready/confirm 2단계로 말하라. (→ [결제 흐름](/area-e/payment-flow))
5. "AI 실행과 과금 차감이 아직 배선 안 됐다"를 면접관이 신뢰하도록 30초로 설명하라.
6. #28 요금제 추천이 "데이터는 있는데 로직이 없다"는 상태를 정직하게 말하라.

:::tip 마무리 한 줄
영역 E의 면접 강점은 "정교한 과금 인프라를 거래 장부·멱등·정책 데이터화로 제대로 설계했다"와 "구현됨/미연결을 정직하게 구분한다"를 동시에 보여주는 것이다.
:::

## 퀴즈

<QuizBox question="현재 코드 기준, 첨삭을 한 번 실행하면 실제로 일어나는 일은?" :choices="['users.credit에서 크레딧이 즉시 차감된다', 'ai_usage_log와 correction_request만 쌓이고 잔액 차감은 일어나지 않는다', '사용권이 1장 소모되고 부족하면 크레딧으로 폴백된다', '결제 confirm이 자동 호출되어 PAID 처리된다']" :answer="1" explanation="차감 엔진(AiChargeService 등)은 완성·테스트 통과했지만 운영 경로에서 호출되지 않는다(호출처가 전부 src/test). 따라서 사용량 로그와 결과 행만 쌓이고 users.credit·user_benefit_balance는 차감되지 않는다." />

<QuizBox question="AI 호출(CorrectionAiClient)은 3회 재시도하는데 결제 confirm(TossPaymentClient)은 재시도하지 않는 이유로 가장 적절한 것은?" :choices="['결제 API가 더 빠르기 때문', '두 작업의 멱등성 성격이 반대라서 — 중복 승인은 곧 중복 결제 위험', 'OpenAI가 재시도를 막기 때문', 'Toss가 자동으로 재시도해 주기 때문']" :answer="1" explanation="AI 호출은 재호출해도 부작용이 없어 일시 오류에 강하게 재시도하지만, 결제 승인은 중복 호출이 중복 결제로 이어질 수 있어 1회만 승인하고 Idempotency-Key로 멱등을 보장한다." />

<QuizBox question="예약된 요금제 정책 변경이 발효 시각 이후 자동으로 반영되는 방식은?" :choices="['@Scheduled 배치가 매일 markApplied를 실행한다', 'cron 없이 조회 시점에 effective_from <= now인 최신 SCHEDULED 변경을 읽어 덮어쓰는 read-time lazy 방식', '관리자가 수동으로 모든 사용자 정책을 UPDATE한다', '결제할 때만 적용되고 조회에는 반영되지 않는다']" :answer="1" explanation="별도 스케줄러 없이 findLatestEffective로 조회 시점에 발효된 최신 변경을 반영한다. 단 applyMode별 차등 적용은 아직 미완이라 현재는 모든 활성 조회에 일괄 즉시 반영된다." />
