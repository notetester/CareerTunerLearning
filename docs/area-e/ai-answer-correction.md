# 면접 답변 첨삭 [#24]

> D가 보유한 면접 질문·답변·평가 맥락을 E의 공통 첨삭 계약으로 개선한다. 프런트 실행, 모델 선택, 이력, 소프트 삭제와 성공 시 과금까지 연결돼 있다.

## 영역 경계

D는 면접 세션과 답변 원본을 소유하고 E는 첨삭 결과를 소유한다. 사용자가 면접 화면에서 첨삭으로 이동하면 `sourceRefId`를 넘기고 E 서버가 `CorrectionSourceService`로 원문과 소유권을 다시 확인한다. 브라우저가 보낸 임의 원문을 신뢰하지 않는다.

```text
D interview_answer
  -> GET /api/corrections/sources/interview-answers/{answerId}
  -> E Correction.tsx
  -> POST /api/corrections (INTERVIEW_ANSWER)
  -> correction_request
```

## 입력과 출력

입력에는 면접 질문, 답변 원문, 연결된 지원 건과 평가 컨텍스트가 포함될 수 있다. 출력은 다음 다섯 필드다.

- `improvedText`
- `summary`
- `issues`
- `changeReasons`
- `suggestions`

질문 의도, STAR 구조, 본인 역할, 근거와 직무 연결을 개선하되 원문에 없는 성과는 만들지 않는다.

## provider와 모델 선택

기본 AUTO는 CareerTuner 자체 첨삭 모델 → Claude → OpenAI 순서다. 사용자는 CAREERTUNER, CLAUDE, OPENAI 중 하나를 골라 해당 tier부터 시작할 수 있다. 전부 실패하면 Mock 답변을 저장하지 않고 오류로 끝낸다.

## 저장과 과금

실행 전 정책 고지와 preflight를 거친다. 유효한 결과가 만들어지면 다음이 한 트랜잭션에서 확정된다.

1. SUCCESS `ai_usage_log`
2. 원문·개선문·source snapshot을 가진 `correction_request`
3. 사용권 우선 또는 크레딧 차감

동일 `requestKey` 재전송은 기존 결과를 replay해 모델 호출과 이중 차감을 막는다. 실패는 실패 로그만 남기고 과금하지 않는다.

## UI

`Correction.tsx`의 답변 탭은 실제 `useCorrections` hook을 사용한다. 면접 source 연결 상태, 질문, 원문, 지원 건, 모델 선택, 비용, 결과와 최근 20건 이력을 보여준다. 이력은 상세 조회와 소프트 삭제가 가능하다.

## 면접 답변

> "D의 면접 답변을 E가 직접 복사해 믿지 않고 source API로 소유권과 원문을 재조회합니다. 질문·답변·평가·공고 맥락을 공통 첨삭 provider 체인에 넣고 구조화된 개선문과 변경 이유를 저장합니다. 실행 전 preflight와 요청 키 멱등을 거쳐 성공 결과·로그·실차감을 확정하고, 실패하거나 모든 모델이 응답하지 않으면 과금하지 않습니다."

### 왜 Mock이 없나?

잘못된 면접 답변을 진짜 개선 결과처럼 제공하는 위험이 크기 때문이다. 가용성을 위해 거짓 성공을 만들지 않는다.

### 재시도 모델을 바꿀 수 있나?

가능하다. 기본 선택을 유지하더라도 사용자가 다른 모델로 새 실행을 만들 수 있다. 같은 요청 키 replay와 모델을 바꾼 새 실행은 구분한다.

<QuizBox question="D 면접 답변을 E 첨삭에 연결할 때 중요한 보안 경계는?" :choices="['브라우저가 준 원문을 그대로 신뢰한다', '서버 source API가 답변 소유권과 원문을 다시 확인한다', '모든 사용자의 답변을 공개한다', 'D 테이블을 프런트가 직접 조회한다']" :answer="1" explanation="CorrectionSourceService가 로그인 사용자 소유 답변인지 검증하고 신뢰할 source context를 만든다." />

<QuizBox question="면접 답변 첨삭 성공 시 과금 상태는?" :choices="['로그만 남고 잔액은 변하지 않는다', '결과·SUCCESS 로그·실제 차감이 멱등 트랜잭션에서 확정된다', '프런트가 잔액을 직접 줄인다', '실패도 차감한다']" :answer="1" explanation="CorrectionService의 chargeRequired 경로가 preflight 후 AiChargeService를 호출한다." />
