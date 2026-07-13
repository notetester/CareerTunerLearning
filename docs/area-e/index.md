# 영역 E — 첨삭·결제·크레딧

> 영역 E는 네 종류의 문서 첨삭과 전 영역이 공유하는 결제·사용권·크레딧 정책을 연결한다. 최신 기준에서는 첨삭 프런트, 자체→Claude→OpenAI provider 체인, 성공 결과 실차감, 요금제 추천까지 모두 운영 코드에 연결돼 있다.

## 기능 범위

| 번호 | 기능 | 식별자 | 현재 상태 |
| --- | --- | --- | --- |
| 24 | 면접 답변 첨삭 | `CORRECTION_INTERVIEW_ANSWER` | 구현 |
| 25 | 자기소개서 첨삭 | `CORRECTION_SELF_INTRO` | 구현 |
| 26 | 이력서 개선 | `CORRECTION_RESUME` | 구현 |
| 27 | 포트폴리오 설명 첨삭 | `CORRECTION_PORTFOLIO` | 구현 |
| 28 | 사용량 기반 요금제 추천 | `USAGE_PLAN_RECOMMENDATION` | 결정론 API·UI 구현 |

## 핵심 설계

### 첨삭 4종은 한 도메인

네 기능은 원문·지원 건 맥락·질문을 받아 개선문과 구조화 피드백을 만드는 계약이 같다. 그래서 별도 테이블과 모델 네 벌을 만들지 않고 `correctionType`으로 분기한다.

```text
CorrectionController
  -> CorrectionService
       -> CorrectionContextService
       -> CorrectionAiClient
            -> CareerTuner LoRA
            -> Claude
            -> OpenAI
       -> ai_usage_log
       -> correction_request
       -> AiChargeService
```

### 원문을 덮어쓰지 않는다

첨삭 결과는 원문과 별도 행으로 저장한다. 개선문, 변경 이유와 제안을 함께 보여주고 사용자가 선택적으로 반영하도록 한다. 없는 성과·경력·수치를 모델이 보충하지 못하게 하고, 근거가 필요한 강화는 suggestion으로 분리한다.

### 성공 결과만 과금한다

사용자는 실행 전에 예상 정책을 확인한다. 서버는 preflight로 잔여 사용권·크레딧을 검증하고, 유효한 모델 결과가 나온 뒤 결과 저장·사용량 로그·실제 차감을 한 트랜잭션에서 확정한다.

- 실패 호출은 무료다.
- 같은 `requestKey`는 기존 결과를 replay한다.
- 사용권을 먼저 쓰고 정책에 따라 크레딧으로 폴백한다.
- 원자적 조건 UPDATE와 유니크 제약으로 음수·중복을 막는다.

### 추천은 규칙으로 결정한다

#28은 LLM이 아니다. 월 AI 사용 15회 이상이면 가능한 다음 상위 플랜, 잔액 5 이하이면서 3회 이상 사용했으면 충전 상품, 나머지는 `KEEP`을 추천한다. 추천 API와 Billing 카드가 실제 연결돼 있다.

## 사용자 화면

`Correction.tsx`는 다음을 제공한다.

- 네 가지 첨삭 탭
- 지원 건 선택과 면접 답변 source 연결
- AUTO/CAREERTUNER/CLAUDE/OPENAI 모델 선택
- 실행 전 비용 고지
- 결과 카드와 최근 이력
- 상세 조회와 소프트 삭제
- 모바일 한 열·데스크톱 본문+aside 배치

`Billing.tsx`는 요금제·추천·사용량·크레딧 상품·결제 이력·환불 요청을 묶는다.

## 자체 모델

E의 Qwen2.5-3B Correction LoRA는 학습·repair 평가와 `SelfLlmCorrectionProvider` 연결 근거가 있다. AUTO 순서는 CareerTuner → Claude → OpenAI다. 사용자가 특정 모델을 고르면 그 tier부터 시작한다.

첨삭은 성공처럼 보이는 Mock을 두지 않는다. 전 provider가 실패하면 `AI_UNAVAILABLE`로 끝내고 저장·과금을 하지 않는다.

## 데이터

| 테이블 | 역할 |
| --- | --- |
| `correction_request` | 원문·개선문·구조화 결과·source snapshot·모델·상태 |
| `ai_usage_log` | provider 사용·token·성공/실패·크레딧 사용 |
| `user_benefit_balance` | 기간별 사용권 잔액 |
| `benefit_transaction` | 사용권 지급·소비 장부 |
| `credit_transaction` | 충전·AI 사용·환불·조정 장부 |
| `payment` | 결제 ready/confirm 상태 |
| `subscription_plan` | 요금제 마스터 |
| `ai_feature_benefit_policy` | 기능별 사용권·크레딧 정책 |

모든 사용자 삭제는 제품 원칙에 따라 소프트 삭제를 우선하며, 첨삭 삭제도 `DELETE` API가 `deleted_at`을 갱신한다.

## 결제 안전성

결제는 ready/confirm 두 단계다.

1. ready에서 서버가 상품과 금액을 확정하고 주문을 기록한다.
2. 공급자 결제창을 거친다.
3. confirm에서 로컬 금액과 공급자 응답 금액을 대조한다.
4. 조건부 `READY -> PAID` 전환과 결제 키 유니크 제약으로 중복을 막는다.
5. 구매 시점 정책 snapshot을 남겨 이후 가격 변경이 과거 주문에 소급되지 않게 한다.

## 문서 지도

- [면접 답변 첨삭](/area-e/ai-answer-correction)
- [자기소개서 첨삭](/area-e/ai-coverletter)
- [이력서 개선](/area-e/ai-resume-improve)
- [포트폴리오 첨삭](/area-e/ai-portfolio)
- [자체 첨삭 모델](/area-e/self-llm-correction)
- [첨삭 원칙](/area-e/correction-principles)
- [첨삭 데이터 모델](/area-e/correction-data-model)
- [크레딧 시스템](/area-e/credit-system)
- [플랜 게이팅](/area-e/plan-gating)
- [요금제 추천](/area-e/ai-plan-recommend)
- [사용량 대시보드](/area-e/usage-dashboard)
- [결제 흐름](/area-e/payment-flow)
- [프런트 UI/UX](/area-e/frontend-ui)
- [관리자 기능](/area-e/admin)
- [면접 플레이북](/area-e/interview-playbook)

## 1분 답변

> "영역 E는 네 종류 첨삭과 전사 과금 기반을 담당합니다. 첨삭은 단일 correction 도메인으로 통합하고 원문·개선문·변경 이유를 별도 저장해 사실을 보존합니다. AUTO는 자체 LoRA·Claude·OpenAI 순서이고 사용자가 특정 모델을 선택할 수도 있습니다. 실행 전 preflight 후 유효한 결과, 사용량 로그, 실제 사용권·크레딧 차감을 같은 트랜잭션으로 확정하며 요청 키로 재시도를 멱등하게 만듭니다. 사용량 기반 요금제 추천은 결제 강권을 피하려 LLM 대신 설명 가능한 규칙으로 구현해 Billing 카드까지 연결했습니다."

<QuizBox question="영역 E 첨삭의 현재 연결 상태로 맞는 것은?" :choices="['백엔드만 있고 화면은 정적이다', '프런트·provider 체인·결과 이력·실차감이 연결돼 있다', 'OpenAI 단일 경로만 있다', '실패해도 Mock 개선문을 저장한다']" :answer="1" explanation="Correction.tsx와 useCorrections가 실제 API를 사용하고 CorrectionService가 provider 결과·사용량 로그·차감을 확정한다." />

<QuizBox question="#28 요금제 추천의 방식은?" :choices="['정책 seed만 있다', 'LLM 단독 판단', '월 사용량·잔액·상품을 이용한 결정론 규칙과 UI 카드', '자동 결제']" :answer="2" explanation="BillingServiceImpl.recommendPlan과 /billing/plan-recommendation, Billing.tsx 추천 카드가 연결돼 있다." />
