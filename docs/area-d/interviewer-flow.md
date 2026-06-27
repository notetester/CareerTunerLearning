# AI 면접관 대화 진행 [#21]

> 면접은 "질문 하나 → 답변 → 다음 액션(다음 질문/재질문/종료)"의 상태 전이다. CareerTuner는 이 진행을 **서버 상태(질문·답변)에서 매번 다시 계산**하고, 사용자 답변은 **절대 수정하지 않는다**.

## 1. 한 줄 정의 · 이 페이지가 답하는 면접 질문

**AI 면접관 대화 진행(#21)** 은 한 세션 안에서 "지금 어느 질문까지 왔고, 다음에 무엇을 해야 하는가"를 결정하는 흐름이다. 텍스트 진행과 실시간 음성 면접관 두 갈래로 구현돼 있다.

면접에서 이렇게 물어볼 수 있다.

- "AI 면접관이 다음 질문으로 넘어갈지, 다시 물을지, 끝낼지는 어떻게 정하나요?"
- "대화 상태를 서버 세션 객체에 들고 있나요, 아니면 매 요청마다 다시 계산하나요?"
- "사용자가 입력한 답변을 AI가 다듬어서 저장하나요?"

핵심 답은 세 가지다. (1) **별도의 대화 상태 머신 객체가 없다.** 진행 상태는 DB의 질문·답변 행에서 **stateless하게 재계산**된다(`getProgress`). (2) **다음 액션은 "답변이 없는 첫 질문"** 이다 — 그게 없으면 종료다. (3) **사용자 답변 원문은 불변** — `answer_text`에는 사용자가 친 그대로 들어가고, AI의 가공물(점수·피드백·개선답변)은 **별도 컬럼**에 들어간다.

:::warning 용어 정리 — "InterviewOrchestrationService"는 없다
이 영역에 `InterviewOrchestrationService`라는 클래스는 **존재하지 않는다.** 진행 관련 로직은 두 곳에 나뉘어 있다.
- **텍스트 진행:** `InterviewServiceImpl.getProgress` (상태 재계산)
- **실시간 음성 면접관:** `InterviewRealtimeService.buildInstructions` (대화 규칙을 프롬프트로 위임)

한편 답변 평가의 자율 루프를 도는 오케스트레이터는 `InterviewAgentOrchestrator`인데, 이건 **#22(답변 평가)** 소관이고 "대화 진행"과는 책임이 다르다. 이 페이지는 진행(#21)에 집중하고 평가 루프는 [답변 평가](/area-d/answer-evaluation)에서 다룬다.
:::

## 2. 왜 이렇게 설계했나 (의도 · 트레이드오프)

### 2.1 대화 상태를 들고 있지 않고 매번 재계산하는 이유

면접 진행은 "지금 몇 번째 질문"이라는 커서를 서버 메모리에 들고 다니면 가장 단순해 보인다. 하지만 CareerTuner는 그러지 않았다.

| 선택지 | 설명 | 채택 |
| --- | --- | --- |
| 서버 세션에 진행 커서 보관 | `currentIndex` 같은 가변 상태를 메모리/세션에 유지 | ✗ |
| DB 행에서 매 요청마다 재계산 | 질문 목록 vs 답변 목록을 비교해 "답 안 한 첫 질문"을 도출 | ✓ |

후자를 택한 이유는 분명하다.

- **새로고침·재접속·복습 재개에 강하다.** "이어서 복원하기"(`markSessionResumed`)로 며칠 뒤 다시 들어와도, 진행 상태는 DB의 질문·답변에서 그대로 도출된다. 들고 있던 커서가 날아갈 일이 없다.
- **순서 무관 답변을 허용한다.** 사용자가 3번 질문을 먼저 답해도, "답 안 한 질문 중 가장 앞"이 다음으로 잡힌다.
- **단일 진실 원천(SSOT).** "어디까지 왔나"의 진실은 오직 `interview_answer` 행의 존재 여부다. 별도 상태와 DB가 불일치할 여지가 없다.

트레이드오프: 매 진행 조회가 질문/답변 두 쿼리를 돈다(`O(n)` 스캔). 하지만 한 세션의 질문은 최대 15개 수준이라 비용이 무의미하다.

### 2.2 사용자 답변 비수정 원칙

가장 중요한 설계 약속이다. **AI는 사용자 답변 원문을 절대 덮어쓰지 않는다.**

- 입력은 `answer_text`에 사용자가 친 그대로 저장된다.
- AI가 만든 것은 전부 **다른 컬럼**으로 분리된다: `score`, `feedback`, `improved_answer`.

왜 중요한가. (1) **신뢰** — "내가 뭐라고 답했는지"가 AI 손을 타면 복습·리포트가 거짓이 된다. (2) **첨삭 비교 UX** — 내 원답과 AI 개선답을 나란히 보여주려면(첨삭 탭) 원본이 보존돼야 한다. (3) **학습 데이터 정합성** — 자체 LLM 학습 샘플(`interview_training_sample`)의 입력은 사용자 원답이어야 채점기를 제대로 학습시킨다.

## 3. 어떤 기술로 구현했나 (실제 클래스 · 테이블 근거)

| 책임 | 위치 |
| --- | --- |
| 텍스트 진행 상태 계산 | `InterviewServiceImpl.getProgress` |
| 진행 응답 DTO | `InterviewProgressResponse(sessionId, totalQuestions, answeredQuestions, finished, currentQuestion)` |
| 진행 조회 REST | `InterviewController.getProgress` → `GET /api/interview/sessions/{sessionId}/progress` |
| 실시간 음성 면접관 발급 | `InterviewRealtimeService.createSession` / `buildInstructions` |
| 실시간 발급 REST | `POST /api/interview/sessions/{sessionId}/realtime` |
| 답변 저장(원문 불변) | `InterviewServiceImpl.submitAnswer` → `interview_answer` INSERT |
| 세션 종료 = 리포트 | `InterviewServiceImpl.getReport` → `updateSessionResult(... ended_at)` |

데이터 경계: 진행 판단은 `interview_question`(준비된 질문)과 `interview_answer`(답변 기록) 두 테이블만 본다. 진행 자체를 위한 별도 상태 테이블은 없다.

## 4. 동작 원리 (흐름 · 표 · 작은 코드)

### 4.1 텍스트 진행 — 상태 재계산

`getProgress`의 핵심은 "답변 행이 있는 질문"과 "없는 질문"을 가르는 단순 루프다.

```java
// InterviewServiceImpl.getProgress — 의사코드 축약
Set<Long> answeredIds = answersOf(session).stream()
        .map(InterviewAnswer::getQuestionId).collect(toSet());

InterviewQuestion next = null;
int answered = 0;
for (InterviewQuestion q : questionsOf(session)) {   // sort_order 순
    if (answeredIds.contains(q.getId())) answered++;
    else if (next == null) next = q;                 // 답 안 한 첫 질문
}
boolean finished = !questions.isEmpty() && next == null;
return new InterviewProgressResponse(
        sessionId, questions.size(), answered, finished,
        next == null ? null : InterviewQuestionResponse.from(next));
```

이 함수는 "다음 액션"을 명령형으로 들고 있지 않다. 대신 **상태를 묘사**한다.

| 상태 | 의미 | 클라이언트가 해석하는 다음 액션 |
| --- | --- | --- |
| `currentQuestion != null` | 답 안 한 질문이 남음 | **다음 질문** 표시 |
| `finished == true` | 모든 질문에 답함 | **종료** → 리포트로 |
| 질문 0개 | 아직 생성 안 됨 | 질문 생성 유도 |

"재질문"(꼬리질문)은 진행 상태가 아니라 **답변의 질**에서 나온다. 답변이 부실하면 #22 평가 루프가 PROBE 플래그를 세우고, 압박 모드에서 꼬리질문을 1회 붙인다([꼬리 질문](/area-d/followup-questions)). 즉 진행기는 "다음/끝"만 보고, "다시 물을지"는 평가가 결정한다 — 책임 분리다.

:::tip 진행 응답은 `currentQuestion`을 함께 내려준다
DTO 필드명은 `currentQuestion`이지만 의미는 "다음에 답해야 할 질문"이다. 프런트가 별도 질문 조회를 한 번 더 하지 않도록 진행 상태와 질문 본문을 한 응답에 묶었다.
:::

### 4.2 실시간 음성 면접관 — 진행을 모델에게 위임

WebRTC 음성 면접에서는 서버가 한 턴 한 턴 진행을 제어하지 않는다. 대신 **진행 규칙 전체를 instructions(시스템 프롬프트)로 만들어** OpenAI Realtime 모델에 넘기고, 단기 ephemeral key만 발급한다.

```text
[buildInstructions가 만드는 면접관 지시문 — 축약]
회사: {회사명}  직무: {직무명}  면접 유형: {모드 라벨}
진행 규칙:
- 한 번에 질문 하나만. 답하면 짧게 반응하고 다음으로.
- 답변이 부실하면 한 번 정도 꼬리 질문으로 파고든다.
- 정답을 대신 말해주지 않는다.
- 인사 → 자기소개 요청 → 아래 질문 → 마무리 순서.
준비된 질문 목록(이 순서대로):
 1. ...  2. ...  (본질문 최대 6개, 꼬리질문 제외)
```

여기서 면접관의 "다음/재질문/종료" 판단은 **모델 안에서** 일어난다. 서버 코드는 진행 흐름을 직접 돌리지 않고, 대화 규칙을 자연어로 명세해 위임한다. 핵심 구현 포인트:

- **본질문만 주입** — `parentQuestionId == null` 필터 후 `limit(6)`. 꼬리질문은 모델이 즉석에서 판단하도록 비운다(ADR-002).
- **키 프록시** — 서버가 OpenAI 키를 쥐고 `/realtime/client_secrets`로 단기 토큰(`value/expiresAt/model/voice/url`)만 내려준다. 브라우저는 이 토큰으로 OpenAI에 **직접** WebRTC 연결한다. 키는 브라우저에 노출되지 않는다.
- **DB 저장 없음** — 이 경로는 키 발급만 한다. 음성 면접 결과는 별도 미디어 분석 흐름([미디어 처리](/area-d/media-handling))에서 저장된다.
- **폴백 없음** — 이 경로만 OpenAI 전용이다. 키가 없으면 곧장 예외다(생성·채점의 [폴백 게이트웨이](/area-d/fallback-gateway)와 다르다).

### 4.3 답변 저장 — 원문과 AI 가공물의 분리

`submitAnswer`가 한 행을 INSERT할 때 컬럼이 어떻게 채워지는지가 비수정 원칙의 실체다.

| 컬럼 | 출처 | 가공 여부 |
| --- | --- | --- |
| `answer_text` | 사용자 입력 원문 | **불변** |
| `audio_url` / `video_url` | 미디어 참조(있으면) | 그대로 |
| `score` | 평가 루프 결과 | AI 산출 |
| `feedback` | 평가 루프 결과 | AI 산출 |
| `improved_answer` | 평가 루프의 개선안 | AI 산출(원문과 별도) |

답변이 들어오면 평가 루프가 돌고, 그 산출물(`score/feedback/improvedAnswer`)이 **다른 컬럼**으로 함께 저장된다. 사용자 원문은 어떤 단계에서도 덮어쓰이지 않는다.

### 4.4 세션 종료 = 리포트 생성

별도의 "면접 종료" API는 없다. **리포트 생성이 곧 세션 종료**다. `getReport`가 리포트를 만들 때 `updateSessionResult(..., LocalDateTime.now())`로 `interview_session.ended_at`을 세팅하면서 세션을 닫는다.

```text
진행 → finished=true → (사용자가) 리포트 요청
        → getReport: 답변 transcript로 리포트 생성
        → updateSessionResult(total_score, report JSON, ended_at = now)  ← 종료 확정
```

이 설계의 의도는 UX 단순화다. "끝내기" 버튼과 "결과 보기" 버튼을 따로 두지 않고, 결과를 보는 행위가 곧 세션을 마감한다.

## 5. 구현 상태 (됨 vs 계획) 정직 구분

**구현됨 (런타임 동작):**

- `getProgress` 상태 재계산(다음 질문 / 종료 판정), `InterviewProgressResponse` 반환.
- 실시간 음성 면접관 ephemeral key 발급(`buildInstructions` + `/realtime/client_secrets`), 본질문 6개 주입, 키 프록시.
- 사용자 답변 원문 불변 저장, AI 가공물 별도 컬럼 분리.
- 세션 종료 = 리포트 생성(`ended_at` 세팅).
- 프런트 API 래퍼 `getInterviewProgress`(`/progress`) 및 데모/튜토리얼 더미 분기 존재.

**정직히 밝힐 것:**

- **`getProgress`는 별도 "대화 상태 머신"이 아니다.** 매 호출마다 DB에서 재계산하는 순수 파생값이다. 진행을 위한 상태 테이블/세션 객체는 없다.
- **진행 폴링이 프런트 주 UI 흐름은 아니다.** 실제 화면은 탭형 `InterviewPage` 구조라, 질문 목록·답변·평가를 탭에서 직접 다룬다. `/progress`는 진행도 조회용으로 존재하지만 대화 루프의 중심축은 아니다.
- **실시간 진행 제어는 모델에 위임된다.** "한 턴씩 서버가 다음 질문을 밀어주는" 방식이 아니라, 규칙을 프롬프트로 주고 모델이 진행한다. 따라서 진행 일탈(질문 건너뜀 등)은 모델 행동에 의존한다.
- **실시간 경로는 OpenAI 전용**(폴백 없음). 키 미설정 시 비활성.

## 6. 면접 답변 3단계

1. **한 줄 정의** — "면접 진행은 별도 상태 머신 없이, 질문과 답변 DB 행에서 매번 다시 계산합니다. '답 안 한 첫 질문'이 다음이고, 그게 없으면 종료입니다."
2. **설계 의도** — "상태를 들고 다니지 않으니 새로고침·며칠 뒤 재접속·순서 무관 답변에 강합니다. 그리고 사용자 답변 원문은 절대 수정하지 않고, AI 산출물은 점수·피드백·개선답변 컬럼으로 분리해 신뢰와 첨삭 비교를 지킵니다."
3. **확장** — "음성 면접은 진행 규칙을 프롬프트로 모델에 위임하고 서버는 단기 토큰만 발급해 키를 숨깁니다. 별도 종료 API 없이 리포트 생성이 세션을 닫습니다."

## 7. 꼬리질문 + 모범답안

:::details Q1. 진행 커서를 서버 세션이나 Redis에 캐싱하면 더 빠르지 않나요?
이론상 빠르지만, 한 세션 질문이 15개 이내라 재계산 비용이 무의미하고, 캐시를 도입하면 "캐시 vs DB 불일치" 위험과 무효화 로직이 늘어납니다. 단일 진실 원천을 DB 답변 행 하나로 두는 게 더 안전합니다. 무엇보다 며칠 뒤 복습 재개(`markSessionResumed`) 같은 시나리오에서 stateless 재계산이 그냥 동작합니다.
:::

:::details Q2. "다음 액션"을 서버가 enum으로 안 내리고 상태만 내리면, 클라이언트마다 다르게 해석할 위험은 없나요?
진행 응답은 `currentQuestion`(다음 질문)과 `finished`(종료) 두 신호로 충분히 결정적입니다. `currentQuestion != null`이면 그 질문, `finished`면 리포트로 — 해석 여지가 거의 없습니다. "재질문 여부"만 의도적으로 진행기 밖(평가 루프의 PROBE)으로 빼서 책임을 분리했습니다.
:::

:::details Q3. 사용자 답변을 AI가 다듬어 저장하면 더 깔끔한 데이터가 되지 않나요?
오히려 신뢰가 깨집니다. 복습·리포트는 "내가 실제로 뭐라고 답했는가"를 보여줘야 하고, 첨삭 탭은 원답과 AI 개선답을 나란히 비교합니다. 또 자체 채점 모델 학습 샘플의 입력이 가공된 답이면 채점기가 왜곡 학습됩니다. 그래서 `answer_text`는 불변, AI 산출은 `score/feedback/improved_answer`로 분리합니다.
:::

:::details Q4. 음성 면접에서 모델이 질문을 건너뛰거나 순서를 어기면요?
진행을 모델에 위임한 구조의 한계입니다. 그래서 instructions에 "이 순서대로 모두 질문"을 명시하고 본질문을 6개로 제한해 일탈 여지를 줄였습니다. 정밀한 턴 제어가 필요해지면 서버가 한 턴씩 다음 질문을 push하는 방식으로 강화할 수 있지만, 현재는 대화 자연스러움을 위해 모델 진행을 택했습니다.
:::

:::details Q5. 실시간 면접 토큰을 그냥 OpenAI 키째로 프런트에 주면 안 되나요?
절대 안 됩니다. 그러면 키가 브라우저에 노출돼 무제한 과금·도용 위험이 생깁니다. 서버가 키를 쥐고 `/realtime/client_secrets`로 **단기** ephemeral key만 발급하는 키 프록시 패턴을 씁니다. 만료 시각(`expiresAt`)이 붙은 일회성 토큰이라 노출돼도 피해가 제한됩니다.
:::

:::details Q6. 세션을 명시적으로 종료하는 API가 없으면, 답하다 만 세션은 어떻게 되나요?
`ended_at`이 비어 있으면 진행 중 세션으로 남고, 목록에서 "이어서 복원하기"로 재개됩니다. 리포트를 생성하는 순간(`getReport`)에야 `ended_at`이 찍히며 종료로 확정됩니다. 즉 "끝까지 안 본 면접"은 자연스럽게 미완 상태로 보존됩니다.
:::

## 8. 직접 말해보기

다음을 소리 내어 30초씩 설명해 보자.

1. "진행 상태를 서버에 안 들고 매번 재계산한다"는 게 정확히 무엇을 비교한다는 뜻인지(질문 vs 답변 행).
2. `finished`가 `true`가 되는 정확한 조건과, 질문이 0개일 때와의 차이.
3. 사용자 답변 원문이 들어가는 컬럼과 AI 산출물이 들어가는 컬럼을 각각 이름까지.
4. 실시간 음성 면접에서 "진행 제어를 누가 하는가"와 키 프록시가 막는 위험.
5. "면접 종료" 버튼이 없는 이유와, 무엇이 세션을 닫는가.

## 퀴즈

<QuizBox question="getProgress가 '다음에 답할 질문'을 결정하는 방식으로 맞는 것은?" :choices="['서버 세션에 저장된 currentIndex 커서를 1 증가시킨다', '질문 목록에서 답변 행이 없는 첫 질문을 매 호출마다 재계산한다', 'LLM에게 다음 질문을 물어본다', 'interview_progress 테이블의 상태 행을 읽는다']" :answer="1" explanation="진행 상태는 별도 상태 객체 없이, interview_question과 interview_answer를 비교해 답 안 한 첫 질문을 stateless하게 재계산한다. 모두 답했으면 finished=true." />

<QuizBox question="사용자 답변 비수정 원칙에 대한 설명으로 옳은 것은?" :choices="['AI가 answer_text를 더 매끄럽게 다듬어 저장한다', 'answer_text에는 사용자 원문이 그대로 들어가고, 점수/피드백/개선답변은 별도 컬럼에 저장된다', '원문은 저장하지 않고 AI 개선답변만 남긴다', '원문과 개선답변을 한 컬럼에 합쳐 저장한다']" :answer="1" explanation="answer_text는 불변이며, AI 산출물(score/feedback/improved_answer)은 별도 컬럼으로 분리된다. 신뢰·첨삭 비교·학습 데이터 정합성을 위해서다." />

<QuizBox question="실시간 음성 면접관(OpenAI Realtime) 경로의 특징으로 틀린 것은?" :choices="['서버가 진행 규칙을 instructions 프롬프트로 만들어 모델에 위임한다', '서버는 단기 ephemeral key만 발급하고 OpenAI 키는 숨긴다', '준비된 본질문만 최대 6개 주입하고 꼬리질문은 제외한다', '자체모델→Claude→OpenAI 3단 폴백이 적용된다']" :answer="3" explanation="이 경로는 OpenAI 전용으로 폴백이 없다. 키가 없으면 곧장 예외다. 생성·채점의 폴백 게이트웨이와는 다른 경로다." />
