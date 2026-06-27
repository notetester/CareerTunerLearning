# OpenAI 구조화된 출력 (Structured Output / JSON Schema)

> LLM에 "이 JSON 스키마 모양으로만 답해"라고 강제해서, 자유 텍스트를 정규식으로 긁는 도박 없이 응답을 곧장 DTO·도메인 객체로 매핑한다 — 이게 AI 출력단을 신뢰 가능하게 만드는 핵심이다.

## 1. 한 줄 정의

OpenAI Responses API에 **JSON Schema를 함께 보내면** 모델이 그 스키마(필드명·타입·enum·required)에 맞는 JSON만 생성하도록 제약되고, 우리는 그 JSON을 파싱해 자바 record로 안전하게 변환한다. CareerTuner에서는 `OpenAiResponsesClient`가 공고분석·회사분석·적합도 분석 응답을 이 방식으로 받는다.

## 2. 단어 뜻 (약자/어원 풀이)

| 용어 | 풀이 |
| --- | --- |
| Structured Output | 구조화된 출력. 모델이 자유 산문이 아니라 **정해진 구조(JSON)** 로 답하게 하는 기능 |
| JSON Schema | JSON의 모양을 기술하는 표준 스펙. `type`, `properties`, `required`, `enum` 등으로 형태를 명세 |
| `strict: true` | 스키마를 **엄격하게** 강제. 스키마에 없는 필드 금지, required 누락 금지 |
| Responses API | OpenAI의 통합 입출력 API(`/v1/responses`). `input` 메시지 + `text.format`으로 출력 형식 지정 |
| enum | 허용 값 목록. 예: `difficulty`는 `EASY`/`NORMAL`/`HARD`만 |
| `additionalProperties:false` | 스키마에 명시되지 않은 추가 키를 금지 — 모델의 즉흥 필드 생성 차단 |

## 3. 왜 필요한가 (없으면 무슨 문제가 생기나)

LLM의 기본 출력은 **자유 텍스트**다. "적합도 분석 결과를 알려줘"라고 하면 보통 이렇게 답한다.

```text
적합도는 약 72점 정도로 보입니다. 보유 기술 중 Java, Spring은 잘 맞고요,
다만 Kafka 경험이 부족해 보입니다. 종합하면 보완 후 지원을 권장합니다.
```

이걸 그대로 받으면 점수·매칭기술·판정을 **정규식이나 문자열 잘라내기로 추출**해야 한다. 문제는:

- 모델이 "72점"을 "약 72점", "70점대", "B등급"으로 매번 다르게 쓴다 → 파싱 깨짐.
- 마크다운 코드펜스(```), 머리말("물론입니다!"), 후행 설명을 섞어 붙인다.
- 필드를 빼먹거나, 요청하지 않은 필드를 추가한다.
- 한 번 잘 되던 파서가 모델 업데이트 한 번에 조용히 부서진다.

Structured Output은 이 불확실성을 **출력 계약(contract)** 으로 바꾼다. "fitScore는 정수, conditionMatrix는 객체 배열, applyDecision은 APPLY/COMPLEMENT/HOLD 중 하나"라고 스키마에 박아두면, 모델이 그 모양으로만 답한다. 우리 쪽 파서는 "있다고 약속된 필드를 꺼내는" 단순 작업이 된다.

:::tip 핵심 사고방식
자유 텍스트 파싱은 "모델을 믿고 사후에 수습"하는 방식이고, Structured Output은 "모델에게 형식을 강제하고 사전에 보장"하는 방식이다. 신뢰 경계를 출력 시점으로 당기는 게 포인트다.
:::

## 4. CareerTuner에서 어디에 썼나 (영역: AI / 공고·적합도 도메인, 본인=C)

핵심은 백엔드 클라이언트 한 곳에 모여 있다.

- `applicationcase/service/OpenAiResponsesClient.java` — Responses API 호출 + 스키마 빌드 + 파싱의 본체.
  - `analyzeJobPosting(...)` → `job_analysis` 스키마로 공고분석을 받아 `JobAnalysisPayload` record로 매핑.
  - `analyzeCompany(...)` → `company_analysis` 스키마로 회사분석을 받아 `CompanyAnalysisPayload`로 매핑.
  - `extractJobPostingMetadata(...)` → `job_posting_metadata` 스키마로 회사명·직무·마감일을 추출(추출 못 하면 `null`, "추측 금지" 프롬프트).
  - `extractImageText(...)` / `extractPdfText(...)` → 여긴 형식 강제가 필요 없어 일반 텍스트 요청(스키마 미사용, OCR 폴백용).
- 시스템 프롬프트는 도메인별 카탈로그 클래스로 분리: `JobAnalysisPromptCatalog`, `CompanyAnalysisPromptCatalog`, `FitAnalysisPromptCatalog`.
- 설정: `applicationcase/service/OpenAiProperties.java` (`@ConfigurationProperties(prefix = "careertuner.openai")`) — `apiKey`, `model`, `baseUrl`, `timeout`. 키 없으면 `configured()`가 false.

본인(C) 영역의 적합도 분석은 별도 경로를 쓴다.

- `fitanalysis/ai/OpenAiFitAnalysisAiService.java` — `CareerAnalysisOpenAiClient`에 `fit_analysis` 스키마를 넘겨 호출하고, 응답을 `FitAnalysisAiResult`로 매핑. 결과는 `fit_analysis` 테이블로 저장.
- 이 스키마는 `fitScore`(정수), `conditionMatrix`(REQUIRED/PREFERRED · MET/PARTIAL/UNMET), `applyDecision`(APPLY/COMPLEMENT/HOLD), `learningRoadmap`·`gapRecommendations`(priority HIGH/MEDIUM/LOW) 등 **enum이 많이 박힌** 복합 구조다.

:::warning 스키마는 강제하되, 점수·판정은 서버가 다시 확정한다
Structured Output은 "형식"은 보장하지만 "정합성"까지 보장하지는 않는다. CareerTuner는 `OpenAiFitAnalysisAiService.guardApplyDecision(...)`에서 LLM이 낸 `applyDecision`을 결정적 규칙(적합도 70점 이상 & 필수조건 미충족 0개일 때만 `APPLY`)으로 재검증한다. 모델이 비교 매트릭스와 모순되게 `APPLY`를 내면 `COMPLEMENT`로 강등한다. 형식은 모델, 점수·판정의 최종 책임은 서버 규칙 — 이게 면접에서 강조할 포인트다.
:::

## 5. 핵심 동작 원리 (요청 구조 + 파싱 단계)

### 요청 바디: `text.format`에 스키마를 싣는다

`structuredRequest(...)`가 만드는 바디의 모양(축약):

```json
{
  "model": "gpt-5",
  "input": [
    { "role": "system", "content": [{ "type": "input_text", "text": "&lt;시스템 프롬프트>" }] },
    { "role": "user",   "content": [{ "type": "input_text", "text": "&lt;공고 텍스트>" }] }
  ],
  "text": {
    "format": {
      "type": "json_schema",
      "name": "job_analysis",
      "strict": true,
      "schema": { "type": "object", "additionalProperties": false, "properties": { } }
    }
  }
}
```

### 스키마는 코드로 조립한다

자바에서 `Map`을 중첩해 스키마를 만든다. 예: `difficulty`는 enum, 배열은 `items`로 원소 타입 지정.

```java
properties.put("difficulty",
    Map.of("type", "string", "enum", List.of("EASY", "NORMAL", "HARD")));

private Map&lt;String, Object> objectSchema(Map&lt;String, Object> props, List&lt;String> required) {
    return Map.of("type", "object",
                  "additionalProperties", false,   // 즉흥 필드 금지
                  "properties", props,
                  "required", required);            // 누락 금지
}
```

### 응답 파싱: 5단계 방어

| 단계 | 메서드 | 하는 일 |
| --- | --- | --- |
| 1 | `parseResponseBody` | HTTP 응답 전체를 `JsonNode` 트리로 |
| 2 | `outputText` | `output_text` 우선, 없으면 `output[].content[].text` 순회로 본문 합치기 |
| 3 | `cleanOutputText` | 혹시 붙은 ```json 코드펜스 제거, 빈 본문이면 예외 |
| 4 | `parseOutputJson` | 본문 문자열을 다시 JSON 트리로 (형식 위반이면 `BusinessException`) |
| 5 | `text/arrayJson/json` | 필드별로 안전하게 꺼내 record 생성자에 주입 |

### 신뢰성 부가 장치

- **재시도**: `post(...)`가 최대 3회. `isRetryable(...)`이 408/429/5xx·타임아웃·`upstream connect` 등을 재시도 대상으로 판단, 지수적으로 늘어나는 백오프(`attempt * 1000ms`).
- **타임아웃**: `OpenAiProperties.timeout`(기본 300초). 초과 시 "추출 결과 저장 안 됨, 더 작은 파일로 재시도" 안내 예외.
- **키 미설정 가드**: `properties.configured()`가 false면 즉시 `BusinessException(INTERNAL_ERROR)`. 적합도 쪽은 한 발 더 나아가 mock으로 폴백(`OpenAiFitAnalysisAiService`).
- **토큰 사용량**: 응답의 `usage`를 `Usage` record로 뽑아 `ai_usage_log` 적재(크레딧/관리자 통계용).

## 6. 면접 답변 3단계

- **초간단 1문장**: "LLM 응답을 JSON Schema로 강제해서, 자유 텍스트 파싱 없이 곧장 DTO로 매핑하는 기능을 썼습니다."
- **기본**: "OpenAI Responses API의 Structured Output을 사용했습니다. 공고분석·회사분석·적합도 분석마다 `type/properties/required/enum`을 가진 JSON Schema를 `strict:true`로 함께 보내면, 모델이 그 모양으로만 답합니다. `OpenAiResponsesClient`가 응답을 `JobAnalysisPayload` 같은 record로 매핑하고, 점수·지원판정은 서버 규칙으로 한 번 더 검증합니다."
- **꼬리질문 대응**: "형식은 스키마가 보장하지만 값의 정합성까지 보장하진 않아서, 적합도에서는 `guardApplyDecision`으로 LLM의 `APPLY`를 70점·필수조건 기준으로 재검증해 강등합니다. 또 키 미설정·타임아웃·5xx에 대비해 재시도와 mock 폴백, 토큰 사용량 로깅을 함께 두었습니다."

## 7. 자주 나오는 꼬리질문 + 모범답안

:::details Q. 프롬프트에 "JSON으로만 답해"라고 쓰는 것과 뭐가 다른가?
프롬프트 지시는 **권유**일 뿐이라 모델이 머리말("Sure!")·코드펜스·여분 필드를 붙이거나 형식을 어길 수 있습니다. Structured Output의 `strict:true` JSON Schema는 **디코딩 단계에서 형식을 제약**해 required 누락과 `additionalProperties` 추가를 구조적으로 막습니다. 그래도 방어적으로 `cleanOutputText`로 혹시 모를 코드펜스를 한 번 더 벗겨냅니다.
:::

:::details Q. 모델이 그래도 스키마를 어기거나 빈 응답을 주면?
파싱이 단계별로 예외를 던집니다. 본문이 비면 `cleanOutputText`가, JSON으로 안 읽히면 `parseOutputJson`이 `BusinessException(INTERNAL_ERROR, "AI 분석 결과가 JSON 형식이 아닙니다")`를 던지고, `GlobalExceptionHandler`가 `ApiResponse` 에러 엔벨로프로 변환합니다. 적합도 분석은 예외를 잡아 mock 결과로 폴백하고 status를 `FALLBACK`으로 표시합니다.
:::

:::details Q. enum과 additionalProperties:false를 굳이 쓰는 이유는?
enum은 `difficulty`, `priority`, `matchStatus`, `decision`처럼 **분기에 쓰는 값**을 모델이 자유롭게 쓰지 못하게 고정합니다. switch·필터 로직이 깨지지 않습니다. `additionalProperties:false`는 모델이 "도움이 될 것 같아서" 즉흥 필드를 추가하는 걸 막아, 스키마와 record 필드를 1:1로 유지합니다.
:::

:::details Q. 점수까지 모델이 줬는데 서버에서 또 검증하는 건 중복 아닌가?
형식과 정합성은 다른 문제입니다. 스키마는 "fitScore가 정수다"는 보장하지만 "그 점수가 비교 매트릭스와 일치한다"는 보장 못 합니다. 그래서 `fitScore`는 0~100으로 clamp하고, `applyDecision`은 결정적 규칙으로 재검증합니다. 사용자에게 모순된 판단(필수조건 미충족인데 APPLY)이 노출되는 걸 사전 차단하는 가드레일입니다.
:::

:::details Q. 텍스트 추출(이미지/PDF OCR)에는 왜 스키마를 안 쓰나?
OCR은 "구조가 있는 결과"가 아니라 "원문 텍스트 한 덩어리"가 필요합니다. 강제할 필드가 없으니 `textRequest(...)`로 일반 텍스트를 받고 `cleanOutputText`만 적용합니다. 구조화된 메타데이터(회사명·마감일)는 그 다음 단계인 `extractJobPostingMetadata`에서 별도 스키마로 뽑습니다 — 책임을 분리한 설계입니다.
:::

## 8. 직접 말해보기

1. 화이트보드 없이, "자유 텍스트로 받았을 때 생기는 문제 3가지 → Structured Output이 각각을 어떻게 막는가"를 1분 안에 말해보라.
2. "형식은 스키마, 값의 정합성은 서버 규칙"이라는 분리를 적합도 분석의 `guardApplyDecision` 예로 30초 안에 설명해보라.

## 퀴즈

<QuizBox question="OpenAI Responses API에서 출력 형식을 JSON Schema로 강제할 때 요청 바디의 어느 위치에 스키마를 싣는가?" :choices="['input 배열의 system 메시지', 'text.format(type json_schema, strict true)', 'model 필드', 'usage 필드']" :answer="1" explanation="structuredRequest()는 text.format에 type=json_schema, name, strict=true, schema를 넣는다. input은 system/user 메시지, model은 모델명, usage는 응답의 토큰 사용량이다." />

<QuizBox question="CareerTuner가 LLM이 낸 fit_analysis의 applyDecision을 서버에서 다시 검증(guardApplyDecision)하는 이유로 가장 정확한 것은?" :choices="['스키마가 형식은 보장하지만 값의 정합성(점수·필수조건과의 일치)까지는 보장하지 않기 때문', 'OpenAI 응답이 항상 JSON이 아니라서', 'enum을 쓸 수 없어서', '토큰 비용을 줄이려고']" :answer="0" explanation="Structured Output은 형식 계약일 뿐 정합성 보장이 아니다. 그래서 APPLY는 70점 이상·필수 미충족 0개 규칙으로 재검증해 모순된 판단을 COMPLEMENT로 강등한다." />

<QuizBox question="자유 텍스트 파싱 대신 Structured Output을 쓸 때 얻는 실질적 이점을, additionalProperties와 enum의 역할을 들어 한 문단으로 설명하라." explanation="자유 텍스트는 머리말·코드펜스·표현 변주·필드 누락/추가로 파서가 깨지기 쉽다. Structured Output은 JSON Schema를 strict로 강제해 출력 형식을 디코딩 단계에서 보장한다. additionalProperties:false는 모델의 즉흥 필드 생성을 막아 스키마와 record 필드를 1:1로 유지하고, enum은 difficulty·priority·decision처럼 분기에 쓰는 값을 허용 목록으로 고정해 switch·필터 로직이 깨지지 않게 한다. 결과적으로 신뢰 경계를 사후 수습이 아니라 출력 시점으로 당겨, 응답을 곧장 DTO로 안전하게 매핑할 수 있다." />
