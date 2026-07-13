# 요금제·AI 기능 게이팅

> 게이팅은 화면에서 버튼만 숨기는 기능이 아니다. 서버 정책으로 실행 가능성과 비용을 미리 확인하고, 성공 시 같은 정책으로 실제 정산한다.

## 정책 데이터

| 테이블 | 역할 |
| --- | --- |
| `subscription_plan` | 플랜 가격·상태 |
| `subscription_benefit_policy` | 플랜별 사용권 수량·초과 정책 |
| `ai_feature_benefit_policy` | AI 기능과 사용권·크레딧 비용 매핑 |
| `user_benefit_balance` | 사용자 기간별 잔여 사용권 |
| `billing_policy_change` | 예약 정책 변경 |

정책을 코드 분기 대신 데이터로 두어 플랜과 기능 비용을 독립적으로 운영한다. 구매 시점 정책은 snapshot으로 동결한다.

## 실행 흐름

```text
프런트 비용 preview
  -> 환불/사용 정책 확인
  -> acknowledgement key 생성
  -> AI 요청
  -> 서버 preflight
  -> provider 실행 + payload 검증
  -> AiChargeService actual settlement
```

preflight는 잔액과 동의를 미리 검사해 비싼 모델 호출 뒤 부족 오류가 나는 일을 줄인다. actual settlement는 실제 token 사용량과 경쟁 조건을 기준으로 최종 확정한다.

## 서버가 최종 권위인 이유

브라우저의 표시 비용은 변조되거나 오래될 수 있다. 서버는 실행 시점의 활성 정책과 사용자 잔액을 다시 읽는다. 프런트 badge는 안내이고 DB 정책과 조건부 UPDATE가 권위다.

## 초과 정책

| 정책 | 동작 |
| --- | --- |
| `BLOCK` | 사용권 부족 오류 |
| `CREDIT` | 크레딧으로 대체 |
| `FALLBACK_CREDIT` | 사용권 우선 후 크레딧 대체 |
| `UPGRADE` | 상위 플랜 안내가 필요한 부족 상태 |

구현 코드는 CREDIT 계열만 자동 차감으로 인정하며 나머지는 부족 오류로 보호한다.

## 예약 변경

관리자는 정책 변경을 발효 시각과 함께 저장할 수 있다. 조회 시점에 `effective_from <= now`인 최신 변경을 반영하는 read-time 방식으로 별도 cron 의존을 줄인다. 적용 모드별 의미는 정책 운영 문서와 회귀 테스트로 관리해야 한다.

## 현재 연결 상태

| 항목 | 상태 |
| --- | --- |
| 정책 조회·preview | 구현 |
| acknowledgement·preflight | 구현 |
| 실제 사용권/크레딧 정산 | 구현 |
| Correction.tsx 비용 고지 | 구현 |
| 첨삭 결과 트랜잭션 연결 | 구현 |
| #28 추천 API·카드 | 구현 |
| 관리자 정책 관리 | 구현, 세부 권한 적용 |

## 요금제 추천과의 차이

게이팅은 “지금 이 기능을 실행할 수 있는가, 비용은 얼마인가”를 결정한다. #28 추천은 “현재 사용 패턴에 어떤 플랜·충전 안내가 적절한가”를 제안한다. 추천이 KEEP이어도 특정 유료 기능의 잔액이 부족할 수 있고, 추천이 업그레이드여도 자동 결제하지 않는다.

## 면접 답변

> "기능 비용을 프런트 상수로 두지 않고 요금제·혜택·AI 기능 정책 테이블로 분리했습니다. 실행 전 preview와 acknowledgement로 예상 비용을 고지하고 서버 preflight가 잔액을 확인합니다. 유효한 결과 뒤 actual charge가 실제 token과 동시성 조건으로 정산합니다. 첨삭 UI와 운영 실행 경로에 연결돼 있고, 요금제 추천도 별도 결정론 API로 제공하지만 자동 결제는 하지 않습니다."

<QuizBox question="preflight와 actual charge를 둘 다 두는 이유는?" :choices="['같은 DB를 두 번 쓰기 위해', '모델 호출 전 부족을 줄이되 실제 token과 경쟁 조건은 성공 후 확정하기 위해', '프런트를 우회하기 위해', '실패도 과금하기 위해']" :answer="1" explanation="사전 UX와 최종 정산은 서로 다른 시점의 책임이다." />

<QuizBox question="게이팅의 최종 권위는?" :choices="['클라이언트 badge', '서버 활성 정책과 원자적 DB 갱신', 'LLM 응답', 'CSS 클래스']" :answer="1" explanation="브라우저 표시값은 안내이며 서버가 정책과 잔액을 다시 검증한다." />
