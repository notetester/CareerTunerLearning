# 결제 흐름 — PG 콜백 검증

> 결제는 "요청(ready) → PG 결제창 → 콜백(confirm)에서 서버가 다시 검증" 의 2단계다. 크레딧/사용권은 **선지급하지 않고**, 토스 승인이 검증을 통과한 뒤에만 지급한다.

## 1. 한 줄 정의 · 이 페이지가 답하는 면접 질문

CareerTuner의 결제는 토스페이먼츠(Toss Payments)를 외부 PG로 쓰는 **2단계 핸드셰이크**다. 클라이언트가 결제를 시작할 때 서버가 먼저 `payment` 행을 `READY` 상태로 박아두고(ready), 사용자가 결제창에서 카드 승인을 마치면 토스가 성공 URL로 리다이렉트한다. 그 콜백에서 서버는 토스 승인 API를 호출해 **결제 사실을 직접 재검증한 다음에야** 크레딧을 충전하거나 구독을 활성화한다.

이 페이지가 답하는 면접 질문:

- "PG 결제에서 클라이언트가 보낸 금액을 그대로 믿으면 왜 위험한가? 어떻게 막았나?"
- "결제 성공 콜백이 두 번 들어오거나 새로고침되면 크레딧이 두 배로 충전되지 않나?"
- "왜 크레딧을 결제창 띄울 때 미리 주지 않고, 콜백 검증 이후에 주는가?"
- "토스 승인 호출은 실패하면 재시도하나? AI 호출은 재시도하는데 왜 다른가?"

## 2. 왜 이렇게 설계했나 (의도·트레이드오프)

### 2-1. 핵심 원칙 — "클라이언트가 보낸 금액을 믿지 않는다"

브라우저에서 토스 SDK로 결제창을 띄울 때 금액·주문번호는 모두 클라이언트가 들고 있는 값이다. 만약 confirm 시점에 "클라이언트가 보낸 amount만큼 결제됐다"고 믿어버리면, 사용자가 1원 결제를 띄워놓고 confirm 요청의 amount만 10000으로 위조해 10000원어치 크레딧을 받을 수 있다.

이를 막으려고 **금액의 출처를 서버로 고정**한다. ready 시점에 서버가 상품 마스터(`credit_product`/`subscription_plan`)에서 가격을 읽어 `payment.amount`에 저장하고, confirm 때는 이 **서버 저장 금액**을 기준으로 (1) 클라가 보낸 amount, (2) 토스 승인 응답의 totalAmount 를 둘 다 대조한다. 셋이 모두 일치해야만 통과한다.

### 2-2. 선지급(先支給)이 아니라 검증 후 지급

크레딧/사용권은 "돈이 들어왔다는 사실을 서버가 확인한 뒤"에만 만들어진다. 결제 도메인(`payment`)은 잔액을 직접 만들지 않고, 토스 승인 검증을 통과한 뒤 **빌링 도메인의 지급 메서드에 위임**한다(`grantCreditsAfterPayment` / `activateSubscriptionAfterPayment`). 책임을 분리하는 이유:

- 결제 검증의 무결성(위변조 차단)과 잔액 변동(원장 기록)을 한 클래스에 섞지 않는다.
- DEV provider 결제(아래 4-5)와 토스 결제가 **같은 지급 메서드를 재사용**할 수 있다.

### 2-3. confirm은 재시도하지 않는다 (멱등성 우선)

| | AI 첨삭 호출 (`CorrectionAiClient`) | 결제 승인 (`TossPaymentClient`) |
| --- | --- | --- |
| 재시도 | 최대 3회, 지수 백오프 | **0회 (1회만)** |
| 이유 | 일시 오류(429/5xx/timeout)에 강해야 함 | 중복 승인 = 중복 청구 위험 |
| 멱등 보강 | — | `Idempotency-Key: orderId` 헤더 |

같은 시스템 안에 재시도 정책이 **정반대인 두 클라이언트**가 있는 이유는, 각 작업의 멱등성 성격이 다르기 때문이다. AI 호출은 다시 불러도 결과 텍스트가 또 생길 뿐이지만, 결제 승인을 두 번 부르면 두 번 청구될 수 있다. 그래서 confirm은 재시도를 의도적으로 배제하고, 그래도 같은 요청이 두 번 가는 경우를 대비해 `Idempotency-Key`를 토스에 넘긴다.

:::tip 트레이드오프 한 줄 요약
"AI는 다시 불러도 안전하니까 재시도하고, 돈은 다시 부르면 위험하니까 재시도하지 않는다." 재시도 정책은 기술 취향이 아니라 **작업의 멱등성**으로 결정된다.
:::

## 3. 어떤 기술로 구현했나 (실제 클래스·테이블 근거)

| 계층 | 클래스 / 파일 | 역할 |
| --- | --- | --- |
| 컨트롤러 | `PaymentController` (`@RequestMapping("/api/payments/toss")`) | `POST /ready`, `POST /confirm` 두 엔드포인트 |
| 서비스 | `PaymentServiceImpl` | ready/confirm 오케스트레이션, 금액·소유권·멱등 검증 |
| PG 클라이언트 | `TossPaymentClient` | 토스 승인 API(`/v1/payments/confirm`) 1회 호출 + 응답 파싱 |
| 설정 | `TossPaymentProperties` (`careertuner.toss.payments`) | secretKey, confirmUrl, success/failUrl, timeout(10s) |
| 지급 위임 | `BillingServiceImpl` | `grantCreditsAfterPayment`, `activateSubscriptionAfterPayment` |
| 매퍼 | `PaymentMapper.xml` | `insertPayment`, `markPaidIfReady`, `findByOrderId`, `existsByPaymentKey` |

핵심 테이블 `payment` 의 무결성 장치:

- `order_id` **UNIQUE**, `payment_key` **UNIQUE** — 주문번호·결제키 중복 차단(DB 레벨).
- `status` — `PENDING`/`PAID`/`FAILED`/`REFUNDED` (실 코드 경로는 `READY → PAID`).
- `policy_snapshot_json` — ready 시점의 가격·혜택 정책을 JSON으로 동결(소급 변경 방지).

프론트엔드 측:

- `paymentApi.ts` — `readyTossPayment(code, "CREDIT"|"SUBSCRIPTION")` → `/payments/toss/ready`, `confirmTossPayment(...)` → `/payments/toss/confirm`.
- `tossPaymentSdk.ts` — 브라우저 토스 SDK를 1회 lazy-load(`VITE_TOSS_CLIENT_KEY` 미설정 시 throw).
- `BillingSuccess.tsx` / `BillingFail.tsx` — 토스 리다이렉트 콜백 페이지.

## 4. 동작 원리 (흐름·표·작은 코드)

### 4-1. 전체 흐름

```text
[브라우저]                 [백엔드]                    [토스 PG]
   │  결제 버튼               │                            │
   ├── POST /ready ─────────▶│  payment 행 INSERT          │
   │                         │   status=READY              │
   │                         │   amount=서버가 결정         │
   │                         │   order_id 발급             │
   │◀── orderId, successUrl ─┤                            │
   │  토스 SDK 결제창 ──────────────────────────────────▶│  카드 승인
   │◀──── /billing/success?paymentKey&orderId&amount ─────┤  리다이렉트
   ├── POST /confirm ───────▶│  ① 소유권 검증              │
   │                         │  ② 로컬 검증(금액·상태·키)   │
   │                         │  ③ 토스 승인 API ─────────▶│  승인 확정
   │                         │  ④ 토스 응답 재검증◀────────┤  (DONE)
   │                         │  ⑤ markPaidIfReady          │
   │                         │  ⑥ 크레딧/구독 지급          │
   │◀── balance, status=PAID─┤                            │
```

### 4-2. ready — 서버가 결제 대기 건을 선기록

`PaymentServiceImpl.ready()`는 productType으로 분기한다(기본 `CREDIT`, `SUBSCRIPTION`). 크레딧 경로(`readyCredit`)를 축약하면:

```java
CreditProduct product = requireActiveProduct(productCode); // 서버에서 상품 조회
validateProduct(product);                                  // price>0, creditAmount>0

Payment payment = new Payment();
payment.setProvider("TOSS");
payment.setAmount(product.getPrice());          // ★금액은 서버가 결정
payment.setCreditAmount(product.getCreditAmount());
payment.setPolicySnapshotJson(...);             // 정책 스냅샷 동결
payment.setStatus("READY");
insertPaymentWithUniqueOrderId(payment);        // order_id 충돌 시 최대 3회 재생성
```

주문번호 형식은 `CT-{yyyyMMddHHmmss}-{userId}-{8자토큰}` 이고, 8자 토큰은 `SecureRandom` 으로 만든다. `order_id` UNIQUE 제약에 걸리면(`DuplicateKeyException`) 새 토큰으로 최대 3회 재생성한다.

### 4-3. confirm — 콜백에서의 다단 검증 (이 페이지의 핵심)

`confirm()`의 검증 순서는 그대로 면접 답변이 된다.

| 단계 | 검사 | 실패 시 에러 |
| --- | --- | --- |
| ① 소유권 | `findByOrderId` 후 `userId` 일치 | `FORBIDDEN` (남의 결제) / `NOT_FOUND` |
| ② provider | `provider == "TOSS"` | `INVALID_INPUT` |
| ③ 상태 | `status == "READY"` (이미 PAID면 별도 분기) | `CONFLICT` / `INVALID_INPUT` |
| ④ 금액(로컬) | `payment.amount == request.amount` | `INVALID_INPUT` |
| ⑤ 결제키 중복 | `existsByPaymentKey` 선검사 | `CONFLICT` |
| ⑥ **토스 승인 호출** | `tossPaymentClient.confirm(...)` | `PAYMENT_CONFIRM_FAILED` |
| ⑦ **토스 응답 재검증** | paymentKey·orderId·totalAmount 일치 + `status=="DONE"` | `PAYMENT_CONFIRM_FAILED` |
| ⑧ 상태 전환 | `markPaidIfReady` (READY→PAID 조건부 UPDATE) | 0행이면 멱등/`CONFLICT` |
| ⑨ 지급 | 크레딧 충전 또는 구독 활성화 | — |

⑥에서 토스를 부르기 **전에** 로컬 검증(①~⑤)을 먼저 통과시키는 게 포인트다. 위조·중복·남의 결제는 외부 호출 없이 빨리 쳐낸다.

⑦의 재검증이 "클라이언트를 믿지 않는다" 원칙의 마지막 빗장이다. 토스가 실제로 승인했다고 응답한 `totalAmount`까지 서버 저장 금액과 대조하므로, 중간에서 금액을 바꿔도 통과하지 못한다.

```java
// ⑦ 토스 응답을 서버 기준값과 다시 대조 (요약)
if (!request.paymentKey().equals(confirmed.paymentKey())) throw PAYMENT_CONFIRM_FAILED;
if (!payment.getOrderId().equals(confirmed.orderId()))    throw PAYMENT_CONFIRM_FAILED;
if (payment.getAmount() != confirmed.totalAmount())       throw PAYMENT_CONFIRM_FAILED;
if (!"DONE".equals(confirmed.status()))                   throw PAYMENT_CONFIRM_FAILED;
```

### 4-4. markPaidIfReady — 조건부 원자적 상태 전환

크레딧을 주기 직전에 상태를 한 번 더 원자적으로 전환한다.

```sql
UPDATE payment
   SET payment_key = #{paymentKey}, status = 'PAID', paid_at = CURRENT_TIMESTAMP
 WHERE order_id = #{orderId}
   AND status = 'READY'      -- ★ READY일 때만 PAID로 바뀐다
```

`WHERE ... AND status='READY'` 가 핵심이다. 두 요청이 동시에 confirm을 호출해도, **먼저 도착한 UPDATE만 1행을 바꾸고** 나중 요청은 0행이 된다. 0행이면 코드는 "이미 PAID 됐나?"를 다시 조회해서, PAID면 **이미 처리된 결과를 그대로 반환(멱등)**, 아니면 `CONFLICT`로 막는다. 결과적으로 **지급은 정확히 한 번만** 일어난다.

### 4-5. 지급 위임 — payment는 잔액을 직접 만들지 않는다

```java
if ("SUBSCRIPTION".equals(payment.getProductType())) {
    billingService.activateSubscriptionAfterPayment(userId, plan, policySnapshotJson);
} else {
    balance = billingService.grantCreditsAfterPayment(userId, productCode, creditAmount);
}
```

`grantCreditsAfterPayment`(`BillingServiceImpl`)는 `users.credit`을 올리고 `credit_transaction`(type=`CHARGE`)을 원장으로 남긴다. 이 메서드는 **DEV provider 결제(`purchaseCredits`)에서도 재사용**된다 — 지급 경로를 한 곳으로 모은 설계다.

### 4-6. DEV provider — PG 없이 흐름 검증

토스 시크릿 키가 없는 개발 환경에서도 구독/충전 전체 흐름을 검증할 수 있도록, `BillingServiceImpl`이 외부 PG 없이 즉시 PAID로 기록하는 대체 경로를 둔다(provider=`DEV`, orderId/paymentKey는 `DEV-`/`DEVKEY-` UUID). 클래스 주석에 명시: "실제 PG 연동 시 결제 승인 단계만 교체하면 된다."

## 5. 구현 상태 (됨 vs 계획) — 정직한 구분

### 됨 (코드 실재)

- 토스 ready/confirm **완전 구현** (외부 승인 API 호출 포함): 금액 위변조 방지, 3중 멱등성, 정책 스냅샷 동결.
- DEV provider 즉시 결제 경로(구독/크레딧 충전).
- 프론트 콜백 페이지(`BillingSuccess`/`BillingFail`)와 `confirmTossPayment` 실 연동.
- 관리자 결제 조회(목록·요약·상태 필터) 백엔드 + 화면.

### 계획/미구현 (근거 있는 갭)

- **환불·결제 취소 없음.** `payment.status` 의 `REFUNDED`, `credit_transaction` 의 `REFUND`/`ADMIN_ADJUST` 타입은 **스키마에만 정의**되어 있고, 환불/취소 API 코드 경로는 없다. confirm 이후를 되돌리는 흐름은 미구현이다.
- **결제 ↔ AI 과금 미배선.** 결제로 충전한 크레딧/사용권은 실제 AI 기능 실행 시 **차감되지 않는다**(차감 엔진은 완성·테스트 통과했으나 운영 경로에 호출 지점이 없음). 자세한 내용은 [크레딧 시스템](/area-e/credit-system) 참고.
- **혜택팩(BENEFIT_PACK) 구매 경로 없음** — 카탈로그 seed만 존재.

:::warning 정직하게 말할 것
"결제 성공/검증은 완성됐지만 **환불과 결제 후 과금 차감은 아직 미구현**"이라고 분명히 구분해서 말하라. 이 갭을 숨기지 않고 설명하면 오히려 시스템 경계를 정확히 이해하고 있다는 신호가 된다.
:::

## 6. 면접 답변 3단계

**1단계 (한 문장):** "결제는 ready/confirm 2단계로, 서버가 결제창을 띄우기 전에 금액을 고정하고, 콜백에서 토스 승인 API로 결제 사실을 직접 재검증한 뒤에만 크레딧을 지급합니다. 선지급은 하지 않습니다."

**2단계 (메커니즘):** "ready에서 `payment` 행을 READY로 선기록하면서 amount를 서버 상품 가격으로 박습니다. confirm에서는 소유권·상태·금액·결제키 중복을 로컬에서 먼저 검증하고, 그다음 토스 승인을 호출한 뒤 응답의 totalAmount와 status=DONE까지 다시 대조합니다. 마지막에 `WHERE status='READY'` 조건부 UPDATE로 READY→PAID 전환을 원자적으로 처리해, 동시 요청이 와도 지급은 한 번만 일어납니다."

**3단계 (트레이드오프):** "AI 호출은 일시 오류에 강하게 3회 재시도하지만, 결제 승인은 중복 청구를 막으려고 재시도하지 않고 대신 Idempotency-Key를 넘깁니다. 같은 시스템에서 재시도 정책이 정반대인 건 작업의 멱등성 성격이 다르기 때문입니다. 다만 환불과 결제 후 과금 차감은 아직 미구현 상태입니다."

## 7. 꼬리질문 + 모범답안

:::details Q1. 결제 성공 페이지를 새로고침하면 크레딧이 두 번 충전되지 않나?
안 된다. 두 가지 방어가 겹친다. (1) 프론트 `BillingSuccess.tsx`가 `useRef(requestedRef)`로 confirm을 **1회만** 호출한다(React StrictMode의 effect 이중 실행도 막음). (2) 그래도 confirm 요청이 두 번 가면, 서버의 `markPaidIfReady`가 `WHERE status='READY'` 조건이라 두 번째 UPDATE는 0행이 되고, 코드는 "이미 PAID"임을 확인해 **충전 없이 기존 결과를 그대로 반환**한다. 클라이언트·서버 양쪽에서 멱등이 보장된다.
:::

:::details Q2. 클라이언트가 confirm 요청의 amount를 위조하면?
세 군데에서 막힌다. ready 때 서버가 `payment.amount`를 상품 가격으로 고정했고, confirm에서 (1) `payment.amount == request.amount` 로컬 대조, (2) 토스 승인 응답의 `totalAmount == payment.amount` 재대조를 한다. 즉 위조 amount는 서버 저장값과도, 토스가 실제 승인한 금액과도 어긋나 `INVALID_INPUT` 또는 `PAYMENT_CONFIRM_FAILED`로 거부된다. "클라이언트가 보낸 금액을 믿지 않는다"가 코드로 구현된 부분이다.
:::

:::details Q3. 토스 승인 API 호출이 타임아웃되면?
`TossPaymentClient`는 재시도하지 않고, `HttpTimeoutException`/`IOException`/`InterruptedException`을 모두 `PAYMENT_CONFIRM_FAILED`로 매핑한다. 이때 `payment`는 여전히 READY 상태이므로 잔액은 변하지 않는다. 같은 orderId로 다시 confirm을 시도하면 토스에 보낸 `Idempotency-Key: orderId` 덕분에 중복 승인 없이 안전하게 재처리된다. 재시도를 코드가 자동으로 하지 않는 것은 의도된 설계다(중복 청구 방지).
:::

:::details Q4. 남의 결제 건을 confirm할 수 있나?
없다. confirm 첫 단계 `requireOwnedPayment`가 `findByOrderId`로 결제 행을 찾은 뒤 `payment.userId`와 인증 사용자 id를 비교한다. 다르면 `FORBIDDEN`을 던지고, 토스 호출 자체가 일어나지 않는다. orderId만 알아도 남의 결제를 가로챌 수 없다.
:::

:::details Q5. 결제는 됐는데 ready 이후 관리자가 상품 가격을 올리면, 이 사용자는 새 가격을 내야 하나?
아니다. ready 시점에 `policy_snapshot_json`으로 가격·혜택 정책을 JSON으로 동결해 두기 때문에, 이후 정책이 바뀌어도 이 결제 건은 가입 시점 값으로 처리된다. 소급 적용이 없다. 정책 스냅샷·예약 변경의 자세한 동작은 [요금제 게이팅](/area-e/plan-gating)을 참고.
:::

:::details Q6. 환불이나 결제 취소는 어떻게 처리하나?
현재는 **미구현**이다. `payment.status`의 `REFUNDED`와 `credit_transaction`의 `REFUND`/`ADMIN_ADJUST` 타입은 스키마 설계에 들어 있지만, 이를 트리거하는 API/서비스 코드는 없다. 만약 구현한다면 토스 결제 취소 API 호출 → `payment.status=REFUNDED` 전환 → `grantCreditsAfterPayment`의 반대 방향으로 `credit_transaction(REFUND, 음수)` 원장 기록 + 잔액 차감 순서가 될 것이고, 여기서도 멱등성(이미 환불된 건 재환불 금지)이 핵심이 된다.
:::

## 8. 직접 말해보기

다음을 막힘없이 설명할 수 있으면 이 주제를 이해한 것이다.

1. ready와 confirm이 각각 무엇을 하고, 왜 한 번에 안 하고 둘로 나눴는지.
2. confirm의 검증 단계를 소유권 → 로컬 → 토스 호출 → 토스 응답 재검증 순서로 읽어 내려가기.
3. `markPaidIfReady`의 `WHERE status='READY'` 한 줄이 동시성·멱등을 어떻게 보장하는지.
4. AI 호출은 재시도하는데 결제 승인은 재시도하지 않는 이유(멱등성).
5. "구현된 것(검증·지급)"과 "미구현(환불·과금 차감)"을 정직하게 구분하기.

## 퀴즈

<QuizBox question="confirm 단계에서 서버가 결제 금액의 위변조를 막는 핵심 방식은?" :choices="['클라이언트가 보낸 amount를 신뢰하고 그대로 사용한다','ready 때 서버가 저장한 amount를, confirm의 클라 amount 및 토스 응답 totalAmount와 모두 대조한다','토스 SDK가 클라이언트에서 금액을 검증해 서버는 검증하지 않는다','결제 후 관리자가 수동으로 금액을 확인한다']" :answer="1" explanation="금액의 출처를 서버로 고정한다. ready에서 상품 가격을 payment.amount에 저장하고, confirm에서 클라가 보낸 amount와 토스 승인 응답의 totalAmount를 둘 다 서버 저장값과 대조해 셋이 일치할 때만 통과시킨다." />

<QuizBox question="결제 성공 콜백이 중복 호출돼도 크레딧이 한 번만 지급되도록 보장하는 서버 측 장치는?" :choices="['프론트의 useRef 하나만으로 충분하다','markPaidIfReady의 WHERE status=READY 조건부 UPDATE — 0행이면 이미 PAID로 보고 멱등 반환','크레딧을 미리 선지급해 두기 때문에 중복이 없다','토스가 중복을 알아서 막아주므로 서버 로직이 필요 없다']" :answer="1" explanation="markPaidIfReady는 status=READY일 때만 PAID로 바꾸는 원자적 UPDATE다. 동시·중복 요청 중 먼저 도착한 것만 1행을 바꾸고, 나중 요청은 0행이 되어 '이미 PAID'를 확인 후 충전 없이 기존 결과를 반환한다. 프론트 useRef는 추가 방어일 뿐이다." />

<QuizBox question="AI 첨삭 호출(CorrectionAiClient)은 최대 3회 재시도하지만 토스 결제 승인(TossPaymentClient)은 재시도하지 않는다. 그 이유로 가장 적절한 것은?" :choices="['결제 API가 AI API보다 항상 빠르기 때문','결제 승인을 재시도하면 중복 청구 위험이 있어, 멱등성을 위해 의도적으로 1회만 호출하고 Idempotency-Key로 보강하기 때문','토스 API가 재시도를 금지하기 때문','AI 호출은 비용이 없어서 마음껏 재시도해도 되기 때문']" :answer="1" explanation="재시도 정책은 작업의 멱등성으로 결정된다. AI 호출은 다시 불러도 결과가 또 생길 뿐이라 일시 오류에 강하게 재시도하지만, 결제 승인을 두 번 부르면 중복 청구가 될 수 있어 재시도를 배제하고 Idempotency-Key를 토스에 넘긴다." />
