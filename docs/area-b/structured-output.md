# B의 구조화 추출 · 프롬프트 카탈로그

> 공고문을 통째로 생성형으로 대체하지 않는다. 문장을 쪼개 분류하고, LLM에 JSON Schema를 강제로 물려 "근거 있는 구조화 출력"만 받아 적재한다.

## 1. 한 줄 정의와 이 페이지가 답하는 면접 질문

영역 B의 AI는 채용공고를 자유 산문으로 다시 쓰는 게 아니라, **공고 텍스트를 `requiredSkills`/`preferredSkills`/`duties`/`qualifications`/`evidence` 같은 고정 필드로 쪼개 추출**한다. 이걸 "구조화 추출(structured extraction)"이라고 부르고, 그 출력이 흔들리지 않도록 두 가지 장치를 쓴다.

1. **프롬프트 카탈로그**: 시스템 프롬프트와 출력 스키마를 코드 상수로 못 박은 `JobAnalysisPromptCatalog` / `CompanyAnalysisPromptCatalog`.
2. **JSON Schema 강제 출력**: 로컬 LLM(Ollama) 호출 시 `format` 필드에 JSON Schema를 직접 넘겨, 모델이 그 스키마 모양의 JSON만 뱉도록 묶는다.

이 페이지가 답하는 면접 질문은 이렇다.

- "LLM이 자유 텍스트로 답하면 파싱이 깨지지 않나요? 어떻게 막았나요?"
- "프롬프트를 코드 어디에 두고, 어떻게 버전 관리하나요?"
- "스키마를 강제했는데도 모델이 헛소리를 넣으면요?"

:::tip 핵심 한 줄
"자유 텍스트를 정규식으로 후파싱하는 대신, **모델 출력 자체를 스키마로 제약**하고, 그래도 새는 부분만 결정론 코드로 후처리한다."
:::

## 2. 왜 이렇게 설계했나 (의도·트레이드오프)

### 2.1 "공고 전체 생성"이 아니라 "구조화 추출"인 이유

B의 자체 AI 철학은 명확하다. **공고문 전체를 한 번에 생성형으로 대체하지 않는다.** 공고는 이미 사실(필수 조건, 우대 조건, 담당 업무)을 담고 있는 1차 자료이므로, LLM의 역할은 그 사실을 "다시 쓰는" 게 아니라 "정해진 슬롯으로 분류·정리"하는 것이다. 그래야 뒤에 붙는 영역들(C 적합도, D 면접, E 첨삭)이 `required_skills` 같은 **구조화된 키를 기계적으로 소비**할 수 있다.

자유 산문 요약을 받았다면 C가 다시 그 산문을 파싱해야 한다. 구조화 출력은 그 파싱 부담을 LLM 호출 시점으로 한 번에 당겨오는 설계다.

### 2.2 자유 텍스트 후파싱을 피한 이유

LLM에게 "JSON으로 답해줘"라고 프롬프트로만 부탁하면 모델은 때때로 ` ```json ` 코드펜스를 두르거나, 앞에 설명 문장을 붙이거나, 끝에 쉼표를 빠뜨린다. 그 출력을 다시 정규식·문자열 조작으로 파싱하는 코드는 깨지기 쉽고 디버깅이 어렵다.

대신 B는 **Ollama의 `format` 파라미터에 JSON Schema 객체를 직접 전달**한다. 이 방식은 모델 디코딩 단계에서 스키마에 맞지 않는 토큰을 배제하므로, 결과 문자열은 거의 항상 "파싱 가능한 JSON 객체"다. OpenAI의 Structured Outputs와 같은 발상이며, 그 공통 배경은 [공통 구조화 출력](/ai/openai-structured-output) 페이지에서 다룬다.

| 접근 | 장점 | 단점 | B의 선택 |
| --- | --- | --- | --- |
| 프롬프트로만 "JSON 줘" | 구현 간단 | 형식 깨짐·후파싱 지옥 | 안 씀 |
| 출력 정규식 후파싱 | 모델 자유도 높음 | 취약·환각 통제 불가 | 안 씀(폴백 규칙엔진에만 일부 잔존) |
| **스키마 강제 + 코드 후처리** | 형식 보장·환각 통제 | 스키마 정의 비용 | **채택** |

### 2.3 트레이드오프: 스키마 강제만으로 부족하다

스키마를 강제해도 모델은 "필드 *모양*"만 맞출 뿐 "필드 *내용*"이 옳다고 보장하진 않는다. 파인튜닝된 소형 모델(`careertuner-b-jobposting-r1`, 이하 R1)은 `requiredSkills`에 "결제 시스템 백엔드 API 설계 및 개발" 같은 **업무 문장**을 스킬로 끼워 넣거나, "경력 5년 이상" 공고를 `JUNIOR`로 오분류한다. 그래서 B는 스키마 강제 *뒤에* 결정론 후처리 층을 한 겹 더 둔다(§4.3).

## 3. 어떤 기술로 구현했나 (실제 클래스·테이블 근거)

```text
BJobSentenceClassifier   문장 분류 전처리(규칙·키워드, 11라벨)
        │  Classification(라벨별 문장)
        ▼
BAnalysisGenerationService   #6~11 엔진 — 프롬프트 조립 + 스키마 정의 + 후처리/grounding
        │  systemPrompt + userPrompt + jsonSchema
        ▼
BLocalLlmClient.chat()   Ollama /api/chat, format=JSON Schema 강제
        │  JSON 문자열
        ▼
parseLocalJobPayload / parseLocalCompanyPayload   파싱 + 검증 + 후처리
```

핵심 클래스(전부 `backend/src/main/java/com/careertuner/applicationcase/service/`):

| 클래스 | 역할 |
| --- | --- |
| `BJobSentenceClassifier` | 공고를 줄·문장 단위로 쪼개 11라벨 부착(전처리 신호) |
| `BAnalysisGenerationService` | 프롬프트 조립, JSON Schema 빌드, 후처리, grounding 검증, 규칙 폴백 |
| `BLocalLlmClient` | Ollama `/api/chat` 호출, `format`에 스키마 전달 |
| `BAnalysisProperties` | 모델명·타임아웃·`groundingThreshold`(0.6) 등 설정 |

프롬프트 카탈로그(영역별 패키지에 분리):

| 클래스 | 경로 |
| --- | --- |
| `JobAnalysisPromptCatalog` | `jobanalysis/ai/prompt/JobAnalysisPromptCatalog.java` |
| `CompanyAnalysisPromptCatalog` | `companyanalysis/ai/prompt/CompanyAnalysisPromptCatalog.java` |

두 카탈로그 모두 `VERSION = "b-v1"`이다. (스토리보드 데모에 보이는 `b-v3.2`는 `VITE_USE_MOCK` 빌드의 mock 값으로, 런타임 진실이 아니다.)

## 4. 동작 원리 (흐름·표·작은 코드)

### 4.1 전처리: 문장 분류로 "신호"를 만든다

`BJobSentenceClassifier.classify`는 공고를 줄 단위로 쪼개고(긴 줄은 문장·불릿 단위로 추가 분할), 각 조각에 라벨을 단다. 11개 라벨: `SECTION_HEADER`, `RESPONSIBILITY`, `REQUIRED`, `PREFERRED`, `QUALIFICATION`, `TECH_STACK`, `EMPLOYMENT_CONDITION`, `BENEFIT`, `APPLICATION_INFO`, `COMPANY_INFO`, `OTHER`.

핵심 기법은 **섹션 헤더 컨텍스트 전파**다. "우대 조건"이라는 헤더를 만나면 `currentSection = PREFERRED`로 바꾸고, 그 아래 줄들은 키워드가 없어도 `PREFERRED`로 상속한다.

```java
// BJobSentenceClassifier.classify (요약)
String currentSection = OTHER;
for (String sentence : splitSentences(text)) {
    String label = label(sentence, currentSection);   // 헤더면 SECTION_HEADER
    if (SECTION_HEADER.equals(label)) {
        currentSection = sectionLabel(sentence);       // 이후 줄에 전파
    }
    rows.add(new LabeledSentence(order++, sentence, label));
}
```

이 분류 결과는 LLM을 **대체하지 않는다.** 분류 신호 JSON(4,000자로 절단)을 프롬프트에 동봉해, R1이 어디가 필수/우대/업무인지 힌트를 갖고 추출하게 돕는 입력일 뿐이다. (LLM이 꺼져 있으면 같은 분류 결과가 `self-rules-v1` 폴백의 직접 입력이 된다.)

### 4.2 프롬프트 조립과 스키마 강제 호출

`generateJobAnalysis`는 시스템 프롬프트(카탈로그 상수), 사용자 프롬프트(회사/직무명 + 분류 신호 + 공고 원문 12,000자 절단), JSON Schema를 만들어 `BLocalLlmClient.chat`에 넘긴다.

```java
// jobAnalysisSchema (요약) — enum까지 코드로 못 박는다
properties.put("experienceLevel",
    Map.of("type", "string", "enum", List.of("JUNIOR", "MID", "SENIOR")));
properties.put("difficulty",
    Map.of("type", "string", "enum", List.of("EASY", "NORMAL", "HARD")));
properties.put("evidence", objectArraySchema(           // [{field, quote}]
    Map.of("field", stringSchema(), "quote", stringSchema()),
    List.of("field", "quote")));
// objectSchema는 additionalProperties=false + required 전 필드 강제
```

`BLocalLlmClient.chat`이 실제로 보내는 Ollama 요청 옵션:

| 항목 | 값 | 이유 |
| --- | --- | --- |
| `stream` | `false` | 한 번에 완성 JSON 수령 |
| `think` | `false` | 추론 토큰 비활성(R1 출력 단순화) |
| `temperature` | `0` | 결정론적·재현 가능한 추출 |
| `num_ctx` | `8192` | 긴 공고 컨텍스트 수용 |
| `format` | **JSON Schema 객체** | 출력 형식 강제(이게 핵심) |
| read-timeout | `480s` | 최대 8분 걸리는 로컬 추론 허용 |

`format`에 스키마를 통째로 넘기는 이 한 줄이 "자유 텍스트 후파싱 회피"의 실체다. 모델은 스키마 밖 모양을 만들 수 없다.

### 4.3 후처리: 스키마가 못 잡는 "내용 오류"를 결정론 코드로 교정

`parseLocalJobPayload`는 JSON을 파싱한 뒤 곧장 후처리한다. 소형 모델 R1의 알려진 결함을 코드로 메우는 단계다.

| 후처리 | 잡는 문제 | 방법 |
| --- | --- | --- |
| `reconcileExperienceLevel` | "경력 5년↑"을 JUNIOR로 오분류 | 원문에서 연차 정규식 파싱(≥5년→SENIOR, 1~4년+JUNIOR→MID) |
| `EXPERIENCE_YEARS_PATTERN` | "경력 무관"·"2024년"·"설립 10년차" 오탐 | 연차 숫자가 경력 키워드와 *결합*된 경우만 인정, lookahead로 부정어 배제 |
| `filterSkillItems` / `looksLikeSkill` | 업무 문장을 스킬로 혼입 | 길이>30자·단어>4개·"및/또는/담당…" 패턴 제거, 전부 걸리면 규칙 추출 폴백 |
| `validateGrounding` | 원문에 없는 스킬(환각) | 스킬 토큰이 공고 원문에 실제 등장하는지 검사 |

특히 `validateGrounding`이 "근거 기반"의 코드 구현이다. 추출된 모든 스킬의 토큰을 공백 제거한 원문과 대조해, **grounded 비율이 임계값(`groundingThreshold`, 기본 0.6) 미만이면 예외**를 던져 LLM 결과를 통째로 버리고 규칙 폴백으로 떨어진다.

```java
// validateGrounding (요약)
double ratio = (double) grounded / allSkills.size();
if (ratio &lt; properties.getLocalLlm().getGroundingThreshold()) {
    throw new IllegalStateException("Grounding check failed: ...");  // → self-rules 폴백
}
```

`validateJobPayload`도 같은 결로 작동한다. requiredSkills가 비었거나, summary가 20자 미만이거나, duties·qualifications가 누락되면 예외 → 폴백. 즉 **스키마는 모양을, 검증 메서드는 최소 내용 품질을, grounding은 사실성을** 각각 보증한다.

### 4.4 기업 분석: 프롬프트가 환각을 직접 차단한다

`CompanyAnalysisPromptCatalog.SYSTEM_PROMPT`는 안전 불변식을 문장으로 명문화한다. 핵심만 옮기면:

- 외부 웹 검색 금지, 모델 내부 지식을 검증된 사실로 쓰지 말 것.
- `verifiedFacts`에는 입력(회사명/직무명/공고문)에서 **직접 확인되는 사실만**.
- 대표자·설립일·직원 수·매출·투자·뉴스 등 입력에 없는 정보 금지.
- `aiInferences`는 추론과 "확인 필요"를 구분.

그리고 스키마가 `verifiedFacts = [{fact, source}]`와 `aiInferences = [{inference, basis}]`를 **별개 배열로 분리**한다. 사실과 추론이 데이터 모델 차원에서 갈라지므로, 사용자에게 "검증된 사실 vs AI 추론" 2분할 UI로 그대로 내려간다. 환각 통제가 **프롬프트(금지 규칙) + 스키마(필드 분리) + 검증(`validateCompanyPayload`)** 3층으로 들어간 셈이다. 더 넓은 맥락은 [환각 방지](/ai/hallucination) 참고.

## 5. 구현 상태 (됨 vs 계획) 정직 구분

| 항목 | 상태 | 근거 |
| --- | --- | --- |
| 로컬 LLM(R1) 스키마 강제 추출 | **구현·기본 ON** | `application.yaml`에서 `B_ANALYSIS_LOCAL_LLM_ENABLED:true` 오버라이드, `BLocalLlmClient` |
| `format`에 JSON Schema 직접 전달 | **구현** | `BLocalLlmClient.chat`의 `request.format` |
| 문장 분류 전처리(11라벨) | **구현(규칙·키워드)** | `BJobSentenceClassifier` |
| 후처리(연차/스킬/grounding) | **구현** | `reconcileExperienceLevel` / `filterSkillItems` / `validateGrounding` |
| `self-rules-v1` 규칙 폴백 | **구현** | `selfRulesJobAnalysis` / `selfRulesCompanyAnalysis` |
| 프롬프트 버전 | **런타임 `b-v1`** | 두 카탈로그 `VERSION="b-v1"` (스토리보드 `b-v3.2`는 mock) |
| KLUE-RoBERTa 등 ML 문장 분류 모델 | **계획** | 현재 런타임은 규칙 기반 `BJobSentenceClassifier` |
| OpenAI Responses / OSS provider 추상화 | **죽은 코드(미배선)** | `jobanalysis/ai` 패키지는 외부 참조 0, 활성 경로는 `BLocalLlmClient` 단일 |

:::warning 자주 틀리는 지점
`careertuner.b-analysis.local-llm.enabled`의 **Java 기본값은 `false`**(`BAnalysisProperties`)지만, `application.yaml`이 `true`로 오버라이드한다. 그래서 "실행 기본 ON"이 정답이다. 둘을 혼동해 "기본 OFF"라고 답하지 말 것.
:::

## 6. 면접 답변 3단계

1. **무엇**: "영역 B는 공고를 산문으로 다시 쓰지 않고, 필수/우대/업무/근거 같은 고정 슬롯으로 *추출*합니다. 그 출력을 안정시키려고 프롬프트와 출력 스키마를 코드 상수(`JobAnalysisPromptCatalog`, `CompanyAnalysisPromptCatalog`)로 못 박고, LLM 호출 시 JSON Schema를 강제했습니다."
2. **어떻게**: "Ollama `/api/chat`의 `format` 파라미터에 스키마 객체를 직접 넘겨 모델이 그 모양의 JSON만 내도록 했습니다. `temperature=0`으로 결정론을 확보하고요. 그래도 소형 모델이 내용을 틀리는 건 스키마로 못 막으니, 파싱 직후 연차 보정·스킬 문장 필터·grounding 검증을 결정론 코드로 한 겹 더 둡니다."
3. **왜**: "자유 텍스트를 후파싱하면 형식이 잘 깨지고 환각을 통제할 수 없습니다. 스키마 강제는 형식을, grounding 검증과 사실/추론 필드 분리는 사실성을 각각 보장합니다. 모든 게 실패하면 `self-rules-v1` 규칙 엔진으로 폴백해 사용자에게는 항상 채워진 결과가 갑니다."

## 7. 꼬리질문 + 모범답안

:::details Q1. 프롬프트로 "JSON 줘"라고 하는 것과 `format`에 스키마를 넘기는 건 뭐가 다른가요?
프롬프트 지시는 *권유*라서 모델이 코드펜스·설명 문장·문법 오류를 섞을 수 있고, 그걸 다시 후파싱해야 합니다. `format`에 JSON Schema를 넘기면 디코딩 단계에서 스키마에 맞지 않는 출력을 배제하므로 결과가 거의 항상 파싱 가능한 객체입니다. B는 `enum`(experienceLevel, difficulty), `objectArraySchema`(evidence·ambiguousConditions), `additionalProperties=false`, `required` 전 필드까지 스키마로 못 박습니다.
:::

:::details Q2. 스키마를 강제했는데도 grounding 검증이 왜 또 필요한가요?
스키마는 "모양"만 보장하지 "내용"은 보장하지 않습니다. `requiredSkills`가 문자열 배열이라는 건 강제되지만, 그 안에 공고에 없는 스킬(환각)이 들어가는 건 못 막습니다. `validateGrounding`은 추출 스킬의 토큰이 실제 공고 원문에 등장하는지 대조해, grounded 비율이 0.6 미만이면 예외를 던져 LLM 결과를 버리고 규칙 폴백으로 떨어집니다.
:::

:::details Q3. 문장 분류를 규칙으로 했는데 그럴 거면 LLM이 왜 필요한가요?
분류기는 LLM 입력을 돕는 *전처리 신호*이지 최종 추출이 아닙니다. 규칙 분류는 "어디가 우대 섹션인지" 같은 거친 구획을, LLM은 그 안에서 "구체적으로 어떤 스킬·업무인지"를 뽑습니다. 게다가 LLM이 꺼지거나 실패하면 같은 분류 결과가 `self-rules-v1` 폴백의 직접 입력이 되어 시스템이 항상 답을 냅니다. 분류기는 두 경로 공용 자산입니다.
:::

:::details Q4. 후처리에서 "경력 무관"을 어떻게 연차 오탐에서 배제하나요?
`EXPERIENCE_YEARS_PATTERN`은 연차 숫자가 경력 키워드(경력/경험/실무, experience/exp)와 *결합*된 경우만 인정합니다. 그리고 `NOT_IRRELEVANT` lookahead로 경력 키워드 뒤에 "무관/관계 없/상관 없/제한 없/불문"이 오면 매칭을 막습니다. 덤으로 "설립 10년차"(연혁)·"2024년"(날짜)은 키워드 결합이 없어 자연히 배제되고, 1~30년 범위만 현실적 연차로 받습니다.
:::

:::details Q5. 프롬프트 버전을 코드 상수로 둔 이유는요? DB나 설정으로 빼면 더 유연하지 않나요?
`VERSION="b-v1"`을 카탈로그 상수로 두면 프롬프트·스키마·버전이 한 컴파일 단위에 묶여, 어떤 코드가 어떤 프롬프트로 돌았는지 git 이력으로 추적됩니다. 운영 화면(`AdminPromptView`)도 이 상수를 그대로 노출합니다. 동적 변경이 필요한 토글(예: OpenAI 폴백)은 별도로 `ai_runtime_setting`에 두지만, 프롬프트 본문 같은 "정확성에 직결되는 값"은 코드에 고정하는 편이 안전합니다.
:::

:::details Q6. 기업 분석에서 사실과 추론을 굳이 별 컬럼으로 나눈 이유는?
환각이 "검증된 사실"로 사용자에게 보이면 취업 의사결정을 왜곡합니다. 그래서 스키마에서 `verifiedFacts=[{fact,source}]`와 `aiInferences=[{inference,basis}]`를 처음부터 분리하고, 프롬프트로 "verifiedFacts엔 입력에서 직접 확인되는 사실만"을 강제합니다. DB의 `verified_facts`/`ai_inferences` 컬럼도 분리돼 있어, 프런트가 "검증된 사실 vs AI 추론" 2분할로 그대로 렌더합니다. 모델·프롬프트·UI가 일관되게 두 종류를 갈라 보여주는 구조입니다.
:::

## 8. 직접 말해보기

다음을 소리 내어 30초 안에 설명해 보라. 막히면 §4로 돌아간다.

1. "구조화 추출"이 "공고 전체 생성"과 어떻게 다른지, 그리고 그게 C·D·E에 왜 중요한지.
2. `format`에 JSON Schema를 넘기는 것이 "프롬프트로 JSON 부탁"보다 나은 이유 두 가지.
3. 스키마 강제 *이후에도* 후처리(연차 보정·스킬 필터·grounding)가 필요한 이유.
4. 기업 분석에서 환각이 프롬프트·스키마·검증 3층으로 어떻게 막히는지.

## 퀴즈

<QuizBox question="B가 자유 텍스트 후파싱 대신 LLM 출력을 안정시킨 핵심 방법은?" :choices="['응답을 정규식으로 후파싱한다', 'Ollama 요청의 format 필드에 JSON Schema를 직접 전달해 출력 형식을 강제한다', 'temperature를 1로 올려 다양성을 확보한다', 'OpenAI Responses API를 직접 호출한다']" :answer="1" explanation="BLocalLlmClient.chat이 Ollama /api/chat 요청의 format에 jsonSchema를 통째로 넘겨, 모델이 스키마 모양의 JSON만 내도록 강제한다. 이것이 후파싱 회피의 실체다." />

<QuizBox question="스키마를 강제했는데도 validateGrounding 검증이 추가로 필요한 이유로 가장 정확한 것은?" :choices="['스키마가 JSON 문법 오류를 못 잡기 때문', '스키마는 필드의 모양만 보장할 뿐 내용의 사실성(환각 여부)은 보장하지 못하기 때문', 'Ollama가 배열을 지원하지 않기 때문', 'temperature가 0이라 출력이 매번 달라지기 때문']" :answer="1" explanation="스키마는 requiredSkills가 문자열 배열임을 강제하지만 그 안에 공고에 없는 스킬이 들어가는 환각은 막지 못한다. validateGrounding이 토큰을 원문과 대조해 grounded 비율이 임계값(0.6) 미만이면 폴백시킨다." />

<QuizBox question="런타임 기준 영역 B 프롬프트 카탈로그의 실제 VERSION 값은?" :choices="['b-v1', 'b-v3.2', 'gpt-5', 'self-rules-v1']" :answer="0" explanation="JobAnalysisPromptCatalog와 CompanyAnalysisPromptCatalog 모두 VERSION=\"b-v1\"이다. 스토리보드에 보이는 b-v3.2는 VITE_USE_MOCK 데모 값이라 런타임 진실이 아니다." />
