# 크레딧·사용권 시스템

> AI 기능은 플랜 사용권을 먼저 소비하고 정책이 허용하면 크레딧으로 폴백한다. 첨삭을 포함한 운영 실행 경로에 실제 차감이 연결돼 있으며 장부와 멱등 제약으로 추적한다.

## 사용권과 크레딧

| 자산 | 성격 | 저장 |
| --- | --- | --- |
| 사용권 | 플랜이 기간별로 주는 기능군 이용 횟수 | `user_benefit_balance` |
| 크레딧 | 충전·보상으로 얻는 범용 잔액 | `users.credit` |

사용권은 `benefit_code`별이고 크레딧은 여러 AI 기능에 공통으로 쓸 수 있다.

## 차감 순서

`AiChargeServiceImpl.charge`는 기능 정책을 읽어 다음 순서로 처리한다.

```text
기능 정책 없음 또는 ticket 미포함
  -> 크레딧 차감

ticket 포함
  -> 사용권 consume
       성공 -> ticket 결과
       이미 소비 -> 멱등 skipped
       부족 + CREDIT/FALLBACK_CREDIT -> 크레딧 폴백
       부족 + BLOCK -> 오류
```

`UPGRADE` 같은 정책은 결제 강제 대신 부족 오류와 요금제 안내 UX로 연결할 수 있다.

## 비용 계산

명시 비용이 있으면 우선 사용한다. 그렇지 않으면 기능 정책에 token 단위 범위가 있으면 다음처럼 계산한다.

```text
ceil(tokenUsage / creditUnitTokens)
  -> minCreditCost 이상
  -> maxCreditCost 이하
```

token 정책이 없으면 구독 혜택 또는 기능의 기본 비용을 사용한다. 모델이 비용을 결정하지 않는다.

## 원자성

동시 요청에서 잔액이 음수가 되지 않도록 조건부 UPDATE를 사용한다.

```sql
UPDATE users
   SET credit = credit - :cost
 WHERE id = :userId
   AND credit >= :cost
```

사용권도 `remaining_quantity > 0` 조건으로 감소한다. 영향 행이 0이면 부족 또는 경쟁 패배로 처리한다.

## 멱등성

애플리케이션의 기존 거래 조회와 DB 유니크 제약을 함께 둔다.

- AI usage log + 거래 유형 중복 차단
- benefit 소비 참조 중복 차단
- correction 사용자 + request key 중복 차단
- 이미 처리된 참조는 `ALREADY_CHARGED`/skipped 결과

선검사는 친절한 결과를 만들고 유니크 제약은 최종 동시성 방어선이다.

## 장부

잔액 컬럼만 갱신하지 않고 변동 행을 함께 남긴다.

| 거래 | 예 |
| --- | --- |
| `CHARGE` | 결제 후 크레딧 지급 |
| `AI_USAGE` | 성공 AI 실행 차감 |
| `REFUND` | 승인된 환불 정산 |
| `ADMIN_ADJUST` | 권한 있는 관리자의 보정 |

`amount`와 `balance_after`로 “왜 현재 잔액이 되었는가”를 역추적할 수 있다. 관리자 보정 API도 요청 ID를 기준으로 멱등하게 처리한다.

## 실행 전 preview와 acknowledgement

`AiChargePreviewService`가 예상 사용권·크레딧 범위와 현재 환불 정책 정보를 반환한다. 사용자는 acknowledgement key를 보내고 preflight가 정책·잔액을 검증한다.

실제 token 수는 모델 응답 뒤에만 알 수 있으므로 실행 전에는 범위를 고지하고 실행 후 actual charge를 확정한다.

## 성공·실패 경계

- 성공 payload: usage log와 결과, 차감 장부 확정
- provider 실패: FAILED usage log만 기록, 차감 없음
- 결과 검증 실패: 성공 저장·차감 없음
- 동일 request key: 기존 결과·charge 결과 replay

## 저잔액 알림

차감 전 잔액이 10 이상이고 차감 후 10 미만으로 내려가는 순간에만 `CREDIT_LOW` 알림을 best-effort로 발행한다. 이미 낮은 잔액에서 반복 차감할 때 알림 폭주를 만들지 않는다.

## 구현 상태

| 항목 | 상태 |
| --- | --- |
| 사용권 우선·크레딧 폴백 | 구현 |
| token 기반 min/max 비용 | 구현 |
| 원자적 조건 차감 | 구현 |
| 장부·멱등 제약 | 구현 |
| 첨삭 실제 실행 연결 | 구현 |
| 공통 첫 성공 usage 정산 helper | 구현 |
| 관리자 크레딧 조정 | 구현, 세부 권한 필요 |
| 환불 요청·관리자 승인/거절 | 구현 |

## 면접 답변

> "플랜 사용권을 먼저 조건부 UPDATE로 소비하고, 소진 시 정책이 CREDIT 계열이면 크레딧으로 폴백합니다. 비용은 token 단위 min/max 또는 기본 정책으로 서버가 계산합니다. AI usage log와 참조 키를 멱등 기준으로 삼고 거래 장부에 amount와 balance_after를 남깁니다. 첨삭은 preflight 후 성공 결과·로그·실차감을 한 트랜잭션에서 확정하며 실패는 무료입니다."

<QuizBox question="사용권이 부족할 때 항상 크레딧을 차감하는가?" :choices="['항상', '구독 혜택의 overage policy가 CREDIT/FALLBACK_CREDIT일 때만', '프런트가 결정', '모델이 결정']" :answer="1" explanation="BLOCK 정책이면 부족 오류이고 허용된 정책에서만 크레딧 폴백한다." />

<QuizBox question="AI_USAGE 장부가 생기는 기준은?" :choices="['버튼 클릭', '유효한 성공 사용량 로그와 차감 실행', '모델 요청 전', '페이지 방문']" :answer="1" explanation="실패 로그는 감사용으로 남아도 차감 장부는 만들지 않는다." />
