# 면접 답변 AI 평가 [#22]

> 면접 답변 한 건을, 모범답안을 만점 기준으로 삼아 멀티에이전트 루프(채점 → 적대적 검증 → 필요 시 재채점)로 0~100점 채점하고, 모든 판단 단계를 trace로 남기는 기능이다.

## 1. 한 줄 정의 · 이 페이지가 답하는 면접 질문

영역 D(가상 면접)에서 가장 핵심이자 자체 LLM 연구가 가장 활발한 지점이 **답변 평가(#22)**다. 사용자가 답변을 제출하면 단순히 LLM에 "점수 매겨줘"라고 한 번 묻는 게 아니라, **여러 에이전트가 순차로 채점·검증·재채점하는 자율 루프**를 돌려 최종 점수와 피드백을 만든다.

이 페이지가 답하는 면접 질문:

- "답변 평가를 어떻게 구현했나요? 그냥 GPT에 점수 물어본 건가요?"
- "구체성·직무 적합성·논리성 같은 항목을 어떻게 채점하나요?"
- "AI 채점이 그때그때 다르게 나오는(편향) 문제를 어떻게 막았나요?"
- "모범답안이 채점 기준과 어떻게 연결되나요?"

:::tip 용어 먼저
이 영역 코드에 **`InterviewEvalService`라는 클래스는 존재하지 않는다.** 답변 평가의 실제 책임은 세 클래스에 나뉘어 있다 — 진입 서비스 `InterviewServiceImpl.submitAnswer`, 자율 루프 `InterviewAgentOrchestrator`, 그리고 실제 채점기 `InterviewOpenAiClient`(OpenAI) 또는 `OssAnswerEvaluator`(자체 모델). 면접에서 "평가 서비스"를 물으면 이 분담 구조를 설명하면 된다.
:::

## 2. 왜 이렇게 설계했나 (의도 · 트레이드오프)

가장 단순한 구현은 "질문 + 답변을 LLM에 넣고 점수 하나 받기"다. 이걸 그대로 두지 않고 멀티에이전트로 만든 이유는 세 가지다.

**1) 단일 채점은 편향·변동이 크다.** 같은 답변을 같은 모델에 두 번 물어도 점수가 흔들리고, 후하거나 박하게 나올 수 있다. 그래서 채점(Evaluator) 위에 **Critic(검수관)**을 얹어 "이 점수가 답변에 비해 공정한가"를 적대적으로 다시 본다. Critic이 원 점수와 크게(±20 이상) 어긋나면 한 번 더 채점하고 **중간값**으로 수렴시킨다(`REEVAL_THRESHOLD=20`).

**2) "모범답안 = 채점 기준 = 표시 = 복습 채점"을 하나로 묶기 위해.** 사용자가 화면에서 보는 모범답안, 채점이 만점(100점) 기준으로 쓰는 답안지, 블라인드 복습 테스트의 채점 기준이 어긋나면 신뢰가 깨진다. 그래서 채점에 항상 **저장된 모범답안을 함께 넘긴다**.

**3) "AI가 무슨 판단을 했는지" 투명화.** 채점 신뢰성을 높이려면 결과만이 아니라 과정을 보여줘야 한다. 그래서 채점·검증·재채점 각 단계를 `interview_agent_step` 테이블에 trace로 남기고, 프론트가 이를 재생한다("에이전트가 지금 일하는" 체감).

| 선택 | 채택 | 버린 대안 | 트레이드오프 |
| --- | --- | --- | --- |
| 채점 방식 | Evaluator + Critic + 재채점 루프 | LLM 단일 호출 | 호출 수↑(비용·지연) ↔ 편향↓·일관성↑ |
| 만점 기준 | 저장된 모범답안을 답안지로 | 채점기가 매번 모범답안 새로 생성 | 모범답안 생성 1회 ↔ 채점=표시=복습 일관성 |
| 정책 | 규칙 정책 기본, LLM Planner는 시연용 | 항상 LLM이 다음 액션 결정 | 비용↓·결정적 ↔ 시연 임팩트↓ |

## 3. 어떤 기술로 구현했나 (실제 클래스 · 테이블 근거)

답변 평가는 4계층(MyBatis) 위에 **Provider 분기 + 자율 에이전트 루프**를 얹은 구조다.

```text
POST /api/interview/questions/{questionId}/answers   ← InterviewController.submitAnswer
  └─ InterviewServiceImpl.submitAnswer                ← 모범답안(답안지) 해석 + 저장
      └─ InterviewAgentOrchestrator.evaluateAnswer    ← 자율 루프(액션 6종)
          └─ InterviewEvaluatorProvider.get()         ← 채점기 런타임 선택
              ├─ InterviewOpenAiClient (기본)          ← OpenAI Responses json_schema
              └─ OssAnswerEvaluator   (자체 모델)       ← vLLM/TGI /v1/chat/completions
```

핵심 클래스/인터페이스:

| 요소 | 위치 | 역할 |
| --- | --- | --- |
| `InterviewServiceImpl.submitAnswer` | `interview/service` | 진입점. 모범답안 우선순위 해석 → 루프 호출 → `interview_answer` 저장 |
| `InterviewAgentOrchestrator` | `interview/service` | 자율 루프. 액션 6종(RETRIEVE/EVALUATE/CRITIC/REEVALUATE/PROBE/FINISH), step trace 적재 |
| `InterviewAnswerEvaluator` | `interview/service` | 공유 인터페이스(레코드). `evaluateAnswer` / `critiqueEvaluation` |
| `InterviewEvaluatorProvider` | `interview/service` | `eval.provider`로 OpenAI vs 자체 모델 선택 |
| `InterviewOpenAiClient` | `interview/service` | OpenAI 채점기. `evaluationSchema()` strict json_schema |
| `OssAnswerEvaluator` | `interview/service` | 자체 파인튜닝 모델 채점기(vLLM/TGI) |
| `EVALUATION_SYSTEM_PROMPT` / `CRITIC_SYSTEM_PROMPT` | `interview/ai/prompt/InterviewPromptCatalog` | 채점·검증 시스템 프롬프트(버전 `d-v1`) |

소유 테이블:

| 테이블 | 평가가 쓰는 컬럼 |
| --- | --- |
| `interview_answer` | `answer_text`, `score`, `feedback`, `improved_answer`, `audio_url`, `video_url` |
| `interview_question.model_answer` | 채점 만점 기준 답안지(DTO 미노출, 블라인드) |
| `interview_agent_step` | `agent`/`action`/`status`/`summary`/`detail`(JSON)/`elapsed_ms` |
| `interview_training_sample` | 평가 시마다 append(파인튜닝·평가 하니스 원천, FK 없음) |
| `ai_usage_log` | `INTERVIEW_ANSWER_EVAL`/`INTERVIEW_CRITIC`/`INTERVIEW_PLANNER` |

## 4. 동작 원리 (구체성/직무적합성/논리성/개선포인트가 어떻게 점수가 되는가)

### 4.1 채점 기준은 항목별 가중치가 아니라 "모범답안 대비"다

면접에서 "구체성·직무적합성·논리성을 항목별로 몇 점씩 나눠 합산하나요?"라고 물으면, **답변 한 건 채점은 항목 합산 방식이 아니다**라고 정직하게 말해야 한다. 코드의 실제 채점 기준은 `EVALUATION_SYSTEM_PROMPT`에 들어 있고, 두 갈래다.

**(a) 모범답안이 있을 때 (대부분의 경우):** 주어진 모범답안을 만점(100점) 답안지로 삼고 지원자 답변을 **직접 비교**한다.

- 사실상 동일(표현만 다른 수준) → 100점
- 핵심 내용·구조가 실질적으로 일치 → 95점 이상, 표현(STAR 형식 등) 차이만으로는 깎지 않음
- 핵심 일부가 빠졌으면 → 빠진 정도만큼만 감점

**(b) 모범답안이 없을 때:** 채점기가 먼저 이상적 모범 답변을 정한 뒤(90초~2분, 두괄식, 경험 질문은 STAR), 그 대비로 점수를 매긴다.

그리고 **공통 평가 관점**으로 프롬프트가 명시하는 것이 바로 면접에서 자주 묻는 그 항목들이다:

> "평가는 답변 내용, 직무 적합성, 구체성, 논리성, 적정 분량/간결성을 본다."

즉 **구체성/직무적합성/논리성/적정분량은 "채점 기준 답안에 이 요소가 얼마나 담겼는가"라는 단일 0~100 점수로 통합 반영**되고, `feedback`(2~3문장)에 부족한 점과 보완 방향이 자연어로 적힌다. 항목별 점수로 쪼개지는 건 답변 한 건이 아니라 **세션 전체 리포트(#23)** 단계다(거기서 `categories`로 답변 내용/직무 적합성/구체성/논리성/표현력 등이 분리된다).

### 4.2 자율 루프: 정책이 다음 액션을 고른다

`InterviewAgentOrchestrator.evaluateAnswer`는 `AgentContext`를 만든 뒤 `maxTurns`(기본 6)까지 while 루프를 돈다. 매 턴 **정책(`AgentPolicy`)이 현재 상태를 보고 다음 액션 하나**를 고른다.

```text
액션 6종:
  RETRIEVE    RAG 지식베이스 근거 주입 (best-effort, 없으면 step도 안 남김)
  EVALUATE    답변 채점 → 원 점수 + 피드백
  CRITIC      적대적 검증 → 조정 점수 + verdict("유지"|"조정") + reason
  REEVALUATE  Critic과 원점수 차 ≥20 이면 1회 재채점 → (재점수+Critic조정값)/2
  PROBE       답변 약하면(길이<40자 또는 점수<50) 꼬리질문 권장 플래그만
  FINISH      더 할 일 없음
```

규칙 정책(`RulePolicy`, 운영 기본값)의 결정 순서를 코드 그대로 옮기면:

```java
if (!ctx.ragAttempted)                         return RETRIEVE;
if (!ctx.evaluated)                            return EVALUATE;
if (!ctx.critiqued)                            return CRITIC;
if (!ctx.reEvaluated && ctx.bigDisagreement()) return REEVALUATE; // |원점수 - Critic조정| >= 20
if (!ctx.probeFlagged && ctx.answerWeak())     return PROBE;      // 길이<40 또는 점수<50
return FINISH;
```

REEVALUATE의 핵심 한 줄(편향 완화):

```java
int reconciled = Math.round((re.score() + ctx.criticAdjusted) / 2.0f);
```

→ 재채점 점수와 Critic 조정값의 **중간**을 최종으로 채택해, 한쪽으로 튀는 걸 막는다.

### 4.3 두 가지 정책: 규칙 기반 vs LLM Planner

같은 `AgentPolicy` 인터페이스로 두 구현을 병행한다.

| 정책 | 동작 | 언제 |
| --- | --- | --- |
| `RulePolicy` | 위 if-else로 결정. LLM 호출 0 | 운영 기본(`planner=rule`) |
| `LlmPolicy` | 매 턴 LLM이 가용 액션 중 선택, 실패 시 규칙으로 폴백 | 시연 모드(`planner=llm`) |

`LlmPolicy`는 비용을 의식한다 — **선택지가 하나뿐이면 LLM을 부르지 않고**(`available.size()==1`) 바로 그 액션을 실행한다. 그리고 LLM Planner는 평가기 교체와 무관하게 항상 OpenAI를 직접 쓴다(`aiClient` 주입).

### 4.4 모범답안(답안지) 우선순위

`submitAnswer`가 채점에 넘길 기준 모범답안을 정하는 순서(코드 그대로):

```java
String reference = blankToNull(request.modelAnswer());          // 1) 프론트가 보낸 값
if (reference == null) reference = blankToNull(question.getModelAnswer()); // 2) 질문에 저장된 값
if (reference == null) reference = generateModelAnswerForGrading(...);     // 3) 즉시 단건 생성
```

저장값(2)을 쓰기 때문에 모범답안을 보여주지 않는 **블라인드 복습 테스트도 같은 답안지로 채점**된다. 그리고 모범답안 저장은 **first-writer-wins**(`model_answer IS NULL OR ''`일 때만 UPDATE)라, 백그라운드 일괄 생성과 지연 단건 생성이 경쟁해도 답안지는 하나로 고정된다.

### 4.5 trace: 각 단계가 DB에 남는다

각 액션은 `interview_agent_step`에 INSERT된다. 예: EVALUATOR 단계는 `summary="원 채점 78점"`, `detail={"score":78,"feedback":"..."}`. CRITIC은 `summary="검증: 조정 → 72점"`, `detail={"adjustedScore":72,"verdict":"조정","reason":"..."}`. 프론트의 `AgentTimeline`이 이 step 배열을 클라이언트에서 550ms 간격으로 순차 재생한다.

## 5. 구현 상태 — 됨 vs 계획 (정직 구분)

:::warning 추측 금지 — 코드 기준 사실
- **자체 채점 모델(`OssAnswerEvaluator`)은 구현됐으나 기본값은 OpenAI.** `eval.provider=oss`이고 base-url이 설정돼야 자체 모델로 분기한다. 미설정 시 호출하면 명확한 예외를 던지고 OpenAI로 폴백한다("실제 서빙 전까지 폴백", 로드맵 5장).
- **개선답변(AI 첨삭, `improvedAnswer`)은 사실상 자체(OSS) 평가기에서만 실질적으로 채워진다.** 이유: OpenAI 경로의 `evaluationSchema()`는 `required=["score","feedback"]`뿐이라(strict json_schema), `improvedAnswer`는 응답에 없어 항상 빈 문자열이 된다. 반면 `OssAnswerEvaluator`는 user 프롬프트에서 별도로 `{"score","feedback","improvedAnswer"}`를 요구해 채운다. 시스템 프롬프트가 "별도 모범/개선 답변은 생성하지 않는다"라고 못 박은 것과 OpenAI 스키마가 일치한다.
- **꼬리질문 권장(PROBE)은 플래그만 남긴다.** 실제 꼬리질문 생성은 사용자가 트리거한다(자동 생성 아님).
- **RAG(RETRIEVE)는 기본 비활성.** Qdrant 미기동 환경에서도 동작하도록 best-effort라, 근거가 없으면 빈 컨텍스트로 넘어가고 step도 남기지 않는다.
- **trace 실시간 SSE 스트리밍은 후속.** 현재는 저장된 step을 프론트가 순차 재생한다(로드맵 6-1).
:::

**됨:** Evaluator→Critic→(필요 시)REEVALUATE 루프, REEVALUATE 중간값, PROBE 플래그, RulePolicy/LlmPolicy 2정책, Provider 분기(OpenAI/OSS), 모범답안 답안지 채점, first-writer-wins, step trace 적재, `interview_training_sample` 적재(파인튜닝 원천), `ai_usage_log` 기록.

## 6. 면접 답변 3단계 (30초 / 2분 / 깊게)

**30초:** "답변 평가는 LLM에 한 번 점수 묻는 게 아니라, 채점기(Evaluator)와 검수기(Critic)를 둔 자율 에이전트 루프입니다. 모범답안을 100점 기준 답안지로 삼아 채점하고, Critic이 점수를 적대적으로 검증해 크게 어긋나면 한 번 더 채점한 뒤 중간값으로 수렴시킵니다. 모든 단계는 trace로 남겨 투명하게 보여줍니다."

**2분:** 위에 더해 — 진입은 `submitAnswer`이고, 실제 루프는 `InterviewAgentOrchestrator`다. 모범답안 우선순위(프론트값 > 저장값 > 즉시 생성)로 항상 답안지를 확보해 채점=표시=블라인드 복습 채점을 일치시킨다. 채점기는 `InterviewEvaluatorProvider`가 OpenAI냐 자체 모델이냐를 런타임에 고른다. Critic은 `±20` 이상 어긋나면 REEVALUATE로 분기하고 `(재점수+Critic조정)/2`로 편향을 줄인다. 답변이 약하면(길이&lt;40 또는 점수&lt;50) PROBE로 꼬리질문을 권장한다. 각 단계는 `interview_agent_step`에 적재돼 프론트 `AgentTimeline`이 재생한다.

**깊게:** 구체성·직무적합성·논리성은 항목 합산이 아니라 모범답안 대비 단일 0~100 점수로 통합되고(`EVALUATION_SYSTEM_PROMPT`의 공통 관점), 항목 분리는 세션 리포트(#23) 단계의 일이다. 정책을 인터페이스로 추상화해 규칙/LLM을 갈아끼우며, OpenAI strict json_schema와 자체 모델 json_object를 같은 인터페이스(`InterviewAnswerEvaluator`) 뒤에 숨겼다. 이 평가 경로가 자체 LLM 파인튜닝의 학습 데이터(`interview_training_sample`)를 매 채점마다 쌓는 자리이기도 하다.

## 7. 꼬리질문 + 모범답안

:::details Q1. "구체성·논리성을 항목별로 몇 점씩 나눠 합산하나요?"
아닙니다. **답변 한 건 채점은 항목 합산이 아니라 모범답안 대비 단일 0~100 점수**입니다. `EVALUATION_SYSTEM_PROMPT`가 "답변 내용·직무 적합성·구체성·논리성·적정 분량을 본다"라고 평가 관점을 명시하지만, 이 관점들이 하나의 점수와 자연어 피드백으로 통합됩니다. 항목별 점수로 분리되는 건 세션 전체를 보는 리포트(#23)의 `categories`입니다.
:::

:::details Q2. "AI 채점이 그때그때 다른 편향 문제는 어떻게 막았나요?"
세 장치입니다. (1) Critic이 원 채점을 적대적으로 다시 봐 부당하게 후하거나 박하면 조정합니다. (2) Critic 조정폭이 ±20 이상이면 REEVALUATE로 한 번 더 채점하고 `(재채점+Critic조정)/2` 중간값을 최종으로 씁니다. (3) 모범답안을 만점 기준 답안지로 고정해 채점의 기준점을 일관시킵니다. 추가로 `ai_usage_log`와 `interview_agent_step`에 모든 호출·판단을 남겨 사후 검증이 가능합니다.
:::

:::details Q3. "`InterviewEvalService` 클래스가 어디 있나요?"
그 이름의 클래스는 없습니다. 평가 책임이 셋으로 나뉩니다 — 진입 `InterviewServiceImpl.submitAnswer`(모범답안 해석·저장), 루프 `InterviewAgentOrchestrator`(액션 6종), 실제 채점 `InterviewOpenAiClient` 또는 `OssAnswerEvaluator`(공유 인터페이스 `InterviewAnswerEvaluator`). 이렇게 나눈 건 "오케스트레이션 정책"과 "채점 모델"을 독립적으로 교체하기 위해서입니다.
:::

:::details Q4. "AI 첨삭(개선답변)은 항상 채워지나요?"
아닙니다. OpenAI 경로의 채점 스키마(`evaluationSchema()`)는 `score`/`feedback`만 required라 strict json_schema 응답에 `improvedAnswer`가 없어 빈 문자열이 됩니다. 시스템 프롬프트도 "별도 개선 답변은 생성하지 않는다"라고 일치시켜 둡니다. 개선답변을 실질적으로 채우는 건 user 프롬프트에서 직접 `improvedAnswer`를 요구하는 자체(OSS) 평가기입니다. 사용자가 보는 모범답안은 이와 별개로 `model_answer`에서 옵니다.
:::

:::details Q5. "왜 Critic이 검증한 뒤에도 또 재채점(REEVALUATE)하나요? Critic 점수를 그냥 쓰면 안 되나요?"
Critic도 한 번의 LLM 판단이라 그 자체가 틀릴 수 있습니다. 원 채점과 Critic이 ±20 이상 어긋난다는 건 "둘 중 하나가 크게 빗나갔다"는 신호라, 독립적으로 한 번 더 채점한 뒤 재채점값과 Critic값의 **중간**을 취합니다. 작은 차이(±20 미만)는 정상 변동으로 보고 Critic 조정값을 그대로 최종으로 씁니다(불필요한 호출 절약).
:::

:::details Q6. "자체 LLM 채점은 지금 켜져 있나요?"
기본은 OpenAI입니다. `OssAnswerEvaluator`는 구현돼 있지만 `eval.provider=oss`이고 vLLM/TGI base-url이 설정돼야 분기합니다. 미설정 시 호출하면 명확한 예외를 던지고 상위에서 OpenAI로 폴백하도록 설계했습니다. 채점은 면접 도메인에서 학습 데이터(`interview_training_sample`)가 가장 많이 쌓이는 task라 자체 모델 교체의 1순위 후보입니다.
:::

## 8. 직접 말해보기

면접관이 됐다고 생각하고 입으로 답해보자. 막히면 위 섹션으로 돌아간다.

1. 답변 제출부터 점수 저장까지 데이터가 거치는 클래스를 순서대로 말해보라.
2. 모범답안 우선순위 3단계를 말하고, 왜 "저장값"을 쓰는지(블라인드 복습) 설명하라.
3. Critic과 REEVALUATE가 각각 무엇을 막는지, REEVALUATE의 중간값 공식을 말해보라.
4. 구체성·논리성이 "항목별 점수"가 아니라고 정정하면서, 그럼 어디서 항목이 분리되는지 답하라.
5. OpenAI 경로에서 `improvedAnswer`가 비는 이유를 스키마와 프롬프트로 설명하라.

## 퀴즈

<QuizBox
  question="규칙 정책(RulePolicy)에서 Critic 검증 직후 REEVALUATE로 분기하는 조건은?"
  :choices="['답변 길이가 40자 미만일 때', '원 채점 점수와 Critic 조정 점수의 차이가 20 이상일 때', 'RAG 근거를 찾지 못했을 때', '최종 점수가 50점 미만일 때']"
  :answer="1"
  explanation="bigDisagreement()는 |원 점수 - Critic 조정값| >= 20(REEVAL_THRESHOLD)일 때 참이 되어 REEVALUATE로 분기한다. 길이<40·점수<50은 PROBE 조건(answerWeak)이다."
/>

<QuizBox
  question="OpenAI 채점 경로에서 improvedAnswer(개선답변)가 사실상 항상 빈 문자열인 이유로 옳은 것은?"
  :choices="['LLM이 한국어 개선답변을 생성하지 못해서', 'evaluationSchema의 required가 score·feedback만이라 strict json_schema 응답에 필드가 없어서', 'improvedAnswer는 클라이언트에서만 계산해서', 'Critic이 개선답변을 삭제해서']"
  :answer="1"
  explanation="evaluationSchema()의 required는 [score, feedback]뿐이고 OpenAI strict json_schema는 정의되지 않은 필드를 내지 않는다. 그래서 payload.path('improvedAnswer')는 빈 문자열이 된다. 실질적으로 채우는 건 user 프롬프트로 improvedAnswer를 요구하는 OssAnswerEvaluator다."
/>

<QuizBox
  question="답변 한 건 채점에서 '구체성·직무적합성·논리성'은 어떻게 점수에 반영되는가?"
  :choices="['각 항목을 25점씩 나눠 합산한다', '모범답안 대비 단일 0~100 점수로 통합 반영되고, 항목 분리는 세션 리포트(#23) 단계의 일이다', 'Critic만 이 항목들을 채점한다', '항목별 점수는 interview_answer 테이블에 컬럼으로 저장된다']"
  :answer="1"
  explanation="EVALUATION_SYSTEM_PROMPT는 이 관점들을 '본다'고 명시하지만 하나의 0~100 점수와 자연어 feedback으로 통합한다. label별 점수로 쪼개지는 것은 세션 전체를 보는 리포트(#23)의 categories다."
/>
