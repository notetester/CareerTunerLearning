# 면접 LLM 폴백 게이트웨이

> 면접 도메인의 모든 구조화 LLM 호출은 단 하나의 `@Primary` 디스패처를 거친다. 자체 모델(현재 비활성) → Claude Haiku(1차) → OpenAI(2차) 순으로 자동 폴백하며, 호출부는 어떤 provider가 응답했는지 알지 못한다.

## 1. 한 줄 정의·이 페이지가 답하는 면접 질문

영역 D의 **면접 LLM 폴백 게이트웨이**는 질문 생성·꼬리질문·모범답안·리포트·평가 플래너 같은 "구조화 출력이 필요한 LLM 호출"을 받아, 가용한 provider를 순서대로 시도해 첫 성공 응답을 돌려주는 **단일 진입점(Strategy + Chain of Responsibility)** 이다.

이 페이지가 답하는 면접 질문:

- "LLM provider가 죽거나 한도가 차면 서비스가 멈추지 않게 어떻게 설계했나요?"
- "왜 한 모델만 쓰지 않고 자체 모델·Claude·OpenAI를 같이 두었나요?"
- "게이트웨이 패턴을 실제로 어디에 적용했고, 호출부 코드는 provider 교체에 어떻게 무관해지나요?"
- "지금 자체 모델은 정말 돌고 있나요, 아니면 계획인가요?"

핵심 클래스는 `FallbackInterviewLlmGateway`(`interview/service/`)이고, 인터페이스는 `InterviewLlmGateway`다.

## 2. 왜 이렇게 설계했나 (의도·트레이드오프)

### 2.1 "한 곳만 갈아끼우면 전 호출의 provider가 바뀐다"

도메인 로직(프롬프트 구성·JSON 스키마·응답 매핑)은 호출부 `InterviewOpenAiClient`에 두고, 게이트웨이는 **"provider로의 전송"만** 담당한다. 인터페이스 주석이 이 의도를 못박는다.

```text
도메인 로직(프롬프트·스키마·매핑)은 호출부에 두고,
게이트웨이는 "provider 로의 전송"만 담당한다.
덕분에 한 곳만 갈아끼우면 전 호출의 provider 가 바뀐다.
```

`InterviewOpenAiClient`는 생성자에서 `InterviewLlmGateway`(추상 타입)를 주입받고, 질문·평가·모범답안·리포트·플래너까지 **전부 `gateway.complete(...)` 한 줄로** 호출한다. 호출부에는 OpenAI/Anthropic/OSS라는 단어가 없다. provider 정책을 바꿔도 호출부 코드는 한 줄도 변하지 않는다.

### 2.2 Claude는 자체 모델로 가기 위한 "디딤돌"

이 영역의 장기 목표는 **자체 파인튜닝 OSS 모델로의 점진 교체**다. 게이트웨이 주석의 표현 그대로:

> "Claude는 자체 모델로 갈아끼우기 위한 디딤돌(선생 + 과도기 런타임)이다. 자체 모델이 학습한 task부터 `OSS_GENERATION_TASKS`로 점진 교체하고, 전 task가 자체 모델로 덮이면 Claude 게이트웨이를 폐기한다."

즉 Claude Haiku는 두 역할을 동시에 맡는다. (1) 학습 데이터를 생성해 주는 **선생 모델**, (2) 자체 모델이 아직 못 하는 task를 메우는 **과도기 런타임**. 자체 모델이 한 task씩 안정화될 때마다 화이트리스트에 추가해 Claude를 그 task에서 은퇴시키는 전략이다.

### 2.3 트레이드오프

| 선택 | 얻는 것 | 잃는 것 / 비용 |
| --- | --- | --- |
| 3단 폴백 체인 | provider 장애·한도에도 면접이 계속됨 | 폴백 시 응답 모델이 달라져 품질·톤 편차 가능 |
| Claude Haiku 1차 | 빠르고 저렴, 한국어 구조화 출력 양호 | JSON 모드가 없어 프롬프트 임베드로 보강 필요 |
| 자체 모델 화이트리스트 점진 교체 | task별로 안전하게 전환 | 화이트리스트 관리 부담, 당분간 외부 API 의존 지속 |
| 채점 경로를 게이트웨이에서 분리 | 생성/채점 폴백 정책 독립 | 게이트웨이와 평가기 두 경로를 따로 이해해야 함 |

## 3. 어떤 기술로 구현했나 (실제 클래스·근거)

영역 D의 LLM 전송은 **인터페이스 1개 + 구현 4개(3 provider + 1 디스패처)** 로 구성된다.

| 클래스 | 역할 | 핵심 |
| --- | --- | --- |
| `InterviewLlmGateway` | 인터페이스 | `Result complete(Request)` 하나. `Request(schemaName, jsonSchema, systemPrompt, userPrompt, model)` |
| `FallbackInterviewLlmGateway` | `@Primary` 디스패처 | oss→Claude→OpenAI 폴백 체인. 호출부가 주입받는 유일한 구현 |
| `OssLlmGateway` | 자체 모델 전송 | Ollama OpenAI 호환 `/v1/chat/completions`, `json_object` 모드 |
| `AnthropicLlmGateway` | Claude(Haiku) 전송 | Messages API, 1차 폴백, 재시도 3회 |
| `OpenAiLlmGateway` | OpenAI 전송 | Responses API, 최종 폴백, `json_schema strict` |

`@Primary`가 핵심이다. `InterviewLlmGateway` 타입을 주입하면 스프링이 자동으로 `FallbackInterviewLlmGateway`를 꽂아주므로, `InterviewOpenAiClient`는 자기도 모르게 폴백 체인을 쓰게 된다. 세 provider 구현(`OssLlmGateway` 등)은 디스패처가 직접 필드로 들고 있어 폴백 순서를 코드로 통제한다.

:::tip 게이트웨이 패턴이 이 한 줄에 응축돼 있다
`InterviewOpenAiClient` 생성자: `InterviewOpenAiClient(InterviewModelProperties modelProperties, InterviewLlmGateway gateway)`. 주입 타입이 인터페이스라서, 구현이 무엇이든 호출부는 동일하다. provider 교체 = 디스패처 한 곳 수정.
:::

### 3.1 모델 2티어 분리

생성과 채점은 모델 등급을 다르게 쓴다. `InterviewModelProperties`:

- 생성(질문·모범답안·꼬리질문·리포트): `gpt-5.4-mini` — 빠르고 저렴
- 채점(답변 평가·Critic): `gpt-5.4` — 채점 공정성을 위해 한 단계 위

주석의 근거: "단일 `gpt-5` 사용은 추론량 과다로 느리고 비싸므로 작업 성격에 맞춰 모델을 분리한다." 이 `model` 값은 `Request.model`에 실려 게이트웨이로 전달되지만, **OpenAI 게이트웨이에서만 실제로 쓰인다**(Anthropic/OSS는 자기 설정 모델을 쓴다).

## 4. 동작 원리 (흐름·표·작은 코드)

### 4.1 `complete()` 폴백 로직

`FallbackInterviewLlmGateway.complete()`의 실제 분기를 축약하면:

```java
// 1) 자체 모델 우선 — oss provider + 서빙됨 + 학습된 생성 task 일 때만
if (evalProperties.isOss() && oss.available()
        && OSS_GENERATION_TASKS.contains(request.schemaName())) {
    try { return oss.complete(request); }
    catch (BusinessException ex) { log.warn("자체 모델 실패 → Claude/OpenAI 폴백"); }
}
// 2) Claude(Haiku) → 실패 시 OpenAI
if (anthropic.available()) {
    try { return anthropic.complete(request); }
    catch (BusinessException ex) {
        if (openAi.available()) return openAi.complete(request);
        throw ex;
    }
}
// 3) Claude 키 없으면 곧장 OpenAI
if (openAi.available()) return openAi.complete(request);
// 4) 둘 다 없으면 명확한 예외
throw new BusinessException(... "ANTHROPIC_API_KEY 또는 OPENAI_API_KEY 를 설정하세요.");
```

핵심 규칙:

1. **자체 모델은 3중 조건일 때만 1차** — `provider=oss` 설정 + `available()`(base-url 설정됨) + 해당 `schemaName`이 화이트리스트에 있어야. 셋 중 하나라도 빠지면 건너뛴다.
2. **폴백 트리거는 `BusinessException`** — 각 provider 게이트웨이는 HTTP 4xx/5xx·파싱 실패를 `BusinessException`으로 던지고, 디스패처가 그걸 잡아 다음 단계로 내려간다.
3. **`available()` = 키/주소 설정 여부** — Anthropic은 키, OpenAI는 키, OSS는 base-url 설정 여부로 가용성을 판단해 불필요한 호출을 막는다.

### 4.2 provider별 결정 표

| 환경 상태 | 1차 | 2차 | 결과 |
| --- | --- | --- | --- |
| 자체 모델 화이트리스트 task + 서빙됨 | OSS | Claude→OpenAI | 자체 모델 우선, 실패 시 폴백 |
| Anthropic 키 O, OpenAI 키 O (현재 기본) | Claude Haiku | OpenAI | Claude 실패 시 OpenAI |
| Anthropic 키 X, OpenAI 키 O | OpenAI | — | 곧장 OpenAI |
| 둘 다 키 X | — | — | 명확한 설정 예외 |

### 4.3 구조화 출력 3-provider 방어

같은 `jsonSchema`를 provider 특성에 맞게 다르게 처리한다. JSON 모드가 표준화돼 있지 않기 때문이다.

| provider | 구조화 출력 방식 | 잡설 제거 |
| --- | --- | --- |
| OpenAI | 네이티브 `text.format = json_schema, strict:true` | (불필요) |
| Anthropic | JSON 모드 없음 → 스키마를 프롬프트에 임베드 + "순수 JSON만" 지시 | 코드펜스 제거 후 파싱 |
| OSS(소형) | 스키마 임베드 + `response_format: json_object` | `extractJsonSpan`으로 첫 `{`/`[` ~ 마지막 `}`/`]`만 |

`OssLlmGateway.extractJsonSpan`은 소형 모델이 JSON 앞뒤에 "JSON 출력:" 같은 잡설을 붙이는 문제를 정면 처리한다. 첫 여는 괄호부터 마지막 닫는 괄호까지만 잘라 파싱하며, 채점 경로의 `OssAnswerEvaluator`와 공용이다.

### 4.4 재시도와 사용량 기록

- **Anthropic/OpenAI**: 같은 게이트웨이 안에서 `MAX_ATTEMPTS=3` 재시도. 재시도 대상은 408/429/5xx(Anthropic은 529 overloaded 포함), 지수가 아닌 선형 백오프(`attempt * 1000ms`). 3회 실패 후에야 `BusinessException`을 던져 **상위 디스패처가 다른 provider로 폴백**한다. 즉 폴백은 "한 provider 안에서 재시도 → 그래도 실패 → 다음 provider" 2단 구조다.
- **사용량 로그**: 모든 LLM 호출은 **최종 성공한 provider/model만** `ai_usage_log`에 기록한다. 폴백이 몇 번 일어났는지는 애플리케이션 warn 로그로만 남고 과금 로그에는 안 들어간다. 자체 서버 토큰은 과금 대상이 아니라 `usage=0`으로 기록(모델 id만 남김).

### 4.5 오케스트레이터의 "두뇌"도 같은 게이트웨이를 쓴다

답변 평가는 자율 에이전트 루프(`InterviewAgentOrchestrator`)를 도는데, LLM 플래너 모드(`LlmPolicy`)가 다음 액션을 고를 때 `aiClient.planNextAction(...)`을 호출한다. 그런데 `InterviewOpenAiClient.planNextAction` 역시 내부에서 `gateway.complete(...)`로 위임한다. 즉 **에이전트의 "어떤 행동을 할지 결정하는 두뇌"조차 이 폴백 게이트웨이를 거친다** — 플래너 LLM 호출이 OpenAI 한도에 걸리면 Claude로, 그것도 안 되면 OpenAI 폴백으로 자동 우회된다.

:::warning 단, 채점(EVAL)·Critic은 이 게이트웨이를 거치지 않는다
답변 채점과 Critic 검증은 `InterviewEvaluatorProvider`가 `OssAnswerEvaluator`(또는 OpenAI)로 **별도 분기**한다. 게이트웨이 주석이 직접 명시: "채점·Critic은 이 게이트웨이가 아니라 `InterviewEvaluatorProvider`가 분기하므로 화이트리스트에 넣지 않는다(이중 경로 방지)." 생성/채점의 폴백 정책·모델 티어·자체모델 교체 진척이 다르기 때문이다. 이 2-축 분리는 영역 D의 설계 정체성이다.
:::

## 5. 구현 상태 (됨 vs 계획) 정직 구분

### 됨 (런타임 동작)

- 3 provider 게이트웨이 + `@Primary` 디스패처, oss→Claude→OpenAI 폴백 체인.
- provider별 재시도(3회), 구조화 출력 3-provider 방어, `available()` 게이트.
- Claude Haiku 1차, OpenAI 2차 폴백 — **면접(D) 도메인에서 실제로 동작**. (다른 영역은 OpenAI 직행이라 Haiku 폴백이 실재하는 곳은 D뿐.)
- 모델 2티어(생성 `gpt-5.4-mini` / 채점 `gpt-5.4`).
- 플래너 LLM 호출도 게이트웨이 경유.

### 계획/진행중 (정직히)

1. **자체 모델 생성은 미가동.** `OSS_GENERATION_TASKS = Set.of()`로 **빈 집합**이다(코드 직접 확인). 따라서 질문·꼬리·모범답안·리포트 생성은 **사실상 Claude→OpenAI 폴백만** 탄다. 빈 집합인 이유는 주석에 명시: "2026-06-20 검증 결과 QGEN(질문생성)은 학습 데이터가 seed당 1개로 적어 형식이 불안정(질문 대신 프로필/환각을 뱉음)." QGEN/MODEL_ANSWER 데이터 보강 + 재학습 후 화이트리스트를 채워 단계적으로 Claude를 폐기할 계획이다.
2. **채점용 자체 모델은 구현됐으나 기본값 OpenAI.** `OssAnswerEvaluator`는 base-url 미설정 시 폴백된다("실제 서빙 전까지 폴백").
3. **Claude 게이트웨이 자체가 과도기 산출물.** 자체 모델이 전 task를 커버하면 `AnthropicLlmGateway`는 폐기 예정.

이 솔직함이 면접에서 강점이 된다 — "자체 모델로 가는 길을 코드로 깔아두되, 아직 불안정한 task는 무리해서 켜지 않았다"는 판단을 설명할 수 있다.

## 6. 면접 답변 3단계

1. **한 문장 정의**: "면접의 모든 구조화 LLM 호출은 단 하나의 `@Primary` 디스패처를 거치고, 그 디스패처가 자체 모델 → Claude Haiku → OpenAI 순으로 자동 폴백합니다."
2. **왜·어떻게**: "게이트웨이 패턴으로 도메인 로직과 전송을 분리해서, 호출부는 `gateway.complete()` 한 줄만 알고 provider를 모릅니다. 각 provider 게이트웨이는 자체적으로 3회 재시도하고, 그래도 실패하면 `BusinessException`을 던져 디스패처가 다음 provider로 내려갑니다. 키/주소 미설정 provider는 `available()`로 건너뜁니다."
3. **트레이드오프·정직**: "Claude는 자체 OSS 모델로 가기 위한 디딤돌(선생 겸 과도기 런타임)입니다. 다만 질문 생성용 자체 모델은 학습 데이터가 부족해서 화이트리스트가 아직 빈 집합이라, 현재 생성은 사실상 Claude→OpenAI 폴백입니다. task별로 안정화되면 화이트리스트에 추가해 Claude를 은퇴시키는 게 로드맵입니다."

## 7. 꼬리질문 + 모범답안

:::details Q1. 왜 한 게이트웨이 안에서 재시도하고, 그래도 또 디스패처에서 폴백하나요? 2단이 중복 아닌가요?
역할이 다릅니다. provider **내부 재시도**(3회)는 같은 모델의 **일시적 장애**(429 rate limit, 5xx, 타임아웃)를 흡수합니다 — 같은 모델로 다시 시도하는 게 합리적입니다. **디스패처 폴백**은 그 provider가 **지속적으로 실패**할 때(키 한도 소진, 모델 다운) 아예 **다른 provider**로 갈아타는 것입니다. 일시 장애를 곧바로 다른 모델로 넘기면 응답 품질이 출렁이므로, "같은 모델 재시도 → 그래도 안 되면 모델 교체" 순서가 맞습니다.
:::

:::details Q2. `OSS_GENERATION_TASKS`가 빈 집합인데 OSS 게이트웨이를 왜 두나요? 죽은 코드 아닌가요?
죽은 코드가 아니라 **확장 지점**입니다. 자체 모델이 특정 생성 task(예: `interview_questions`)를 안정적으로 처리하게 되면, 그 `schemaName`을 화이트리스트에 한 줄 추가하는 것만으로 즉시 1차 provider가 됩니다. 게이트웨이 구현은 이미 완성돼 있고(Ollama `/v1/chat/completions` + `json_object` + 잡설 제거), 교체를 **점진적·task 단위**로 하기 위한 토글이 빈 집합일 뿐입니다. 채점용 OSS 평가기는 별도 경로에서 이미 동작 준비가 돼 있습니다.
:::

:::details Q3. Claude는 JSON 모드가 없는데 어떻게 구조화 출력을 받나요?
`AnthropicLlmGateway`는 기대 JSON 스키마를 직렬화해 **유저 프롬프트 끝에 임베드**하고 "코드블록·설명 없이 순수 JSON만 출력하라"고 지시합니다. 응답이 코드펜스(```json)나 잡설을 섞어도, 파싱 단계에서 `^```(json)?` 펜스를 정규식으로 제거한 뒤 파싱합니다. 그래도 JSON이 아니면 `BusinessException`을 던져 OpenAI로 폴백합니다. OpenAI는 반대로 네이티브 `json_schema strict`라 스키마 위반 자체가 거의 발생하지 않습니다.
:::

:::details Q4. 폴백이 일어나면 사용량 로그는 어떻게 남나요? 비용 추적은요?
**최종 성공한 provider/model만** `ai_usage_log`에 `feature_type`/`model`/`token_usage`/`credit_used`로 기록합니다. 중간에 몇 번 폴백했는지는 과금 로그가 아니라 애플리케이션 warn 로그로만 남습니다. 의도는 "실제 과금된 호출"과 "버려진 시도"를 분리하는 것입니다. 자체 서버 호출은 외부 과금 대상이 아니라 `usage=0`(모델 id만)으로 기록해, 자체 모델 전환 시 비용 절감 효과를 로그에서 바로 볼 수 있게 했습니다.
:::

:::details Q5. 두 provider 키가 다 없으면 어떻게 되나요?
조용히 빈 응답을 주지 않고 **명확한 예외**를 던집니다: "LLM provider가 설정되어 있지 않습니다. `ANTHROPIC_API_KEY` 또는 `OPENAI_API_KEY`를 설정하세요." 폴백 체인의 마지막 안전장치로, 설정 누락을 런타임에 곧장 드러내 디버깅을 쉽게 합니다.
:::

:::details Q6. 모델을 생성/채점 2티어로 나눈 이유는요? 그냥 좋은 모델 하나 쓰면 안 되나요?
단일 상위 모델은 **추론량 과다로 느리고 비쌉니다**. 면접 질문 생성·모범답안·리포트는 깊은 추론이 필요 없어 빠르고 저렴한 `gpt-5.4-mini`로 충분하고, 답변 채점·Critic은 **공정성**이 중요해 한 단계 위 `gpt-5.4`를 씁니다. 추가로 OpenAI 게이트웨이는 추론 모델(`gpt-5`/`o`-시리즈)을 감지하면 `reasoning effort=low`를 붙여 면접 응답 속도와 타임아웃 안정성을 확보합니다.
:::

## 8. 직접 말해보기

다음을 막힘없이 설명할 수 있는지 점검하세요.

- `@Primary FallbackInterviewLlmGateway`가 호출부에 주입되는 메커니즘과, 그게 왜 "한 곳만 갈아끼우면 끝"인지.
- oss→Claude→OpenAI 분기에서 각 단계의 **진입 조건**(`isOss()`+`available()`+화이트리스트 / 키 보유 / 최종 예외)을 순서대로.
- provider **내부 재시도**(3회)와 **디스패처 폴백**의 차이.
- 왜 채점·Critic은 이 게이트웨이를 **일부러 안 거치는지**(이중 경로 방지, 2-축 분리).
- 자체 모델이 지금 **안 도는 이유**(빈 화이트리스트, QGEN 데이터 부족)와 켜지는 절차.

관련 학습: [영역 D 개요](/area-d/), [답변 평가 멀티에이전트](/area-d/answer-evaluation), [면접관 진행 흐름](/area-d/interviewer-flow).

## 퀴즈

<QuizBox question="FallbackInterviewLlmGateway 의 폴백 순서로 옳은 것은?" :choices="['OpenAI → Claude → 자체모델', '자체모델 → Claude Haiku → OpenAI', 'Claude → OpenAI → 자체모델', '자체모델 → OpenAI → Claude']" :answer="1" explanation="complete() 는 (1) provider=oss+서빙+화이트리스트면 자체 모델, (2) Claude(Haiku), (3) OpenAI 순으로 폴백한다. 단 현재 화이트리스트가 빈 집합이라 생성은 사실상 Claude→OpenAI 만 탄다." />

<QuizBox question="OSS_GENERATION_TASKS 가 현재 빈 집합(Set.of())인 직접적 이유는?" :choices="['자체 모델 서버가 아예 없어서', '질문생성(QGEN) 학습 데이터가 seed당 1개로 적어 형식이 불안정해서', 'OpenAI 가 더 싸서', '법적 제약 때문에']" :answer="1" explanation="주석에 명시: QGEN 은 학습 데이터가 seed당 1개라 질문 대신 프로필/환각을 뱉어 불안정하다. 데이터 보강+재학습 후 화이트리스트를 채워 점진 교체할 계획이다." />

<QuizBox question="답변 채점(EVAL)·Critic 이 이 게이트웨이를 거치지 않는 이유로 가장 적절한 것은?" :choices="['채점은 LLM 을 안 쓰기 때문', '생성과 채점의 폴백 정책·모델·교체 진척이 달라 이중 경로를 막으려고 InterviewEvaluatorProvider 로 분리', '채점이 항상 자체 모델만 쓰기 때문', '게이트웨이가 채점 스키마를 지원하지 못해서']" :answer="1" explanation="채점·Critic 은 InterviewEvaluatorProvider 가 OssAnswerEvaluator/OpenAI 로 분기한다. 생성/채점은 폴백 정책·모델 티어·자체모델 교체 진척이 달라 의도적으로 2-축으로 분리했다(이중 경로 방지)." />
