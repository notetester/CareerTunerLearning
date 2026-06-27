# LLM과 프롬프트

> "LLM은 다음 토큰을 확률로 예측하는 모델이고, 그 출력을 통제하는 가장 강력한 손잡이가 프롬프트와 temperature다. CareerTuner는 OpenAI와 로컬 Ollama를 같은 프롬프트 카탈로그로 갈아끼우게 설계했다."

## 1. 한 줄 정의

**LLM(Large Language Model)** 은 방대한 텍스트로 학습해 "지금까지의 토큰들 다음에 올 가장 그럴듯한 토큰"을 확률로 예측하는 신경망이고, **프롬프트(prompt)** 는 그 예측을 원하는 방향으로 몰아주는 입력 텍스트다.

## 2. 단어 뜻 (약자/어원 풀이)

| 용어 | 풀이 |
| --- | --- |
| **LLM** | Large Language Model. "큰(파라미터 수십억+) 언어 모델" |
| **토큰(token)** | 모델이 처리하는 텍스트 최소 단위. 단어보다 작을 때가 많음(한글은 글자/조각 단위로 더 잘게 쪼개짐). 과금·길이 제한이 전부 토큰 기준 |
| **컨텍스트 윈도(context window)** | 한 번에 모델에 넣을 수 있는 토큰 총량(입력+출력). 넘으면 잘리거나 거부됨 |
| **temperature** | 출력의 무작위성 조절값(0=거의 결정론적/일관, 높을수록 다양/창의). 어원은 통계물리의 "온도" |
| **system / user 프롬프트** | system=모델의 역할·규칙(헌법), user=이번 요청의 실제 질문/데이터 |
| **프롬프트 엔지니어링** | 역할 지정·예시·출력형식 강제 등으로 모델 출력 품질을 끌어올리는 작업 |

:::tip 토큰 감각
영어는 대략 "1토큰 ≈ 4글자", 한글은 더 비싸서 "1글자 ≈ 1~3토큰"으로 잡으면 안전하다. 긴 채용공고 PDF를 통째로 넣으면 토큰이 폭발하므로, 추출·요약 후 핵심만 넣는 게 비용·정확도 양쪽에 유리하다.
:::

## 3. 왜 필요한가 (없으면 무슨 문제가 생기나)

LLM 자체는 "무엇이든 그럴듯하게 이어 쓰는" 만능 텍스트 엔진이라, 통제 장치가 없으면 서비스에 쓸 수 없다.

- **출력이 매번 다르다** → temperature를 낮추지 않으면 같은 공고에 점수·문장이 들쭉날쭉해 신뢰가 깨진다.
- **형식이 안 맞는다** → 자유 서술로 답하면 코드가 파싱할 수 없다. JSON 스키마 강제가 필요하다.
- **거짓을 지어낸다(hallucination)** → 공고에 없는 회사·자격증·수치를 만들어낸다. 프롬프트로 "입력에 없는 건 추가 금지" 규칙을 박아야 한다.
- **역할이 흐려진다** → 매 요청마다 "너는 적합도 분석가다"를 다시 설명하면 비효율적이고 일관성이 없다. system 프롬프트로 역할을 고정해야 한다.
- **컨텍스트 초과** → 입력이 너무 길면 잘려 핵심을 잃는다. num_ctx/모델 한도 안에서 설계해야 한다.

즉 프롬프트와 파라미터는 "확률 엔진을 제품 부품으로 바꾸는 어댑터"다.

## 4. CareerTuner에서 어디에 썼나 (실제 클래스/파일/테이블, 영역 표시)

CareerTuner는 **프롬프트를 코드에 흩뿌리지 않고 도메인별 "프롬프트 카탈로그" 클래스에 모은다.** 영역 C(본인 담당)가 적합도/경향/대시보드를 맡는다.

| 위치 | 역할 | 영역 |
| --- | --- | --- |
| `fitanalysis/ai/prompt/FitAnalysisPromptCatalog` | 적합도 분석 system/user 프롬프트, JSON 출력 규칙 | C(구현됨) |
| `analysis/ai/prompt/CareerTrendPromptCatalog` | 장기 취업경향 분석 프롬프트 | C(구현됨) |
| `dashboard/ai/prompt/DashboardInsightPromptCatalog` | 대시보드 요약 인사이트 프롬프트 | C(구현됨) |
| `jobanalysis/ai/prompt/JobAnalysisPromptCatalog` | 공고 분석 프롬프트 | B |
| `companyanalysis/ai/prompt/CompanyAnalysisPromptCatalog` | 기업 분석 프롬프트 | B |
| `applicationcase/service/OpenAiResponsesClient` | OpenAI Responses API 호출, **structured output(json_schema strict)** 전송·파싱 | 공통 |
| `support/chatbot/OllamaChatClient` | 로컬 Ollama 호출, `temperature 0.3 / num_ctx 4096` 옵션 | 공통/지원 |
| `fitanalysis/ai/FallbackFitAnalysisAiService` | 자체모델 → OpenAI → Mock 폴백 체인 | C(구현됨) |
| `ai_usage_log` 테이블 | 모델명·input/output/total 토큰 사용량 기록(과금·`INSUFFICIENT_CREDIT` 판정 근거) | 공통 |

**OpenAI vs 로컬 Ollama 혼용:** 같은 카탈로그의 프롬프트 문자열을 OpenAI 클라이언트와 OSS(Ollama) 클라이언트가 공유한다. 그래서 공급자를 바꿔도 "무엇을 묻는가"는 동일하다.

:::tip 영역 C의 핵심 설계 — 뉴로-심볼릭(neuro-symbolic)
적합도 점수(`fitScore`)·지원판단(`applyDecision`)·매칭/부족 역량은 **서버 규칙엔진(`MockFitAnalysisAiService`)이 결정론적으로 계산**하고, LLM은 그 값을 *입력으로 받아* **한국어 설명 텍스트만** 생성한다(`FitAnalysisPromptCatalog.FIT_EXPLAIN_SYSTEM_PROMPT`, `OssFitAnalysisAiService`). 숫자는 코드가, 말은 모델이 — temperature로 인한 점수 흔들림을 원천 차단하는 패턴이다.
:::

:::warning 설계 단계인 것
자체 파인튜닝 커리어전략 모델(`careertuner-c-career-strategy`, Qwen/Gemma 베이스)과 학습 데이터셋(`ml/career-strategy-llm`)은 **계획·설계 단계**다. 프롬프트 카탈로그에 학습용 system 프롬프트 자리는 잡혀 있지만(train/serve skew 방지 목적), 현재 운영 경로는 OpenAI + 규칙엔진 + Mock 폴백이다.
:::

## 5. 핵심 동작 원리 (표/작은 코드/단계)

### system vs user 프롬프트

`OpenAiResponsesClient.structuredRequest()` 는 두 메시지를 보낸다.

```text
[system]  너는 채용 공고 요구 조건과 지원자 스펙을 비교하는 커리어 적합도 분석가다.
          반드시 한국어로, 주어진 JSON 스키마에 맞는 결과만 생성한다. (규칙 나열...)
[user]    [공고] 회사: ... 직무: ... 필수 역량: ...
          [지원자 프로필] 보유 기술: ...
          위 정보를 비교해 적합도 분석 결과를 생성하라.
```

- **system** = 변하지 않는 역할·규칙·금지사항(과장 금지, 근거 약하면 보수적으로).
- **user** = 이번 건의 실제 데이터(공고·프로필). `FitAnalysisPromptCatalog.userPrompt(...)` 가 빈칸을 채워 만든다.

### 출력 형식 강제 (structured output)

자유 텍스트가 아니라 **JSON 스키마를 강제**해 코드가 바로 파싱할 수 있게 한다.

```java
body.put("text", Map.of("format", Map.of(
    "type", "json_schema",
    "name", "job_analysis",
    "strict", true,          // 스키마 벗어난 출력 금지
    "schema", schema)));     // requiredSkills:[string], difficulty: enum[...] 등
```

응답에 코드펜스(\`\`\`json)가 섞여 오면 `cleanOutputText()` 가 벗겨내고, 파싱 실패 시 `BusinessException(INTERNAL_ERROR)` 으로 떨어뜨린다.

### temperature와 일관성

| 값 | 성격 | CareerTuner에서 |
| --- | --- | --- |
| 0.0~0.3 | 일관·결정론적 | 분석/추출처럼 "정답에 가까운" 작업. `OllamaChatClient` 는 `0.3` |
| 0.7~1.0 | 다양·창의 | 브레인스토밍·표현 다양화 |

분석류는 낮게 잡아 같은 입력에 비슷한 출력을 내도록 한다. 점수 자체는 어차피 규칙엔진이 확정하므로, 모델은 "설명의 톤"만 책임진다.

### 동작 단계 (적합도 분석 예)

```text
1. 규칙엔진이 점수·매칭/부족·지원판단을 계산 (결정론)
2. PromptCatalog가 그 값 + 공고/프로필을 user 프롬프트로 조립
3. system 프롬프트(역할·규칙) + user 프롬프트를 LLM에 전송
4. JSON 스키마로 출력 강제 → 파싱 → FitAnalysisAiResult
5. grounding guard: "부족 역량을 보유로 서술" 등 위반이면 재호출, 소진 시 폴백
6. 토큰 사용량을 ai_usage_log에 기록
```

## 6. 면접 답변 3단계

- **초간단(1문장):** "LLM은 다음 토큰을 확률로 예측하는 모델이고, system/user 프롬프트와 temperature로 그 출력을 통제합니다."
- **기본:** "CareerTuner에서는 프롬프트를 도메인별 카탈로그 클래스(예: `FitAnalysisPromptCatalog`)에 모아 관리합니다. system 프롬프트에 역할과 금지규칙을 고정하고, user 프롬프트에 공고·프로필 데이터를 채워 넣습니다. 분석류는 일관성이 중요해 temperature를 낮게(0.3) 두고, JSON 스키마를 strict로 강제해 코드가 바로 파싱하게 합니다."
- **꼬리질문 대응:** "특히 적합도 점수는 LLM에 맡기면 매번 흔들리므로, 점수·판단은 서버 규칙엔진이 결정론적으로 계산하고 LLM은 그 값을 입력받아 *설명만* 생성하는 뉴로-심볼릭 구조로 분리했습니다. 공급자도 OpenAI와 로컬 Ollama를 같은 프롬프트로 갈아끼울 수 있게 추상화했고, 실패 시 자체모델→OpenAI→Mock으로 폴백합니다."

## 7. 자주 나오는 꼬리질문 + 모범답안

:::details Q1. temperature를 0으로 두면 완전히 같은 답이 나오나요?
"거의 같지만 100% 보장은 아닙니다. 0에 가까울수록 가장 확률 높은 토큰을 고르므로 결정론에 수렴하지만, 부동소수 연산·서버 배치·모델 버전 차이로 미세하게 달라질 수 있습니다. 그래서 *반드시 같아야 하는* 점수 같은 값은 temperature에 의존하지 않고 규칙엔진으로 계산합니다."
:::

:::details Q2. 토큰이 왜 중요한가요?
"세 가지 모두 토큰 기준이기 때문입니다. (1) 과금 — 입력/출력 토큰 수로 비용이 매겨져 `ai_usage_log`에 input/output/total을 기록합니다. (2) 컨텍스트 한도 — 입력+출력이 모델 윈도를 넘으면 잘립니다. (3) 지연 — 출력 토큰이 많을수록 느립니다. 그래서 공고를 통째로 넣지 않고 추출·요약 후 핵심만 넣습니다."
:::

:::details Q3. structured output(JSON 스키마 강제)이 왜 필요했나요?
"LLM이 자유 서술로 답하면 코드가 파싱할 수 없고, 'JSON으로 답해줘'라고 부탁만 하면 가끔 설명 문장이나 코드펜스를 덧붙입니다. OpenAI Responses API의 `json_schema` + `strict:true`로 스키마를 강제하면 필드·타입·enum이 보장됩니다. 그래도 방어적으로 코드펜스 제거(`cleanOutputText`)와 파싱 실패 예외 처리를 둡니다."
:::

:::details Q4. hallucination(환각)은 어떻게 줄였나요?
"세 겹입니다. (1) system 프롬프트에 '입력에 없는 회사명·기술·자격증·수치를 추가하지 않는다', '합격 보장 표현 금지', '근거 약하면 보수적으로'를 명시합니다. (2) 점수·판단은 모델이 아니라 규칙엔진이 정합니다. (3) 출력 후 grounding guard로 '부족 역량을 보유로 서술' 같은 위반을 잡아 재호출하거나 폴백합니다."
:::

:::details Q5. OpenAI와 로컬 Ollama를 왜 둘 다 쓰나요?
"비용·프라이버시·가용성 때문입니다. OpenAI는 품질과 structured output이 강하고, 로컬 Ollama는 키 없이/오프라인으로 돌고 비용이 0입니다. 같은 프롬프트 카탈로그를 공유해 공급자를 인터페이스 뒤로 추상화했고, 자체모델 호출 실패 시 OpenAI, 그것도 안 되면 Mock으로 폴백해 화면이 깨지지 않게 합니다. 자체 파인튜닝 모델은 학습 데이터의 system 프롬프트를 카탈로그와 동일하게 맞춰 train/serve skew를 막도록 설계했습니다."
:::

## 8. 직접 말해보기 (말하기 훈련용 질문)

1. "system 프롬프트와 user 프롬프트를 CareerTuner 적합도 분석 예로 30초 안에 구분해서 설명해 보세요. 각각에 무엇이 들어가나요?"
2. "면접관이 '점수도 그냥 LLM한테 시키면 되지 않나요?'라고 물으면, temperature와 뉴로-심볼릭 분리를 근거로 1분 안에 반박해 보세요."

## 퀴즈

<QuizBox question="CareerTuner 적합도 분석에서 system 프롬프트에 들어가는 내용으로 가장 알맞은 것은?" :choices="['이번 지원 건의 회사명과 보유 기술 데이터', '분석가 역할과 출력 규칙·금지사항', '최종 적합도 점수 숫자', 'OpenAI API 키']" :answer="1" explanation="system 프롬프트는 역할(커리어 적합도 분석가)과 규칙(JSON만 생성, 과장 금지, 근거 약하면 보수적으로)을 고정합니다. 이번 건의 회사명·보유기술 같은 데이터는 user 프롬프트에 들어갑니다." />

<QuizBox question="분석류 작업에서 temperature를 낮게(예: 0.3) 두는 주된 이유는?" :choices="['응답 속도를 높이려고', '토큰 비용을 줄이려고', '같은 입력에 일관된 출력을 내려고', '컨텍스트 윈도를 늘리려고']" :answer="2" explanation="temperature가 낮을수록 가장 확률 높은 토큰을 골라 출력이 일관·결정론적으로 됩니다. 분석·추출처럼 정답에 가까운 작업에 적합합니다. 속도·비용·컨텍스트와는 직접 관련이 없습니다." />

<QuizBox question="CareerTuner가 적합도 점수(fitScore)와 지원판단을 LLM이 아니라 서버 규칙엔진으로 계산하는 이유를 설명해 보세요." explanation="LLM은 temperature 등으로 같은 입력에도 출력이 흔들릴 수 있어 점수가 일관되지 않습니다. 그래서 점수·판단·매칭/부족 같은 정량 판단은 규칙엔진(MockFitAnalysisAiService)이 결정론적으로 계산하고, LLM은 그 값을 입력으로 받아 한국어 설명 텍스트만 생성합니다(뉴로-심볼릭). 이렇게 분리하면 숫자의 신뢰성과 설명의 자연스러움을 동시에 얻고, 모델 출력이 점수를 오염시키지 못합니다." />
