# 담당 업무 AI 요약 [#9]

> 공고의 길고 산만한 "주요 업무" 설명을, 지원자가 한눈에 읽고 면접에서 바로 꺼내 쓸 수 있는 **짧은 업무 텍스트**로 정제한다. 별도 LLM 호출이 아니라 공고 분석 한 번(`generateJobAnalysis`)에 묶여 나오는 필드 `duties`가 그 산출물이다.

## 1. 한 줄 정의와 이 페이지가 답하는 면접 질문

**담당 업무 AI 요약(#9)** 은 채용공고의 "주요 업무/담당 업무" 영역을 추출·정리해 `job_analysis.duties` 한 컬럼에 저장하는 기능이다. 필수 역량(#7)·우대 역량(#8)과 **같은 LLM 호출 한 번**으로 함께 산출되며, 결과는 지원 건 상세의 `JobAnalysisPanel` "주요 업무" 카드와 면접 준비 입력으로 쓰인다.

이 페이지가 면접에서 답하게 해주는 질문:

- "공고의 업무 설명을 어떻게 짧은 형태로 만드나? 통째로 생성형 요약을 돌리나?"
- "담당 업무는 왜 JSON 배열이 아니라 텍스트 한 덩어리로 저장하나?"
- "필수/우대 역량과 담당 업무는 별개 호출인가?"
- "LLM이 비거나 실패하면 담당 업무는 어떻게 채우나?"
- "이 산출물이 면접 준비(영역 D)에 어떻게 연결되나?"

:::tip 한 문장 요약
담당 업무 요약은 "독립 AI 기능"이 아니라, 공고 분석 페이로드(`JobAnalysisPayload`)의 한 필드다. 핵심은 **문장 분류 전처리 → LLM 또는 규칙 폴백 → 텍스트 1필드로 동결 저장**이라는 파이프라인이다.
:::

## 2. 왜 이렇게 설계했나 (의도와 트레이드오프)

영역 B의 자체 AI 철학은 "공고문 전체를 한 번에 생성형으로 대체하지 않는다"이다. 담당 업무도 그 원칙을 따른다.

| 결정 | 이유 | 포기한 것 |
| --- | --- | --- |
| 담당 업무를 **분석 호출에 합침** (별도 #9 호출 없음) | 6개 AI 기능(#6~#11)을 LLM 호출 2번(`generateJobAnalysis` + `generateCompanyAnalysis`)으로 끝내 비용·지연 절감 | 담당 업무만 따로 재생성하는 세밀한 제어 |
| `duties`를 **`MEDIUMTEXT` 1필드**로 저장(JSON 아님) | 업무 설명은 "키워드 목록"이 아니라 문장/단락이라 정규화 가치가 낮음. 필수/우대 스킬만 배열(`JSON`)로 분리 | 업무 항목별 구조화 질의(개별 업무 검색) |
| **문장 분류 전처리** 후 LLM에 신호 동봉 | 작은 파인튜닝 모델이 "담당 업무" 영역을 헷갈리지 않도록 미리 라벨(`RESPONSIBILITY`)을 붙여 줌 | 전처리 규칙 유지보수 비용 |
| 폴백 시 **분류기 `RESPONSIBILITY` 문장을 그대로 join** | LLM 없이도 "원문에 실제로 있던 업무 문장"만으로 채워 환각 0 보장 | 표현 다듬기(원문 그대로라 거칠 수 있음) |

설계의 핵심 트레이드오프는 **"짧게 다듬되, 원문에 없는 업무를 지어내지 않는다"** 이다. 담당 업무는 다른 영역(C 적합도, D 면접)이 신뢰하고 소비하는 입력이라, 환각이 섞이면 잘못된 면접 질문·잘못된 적합도 판정으로 번진다. 그래서 LLM이 실패하면 깔끔한 가짜 문장 대신 거칠더라도 원문 기반 규칙 결과로 떨어진다.

## 3. 어떤 기술로 구현했나 (실제 클래스·테이블 근거)

담당 업무 요약은 다음 4개 요소가 협력한다.

| 요소 | 클래스/위치 | 역할 |
| --- | --- | --- |
| 문장 분류 전처리 | `BJobSentenceClassifier` | 공고를 줄/문장으로 쪼개 11라벨 부착. 업무 문장에 `RESPONSIBILITY` 라벨 |
| 분석 엔진 | `BAnalysisGenerationService.generateJobAnalysis` | LLM 우선 → 실패 시 `self-rules-v1` 폴백. `duties` 포함 페이로드 산출 |
| LLM 호출 | `BLocalLlmClient.chat` | Ollama `/api/chat`, JSON Schema로 `duties` 필드 강제 |
| 시스템 프롬프트 | `JobAnalysisPromptCatalog` (`VERSION="b-v1"`) | "B 범위만, 한국어, 짧게" 규칙 |
| 저장 | `job_analysis.duties` (`MEDIUMTEXT`) | 텍스트 1필드. 분석 시점 공고 revision 동결 |

저장 컬럼은 스키마 `schema.sql`에서 확인된다.

```sql
-- job_analysis (#6~9)
required_skills   JSON NULL,        -- #7
preferred_skills  JSON NULL,        -- #8
duties            MEDIUMTEXT NULL,  -- #9  ← 배열 아님, 텍스트
qualifications    MEDIUMTEXT NULL,
difficulty        VARCHAR(20) NULL, -- EASY/NORMAL/HARD
```

`duties`가 `JSON`이 아닌 `MEDIUMTEXT`라는 점이 #7/#8(스킬 배열)과 #9(업무 텍스트)의 가장 명확한 차이다. 프런트도 이를 그대로 반영해, 스킬은 칩(`SkillList`)으로, 담당 업무는 `whitespace-pre-line` 텍스트 블록으로 렌더한다(`JobAnalysisPanel.tsx`의 "주요 업무" 카드).

JSON Schema에 `duties`를 `string`으로 못 박는 부분(`BAnalysisGenerationService.jobAnalysisSchema`):

```java
properties.put("duties", stringSchema());          // 단일 문자열
properties.put("requiredSkills", stringArraySchema()); // 배열
// ...
// required 목록에 "duties" 포함 → 모델이 반드시 채워야 함
```

이 스키마는 `BLocalLlmClient`가 Ollama 요청의 `format` 필드로 그대로 전달하므로(구조화 출력 강제), 모델은 `duties`를 문자열로 반환하도록 제약된다.

## 4. 동작 원리 (흐름·표·작은 코드)

### 4.1 전처리: 업무 문장 라벨링

`BJobSentenceClassifier.classify`가 공고를 줄/문장 단위로 분해하고, 섹션 헤더("담당 업무", "주요 업무", "responsibilities", "duties" 등)를 감지하면 그 아래 줄에 컨텍스트를 전파한다. 업무로 판정된 문장은 `RESPONSIBILITY` 라벨을 받는다. 판정 트리거 키워드(코드의 `label` 메서드):

```text
"담당", "업무", "responsibilities", "duties",
"what you will do", "build", "operate", "개발", "운영"
```

분류 결과는 `classification.asMap()`으로 라벨별 묶음이 되고, JSON으로 직렬화돼(4,000자 절단) LLM 프롬프트의 "문장 분류 신호" 블록에 동봉된다. 즉 LLM은 "이 문장들이 업무 영역으로 추정된다"는 힌트를 받은 상태에서 `duties`를 작성한다.

### 4.2 LLM 경로 (주 경로)

```text
generateJobAnalysis(case, postingText)
  ├─ classify(postingText)                    # RESPONSIBILITY 등 11라벨
  ├─ if localLlm.enabled:                      # 기본 ON
  │    for attempt in 1..(1+maxRetries):       # maxRetries=1 → 최대 2회
  │      content = BLocalLlmClient.chat(SYSTEM_PROMPT, jobPrompt, jobAnalysisSchema)
  │      payload = parseLocalJobPayload(content)  # duties = requiredText(root,"duties")
  │      validateJobPayload(payload)           # duties 비면 예외
  │      validateGrounding(payload)            # 스킬 근거율 검사
  │      return payload                         # 성공
  │    # 모든 시도 실패 → 폴백
  └─ return selfRulesJobAnalysis(...)          # 규칙 기반 duties
```

`duties`에 직접 걸리는 검증은 `validateJobPayload`다. **`duties`가 비어 있으면 예외를 던져 폴백을 유발**한다.

```java
if (isBlank(payload.duties()) || isBlank(payload.qualifications())) {
    throw new IllegalStateException(
        "Local LLM job analysis is missing duties or qualifications.");
}
```

또 `parseLocalJobPayload`는 `duties`를 `requiredText(root, "duties")`로 읽어, 모델이 키를 누락하거나 빈 문자열을 주면 그 자리에서 예외 → 폴백으로 떨어진다. 담당 업무는 "있으면 좋은 필드"가 아니라 **필수 필드**로 취급된다.

:::warning 담당 업무에는 grounding 검증이 직접 걸리지 않는다
`validateGrounding`(원문 토큰 매칭)은 `requiredSkills`/`preferredSkills`에만 적용된다. `duties`의 환각 방지는 (a) 분류기가 던져 준 `RESPONSIBILITY` 신호와 (b) 프롬프트의 "B 범위만/짧게" 규칙, 그리고 (c) 폴백 시 원문 문장 join으로 보장한다. 스킬처럼 토큰 단위로 강제 검증하지는 않는다는 점을 정확히 구분해야 한다.
:::

### 4.3 폴백 경로: 원문 업무 문장 join

LLM이 두 번 다 실패하거나 비활성이면 `selfRulesJobAnalysis`가 `duties`를 만든다. 핵심은 **분류기의 `RESPONSIBILITY` 문장을 그대로 이어 붙이는 것**이다.

```java
String duties = joinClassified(classification, BJobSentenceClassifier.RESPONSIBILITY);
// joinClassified: 해당 라벨 문장 최대 8개를 개행으로 join
// ...
.duties(defaultText(duties, firstSentences(postingText, 2)))
```

`RESPONSIBILITY` 문장이 하나도 없으면 `firstSentences(postingText, 2)`로 공고 앞 2문장을 임시로 채워 빈 값을 막는다. 어느 경로든 **원문에 실제로 존재한 텍스트**만 들어가므로, 폴백 담당 업무는 거칠어도 환각이 없다. 이 폴백 산출물은 `self-rules-v1` 모델명으로 기록되고, 자체 LLM 단계라 크레딧 0(`recordLocalSuccess`)으로 로깅된다.

### 4.4 산출물 저장과 동결

자동 파이프라인이든 동기 단건 재생성이든, 받은 페이로드는 `TransactionTemplate` 안에서만 `job_analysis`에 INSERT된다(`.duties(payload.duties())`). 이때 `job_posting_id` + `job_posting_revision`을 **분석 시점 값으로 동결**하므로, 나중에 공고가 새 revision으로 바뀌면 이 담당 업무는 "이전 공고 rev 기준"으로 표시된다(프런트 stale 배지). 즉 담당 업무 요약도 "어느 공고 버전에서 뽑힌 업무인지"가 추적된다.

### 4.5 두 진입 경로 비교

| 경로 | 트리거 | duties 생성 위치 |
| --- | --- | --- |
| 자동 파이프라인(주) | 추출 품질 PASS 후 `ApplicationCaseAutoPipelineService` | `generateJobAnalysis` 결과의 `payload.duties()`를 그대로 insert |
| 동기 단건 재분석 | `POST /job-analysis` (패널의 "AI 재분석" 버튼) | 동일 엔진 `generateJobAnalysis` 직접 호출 |

둘 다 같은 엔진으로 수렴하므로 담당 업무 산출 로직은 한 곳(`BAnalysisGenerationService`)에 있다.

## 5. 구현 상태 (됨 vs 계획)

| 항목 | 상태 | 근거 |
| --- | --- | --- |
| LLM `duties` 추출(로컬 R1 모델) | **구현·기본 ON** | `generateJobAnalysis`, `local-llm.enabled` 기본 true |
| `duties` 필수 검증(비면 폴백) | **구현** | `validateJobPayload`, `requiredText(root,"duties")` |
| 규칙 폴백(`RESPONSIBILITY` join) | **구현** | `selfRulesJobAnalysis` + `joinClassified` |
| 문장 분류 전처리(11라벨) | **구현(규칙 기반)** | `BJobSentenceClassifier` |
| 사용자 검수(수정·확정) | **구현** | `JobAnalysisPanel` edit 모드 → `reviewJobAnalysis` |
| 공고 revision 동결·stale 표시 | **구현** | `job_posting_revision` 컬럼, 패널 stale 배지 |
| duties 전용 grounding 토큰 검증 | **미구현(의도적)** | grounding은 스킬에만 적용 |
| KLUE-RoBERTa 분류 모델로 교체 | **계획** | 현재는 규칙 기반 분류기 |
| 담당 업무 항목별 구조화(JSON 배열) | **미구현** | `duties`는 `MEDIUMTEXT` 단일 필드 |

:::details "업무 설명을 태그로 쪼갠다"는 표현의 정확한 의미
기획 단계 표현으로 "업무 설명 → 짧은 문장 + 태그"가 등장하지만, 현재 런타임에서 담당 업무 자체는 **텍스트 1필드**다. "태그"에 해당하는 구조화된 키워드는 같은 분석 페이로드의 형제 필드인 `requiredSkills`/`preferredSkills`(JSON 배열, 칩 UI)가 담당한다. 즉 한 화면에서 "업무는 짧은 텍스트, 역량은 태그 칩"으로 함께 보이지만, 데이터 모델상 담당 업무가 태그 배열로 저장되는 것은 아니다. 면접에서 이 구분을 정확히 말하면 신뢰도가 올라간다.
:::

## 6. 면접 답변 3단계

1. **무엇** — "담당 업무 요약은 공고의 주요 업무 영역을 정제해 `job_analysis.duties` 텍스트 필드에 저장하는 기능입니다. 필수·우대 역량과 같은 LLM 호출 한 번으로 함께 나옵니다."
2. **어떻게** — "먼저 규칙 기반 문장 분류기가 공고를 줄 단위로 쪼개 업무 문장에 `RESPONSIBILITY` 라벨을 붙이고, 이 신호를 프롬프트에 동봉해 로컬 LLM이 `duties`를 작성합니다. JSON Schema로 문자열 필드를 강제하고, 비어 있으면 검증에서 막아 폴백시킵니다."
3. **안전장치** — "LLM이 실패하면 지어내는 대신, 분류기가 뽑아둔 원문 업무 문장을 그대로 이어 붙여 채웁니다. 그래서 담당 업무에는 원문에 없던 업무가 들어가지 않고, 분석 시점 공고 revision을 동결해 재현성도 확보합니다."

## 7. 꼬리질문 + 모범답안

:::details Q1. 담당 업무는 왜 JSON 배열이 아니라 텍스트로 저장하나요?
업무 설명은 "키워드 목록"이 아니라 문장·단락 형태라 정규화로 쪼갤 실익이 적습니다. 항목별 검색·필터가 필요한 필수/우대 역량만 `JSON` 배열로 분리하고, 담당 업무와 자격 요건은 `MEDIUMTEXT` 텍스트로 둡니다. 스키마에서 `duties MEDIUMTEXT`, `required_skills JSON`으로 명확히 갈립니다. 프런트도 업무는 텍스트 블록, 역량은 칩으로 다르게 렌더합니다.
:::

:::details Q2. 담당 업무에도 환각 방지 grounding 검증이 걸리나요?
토큰 단위 grounding 검증(`validateGrounding`)은 필수/우대 스킬에만 적용됩니다. 담당 업무는 (a) 분류기가 라벨링한 `RESPONSIBILITY` 신호를 프롬프트로 주고, (b) 폴백 시 원문 업무 문장을 그대로 join하는 방식으로 환각을 막습니다. 또 `duties`가 비면 검증에서 예외를 던져 폴백으로 떨어지므로, 모델이 업무를 누락하는 사고도 차단됩니다. "스킬은 토큰 매칭, 업무는 분류 신호 + 원문 폴백"이라는 차이를 정확히 말하는 게 핵심입니다.
:::

:::details Q3. LLM이 두 번 다 실패하면 담당 업무는 어떻게 채워지나요?
`selfRulesJobAnalysis`가 분류기의 `RESPONSIBILITY` 라벨 문장(최대 8개)을 개행으로 이어 붙여 `duties`를 만듭니다. 업무 문장이 하나도 없으면 공고 앞 2문장으로 임시 대체해 빈 값을 막습니다. 결과는 `self-rules-v1` 모델명으로 기록되고 자체 LLM 단계라 크레딧 0으로 로깅됩니다. 결정론적이라 같은 공고면 항상 같은 결과가 나옵니다.
:::

:::details Q4. 담당 업무 요약만 따로 재생성할 수 있나요?
아니요. 담당 업무는 독립 호출이 아니라 공고 분석(`generateJobAnalysis`) 페이로드의 한 필드라, 재생성은 공고 분석 전체를 다시 돌리는 단위입니다(패널의 "AI 재분석"). 다만 사용자가 검수 모드에서 `duties` 텍스트만 직접 고쳐 `reviewJobAnalysis`로 부분 저장·확정하는 것은 가능합니다. 이때 null 필드는 기존값을 유지합니다.
:::

:::details Q5. 분류기가 업무 문장을 잘못 잡으면 어떻게 되나요?
분류기는 규칙·키워드 기반이라 오분류 가능성이 있습니다. 그래서 LLM 경로에서는 분류 결과가 "정답"이 아니라 "힌트"로만 프롬프트에 들어가고, 최종 `duties`는 LLM이 공고 원문 전체를 보고 작성합니다. 폴백 경로에서만 분류 결과를 직접 사용합니다. 운영적으로는 사용자 검수와 관리자 화면에서 교정할 수 있고, 장기적으로는 규칙 분류기를 KLUE-RoBERTa 같은 학습 모델로 교체하는 것이 계획에 있습니다.
:::

:::details Q6. 담당 업무 요약이 면접 준비(영역 D)에 직접 들어가나요?
설계 의도상 담당 업무·역량이 면접 질문 생성의 입력이지만, 현재 자동 파이프라인의 D 질문 생성은 `duties` 텍스트를 직접 소비하지 않고 `job_analysis`의 필수/우대 스킬과 회사·직무명으로 템플릿 질문을 만듭니다. 담당 업무는 지원 건 상세 "주요 업무" 카드로 사용자에게 보여 주는 용도와, 사용자가 면접 답변을 준비할 때 참고하는 맥락으로 활용됩니다. "계획상 직접 입력, 현재는 스킬 경유 간접"이라고 정직하게 구분하는 게 좋습니다.
:::

## 8. 직접 말해보기

아래를 막힘없이 60초 안에 말할 수 있으면 이 주제를 이해한 것이다.

1. 담당 업무 요약이 "독립 AI 호출이 아니다"라는 점과, 어느 호출에 묶여 나오는지.
2. `duties`가 `MEDIUMTEXT`인 이유와, 필수/우대 역량(`JSON`)과의 데이터 모델 차이.
3. 전처리 분류기의 `RESPONSIBILITY` 라벨이 LLM 경로와 폴백 경로에서 각각 어떻게 쓰이는지.
4. `duties`가 비면 무슨 일이 일어나는지(`validateJobPayload` → 폴백), 그리고 폴백 결과가 왜 환각이 없는지.
5. 공고 revision 동결이 담당 업무 요약에 주는 효과(stale 추적·재현성).

연관 학습: [공고 텍스트 추출/OCR](/ai/job-posting-extraction) · [환각 방지](/ai/hallucination) · [폴백 전략](/ai/fallback) · [구조화 출력](/ai/openai-structured-output) · 같은 섹션의 [필수/우대 역량](/area-b/required-preferred)

## 퀴즈

<QuizBox question="job_analysis.duties 컬럼의 저장 타입과 그 이유로 옳은 것은?" :choices="['JSON 배열 — 업무를 항목별로 검색해야 하므로', 'MEDIUMTEXT 텍스트 — 업무 설명은 문장/단락이라 정규화 실익이 적어서', 'VARCHAR(255) — 한 줄 요약만 저장하므로', '필수/우대 역량과 같은 JSON 타입 — 일관성을 위해']" :answer="1" explanation="duties는 schema.sql에서 MEDIUMTEXT입니다. 키워드 목록인 required_skills/preferred_skills만 JSON 배열로 분리하고, 문장 형태인 담당 업무는 텍스트 1필드로 둡니다." />

<QuizBox question="로컬 LLM이 반환한 결과에 duties가 비어 있을 때 일어나는 일은?" :choices="['빈 문자열 그대로 저장된다', 'validateJobPayload가 예외를 던져 self-rules 폴백으로 넘어간다', 'qualifications 값을 복사해 채운다', '분석 자체가 영구 실패로 기록되고 재시도하지 않는다']" :answer="1" explanation="parseLocalJobPayload는 requiredText로 duties를 읽고, validateJobPayload는 duties가 비면 예외를 던집니다. 그 결과 selfRulesJobAnalysis 폴백이 RESPONSIBILITY 문장으로 duties를 채웁니다." />

<QuizBox question="LLM이 두 번 다 실패했을 때 폴백이 담당 업무를 채우는 방식은?" :choices="['OpenAI에 재요청해 요약을 받아 온다', '분류기의 RESPONSIBILITY 라벨 문장을 그대로 이어 붙인다', '회사명과 직무명으로 일반적인 업무 문장을 생성한다', '담당 업무를 빈 값으로 두고 사용자에게 직접 입력을 요구한다']" :answer="1" explanation="selfRulesJobAnalysis는 joinClassified로 RESPONSIBILITY 문장(최대 8개)을 join합니다. 원문에 실제 있던 문장만 쓰므로 환각이 없고, 없으면 공고 앞 2문장으로 임시 대체합니다." />
