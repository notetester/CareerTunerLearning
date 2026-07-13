# E 프론트엔드 UI/UX — 첨삭과 결제

> 영역 E의 첨삭·결제 화면은 모두 실제 API에 연결돼 있다. 첨삭은 4종 입력, 모델 선택, 실행, 결과, 이력 조회·삭제를 제공하고 결제 화면은 추천·요금제·사용량·충전·결제 이력을 묶는다.

## 화면 구조

| 화면 | 역할 |
| --- | --- |
| `Correction.tsx` | 답변·자기소개서·이력서·포트폴리오 첨삭 |
| `Billing.tsx` | 요금제, 추천, AI 사용량, 크레딧, 결제 이력 |
| `BillingSuccess.tsx` | 결제 승인 콜백 |
| `BillingFail.tsx` | 결제 실패 안내 |
| `Pricing.tsx` | 공개 요금제·기능별 비용 비교 |

첨삭 페이지는 app route를 담당하지만 API·hook·type·결과·이력 컴포넌트는 `frontend/src/features/correction/` 아래로 분리돼 있다.

## 첨삭 페이지

### 네 가지 작업을 한 흐름으로 묶기

`Correction.tsx`는 탭을 다음 서버 타입으로 변환한다.

| 탭 | 서버 `correctionType` |
| --- | --- |
| 답변 첨삭 | `INTERVIEW_ANSWER` |
| 자기소개서 | `SELF_INTRO` |
| 이력서 | `RESUME` |
| 포트폴리오 | `PORTFOLIO` |

입출력 계약과 과금·이력 흐름이 같기 때문에 화면을 네 벌 복제하지 않고 탭과 메타데이터로 분기한다.

### 실제 사용자 흐름

```text
탭 선택
  -> 지원 건 선택(선택 사항)
  -> 원문·질문 입력 또는 면접 답변 source 연결
  -> ModelPicker에서 AUTO/CAREERTUNER/CLAUDE/OPENAI 선택
  -> 비용 고지 확인
  -> POST /api/corrections?model=...
  -> 개선문·요약·문제·변경 이유·제안 렌더링
  -> 최근 20건 조회, 상세 재열기 또는 소프트 삭제
```

`useCorrections`가 목록·상세·실행·삭제 상태를 관리한다. 실행 버튼은 빈 원문, source 로딩, 제출 중 상태에서 비활성화하고 spinner와 오류 메시지로 상태를 보여준다.

### 모델 선택

공통 `ModelPicker`로 사용자가 모델 tier를 명시할 수 있다. 기본값 `AUTO`는 자체 모델 → Claude → OpenAI 순서이고, 명시 선택은 해당 tier부터 시작해 하위 tier로 폴백한다. 선택한 모델이 실패했다고 자동으로 원래 선택을 숨기지 않으며, 다음 실행에서 사용자가 다시 다른 모델을 고를 수 있다.

### 멱등 재시도

프런트는 입력 fingerprint와 `requestKey`를 `sessionStorage`에 임시 보관한다. 네트워크 응답을 받지 못해 다시 눌러도 같은 요청 키를 재사용하고, 성공하면 제거한다. 서버는 사용자+요청 키로 기존 결과를 반환하고 DB 유니크 제약으로 경합도 막는다.

이 계약은 AI를 두 번 호출하고 크레딧을 두 번 차감하는 문제를 함께 막는다.

### 원문과 연결 컨텍스트

지원 건을 선택하면 공고·직무 맥락을 첨삭에 반영한다. D 면접 답변에서 진입한 경우 `sourceRefId`로 원문과 평가 맥락을 서버에서 다시 조회한다. 클라이언트가 다른 사용자의 텍스트를 임의로 주입하는 대신 서버가 소유권을 검증한 source를 사용한다.

### 결과와 이력

결과 카드는 개선문뿐 아니라 다음을 분리해 보여준다.

- 요약
- 발견한 문제
- 변경 이유
- 사실 근거가 더 필요한 제안
- 실제 사용 모델과 과금 결과

최근 기록은 현재 첨삭 유형과 선택한 지원 건 기준으로 불러온다. 기록 클릭 시 단건 API로 상세를 열고 삭제는 `DELETE /api/corrections/{id}`를 호출한다. 서버는 소프트 삭제하므로 감사 데이터가 물리적으로 사라지지 않는다.

## 첨삭 API 연결

| 사용자 행동 | API |
| --- | --- |
| 모델 warmup | `POST /api/corrections/warmup` |
| 첨삭 실행 | `POST /api/corrections?model=...` |
| 최근 목록 | `GET /api/corrections` |
| 상세 | `GET /api/corrections/{id}` |
| 삭제 | `DELETE /api/corrections/{id}` |
| 면접 답변 source | `GET /api/corrections/sources/interview-answers/{answerId}` |

모든 API는 로그인과 `AI_DATA` 동의를 요구한다.

## 과금과 UI

실행 전 `AiChargeCostBadge`가 서버 정책 기반 예상 비용을 보여준다. 사용자가 정책 고지에 동의한 뒤 요청하며, 서버는 preflight로 잔여 사용권·크레딧을 확인한다. 유효한 AI 결과가 만들어지면 결과 저장과 실제 토큰 기반 차감을 같은 트랜잭션에서 확정한다.

실패한 AI 호출은 실패 로그만 남고 차감하지 않는다. 동일 요청 키 재전송은 기존 결과와 과금 결과를 replay한다.

## Billing 페이지

Billing은 다음 데이터를 실제 API로 불러온다.

- 공개 플랜과 크레딧 상품
- 현재 구독·잔액·사용권
- 이번 달 AI 사용량
- 결제·크레딧 거래 이력
- 사용량 기반 요금제 추천
- 환불 요청과 정책

추천 카드는 `UPGRADE_PLAN`, `BUY_CREDITS`, `KEEP`을 색상과 CTA로 구분한다. 추천 API가 일시 실패해도 플랜·결제 핵심 화면은 유지한다.

## 결제 UX와 안전성

유료 구독·충전은 서버 ready 후 결제창을 열고, 콜백에서 confirm한다. 클라이언트 표시 금액을 승인 근거로 쓰지 않고 서버가 보관한 상품·주문 금액과 공급자 응답 금액을 대조한다.

`BillingSuccess`는 React StrictMode에서 effect가 두 번 실행될 수 있는 상황을 `useRef`로 방어한다. 서버도 주문·결제 키와 조건부 상태 전환으로 중복 승인을 막으므로 클라이언트와 서버가 각각 멱등 경계를 가진다.

## 반응형과 접근성

- 첨삭 본문과 이력 aside는 작은 화면에서 한 열, 큰 화면에서 두 열로 배치한다.
- 긴 원문은 resize 가능한 textarea와 글자 수 표시를 제공한다.
- 제출·로딩·삭제 상태는 버튼 비활성화와 텍스트로 함께 표현한다.
- 오류는 색상만 쓰지 않고 제목과 설명을 가진 alert로 노출한다.
- 탭·select·button 같은 표준 인터랙션 컴포넌트를 재사용한다.

## 구현 상태

| 항목 | 상태 |
| --- | --- |
| 첨삭 4탭 입력·실행 | 구현 |
| 공통 모델 선택 | 구현 |
| 지원 건·면접 source 연결 | 구현 |
| 결과·이력·상세·소프트 삭제 | 구현 |
| 요청 멱등 키 | 구현 |
| 비용 고지·preflight·실차감 | 구현 |
| 요금제 추천 카드 | 구현 |
| 결제 ready/confirm UI | 구현 |
| 모바일 한 열 / 데스크톱 2열 | 구현 |

## 면접 답변

> "첨삭 화면은 4개 유형을 하나의 API·hook 계약으로 통합했습니다. 사용자는 AUTO나 특정 모델을 선택하고, 지원 건 또는 면접 답변 원문을 연결해 첨삭할 수 있습니다. 입력 fingerprint에 묶인 요청 키로 네트워크 재시도를 멱등하게 만들었고, 서버의 preflight와 결과 저장·실차감 트랜잭션을 UI 비용 고지와 연결했습니다. 결과는 개선문과 변경 이유를 분리하고 최근 이력은 상세 조회와 소프트 삭제까지 제공합니다."

<QuizBox question="현재 Correction.tsx의 구현 상태로 맞는 것은?" :choices="['정적 샘플이며 API 호출이 없다', '첨삭 실행·모델 선택·결과·이력·삭제가 실제 API에 연결돼 있다', '결제 화면만 있고 첨삭 화면은 없다', '브라우저에서만 결과를 만들어 서버에 저장하지 않는다']" :answer="1" explanation="features/correction의 API와 useCorrections를 사용해 생성·목록·상세·삭제를 연결하고 ModelPicker와 결과·이력 컴포넌트를 렌더링한다." />

<QuizBox question="네트워크 오류 후 재실행이 중복 과금을 만들지 않게 하는 핵심은?" :choices="['버튼 색상을 바꾼다', '같은 입력 fingerprint의 pending requestKey를 재사용하고 서버가 기존 결과를 replay한다', '항상 새 탭을 연다', 'AI 호출을 생략한다']" :answer="1" explanation="프런트 임시 키와 서버 사용자+requestKey 멱등 계약, DB 유니크 제약이 함께 중복 실행을 막는다." />
