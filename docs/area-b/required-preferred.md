# 필수·우대 조건 AI 추출 [#7·#8]

> 공고 텍스트에서 "반드시 충족해야 하는 역량(필수)"과 "있으면 가산되는 역량(우대)"을 **별도 배열로 분리 추출**한다. 이 두 배열은 C 적합도 분석의 채점 기준 데이터가 되므로, 추출 정확도가 곧 적합도 점수의 신뢰도를 좌우한다.

## 1. 한 줄 정의 · 이 페이지가 답하는 면접 질문

CareerTuner 영역 B의 공고 분석(#6)은 한 번의 LLM 호출로 여러 필드를 뽑는데, 그중 **#7 필수 역량(`requiredSkills`)**과 **#8 우대 역량(`preferredSkills`)**은 의미가 근본적으로 다른 두 카테고리다.

- **필수(required)**: 지원 자격의 하한선. 못 채우면 서류에서 걸린다. → C에서 "감점/탈락 리스크" 기준.
- **우대(preferred)**: 가산점. 있으면 좋고 없어도 지원 가능. → C에서 "추가 가점" 기준.

이 페이지가 답해야 하는 면접 질문:

- "공고에서 필수와 우대를 어떻게 구분해서 뽑았나요?"
- "LLM이 뽑은 스킬을 그대로 믿었나요? 검증은 어떻게 했나요?"
- "이 추출 결과가 다른 기능(적합도)에 어떻게 쓰이나요? 부정확하면 무슨 일이 생기나요?"

핵심 클래스는 `BAnalysisGenerationService`(엔진), 저장 컬럼은 `job_analysis.required_skills` / `job_analysis.preferred_skills`(둘 다 `JSON` 타입)다.

## 2. 왜 이렇게 설계했나 (의도 · 트레이드오프)

### 2.1 왜 "생성"이 아니라 "분리 추출"인가

영역 B의 자체 AI 철학은 **공고문 전체를 생성형으로 대체하지 않는 것**이다. 공고 텍스트를 문장 단위로 쪼개 필수/우대/담당업무/기술스택으로 **분류·추출**하는 것이 본질이다. 이유는 명확하다.

- 필수/우대는 공고에 **실제로 적혀 있는 사실**이다. 모델이 새로 "창작"하면 안 된다. 환각으로 없는 자격요건을 만들면 사용자의 취업 의사결정이 왜곡된다.
- 그래서 추출물은 "어느 원문 구절에서 나왔는지(`evidence`)"를 함께 보존하고, 원문에 근거가 없는 스킬은 **검증 단계에서 폐기**한다(§4의 grounding 검증).

### 2.2 왜 필수와 우대를 "별 컬럼/별 배열"로 나눴나

한 덩어리 텍스트로 합쳐 저장할 수도 있었지만, 분리한 이유는 **하류 소비처(C)가 둘을 다르게 채점하기 때문**이다.

| 구분 | 의미 | C의 사용 방식 | 합쳐서 저장하면? |
| --- | --- | --- | --- |
| 필수 | 충족 하한선 | 미충족 시 큰 감점/리스크 | 가중치를 못 나눔 → 점수 왜곡 |
| 우대 | 가산 요소 | 충족 시 가점 | 우대 미충족을 탈락으로 오인 |

즉 분리 추출은 "데이터 모델을 소비처의 의미론에 맞춘" 결정이다. `FitAnalysisMapper.xml`이 `required_skills`와 `preferred_skills`를 **각각 별도 컬럼으로 SELECT**해 가는 것이 그 증거다.

### 2.3 트레이드오프: 작은 파인튜닝 모델 + 코드 후처리

비용/데이터 주권을 위해 자체 호스팅 소형 모델(파인튜닝 R1)을 쓴다. 대신 소형 모델 특유의 오류(업무 문장을 스킬로 혼입, 경력 오분류)를 **결정론 코드로 후처리 보정**한다. "큰 모델로 한 방에" 대신 "작은 모델 + 규칙 가드"를 택한 것이며, 이 가드 로직 자체가 영역 B 설계의 백미다.

## 3. 어떤 기술로 구현했나 (실제 클래스 · 테이블 근거)

| 역할 | 구현체 |
| --- | --- |
| #7·#8 추출 엔진 | `BAnalysisGenerationService.generateJobAnalysis()` |
| 전처리(문장 분류) | `BJobSentenceClassifier.classify()` — 11라벨, `PREFERRED`/`REQUIRED` 섹션 컨텍스트 전파 |
| LLM 호출 | `BLocalLlmClient.chat()` — Ollama `/api/chat`, JSON Schema 강제 |
| 시스템 프롬프트 | `JobAnalysisPromptCatalog.SYSTEM_PROMPT` (버전 `b-v1`) |
| 규칙 폴백 | `BAnalysisGenerationService.selfRulesJobAnalysis()` (`self-rules-v1`) |
| 저장 | `job_analysis.required_skills` / `preferred_skills` (`JSON` 컬럼) |
| 화면 | `JobAnalysisPanel.tsx` 의 `SkillList`(칩 렌더) |
| 소비처 | `FitAnalysisMapper.xml`(C 적합도) |

스키마 근거(`schema.sql:253-254`):

```sql
required_skills     JSON NULL,
preferred_skills    JSON NULL,
```

LLM 출력 스키마에서 둘 다 문자열 배열로 강제된다(`jobAnalysisSchema()`):

```java
properties.put("requiredSkills", stringArraySchema());   // ["Java","Spring",...]
properties.put("preferredSkills", stringArraySchema());
// required: requiredSkills, preferredSkills 둘 다 필수 필드
```

:::tip 자체 LLM은 무과금
이 추출은 자체 호스팅 LLM 단계라 `ai_usage_log`에 `recordLocalSuccess`(credit=0)로 기록된다. OpenAI 같은 외부 API 비용이 발생하지 않는다.
:::

## 4. 동작 원리 (흐름 · 표 · 작은 코드)

### 4.1 전체 흐름

```text
공고 원문
  │
  ├─(1) BJobSentenceClassifier.classify()      문장→11라벨, PREFERRED/REQUIRED 섹션 전파
  │
  ├─(2) BLocalLlmClient.chat()                 분류 신호 + 원문을 프롬프트로, JSON Schema 강제
  │        └ 출력: requiredSkills[], preferredSkills[], ...
  │
  ├─(3) filterSkillItems()                     업무 문장(스킬 아님) 제거
  │
  ├─(4) validateGrounding()                    원문에 토큰으로 등장하는지 검증 (실패→폴백)
  │
  └─(5) validateJobPayload()                   requiredSkills 비면 예외→폴백
           │
           └─ 통과 → job_analysis.required_skills / preferred_skills 적재
           └─ 실패 → selfRulesJobAnalysis() (규칙 추출)
```

### 4.2 (1) 전처리: 분류기가 필수/우대 섹션을 "컨텍스트 전파"로 잡는다

소형 모델에 그냥 원문만 던지지 않는다. `BJobSentenceClassifier`가 먼저 줄·문장 단위로 라벨을 붙여 **분류 신호 JSON**을 만들고, 이를 프롬프트에 동봉한다. 핵심은 **섹션 헤더를 만나면 그 아래 줄에 라벨을 전파**하는 것이다.

```java
// label(): "우대" 헤더를 만나면 currentSection=PREFERRED, 이후 줄도 PREFERRED로
if (containsAny(lower, "우대", "preferred", "nice to have", "plus", "bonus")) return PREFERRED;
if (PREFERRED.equals(currentSection)) return PREFERRED;   // 헤더 아래 줄 전파
if (containsAny(lower, "필수", "required", "must", "자격요건", "지원 자격")) return REQUIRED;
if (REQUIRED.equals(currentSection)) return REQUIRED;
```

이 덕분에 "우대 사항" 헤더 밑에 줄줄이 나열된 항목들이 한 줄씩 키워드를 안 가져도 PREFERRED로 묶인다. 모델이 필수/우대를 헷갈릴 위험을 전처리에서 미리 줄이는 셈이다.

### 4.3 (2) LLM 호출 — 구조화 출력 강제

`BLocalLlmClient`는 Ollama `/api/chat`에 `format`으로 JSON Schema를 직접 넘겨 출력을 강제한다. 옵션은 `temperature=0`, `num_ctx=8192`, `stream=false`. 결정론적 출력을 위해 온도를 0으로 둔다. 실패 시 `maxRetries=1`이라 총 2회 시도한다.

### 4.4 (3) 핵심 보정: `filterSkillItems` — "업무 문장"을 스킬에서 걷어낸다

R1 모델은 `requiredSkills`에 "결제 시스템 백엔드 API 설계 및 개발" 같은 **업무 문장**을 스킬로 섞어 넣곤 한다. 이건 스킬(`Java`, `Spring`)이 아니라 담당업무다. 그대로 두면 C가 "이 사람이 '결제 시스템 백엔드 API 설계 및 개발'이라는 스킬을 가졌는가"를 채점하려 들어 엉뚱한 점수가 나온다.

```java
private boolean looksLikeSkill(String value) {
    String trimmed = value.trim();
    if (trimmed.isEmpty() || trimmed.length() > 30) return false;   // 너무 길면 문장
    if (trimmed.split("\\s+").length > 4) return false;             // 단어 4개 초과면 문장
    return !SKILL_SENTENCE_PATTERN.matcher(trimmed).find();         // "및/또는/담당..." 패턴 제거
}
```

`SKILL_SENTENCE_PATTERN`은 `및 | 또는 | 등의 | 에 대한 | 설계 및 | 개발 및 | 구축 및 | 담당`을 잡는다. **전부 걸러져 빈 배열이 되면** 규칙 추출(`extractRequiredSkills`)로 폴백해 빈 배열을 방지한다.

### 4.5 (4) 환각 차단: `validateGrounding` — 원문에 없으면 폐기

필수/우대로 뽑힌 스킬이 **실제 공고 원문에 토큰으로 등장하는지** 검증한다. grounded 비율이 임계치(`groundingThreshold`, 기본 0.6) 미만이면 예외를 던져 **규칙 폴백**으로 넘어간다. "근거 기반 추출"의 실체가 바로 이 메서드다.

```java
double ratio = (double) grounded / allSkills.size();
if (ratio < properties.getLocalLlm().getGroundingThreshold()) {   // 기본 0.6
    throw new IllegalStateException("Grounding check failed: ...");  // → self-rules 폴백
}
```

토큰 매칭은 공백을 제거한 정규화 원문에 스킬 토큰(길이 2 이상)이 포함되는지로 본다. 토큰이 2개 이하면 1개만 맞아도, 3개 이상이면 절반 이상 맞아야 grounded로 인정한다.

### 4.6 규칙 폴백의 필수/우대 분리 방식

LLM이 실패하면 `selfRulesJobAnalysis`가 결정론적으로 추출한다. 여기서도 필수/우대를 분리한다.

```java
List<String> requiredSkills = extractRequiredSkills(postingText);   // KNOWN_SKILLS 화이트리스트 매칭
List<String> preferredSkills = extractPreferredSkills(postingText, requiredSkills);
```

- `extractRequiredSkills`: `KNOWN_SKILLS`(46종 화이트리스트, 예: `Java`, `Spring Boot`, `MyBatis`, `Docker`, `AWS`, `React`...)를 원문에서 부분문자열 매칭. 최대 10개.
- `extractPreferredSkills`: **"우대/preferred/nice to have/plus" 섹션 텍스트만** 잘라내(`extractSection`) 거기서 매칭하되, **이미 필수에 든 스킬은 제외**(`!containsIgnoreCase(requiredSkills, skill)`). 최대 6개.

즉 폴백 경로에서도 "우대는 우대 섹션에서, 필수와 중복 제거"라는 분리 원칙이 코드로 강제된다.

## 5. 구현 상태 (됨 vs 계획) 정직 구분

| 항목 | 상태 | 근거 |
| --- | --- | --- |
| 자체 LLM 기반 필수/우대 분리 추출 | **구현 · 기본 ON** | `application.yaml` `B_ANALYSIS_LOCAL_LLM_ENABLED:true`, `BLocalLlmClient` |
| 업무 문장 필터(`filterSkillItems`) | **구현** | `looksLikeSkill`, `SKILL_SENTENCE_PATTERN` |
| 환각 차단 grounding 검증 | **구현** | `validateGrounding`(임계 0.6) |
| `self-rules-v1` 규칙 폴백(우대 섹션 분리) | **구현** | `selfRulesJobAnalysis`, `extractPreferredSkills` |
| 필수/우대 → C 적합도 입력 | **구현** | `FitAnalysisMapper.xml`이 두 컬럼 직접 SELECT |
| 문장 분류기(전처리) | **구현(규칙·키워드 기반)** | `BJobSentenceClassifier` |
| KLUE-RoBERTa 등 ML 문장 분류 모델 | **계획** | 현재 런타임은 규칙 기반 분류기 |
| 프롬프트 버전 | **런타임 `b-v1`** | `JobAnalysisPromptCatalog.VERSION="b-v1"` (스토리보드의 다른 버전 값은 mock 데모) |

:::warning 흔한 혼동
"필수/우대를 LLM이 생성한다"가 아니라 **"원문에서 추출하고, 근거 없으면 폐기한다"**가 정확한 표현이다. grounding 검증과 업무 문장 필터가 그 약속을 코드로 보증한다.
:::

## 6. 면접 답변 3단계

1. **무엇**: "공고 분석에서 필수 역량과 우대 역량을 의미가 다른 두 배열로 분리 추출합니다. 필수는 충족 하한선, 우대는 가산 요소라 하류 적합도 분석이 둘을 다르게 채점하기 때문입니다."

2. **어떻게**: "먼저 규칙 기반 문장 분류기가 '우대/필수' 섹션을 컨텍스트 전파로 라벨링해 신호를 만들고, 그걸 동봉해 자체 LLM을 JSON Schema로 강제 호출합니다. 출력은 그대로 믿지 않고, 업무 문장을 스킬에서 걸러내고(`filterSkillItems`), 원문에 토큰으로 등장하지 않으면 폐기하는 grounding 검증을 거칩니다. 검증을 통과 못 하면 규칙 기반 폴백으로 넘어가 빈 결과를 막습니다."

3. **왜 중요**: "이 두 배열은 `required_skills`/`preferred_skills` 컬럼에 저장돼 C 적합도 분석이 사용자 프로필과 매칭하는 기준이 됩니다. 추출이 부정확하면 적합도 점수가 통째로 왜곡되므로, 정확도 가드를 데이터·프롬프트·검증 여러 층에 둔 겁니다."

## 7. 꼬리질문 + 모범답안

:::details Q1. 필수와 우대를 굳이 나눈 이유가 뭔가요? 한 배열로 합치면 안 되나요?
소비처인 C 적합도 분석이 둘을 **다르게 채점**하기 때문입니다. 필수 미충족은 큰 리스크/감점, 우대 미충족은 단순히 가점이 없을 뿐입니다. 합쳐 저장하면 가중치를 분리할 수 없어 "우대 하나 부족"을 "탈락 위험"으로 오인할 수 있습니다. `FitAnalysisMapper.xml`이 `required_skills`와 `preferred_skills`를 별도 컬럼으로 가져가는 것이 이 분리의 근거입니다.
:::

:::details Q2. LLM이 뽑은 스킬을 그대로 저장하지 않는다고 했는데, 어떤 후처리를 거치나요?
두 가지입니다. (1) `filterSkillItems`: 길이 30자 초과·단어 4개 초과·"및/또는/담당" 패턴을 가진 항목은 스킬이 아니라 업무 문장으로 보고 제거합니다. R1 모델이 "결제 시스템 백엔드 API 설계 및 개발"을 스킬로 섞는 사례를 잡습니다. (2) `validateGrounding`: 뽑힌 스킬이 원문에 토큰으로 등장하는지 비율을 계산해, 0.6 미만이면 환각으로 보고 예외를 던져 규칙 폴백으로 넘깁니다.
:::

:::details Q3. 모든 스킬이 업무 문장으로 걸러지면 결과가 비게 되는데, 어떻게 막나요?
`filterSkillItems`에서 전부 걸러져 빈 배열이 되면, 폴백 텍스트(원문) 기반으로 `extractRequiredSkills`를 호출해 규칙 추출 결과로 채웁니다. 추가로 `validateJobPayload`가 `requiredSkills`가 비면 예외를 던져 self-rules 전체 폴백으로 넘어가므로, 어느 경로로도 필수 역량이 빈 채 저장되지는 않습니다.
:::

:::details Q4. 규칙 폴백에서는 필수/우대를 어떻게 구분하나요?
`extractRequiredSkills`는 46종 화이트리스트(`KNOWN_SKILLS`)를 원문 전체에서 매칭합니다. `extractPreferredSkills`는 "우대/preferred/nice to have/plus" 마커가 있는 줄만 `extractSection`으로 잘라낸 뒤 거기서만 매칭하고, 이미 필수에 든 스킬은 제외합니다. 그래서 폴백 경로에서도 "우대는 우대 섹션에서, 중복 제거"라는 분리 규칙이 유지됩니다.
:::

:::details Q5. 정확도가 C 점수를 좌우한다면, 사용자가 추출 결과를 고칠 수 있나요?
네. `JobAnalysisPanel`의 edit 모드에서 필수/우대를 한 줄에 하나씩 입력하는 textarea로 수정하고, `reviewJobAnalysis`로 부분 갱신합니다(null이면 기존값 유지). 검수 시 JSON 배열은 `BAnalysisJsonValidator`로 키 스키마를 검증합니다. 즉 자동 추출 + 사용자 검수의 2단 구조라, 추출이 틀려도 사람이 교정한 뒤 C가 채점하도록 설계돼 있습니다.
:::

:::details Q6. 왜 큰 모델을 안 쓰고 작은 R1 모델 + 코드 보정을 택했나요?
비용과 데이터 주권 때문입니다. 자체 호스팅 소형 모델은 외부 API 비용이 없고(`ai_usage_log` credit=0), 데이터가 외부로 나가지 않습니다. 대신 소형 모델의 알려진 오류(경력 오분류, 업무 문장 혼입)를 결정론 코드로 보정해 품질을 끌어올립니다. "큰 모델 의존" 대신 "작은 모델 + 결정론 가드"라는 트레이드오프입니다.
:::

## 8. 직접 말해보기

아래 질문에 막힘없이 답할 수 있으면 이 페이지를 이해한 것이다.

1. 필수와 우대를 별 배열로 분리한 이유를 C의 채점 방식과 연결해 설명해 보라.
2. LLM이 "결제 시스템 백엔드 API 설계 및 개발"을 필수 스킬로 내놨을 때 코드가 어떻게 처리하는지 단계별로 말해 보라.
3. grounding 검증이 통과하지 못하면 무슨 일이 일어나는가? 왜 그렇게 설계했는가?
4. 규칙 폴백 경로에서 우대 스킬은 어디서 어떻게 뽑는가?

관련 학습 페이지: [공고 분석 종합](/area-b/job-analysis), [적합도 분석 영역 C](/area-c/), [영역 B 개요](/area-b/)

## 퀴즈

<QuizBox question="필수 역량과 우대 역량을 별도의 JSON 배열/컬럼으로 분리 저장한 가장 핵심적인 이유는?" :choices="['저장 공간을 아끼려고', '하류의 C 적합도 분석이 둘을 다른 가중치로 채점하기 때문', 'LLM이 한 배열만 출력할 수 있어서', 'MySQL이 배열 합치기를 지원하지 않아서']" :answer="1" explanation="필수는 충족 하한선, 우대는 가산 요소라 C가 둘을 다르게 채점한다. FitAnalysisMapper가 required_skills/preferred_skills를 각각 별도 컬럼으로 SELECT하는 것이 근거다." />

<QuizBox question="LLM이 추출한 필수 스킬에 '결제 시스템 백엔드 API 설계 및 개발' 같은 업무 문장이 섞였을 때, 이를 걸러내는 메서드는?" :choices="['validateGrounding', 'reconcileExperienceLevel', 'filterSkillItems', 'normalizeDifficulty']" :answer="2" explanation="filterSkillItems가 looksLikeSkill로 길이 30자 초과·단어 4개 초과·및/또는/담당 패턴을 제거한다. 전부 걸러지면 규칙 추출로 폴백해 빈 배열을 막는다." />

<QuizBox question="validateGrounding 검증이 임계치(기본 0.6) 미만으로 실패하면 어떻게 되는가?" :choices="['빈 배열을 저장한다', '예외를 던져 self-rules-v1 규칙 폴백으로 넘어간다', '사용자에게 즉시 에러를 보여준다', 'OpenAI로 재시도한다']" :answer="1" explanation="grounded 비율이 임계치 미만이면 환각으로 보고 IllegalStateException을 던져, 결정론 규칙 기반 추출(selfRulesJobAnalysis)로 폴백한다. 원문에 근거 없는 스킬이 저장되는 것을 막는 환각 차단 장치다." />
