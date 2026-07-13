# 자기소개서 첨삭 [#25]

> `correctionType=SELF_INTRO`로 자소서 문항 의도, 경험 구조, 성과 근거와 지원 직무 연결을 개선한다. 원문에 없는 사실은 본문에 추가하지 않는다.

## 입력

- 자기소개서 원문
- 문항 또는 질문
- 선택한 지원 건의 회사·직무 맥락
- 사용자 선택 모델

지원 건이 있으면 서버의 공통 소유권 서비스를 거쳐 컨텍스트를 조립한다. E가 B의 공고 원본을 수정하지 않는다.

## 출력 계약

```text
improvedText   개선문
summary        핵심 요약
issues         발견한 문제
changeReasons  무엇을 왜 바꿨는지
suggestions    확인이 필요한 보강 제안
```

성과·수치·회사·프로젝트를 새로 만들지 말라는 시스템 규칙을 두고, 근거가 필요한 보강은 `suggestions`로 보낸다. 사용자는 원문과 변경 이유를 비교한 뒤 반영 여부를 결정한다.

## 실행 흐름

```text
Correction.tsx cover 탭
  -> POST /api/corrections?model=...
  -> CorrectionService
  -> CareerTuner LoRA → Claude → OpenAI
  -> payload 검증
  -> 결과·사용량·차감 저장
```

프런트는 실제 API와 연결돼 있고 결과·최근 이력·삭제를 제공한다. 비용은 클라이언트 상수가 아니라 서버 정책을 조회하는 `AiChargeCostBadge`로 안내한다.

## 실패와 재시도

모델 provider가 모두 실패하면 `AI_UNAVAILABLE`이며 성공 행과 차감이 없다. 같은 네트워크 요청의 재전송은 동일 `requestKey`를 사용해 기존 결과를 반환한다. 다른 모델을 선택해 다시 첨삭하는 것은 새 실행이다.

## 면접 답변

> "자소서 첨삭은 네 첨삭 유형이 공유하는 correction 도메인에서 SELF_INTRO로 분기합니다. 질문과 지원 직무 맥락을 함께 넣되 원문에 없는 성과는 개선문에 만들지 않고 suggestion으로 분리합니다. 자체 모델·Claude·OpenAI 체인과 사용자 선택을 지원하고, 프런트 실행부터 결과 이력·소프트 삭제·성공 시 멱등 차감까지 연결했습니다."

<QuizBox question="자소서 첨삭에서 근거 없는 성과 보강은 어디에 두는가?" :choices="['improvedText에 사실처럼 추가', 'suggestions에 확인 과제로 분리', 'DB에서 원문을 수정', '결제 내역에 기록']" :answer="1" explanation="사용자가 사실을 확인하기 전에는 개선문에 넣지 않고 제안으로 분리한다." />

<QuizBox question="자소서 첨삭 구현으로 맞는 것은?" :choices="['프런트가 정적 샘플이다', 'SELF_INTRO 분기의 실제 API·provider·이력·차감 흐름이 연결돼 있다', 'OpenAI만 사용할 수 있다', '원문을 즉시 덮어쓴다']" :answer="1" explanation="Correction.tsx와 correction feature hook이 서버 생성·조회·삭제 API를 소비한다." />
