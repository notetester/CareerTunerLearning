# AI 공급자 · 폴백 전략(전사)

> 한 줄 핵심: CareerTuner의 모든 AI는 "자체 OSS LLM → Claude Haiku → OpenAI → Mock(규칙)" 폴백 사상을 공유하지만, **실제 코드로 작동하는 깊이는 영역마다 다르다.** 그리고 점수·신뢰도·분류 같은 판단은 LLM이 아니라 서버 규칙이 확정한다.

이 페이지는 6개 영역(A~F)을 가로지르는 **공급자 추상화와 폴백 흐름**을 다룬다. 각 영역이 자기 AI를 어떻게 구현했는지(예: [/area-c/fit-analysis](/area-c/fit-analysis), [/area-d/orchestrator-interview](/area-d/orchestrator-interview))는 영역 페이지에서, 여기서는 "그 위에 깔린 공통 폴백 골격이 어떻게 생겼고 왜 영역별로 갈렸는가"에 집중한다.

## 1. 이 흐름이 답하는 면접 질문

이 한 장으로 다음 질문들에 답할 수 있어야 한다.

- "AI API 키가 없을 때도 데모가 동작하나요?" → **동작한다.** Mock(규칙 엔진) 폴백 + provider 토글.
- "한 공급자가 죽거나 한도 초과면요?" → 폴백 체인으로 다음 공급자로 넘어간다(영역별 깊이 차이).
- "자체 LLM을 쓴다는데 진짜 쓰나요?" → **설계 목표와 현재 구현을 정직하게 구분**해야 하는 지점. 지금 실제로 자체 모델 폴백이 도는 곳은 한정적이다.
- "AI가 점수를 매기면 신뢰할 수 있나요?" → **점수·신뢰도는 LLM이 아니라 결정적 서버 규칙**이 계산한다(뉴로-심볼릭).
- "키/시크릿은 어떻게 관리하나요?" → 전부 환경변수 placeholder, 미발급이면 Mock 경로.

## 2. 전체 그림

### 2-1. 이상적 폴백 사상(전사 공통 설계)

```text
       ┌─────────────────────────────────────────────────────────┐
요청 → │ ① 자체 OSS LLM      ② Claude Haiku   ③ OpenAI   ④ Mock  │ → 응답
       │ (Qwen/Gemma·Ollama)   (디딤돌·선생)    (성숙 보루)  (규칙) │
       └─────────────────────────────────────────────────────────┘
        4090 원격 Ollama        claude-haiku-4-5    gpt-5 계열   키 없을 때
        영역별 자체모델          요청실패→다음        한도/오류→다음  항상 성립
```

핵심 의도 3가지:

1. **비용·자율성**: 자체 OSS 모델로 가능한 만큼 처리하고, 외부 API는 보루로 둔다. Claude Haiku는 "자체 모델로 갈아끼우기 위한 디딤돌(선생 + 과도기 런타임)"로 명시돼 있다.
2. **가용성**: 한 공급자가 죽어도 다음으로 넘어가 화면이 깨지지 않는다.
3. **데모 가능성**: 키가 하나도 없어도 Mock 규칙 엔진이 받쳐서 키 미발급 환경에서 전체 여정이 돈다.

### 2-2. 실제 적용 깊이 (영역별로 다르다)

같은 사상이라도 코드 적용 수준은 영역마다 크게 갈린다. **이 표가 이 페이지의 핵심이다.**

| 적용 수준 | 영역 | 실제 체인 | 대표 클래스 |
|---|---|---|---|
| **완전** (OSS→Haiku→OpenAI) | D 면접 + 두뇌(플래너) | 자체→Claude→OpenAI | `FallbackInterviewLlmGateway` |
| **부분** (OSS→OpenAI→Mock, Haiku 생략) | C 적합도 | 자체→OpenAI→Mock | `FallbackFitAnalysisAiService` |
| **Mock 폴백만** | A 프로필 · B 공고/회사 · C 대시보드 · E 자소서 | OpenAI→규칙엔진 | 도메인 OpenAI 서비스 + RuleBased |
| **폴백 없음** (Ollama 직접) | F 커뮤니티 · 인테이크 챗봇 | LangChain4j Ollama 직접 | `IntakeChatAgent` 등 |

:::warning 정직한 구분 — Claude Haiku가 실제로 도는 곳
"전사 OSS→Haiku→OpenAI→Mock"은 **사상**이고, **Claude Haiku 폴백이 실제 코드로 작동하는 건 D(면접)와 두뇌(플래너)뿐**이다. 나머지 영역은 Claude 단계를 건너뛰거나, OpenAI/Mock만 탄다. 면접에서 "전 영역이 Haiku 폴백을 탑니다"라고 말하면 과장이다.
:::

## 3. 단계별 상세 — 각 공급자가 무엇을 받아 무엇을 넘기나

### 3-1. 공급자 선택의 단일 지점 = `@Primary` 디스패처

영역마다 호출부는 `@Primary` 게이트웨이 **하나만** 주입받는다. 그래서 provider 전략이 한 파일에 모인다. 호출하는 도메인 서비스는 "어떤 공급자가 응답했는지" 몰라도 된다.

D 면접의 디스패처 골격(추상화):

```java
// FallbackInterviewLlmGateway.complete(request)
// ① 자체 모델: provider=oss + 서빙됨 + "학습된 생성 task"일 때만 1차 시도
if (oss.available() && OSS_GENERATION_TASKS.contains(request.schemaName())) {
    try { return oss.complete(request); }
    catch (BusinessException e) { /* 로그만, 아래로 폴백 */ }
}
// ② Claude(Haiku) 우선 → 실패 시 OpenAI
if (anthropic.available()) {
    try { return anthropic.complete(request); }
    catch (BusinessException e) { return openAi.complete(request); }
}
// ③ OpenAI, ④ 둘 다 없으면 명확한 예외
```

여기서 결정적 디테일: `OSS_GENERATION_TASKS = Set.of()` — **현재 빈 집합**이다.

:::details 왜 자체 모델 생성 화이트리스트가 비어 있나
면접 질문 생성(QGEN)은 학습 데이터가 seed당 1개로 적어 형식이 불안정했다(질문 대신 프로필/환각을 뱉음). 그래서 **생성은 전부 외부 폴백(Claude/OpenAI)으로 두고 화이트리스트를 비워**, 데이터 보강·재학습 후 task별로 점진 교체하기로 했다. 반면 채점(EVAL)은 데이터가 많아 안정적이라 **별도 경로**(`InterviewEvaluatorProvider` → `OssAnswerEvaluator`)로 자체 모델을 쓴다. 즉 "자체 모델을 안 쓴다"가 아니라 "생성은 아직, 채점은 자체 모델"이라는 갈림이 코드에 박혀 있다. 상세는 [/area-d/orchestrator-interview](/area-d/orchestrator-interview).
:::

### 3-2. C 적합도 — Haiku를 건너뛰는 부분 폴백

같은 패턴을 C가 빌려왔지만(D 파일은 미수정) 체인이 다르다.

```java
// FallbackFitAnalysisAiService.generate(command)
if (properties.isOss() && ossClient.available()) {
    try { return ossService.generate(command); }
    catch (RuntimeException e) { /* 로그만, OpenAI/Mock 폴백 */ }
}
// OpenAI 단계: 키 있으면 실제 호출, 없거나 실패하면 내부에서 Mock 폴백
return openAiService.generate(command);
```

기본값은 `provider=openai`라 자체 모델은 base-url을 설정해야 켜진다. **Claude 단계가 아예 없다** — C는 자체→OpenAI→Mock 3단이다.

### 3-3. F 커뮤니티 / 인테이크 챗봇 — 폴백 없는 Ollama 직접

F는 LangChain4j로 원격 Ollama를 직접 호출한다(폴백 디스패처 없음). 모델은 챗봇 `qwen3:8b`, 검열/추천칩 `gemma4`, 임베딩 `bge-m3`. 인테이크 챗봇은 슬롯 수집까지만 하고, 실제 실행 스트림은 D 오케스트레이터가 받는다 — 이 연결은 [/area-f/intake-chatbot](/area-f/intake-chatbot)과 [/area-d/orchestrator-interview](/area-d/orchestrator-interview)에 있다.

### 3-4. 자체 OSS 서버와 모델 지도

자체 OSS는 **원격 4090 Ollama 서버**(환경변수 `AI_OLLAMA_BASE_URL`)에 모델을 띄워 쓴다. 공개 가능한 모델명만 정리하면:

| 용도 | 공급자/모델 | 비고 |
|---|---|---|
| 외부 면접 생성/플래너 | OpenAI `gpt-5` 계열 (생성 `gpt-5.4-mini` / 채점 `gpt-5.4`) | 두뇌 플래너도 D 게이트웨이를 빌려 씀 |
| 외부 폴백(디딤돌) | Anthropic `claude-haiku-4-5` | D + 두뇌에서만 실작동 |
| 자체 모델(목표) | `Qwen2.5-3B` 베이스 / C `careertuner-c-career-strategy-3b` / E `Qwen3-8B·4B` | 대부분 합의된 **목표**, 런타임 여부는 영역별 |
| 챗봇 | `qwen3:8b` | F, Ollama 직접 |
| 검열/추천칩 | `gemma4` | F |
| 임베딩 | `bge-m3` | F 추천 코사인, RAG는 별도 |

:::warning 설계 목표 vs 현재 구현
통합 클래스 설계서가 담당별 자체 모델(C `career-strategy-3b`, E Qwen3 등)을 정의하지만 이는 **팀 합의 목표**다. 실제로 자체 모델이 런타임에서 도는지는 영역 페이지 표기를 따른다. 예: B는 현재 OpenAI 단일 경로, D는 채점만 자체 모델, 생성은 외부.
:::

## 4. 설계 포인트 — 왜 이렇게 연결했나

### 4-1. status / retryable — 폴백을 트리거하는 신호

폴백은 막연히 "오류 나면 넘긴다"가 아니다. 디스패처는 `BusinessException`(요청 실패·한도 초과 등 재시도 가치 있는 신호)을 잡아 다음 공급자로 넘기고, 결과의 `status`는 사용량 로그(`ai_usage_log`)에 `SUCCESS / FAILED / FALLBACK`으로 남는다. 단:

- **로그에는 최종 성공 모델만** 기록된다. 폴백을 몇 번 거쳤는지는 앱 로그 warn에만 남는다 — `model` 컬럼은 "실제로 응답한 공급자"를 가리킨다.
- 그래서 사용량 통계에서 "어떤 모델이 실제로 일했나"가 깨끗하게 집계된다.

### 4-2. 점수·판단은 LLM이 아니라 서버 규칙 (뉴로-심볼릭)

이게 폴백 전략과 직결되는 핵심 설계다. **공급자가 무엇이든(자체/Claude/OpenAI/Mock) 결과가 일관**되려면, 점수·신뢰도·분류 같은 판단을 LLM에 맡기면 안 된다.

C 적합도가 모범 사례다.

- AI는 후보(매칭 스킬·부족 스킬·전략 텍스트)를 **생성**만 한다.
- **신뢰도는 입력 상태 기반 결정적 계산** — 코드 주석이 못 박는다: "AI 판단이 아니라 입력 상태 기반의 결정적 계산이라 mock/실 AI 모두 동일하게 산정된다." (`FitAnalysisConfidence.evaluate(command)`)
- 조건 매트릭스 severity도 서버 규칙: `REQUIRED + UNMET → HIGH`, 그 외 `UNMET → MEDIUM`, 나머지 `LOW`.

결과: **Mock으로 폴백해도 점수 체계가 흔들리지 않는다.** LLM은 자연어 설명·생성만 소유하고, 점수·판단·분류는 규칙 엔진이 소유한다(화이트리스트 병합). 상세는 [/area-c/fit-analysis](/area-c/fit-analysis).

### 4-3. 크레딧은 성공 기준 + 멱등

폴백이 있으니 "실패한 호출에 과금하면 안 된다"가 중요하다. 그래서 크레딧 차감은 `status == SUCCESS`일 때만 일어나고(success-gated), 중복 차감을 막는 멱등 가드(`ALREADY_DEDUCTED`)가 있다. 실패한 AI는 미차감, 폴백으로 성공하면 최종 모델 1회만 과금. 사용량·과금 연결은 [/area-e/credit-system](/area-e/credit-system)과 [/flow/credit-usage](/flow/credit-usage)를 참고.

### 4-4. 키는 전부 placeholder + provider 토글

모든 공급자 키/엔드포인트는 환경변수 placeholder로만 존재한다(예: `${OPENAI_API_KEY:}`, `${ANTHROPIC_API_KEY:}`). 키 미발급이면:

- `available()`이 false → 그 공급자 단계를 건너뜀.
- 모두 없으면 Mock 규칙 엔진이 받는다.

즉 **공개 repo·개발 환경에서도 실제 시크릿 없이 전체 데모가 성립**한다. provider 토글(`provider=oss|openai`)로 자체 모델 경로를 켜고 끈다.

## 5. 구현 상태

| 항목 | 상태 |
|---|---|
| `@Primary` 폴백 디스패처(D 면접) | 구현됨 — OSS→Claude→OpenAI |
| 두뇌(플래너) Claude 폴백 | 구현됨 — D 게이트웨이 재사용 |
| C 적합도 OSS→OpenAI→Mock | 구현됨 (Haiku 미포함) |
| A·B·C대시보드·E 자소서 Mock 폴백 | 구현됨 — OpenAI→규칙엔진 |
| F 커뮤니티/챗봇 Ollama 직접 | 구현됨 — 폴백 없음 |
| 자체 모델 면접 **생성** 폴백 | **미가동** — 화이트리스트 빈 집합(데이터 부족) |
| 자체 모델 면접 **채점** | 구현됨 — 별도 평가 경로 |
| 담당별 자체 모델(C/E 등) 런타임 | **목표** — 영역별 표기 따름 |
| 결정적 점수/신뢰도(C) | 구현됨 |
| 성공 기준 + 멱등 과금 | 구현됨 |

## 6. 면접 답변 — 전체를 흐름으로 설명

> "CareerTuner의 AI는 영역마다 도메인 서비스가 따로 있지만, 그 위에 공통 폴백 사상이 깔려 있습니다. 이상적으로는 자체 OSS LLM을 1차로 쓰고, 실패하면 Claude Haiku를 디딤돌로, 그다음 OpenAI, 최후에 규칙 기반 Mock으로 떨어집니다. 각 영역은 `@Primary` 디스패처 하나만 주입받아서 공급자 전략이 한 파일에 모입니다.
>
> 다만 실제 적용 깊이는 정직하게 영역마다 다릅니다. Claude Haiku 폴백이 코드로 진짜 도는 건 면접(D)과 오케스트레이터 두뇌뿐이고, 적합도(C)는 자체→OpenAI→Mock으로 Haiku를 건너뜁니다. 커뮤니티와 챗봇(F)은 Ollama를 직접 호출하고요. 자체 모델도 '면접 채점'은 쓰지만 '면접 질문 생성'은 학습 데이터가 부족해서 화이트리스트를 비워두고 외부 모델로 둔 상태입니다.
>
> 폴백이 있어도 결과가 흔들리지 않는 비결은 뉴로-심볼릭 설계입니다. 점수·신뢰도·분류는 LLM이 아니라 결정적 서버 규칙이 계산하고, LLM은 자연어 설명만 생성합니다. 그래서 Mock으로 떨어져도 적합도 점수 체계가 동일합니다. 과금은 status가 SUCCESS일 때만, 멱등하게 한 번만 차감하고요. 키는 전부 환경변수 placeholder라 시크릿 없이도 전체 여정이 데모됩니다."

## 7. 꼬리질문 + 모범답안

:::details Q1. "폴백이 매번 비싼 외부 모델로 떨어지면 비용이 폭발하지 않나요?"
실패한 호출은 과금되지 않습니다(success-gated). 그리고 자체 모델이 안정적인 task는 점진적으로 화이트리스트로 옮겨 외부 호출을 줄입니다. 면접 채점이 이미 자체 모델로 처리되는 게 그 예고, 생성도 데이터 보강·재학습 후 같은 방식으로 교체할 계획입니다. 사용량 로그가 최종 모델만 기록해서 "실제로 어느 공급자가 일했나"를 집계해 비용을 추적할 수 있습니다.
:::

:::details Q2. "공급자가 바뀌면 응답 품질·형식이 달라져서 다운스트림이 깨지지 않나요?"
판단(점수·신뢰도·severity·분류)을 LLM에서 떼어내 서버 규칙으로 확정했기 때문에, 공급자가 자체 모델이든 OpenAI든 Mock이든 점수 체계는 동일합니다. LLM이 소유하는 건 자연어 설명·후보 생성뿐이고, 그마저 결과를 화이트리스트로 병합·검증합니다. 그래서 폴백이 형식 호환성을 깨지 않습니다.
:::

:::details Q3. "왜 면접 질문 생성은 자체 모델을 안 쓰고 채점은 쓰나요?"
데이터 양 차이입니다. 채점(EVAL)은 학습 데이터가 많아 형식이 안정적이라 자체 모델로 분기하지만, 질문 생성(QGEN)은 seed당 1개 수준이라 형식이 불안정해(질문 대신 환각을 뱉음) 외부 모델로 둡니다. 화이트리스트(`OSS_GENERATION_TASKS`)를 비워두는 방식으로 코드에서 명시적으로 분리해, 데이터가 보강되면 task 단위로 안전하게 켤 수 있습니다.
:::

## 8. 직접 말해보기

아래를 막힘 없이 60초 안에 말할 수 있으면 이 흐름을 이해한 것이다.

1. 전사 폴백 사상 4단계를 순서대로 말하고, 각 단계의 역할(자율성·디딤돌·보루·데모)을 한 줄씩.
2. "Claude Haiku 폴백이 실제로 도는 영역은 어디뿐인가"와 그 이유.
3. "왜 점수는 LLM이 아니라 서버 규칙인가"를 폴백 일관성과 연결해서.
4. 키가 하나도 없는 환경에서 전체 데모가 어떻게 성립하는지.

## 퀴즈

<QuizBox question="전사 폴백 사상에서 Claude Haiku의 역할로 가장 정확한 것은?" :choices="['모든 영역의 1차 공급자', '자체 모델로 갈아끼우기 위한 디딤돌이자 과도기 런타임', '점수 계산을 담당하는 판단 엔진', '키가 없을 때의 최종 Mock 대체']" :answer="1" explanation="Claude Haiku는 자체 모델로 점진 교체하기 위한 디딤돌(선생 + 과도기 런타임)로 명시돼 있고, 실제로는 D 면접과 두뇌 플래너에서만 작동한다." />

<QuizBox question="C 적합도에서 신뢰도(confidence)를 결정하는 주체는?" :choices="['응답한 LLM 공급자', '입력 상태 기반의 결정적 서버 규칙', '사용자가 직접 입력', 'Claude Haiku 전용 분류기']" :answer="1" explanation="신뢰도는 FitAnalysisConfidence.evaluate로 입력 상태 기반 결정적 계산이라 mock이든 실제 AI든 동일하게 산정된다. 점수·판단은 LLM이 아니라 서버 규칙이 소유하는 뉴로-심볼릭 설계다." />

<QuizBox question="면접(D) 게이트웨이에서 자체 모델 생성 화이트리스트(OSS_GENERATION_TASKS)가 현재 빈 집합인 이유는?" :choices="['자체 모델이 외부 API보다 항상 비싸서', '질문 생성 학습 데이터가 부족해 형식이 불안정해서', 'Anthropic 키가 없어서', 'Ollama 서버가 폐기돼서']" :answer="1" explanation="QGEN은 seed당 데이터가 1개 수준이라 형식이 불안정해(질문 대신 환각) 생성은 외부 폴백으로 두고 화이트리스트를 비웠다. 데이터가 많은 채점(EVAL)은 별도 경로로 자체 모델을 쓴다." />
