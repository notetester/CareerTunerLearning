# 구조화 출력 — 신뢰 가능한 JSON 파싱

> LLM의 출력을 자유 텍스트가 아니라 **스키마로 강제한 JSON**으로만 받는다. 점수·enum·배열은 응답 즉시 코드가 검증·클램핑하므로, "AI가 형식을 깨서 화면이 무너지는" 사고가 구조적으로 불가능하다.

## 1. 한 줄 정의 · 이 페이지가 답하는 면접 질문

영역 C의 AI 12~18은 전부 OpenAI **Responses API의 `json_schema` strict 모드**로 호출한다. 응답 본문은 사람이 읽는 글이 아니라, 내가 정의한 스키마를 통과한 기계가 읽는 JSON이다. 클라이언트(`CareerAnalysisOpenAiClient`)가 이 JSON을 받아 도메인 객체로 안전하게 매핑한다.

이 페이지가 답하는 면접 질문:

- "LLM 응답을 어떻게 파싱하나요? 형식이 깨지면 어떻게 되나요?"
- "왜 자유 텍스트를 정규식으로 긁지 않고 구조화 출력을 쓰나요?"
- "스키마는 누가 정의하고, enum이나 점수 범위 같은 제약은 어디서 보장되나요?"
- "네트워크가 불안하거나 429가 오면 어떻게 처리하나요?"

:::tip 공통 엔진과의 관계
프로젝트 전역의 구조화 출력 개념·OpenAI 계약은 [공통 구조화 출력](/ai/openai-structured-output) 문서가 정의한다. 이 페이지는 그 위에서 **영역 C가 실제로 어떤 스키마·어떤 클라이언트·어떤 방어 코드로 구현했는지**를 다룬다.
:::

## 2. 왜 이렇게 설계했나 (설계 의도·대안과 트레이드오프)

핵심 출발점은 영역 C의 [뉴로-심볼릭 철학](/area-c/neuro-symbolic)이다. **점수·판단은 규칙엔진이 소유하고 LLM은 설명 텍스트만 생성**한다. 그런데 그 "설명 텍스트"조차 여러 필드(요약, 부족역량 배열, 학습 로드맵, 조건 매트릭스...)로 구성된 구조물이다. 이걸 어떻게 받느냐가 시스템 안정성을 좌우한다.

선택지를 비교했다.

| 방식 | 장점 | 치명적 단점 |
| --- | --- | --- |
| **자유 텍스트 + 정규식/마커 파싱** | 프롬프트가 단순 | 모델이 마커를 빠뜨리거나 순서를 바꾸면 파싱 전체가 깨짐. 환각이 텍스트 사이에 섞여도 걸러낼 지점이 없음 |
| **프롬프트로 "JSON으로만 답해" 요청** | 구현 빠름 | 모델이 앞뒤에 설명을 붙이거나(` ```json ` 펜스), 필드를 누락/추가/오타냄. 검증이 런타임 try-catch뿐 |
| **`json_schema` strict (채택)** | 스키마 미준수 응답을 모델 단에서 차단. 필드·타입·enum·required가 계약으로 고정 | 스키마를 매번 명시해야 함(코드량↑), 모델/엔드포인트 제약 |

자유 텍스트 파싱은 "잘 동작하다가 어느 날 갑자기 깨지는" 가장 나쁜 종류의 실패를 만든다. 부족역량 추천(AI #13)이 줄바꿈 하나 때문에 빈 배열이 되어 사용자에게 "보완할 게 없다"고 잘못 표시되면, 그건 단순 버그가 아니라 **신뢰를 깨는 잘못된 조언**이다.

그래서 두 겹의 방어를 둔다.

1. **모델 단(strict 스키마):** 정의한 필드·타입·enum을 벗어난 응답 자체를 막는다.
2. **코드 단(클램핑·재검증):** 그래도 통과한 값을 `fitScore` 0~100 클램핑, [가드레일](/area-c/guardrails)의 `guardApplyDecision` 재검증으로 다시 잡는다.

:::warning 구조화 출력은 "환각 방지"가 아니다
strict 스키마는 **형식**을 보장할 뿐, **내용의 진실성**은 보장하지 않는다. 모델이 입력에 없는 회사·기술을 `string` 필드에 채워 넣어도 스키마는 통과한다. 그 내용 검증은 [grounding guard](/area-c/guardrails)와 [가드레일](/area-c/guardrails)이 담당한다. 면접에서 이 둘을 섞어 말하면 깊이가 없어 보인다.
:::

## 3. 어떤 기술로 구현했나 (실제 클래스·메서드·테이블 근거)

| 역할 | 실제 구현 | 비고 |
| --- | --- | --- |
| HTTP 클라이언트 | `CareerAnalysisOpenAiClient` | `java.net.http.HttpClient` 직접 사용, AI 12~18 공유 |
| 요청 진입 메서드 | `request(name, schema, systemPrompt, userPrompt)` | `text.format.type = "json_schema"`, `strict = true` |
| 적합도 서비스 | `OpenAiFitAnalysisAiService` | `schema()`에서 fit_analysis 스키마를 코드로 조립 |
| 장기경향 서비스 | `OpenAiCareerTrendAiService` (`@Primary`) | career_trend 스키마 |
| 대시보드 서비스 | `OpenAiDashboardInsightAiService` (`@Primary`) | dashboard_insight 스키마 |
| JSON 처리 | Jackson `ObjectMapper`, `JsonNode` | `tools.jackson` 패키지 |
| 프롬프트 분리 | `FitAnalysisPromptCatalog` / `CareerTrendPromptCatalog` / `DashboardInsightPromptCatalog` | system/user 프롬프트를 코드에서 분리 |
| 응답 래퍼 | `StructuredResponse(JsonNode payload, CareerAnalysisAiUsage usage)` | 본문 + 토큰 사용량 |

요청 본문은 손으로 짜지 않고 코드로 조립한다. 핵심만 추리면 이렇다.

```java
// CareerAnalysisOpenAiClient.request(...)
body.put("model", properties.getModel());
body.put("input", List.of(
        message("system", systemPrompt),
        message("user", userPrompt)));
body.put("text", Map.of(
        "format", Map.of(
                "type",   "json_schema",
                "name",   name,        // "fit_analysis" 등
                "strict", true,        // 핵심: 스키마 미준수 차단
                "schema", schema)));   // 서비스가 넘긴 스키마 Map
```

`message(...)`는 Responses API 형식대로 `content`를 `{"type":"input_text","text":...}` 배열로 감싼다. Chat Completions의 평문 `content` 문자열과 다른 부분이라, 이걸 정확히 맞추는 게 Responses API 적용의 실무 포인트다.

## 4. 동작 원리 (데이터 흐름·단계·표/작은 코드)

### 4-1. 전체 흐름

```text
서비스(OpenAiFitAnalysisAiService)
   └─ schema() 로 fit_analysis JSON Schema 조립
   └─ openAiClient.request("fit_analysis", schema, system, user)
        └─ post(body): HttpClient.send (재시도/백오프/4xx·5xx 분기)
        └─ parseOutputJson(root): output_text → 코드펜스 제거 → readTree
   └─ payload(JsonNode)에서 필드별 추출
        └─ fitScore: Math.max(0, Math.min(100, ...))  ← 클램핑
        └─ conditionMatrix, applyDecision 추출
        └─ guardApplyDecision(...) 재검증     ← 가드레일
   └─ FitAnalysisAiResult(status = "SUCCESS")
```

### 4-2. 세 가지 스키마 (필드·enum)

스키마는 모두 `OpenAi*Service.schema()`에서 코드로 만든다. `additionalProperties:false` + 모든 키를 `required`로 둬서 **모델이 임의 필드를 추가하거나 누락하지 못하게** 못박는다.

**fit_analysis** (`OpenAiFitAnalysisAiService.schema()`) — 가장 복잡한 스키마:

| 필드 | 타입 | enum / 비고 |
| --- | --- | --- |
| `fitScore` | integer | 응답 후 0~100 클램핑 |
| `matchedSkills` / `missingSkills` | string[] | |
| `recommendedStudy` / `recommendedCertificates` | string[] | |
| `strategy` | string | |
| `scoreBasis` | string[] | 점수 근거 |
| `gapRecommendations[]` | object[] | `category`: `REQUIRED_MISSING`/`PREFERRED_GAP`/`LONG_TERM_GROWTH`, `priority`: `HIGH`/`MEDIUM`/`LOW` |
| `learningRoadmap[]` | object[] | `skill`, `title`, `practiceTask`, `expectedDuration`, `priority`, `sortOrder`(int) |
| `certificateRecommendations[]` | object[] | `name`, `priority`, `reason` |
| `conditionMatrix[]` | object[] | `conditionType`: `REQUIRED`/`PREFERRED`, `matchStatus`: `MET`/`PARTIAL`/`UNMET`, `evidence` |
| `applyDecision` | object | `decision`: `APPLY`/`COMPLEMENT`/`HOLD`, `reasons[]`, `actions[]` |

**career_trend** (`OpenAiCareerTrendAiService.schema()`):

| 필드 | 타입 |
| --- | --- |
| `trendSummary` | string |
| `recommendedDirections` | string[] |

**dashboard_insight** (`OpenAiDashboardInsightAiService.schema()`):

| 필드 | 타입 |
| --- | --- |
| `summary` | string |

장기경향·대시보드 스키마가 의도적으로 작다는 점에 주목하라. 뉴로-심볼릭 원칙대로 **숫자·집계는 전부 규칙엔진(`AnalysisServiceImpl`)이 결정**하고, LLM에는 그 결과를 요약하는 텍스트만 맡기기 때문이다. `enum`이 들어가는 곳(category/priority/matchStatus/decision)은 전부 적합도 쪽이고, 이 enum들이 그대로 DB(`fit_analysis_condition_match` 등)와 프론트 배지 색으로 이어진다.

### 4-3. enum이 만드는 안전성

`enumString("MET", "PARTIAL", "UNMET")` 한 줄이 조건 매트릭스의 상태값을 고정한다. 만약 자유 텍스트였다면 모델이 "충족", "met", "Matched", "거의 충족" 같은 변종을 뱉었을 것이고, 프론트는 그걸 분기하지 못해 회색 처리하거나 깨졌을 것이다. enum 덕분에 `matchStatus`는 항상 세 값 중 하나라서, 점수 가중(MET=1.0 / PARTIAL=0.5 / UNMET=0.0)과 색상 매핑을 안심하고 결정적으로 할 수 있다. → [점수 엔진](/area-c/score-engine)

### 4-4. 응답 파싱의 방어 (`parseOutputJson`)

strict라도 코드는 한 번 더 의심한다.

```java
String text = outputText(root).trim();           // output_text 우선, 없으면 output[].content[].text 합산
if (text.startsWith("```")) {                     // 모델이 ```json 펜스를 붙인 경우
    text = text.replaceFirst("^```(?:json)?\\s*", "")
               .replaceFirst("\\s*```$", "").trim();
}
if (text.isBlank()) throw ...;                     // 빈 본문 방어
return objectMapper.readTree(text);                // 여기서 깨지면 BusinessException → 폴백
```

`readTree`가 실패하면 `BusinessException`을 던지고, 그건 서비스의 `catch (RuntimeException)`에서 잡혀 **Mock 규칙엔진으로 폴백(status `FALLBACK`)**된다. 즉 JSON 파싱 실패조차 화면을 깨지 않는다. → [폴백 체인](/area-c/fallback-chain)

### 4-5. 재시도 · 지수 백오프 · 4xx/5xx 분기 (`post`)

```java
for (int attempt = 1; attempt &lt;= MAX_ATTEMPTS; attempt++) {   // MAX_ATTEMPTS = 3
    HttpResponse&lt;String> res = httpClient.send(...);
    if (2xx) return readTree(res.body());
    if (attempt &lt; 3 && retryable(status, message)) { sleep(attempt); continue; }
    throw new BusinessException(...);                          // 재시도 불가 → 폴백으로
}
```

`retryable(...)` 판정 기준:

| 분류 | 동작 |
| --- | --- |
| 408 / 429 / 5xx | 재시도 가능 |
| 본문에 `timeout` / `upstream connect` / `disconnect/reset` 포함 | 재시도 가능 (게이트웨이 일시 장애) |
| 그 외 4xx (잘못된 요청·인증 등) | **즉시 중단** — 재시도해도 의미 없음 |
| `IOException` (연결 끊김 등) | 남은 시도가 있으면 재시도 |

백오프는 `Thread.sleep(attempt * 1000L)` — 1차 실패 후 1초, 2차 실패 후 2초로 **선형 증가하는 단순 지수형**이다. 4xx 중 클라이언트 잘못(스키마 오타, 키 만료)은 재시도가 낭비라 바로 끊고, 서버/혼잡(5xx·429)만 backoff로 흡수한다. 이 구분이 "비용·지연을 늘리지 않으면서 일시 장애만 견디는" 핵심이다.

## 5. 구현 상태 (됨 vs 향후) 정직 구분

| 항목 | 상태 |
| --- | --- |
| 세 스키마(fit/career_trend/dashboard) 코드 정의 | **구현됨** |
| `json_schema` strict 요청 본문 조립 | **구현됨** |
| `java.net.http` 호출 + 재시도/백오프/4xx·5xx 분기 | **구현됨** |
| `output_text` 추출·코드펜스 제거·`readTree` 방어 | **구현됨** |
| fitScore 0~100 클램핑 + `guardApplyDecision` 재검증 | **구현됨** |
| 키 없으면 Mock 폴백, 예외 시 `FALLBACK` 처리 | **구현됨** |
| 단위 테스트(`OpenAiFitAnalysisAiServiceTest` 등) | **구현됨** |
| **실제 OpenAI 키로 라이브 호출** | **향후** (키 발급 시 `OpenAi*Service` 활성, 현재는 Mock 규칙엔진으로 결정론적 데모) |

:::tip 정직한 한 줄
"구조화 출력 **아키텍처와 계약은 완성**되어 있고, Mock과 실제 LLM의 응답 형태·검증 경로가 동일하다. 실 LLM 연동은 **API 키 발급 후 토글만 켜면 되는 상태**다." 이렇게 말하면 과장 없이 깊이가 산다.
:::

## 6. 면접 답변 3단계 (초간단/기본/꼬리질문 대응)

**초간단(15초):** "LLM 출력을 자유 텍스트가 아니라 OpenAI Responses API의 json_schema strict 모드로 받습니다. 필드·타입·enum이 스키마로 고정되니 파싱이 깨질 일이 없고, 받은 뒤 점수는 0~100으로 클램핑하고 지원 판단은 규칙으로 재검증합니다."

**기본(45초):** 여기에 더해 — "스키마는 `OpenAiFitAnalysisAiService.schema()`처럼 코드로 조립하고 `additionalProperties:false` + 전부 required로 둬서 모델이 필드를 누락·추가하지 못하게 합니다. 클라이언트 `CareerAnalysisOpenAiClient`는 `java.net.http`로 호출하면서 429·5xx·타임아웃은 최대 3회 지수 백오프로 재시도하고, 일반 4xx는 즉시 끊습니다. 응답 본문은 output_text를 추출해 코드펜스를 제거한 뒤 Jackson `readTree`로 파싱하고, 이게 실패하면 Mock 규칙엔진으로 폴백해 화면이 절대 깨지지 않습니다."

**꼬리질문 대응:** "strict 스키마는 형식만 보장하지 내용 진실성은 보장하지 않습니다. 그래서 입력에 없는 회사·수치를 채우는 환각은 grounding guard가 별도로 잡고, APPLY 같은 판단은 guardApplyDecision으로 점수·필수충족 기준에 맞춰 재검증합니다."

## 7. 자주 나오는 꼬리질문 + 모범답안

**Q1. strict 스키마가 있는데 왜 코드에서 또 클램핑·검증하나요? 이중 아닌가요?**
방어 계층이 다릅니다. strict는 "fitScore가 integer다"까지만 보장하지 "0~100이다", "APPLY는 70점 이상일 때만이다" 같은 도메인 규칙은 보장하지 못합니다. 그건 스키마가 아니라 비즈니스 불변식이라 코드가 책임집니다. 모델 단(형식)과 코드 단(도메인 규칙)은 중복이 아니라 역할 분담입니다.

**Q2. 왜 Chat Completions가 아니라 Responses API인가요?**
구조화 출력을 1급 기능(`text.format.json_schema`)으로 다루고 출력 본문을 `output_text`로 일관되게 받을 수 있어 파싱 분기가 단순해집니다. 다만 입력 메시지의 `content`를 `{"type":"input_text"}` 배열로 감싸야 하는 차이가 있어 `message(...)` 헬퍼로 그 형식을 캡슐화했습니다.

**Q3. 모델이 그래도 ` ```json ` 펜스를 붙이거나 빈 응답을 주면요?**
`parseOutputJson`에서 선행 ` ``` ` 펜스를 정규식으로 벗기고, 본문이 비면 즉시 예외를 던집니다. 어떤 경우든 파싱 실패는 RuntimeException으로 수렴하고, 서비스의 try-catch가 이를 잡아 status `FALLBACK`으로 Mock 결과를 반환합니다. 사용자 화면은 정상값을 받습니다.

**Q4. 왜 스키마를 외부 파일이 아니라 Java 코드(`Map`)로 만드나요?**
스키마가 `FitAnalysisAiResult` 같은 도메인 객체·매핑 코드와 같은 파일에 있어 함께 진화합니다. enum 값을 바꾸면 스키마·추출 코드·DB 컬럼을 한눈에 맞출 수 있어 드리프트가 줄고, 컴파일 시점에 오타가 일부 잡힙니다. AI 12~18이 공유하는 `request(...)`는 스키마를 인자로만 받으므로 클라이언트는 스키마에 무지하게 유지됩니다.

**Q5. 재시도가 무한 루프나 비용 폭증을 일으키지 않나요?**
`MAX_ATTEMPTS=3`으로 상한이 있고, 재시도 대상은 429·5xx·타임아웃류뿐입니다. 인증 실패나 잘못된 요청 같은 일반 4xx는 재시도해도 같은 결과라 즉시 중단합니다. 3회를 다 쓰면 폴백으로 빠지므로, 장애가 길어져도 비용·지연이 선형 이상으로 늘지 않습니다.

**Q6. career_trend·dashboard 스키마는 왜 이렇게 빈약한가요(필드 1~2개)?**
의도된 결과입니다. 뉴로-심볼릭 원칙상 숫자·집계는 규칙엔진이 모두 결정하고, LLM에는 그 결과를 사람이 읽을 한두 문장으로 요약하는 역할만 줍니다. LLM의 책임 표면적을 줄일수록 환각·재현성 위험이 작아지고, 캐시(`career_analysis_run`)와도 잘 맞습니다.

## 8. 직접 말해보기

다음을 막힘없이 30초 안에 설명할 수 있으면 이 페이지를 소화한 것이다.

1. "구조화 출력을 안 쓰면 구체적으로 무엇이 어떻게 깨지는가"를 부족역량 추천 예시로.
2. fit_analysis 스키마에서 enum이 들어가는 4개 필드와, 그 enum이 DB·프론트로 어떻게 이어지는지.
3. 429와 401이 왔을 때 `CareerAnalysisOpenAiClient`의 동작이 어떻게 달라지는지(재시도 vs 즉시 중단).
4. "strict 스키마가 환각을 막는다"는 말의 어디가 틀렸고, 환각은 실제로 무엇이 막는지.

## 퀴즈

<QuizBox question="CareerAnalysisOpenAiClient가 OpenAI 응답으로 받은 fitScore를 0~100으로 클램핑하는 근본 이유로 가장 정확한 것은?" :choices="['json_schema strict가 정수 타입은 보장하지만 값의 범위(도메인 불변식)는 보장하지 않기 때문', 'OpenAI가 점수를 항상 문자열로 반환하기 때문', '클램핑을 빼면 컴파일이 되지 않기 때문', 'Recharts가 100 초과 값을 렌더링하지 못하기 때문']" :answer="0" explanation="strict 스키마는 fitScore가 integer라는 형식만 보장한다. 0~100이라는 범위는 비즈니스 불변식이라 코드(Math.max/Math.min)가 책임진다. 형식 보장(모델 단)과 도메인 규칙(코드 단)은 역할이 다른 별개의 방어 계층이다." />

<QuizBox question="post() 메서드의 재시도 정책상 즉시 중단(재시도 안 함)되는 경우는?" :choices="['HTTP 429 (Too Many Requests)', 'HTTP 503 (Service Unavailable)', 'HTTP 401 같은 일반 4xx 인증/요청 오류', '본문에 timeout 문자열이 포함된 응답']" :answer="2" explanation="retryable()은 408/429/5xx와 timeout·upstream connect·disconnect/reset류만 재시도 대상으로 본다. 401 같은 일반 4xx는 재시도해도 같은 결과이므로 즉시 BusinessException을 던져 폴백으로 넘긴다." />

<QuizBox question="career_trend·dashboard_insight 스키마가 fit_analysis에 비해 의도적으로 단순한(필드 1~2개) 이유는?" :choices="['OpenAI가 큰 스키마를 거부하기 때문', '뉴로-심볼릭 원칙상 숫자·집계는 규칙엔진이 결정하고 LLM에는 요약 텍스트만 맡기기 때문', '캐시 용량을 아끼기 위해 필드를 줄였기 때문', '향후 필드를 추가할 예정이라 비워둔 것']" :answer="1" explanation="장기경향·대시보드의 통계는 AnalysisServiceImpl 규칙엔진이 전부 결정하고, LLM은 그 결과를 사람이 읽을 한두 문장으로 요약만 한다. LLM의 책임 표면적을 줄여 환각·재현성 위험을 낮춘 의도된 설계다." />
