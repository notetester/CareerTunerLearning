# 결제·환불 흐름

> 결제는 서버가 상품·금액을 확정하는 ready와 공급자 승인 뒤 검증하는 confirm으로 나눈다. 환불도 사용자 preview·요청과 관리자 승인/거절 흐름이 구현돼 있다.

## 결제 ready

`POST /api/payments/toss/ready`는 로그인 사용자, 상품 코드와 정책 동의를 받는다.

1. 현재 환불 정책 acknowledgement를 검증한다.
2. 서버 상품·요금제 마스터에서 금액을 읽는다.
3. 고유 order ID를 만든다.
4. 구매 시점 요금·혜택·환불 정책 snapshot을 저장한다.
5. `payment.status=READY` 행을 만든다.
6. 결제창에 필요한 응답을 반환한다.

브라우저가 임의 금액을 최종 권위로 보낼 수 없다.

## confirm

`POST /api/payments/toss/confirm`은 성공 리다이렉트의 payment key, order ID, amount를 처리한다.

```text
로컬 READY 주문 조회와 소유권 확인
  -> 요청 금액과 로컬 금액 대조
  -> 공급자 confirm(Idempotency-Key=orderId)
  -> 공급자 totalAmount와 로컬 금액 대조
  -> READY -> PAID 조건부 전환
  -> 구독/크레딧 후처리와 장부
```

이미 PAID인 주문의 동일 confirm은 기존 결과를 반환할 수 있고, 다른 사용자·금액·결제 키 조합은 거절한다.

## 중복 방어

- order ID 유니크
- payment key 유니크
- 공급자 `Idempotency-Key`
- `markPaidIfReady` 조건부 상태 전환
- 프런트 성공 페이지의 StrictMode 중복 effect 방어

한 층의 선검사만 믿지 않고 공급자, 애플리케이션, DB에 각각 멱등 경계를 둔다.

## READY 취소

`POST /api/payments/toss/cancel`은 아직 승인되지 않은 READY 주문을 취소한다. PAID 결제를 단순 READY 취소 API로 되돌리지 않는다.

## 환불 정책과 요청

환불은 별도 사용자·관리자 흐름이다.

| API | 역할 |
| --- | --- |
| `GET /api/billing/refund-policy` | 현재 정책 조회 |
| `POST /api/billing/refunds/preview` | 결제·사용 여부 기준 환불 가능성과 금액 미리보기 |
| `POST /api/billing/refunds` | 사용자 환불 요청 |
| `GET /api/billing/refunds` | 내 요청 이력 |
| `GET /api/admin/refunds` | 권한 있는 관리자 목록 |
| `POST /api/admin/refunds/{id}/approve` | 환불 승인·정산 |
| `POST /api/admin/refunds/{id}/reject` | 사유와 함께 거절 |

관리자 승인은 `BILLING_UPDATE`, 조회는 `BILLING_READ` 권한이 필요하다.

## 왜 정책 snapshot이 필요한가

결제 후 환불 규칙이나 플랜 혜택이 바뀌더라도 과거 구매를 새 정책으로 재해석하면 안 된다. payment의 `policy_snapshot_json`에 구매 당시 정책 버전·요약·규칙과 acknowledgement를 저장해 분쟁 시 근거로 사용한다.

## 환불과 사용량

환불 서비스는 결제가 PAID인지, 기간 조건, 크레딧이나 사용권 사용 여부와 정책의 `usedPolicy`를 평가한다. 승인 시 환불 거래와 필요하면 지급 자산 회수/상쇄를 처리하고 사용자에게 결과 알림을 보낸다.

“REFUND enum만 있다”가 아니라 사용자 요청과 관리자 심사 경로가 실제 존재한다.

## Sites 백업 데모 경계

공개 정적 Sites 환경에서는 실제 금전 변경 API를 막고 데모 설명만 제공한다. 결제·환불은 인증된 운영 백엔드와 공급자 callback, 비밀키가 필요한 기능이므로 mock 데모가 실제 결제로 오인되면 안 된다.

## AI 과금과 연결

결제로 받은 사용권·크레딧은 `AiChargeService`가 실제 AI 성공 경로에서 소비한다. 첨삭은 결과·사용량 로그·차감을 같은 트랜잭션으로 확정한다. 결제 도메인이 AI 실행을 직접 호출하지 않고, 공통 과금 서비스가 자산 소비를 담당한다.

## 면접 답변

> "결제 ready에서 서버 상품 가격과 환불 정책 snapshot을 고정하고, confirm에서 요청·로컬 주문·Toss 응답 금액을 모두 대조합니다. order/payment key 유니크, 공급자 Idempotency-Key와 READY→PAID 조건 전환으로 중복을 막습니다. READY 취소와 별도로 환불 preview·사용자 요청·관리자 승인/거절도 구현돼 있고, 구매한 사용권·크레딧은 AI 성공 경로의 공통 AiChargeService가 실제 소비합니다."

<QuizBox question="결제 금액의 최종 권위는?" :choices="['브라우저 표시값', '서버 상품·READY 주문과 공급자 confirm 응답의 일치', 'URL query', 'LLM 추천']" :answer="1" explanation="클라이언트 값을 단독으로 신뢰하지 않는다." />

<QuizBox question="현재 환불 상태로 맞는 것은?" :choices="['스키마 enum만 있다', '사용자 preview·요청과 관리자 권한 기반 승인/거절이 구현돼 있다', '모든 결제를 자동 환불한다', '프런트에서 DB를 직접 수정한다']" :answer="1" explanation="RefundRequestController와 AdminRefundRequestController, RefundRequestService가 실제 경로를 제공한다." />
