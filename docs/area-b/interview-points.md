# 면접 포인트 AI 추출 [#11]

> 공고 + 기업 분석 + 추출된 조건을 한 번에 묶어, 면접에서 실제로 검증될 기술·경험·협업 포인트를 만들어 `company_analysis.interview_points`에 저장하는 기능. 단, "면접 질문(D)"의 입력으로 직접 들어가는지는 계획과 구현이 갈린다.

## 1. 한 줄 정의와 이 페이지가 답하는 면접 질문

면접 포인트(#11)는 **기업 분석(#10)과 같은 LLM 호출에서 함께 산출되는 단일 텍스트 필드**다. 별도의 AI 호출이 아니라 `generateCompanyAnalysis`의 출력 스키마 안에 `interviewPoints`라는 항목으로 포함되어, "이 공고/회사에서 면접관이 무엇을 파고들 것인가"를 미리 정리한다.

이 페이지가 답하는 면접 질문:

- "면접 포인트는 어디서 어떻게 만들어지고, 무슨 입력을 보나?"
- "그게 영역 D(면접 질문 생성)로 바로 들어가는가? 아니라면 둘은 어떻게 연결되나?"
- "기업 분석과 분리된 별도 기능인가, 아니면 한 LLM 호출의 일부인가?"
- "환각(없는 회사 정보를 면접 포인트에 끼워 넣는 것)을 어떻게 막는가?"

:::tip 한 문장 요약
#11은 "데이터로는 `company_analysis`에 저장되는 텍스트 한 칸"이고, "설계 의도로는 D의 입력"이지만, **현재 자동 파이프라인의 D 질문 생성은 `interview_points`를 읽지 않는다.** 이 갭을 정직하게 설명하는 것이 이 주제의 핵심이다.
:::

## 2. 왜 이렇게 설계했나 (의도·트레이드오프)

### 2.1 왜 기업 분석과 한 호출로 묶었나

면접 포인트는 본질적으로 **기업 분석의 부산물**이다. "이 회사가 어떤 산업이고, 공고에서 어떤 책임을 강조하고, 어떤 스킬을 필수로 봤는가"를 이미 LLM이 한 번 읽었다면, "그래서 면접에서 뭘 검증할까"는 같은 컨텍스트에서 자연스럽게 따라 나온다. 별도 호출로 쪼개면:

- LLM 호출이 한 번 더 늘어 비용·지연(자체 LLM 기준 read-timeout 480s)이 두 배가 되고,
- 같은 공고문을 두 번 토큰으로 넣어야 하며,
- 두 산출물의 일관성(요약과 면접 포인트가 어긋남)을 따로 보정해야 한다.

그래서 #10(기업 현황 요약)과 #11(면접 포인트)은 **하나의 JSON 스키마, 하나의 LLM 호출**로 합쳐졌다. `CompanyAnalysisPromptCatalog.SCHEMA_SUMMARY`가 이를 그대로 보여준다.

```text
companySummary, recentIssues, industry, competitors[],
interviewPoints, sources[], verifiedFacts[], aiInferences[]
```

### 2.2 왜 "면접 질문 생성(D)"과 직접 배선하지 않았나 — 정직한 트레이드오프

설계 문서상 #11의 출력 계약은 "D 면접 질문 생성의 입력"이다. 그러나 **현재 자동 파이프라인은 D 질문을 만들 때 `interview_points`를 소비하지 않는다.** 대신 공고 분석(#7/#8)의 필수·우대 스킬 + 케이스의 회사/직무명으로 **하드코딩 템플릿 6문항**을 만든다(§4.3).

이건 의도된 단순화로 읽힌다: 자유 텍스트인 `interview_points`를 파싱해 질문 6개로 쪼개는 것보다, 구조화된 스킬 배열을 템플릿에 끼우는 편이 **결정론적이고 깨지지 않기** 때문이다. 트레이드오프는 명확하다 — 안정성을 얻는 대신, #11이 만든 풍부한 면접 포인트가 D 질문에는 반영되지 않고 **"사용자에게 보여줄 기업 분석 카드"로만** 쓰인다.

## 3. 어떤 기술로 구현했나 (실제 클래스·테이블 근거)

| 역할 | 위치 |
| --- | --- |
| 면접 포인트 생성 엔진(#10/#11 공통) | `BAnalysisGenerationService.generateCompanyAnalysis` |
| 환각 차단 시스템 프롬프트 | `CompanyAnalysisPromptCatalog.SYSTEM_PROMPT` (`VERSION="b-v1"`) |
| LLM 출력 스키마(필수 필드에 `interviewPoints` 포함) | `BAnalysisGenerationService` 내 company JSON Schema |
| 규칙 폴백(LLM 실패 시) | `BAnalysisGenerationService` company `self-rules-v1` |
| 검증(누락 시 폴백 유발) | `validateCompanyPayload` |
| 자동 파이프라인의 저장·D 연결 | `ApplicationCaseAutoPipelineService.createCompanyAnalysis` / `createInterviewPrep` |
| 저장 컬럼 | `company_analysis.interview_points` (`MEDIUMTEXT`) |
| 프런트 표시 | `CompanyAnalysisPanel`("면접 준비 포인트" 카드) |

핵심: **`interview_points`는 JSON이 아니라 `MEDIUMTEXT` 한 칸**이다(`schema.sql:280`). `verified_facts`/`ai_inferences`/`competitors`/`sources`가 JSON 컬럼인 것과 대조된다. 면접 포인트는 "구조 없이 사람이 읽을 줄글"로 설계됐기 때문이다.

:::details 왜 JSON이 아니라 MEDIUMTEXT인가
`verified_facts`처럼 `[{fact, source}]` 형태로 검증·재조립해야 하는 데이터는 JSON 컬럼으로 두고 키 스키마를 검수한다. 반면 면접 포인트는 "면접관 입장에서 이런 걸 물을 것"이라는 **서술형 가이드**라서, 행 단위로 쪼개 검증할 이득이 없다. 그래서 자유 텍스트로 저장하고 프런트는 `whitespace-pre-line`으로 줄바꿈만 살려 렌더한다.
:::

## 4. 동작 원리 (흐름·표·작은 코드)

### 4.1 LLM 경로 — 기업 분석과 한 호출

```text
공고문 + 회사명/직무명
      │  (외부 웹 조회 없음)
      ▼
CompanyAnalysisPromptCatalog.SYSTEM_PROMPT  ← 환각 차단 불변식
      ▼
BLocalLlmClient.chat  (Ollama /api/chat, temperature=0, format=JSON Schema 강제)
      ▼
{ companySummary, recentIssues, industry, competitors[],
  interviewPoints, sources[], verifiedFacts[], aiInferences[] }
      ▼
validateCompanyPayload  ← interviewPoints 비면 예외 → 규칙 폴백
      ▼
company_analysis.interview_points (MEDIUMTEXT) 에 저장
```

`interviewPoints`는 JSON Schema의 **required 목록에 들어 있다.** 즉 구조화 출력 강제(`format`) 단계에서 모델이 이 필드를 비우면 스키마 위반이 된다. 그리고 검증 단계가 한 번 더 막는다.

```java
// validateCompanyPayload — 면접 포인트가 비면 폴백을 유발한다
if (isBlank(payload.interviewPoints())) {
    throw new IllegalStateException(
        "Local LLM company analysis is missing interviewPoints.");
}
```

### 4.2 환각 차단 — 면접 포인트도 "근거 있는 입력"만

면접 포인트는 `verified_facts`처럼 별도 grounding 토큰 검증을 받지는 않지만, **같은 시스템 프롬프트의 안전 불변식 아래에서 생성**된다. 프롬프트(`CompanyAnalysisPromptCatalog.SYSTEM_PROMPT`)가 명문화한 규칙:

- 외부 웹 검색 금지
- 모델 내부 지식·기억을 검증된 사실로 쓰지 말 것
- 대표자·설립일·직원 수·매출·투자·최근 뉴스 등 입력에 없는 정보 금지
- `verifiedFacts`엔 회사명/직무명/공고문에서 직접 확인되는 사실만

따라서 면접 포인트도 "공고에 적힌 책임·필수 조건"을 근거로 묶이지, 모델이 아는 그 회사의 실제 면접 후기 같은 외부 정보로 채워지지 않는다. 이것이 #11이 단순 "면접 팁 생성기"와 다른 점이다.

### 4.3 규칙 폴백 — 면접 포인트도 결정론으로 채운다

LLM이 실패하거나 검증을 통과 못 하면 `self-rules-v1` 규칙엔진이 면접 포인트를 만든다. 외부 미조회를 명시하고, 공고 원문에서 화이트리스트로 뽑은 필수 스킬을 인용한다.

```java
// selfRulesCompanyAnalysis 내부 — 규칙 기반 면접 포인트
String interviewPoints =
    "Prepare to explain why this role matches your experience, "
  + "how you handle the listed responsibilities, "
  + "and which evidence supports the required skills: "
  + joinPreview(extractRequiredSkills(postingText)) + ".";
```

폴백은 "외부 미조사"를 `recentIssues`와 `aiInferences`에 명시하므로, 사용자가 "이건 LLM이 깊이 본 게 아니라 규칙으로 만든 것"임을 구분할 수 있다.

### 4.4 #11과 D(면접 질문)의 실제 연결 — 스킬 경유 간접

자동 파이프라인 한 트랜잭션 안에서 #11 저장과 D 질문 생성이 둘 다 일어나지만, **둘은 `interview_points`를 통해 연결되지 않는다.**

```text
ApplicationCaseAutoPipelineService.runAfterExtractionPass()
 ├─ createCompanyAnalysis(...)  → interview_points 저장 (#11)
 └─ createInterviewPrep(applicationCase, jobAnalysis)
        └─ interviewQuestions(case, requiredSkills, preferredSkills)  ← #11 미사용
```

`createInterviewPrep`는 `jobAnalysis`의 필수·우대 스킬만 받아 6문항을 만든다. 실제 템플릿:

| # | 질문 형태(요지) | questionType |
| --- | --- | --- |
| 1 | "왜 이 회사의 이 직무에 지원했나" | EXPECTED 계열 |
| 2 | "필수 스킬 1순위를 가장 잘 증명하는 프로젝트" | TECH |
| 3 | "필수 스킬 2순위(없으면 우대/협업) 관련 운영 이슈 대응" | TECH/SITUATION |
| 4 | "납기 속도 vs 유지보수성이 충돌하면 어떤 트레이드오프?" | SITUATION |
| 5 | "이 공고에서 본인의 가장 큰 갭과 보완 계획" | SITUATION |
| 6 | "면접관에게 팀 기대치 검증 위해 물을 질문" | EXPECTED |

즉 D 질문은 `requiredSkills.get(0)`, `requiredSkills.get(1)`(없으면 우대/협업)을 템플릿에 끼우는 방식이라, #11의 면접 포인트 텍스트와는 **공통 입력(스킬)을 공유할 뿐 직접 소비 관계가 아니다.**

## 5. 구현 상태 — 됨 vs 계획 (정직 구분)

| 항목 | 상태 | 근거 |
| --- | --- | --- |
| `interview_points` 생성(LLM, #10과 한 호출) | 구현 | `generateCompanyAnalysis`, company JSON Schema required |
| 누락 시 규칙 폴백 면접 포인트 | 구현 | `selfRulesCompanyAnalysis`, `validateCompanyPayload` |
| 환각 차단(외부조회 금지·입력 사실만) | 구현 | `CompanyAnalysisPromptCatalog.SYSTEM_PROMPT` |
| `MEDIUMTEXT` 저장 + 프런트 카드 표시 | 구현 | `schema.sql:280`, `CompanyAnalysisPanel` "면접 준비 포인트" |
| 사용자/관리자 검수(텍스트 수정) | 구현 | `reviewCompanyAnalysis`, `CompanyAnalysisPanel` edit 모드 |
| **#11 → D 면접 질문 직접 입력** | **부분/간접(미배선)** | `createInterviewPrep`는 `interview_points` 미소비, 스킬 기반 템플릿 6문항 |
| 외부 면접 후기/실시간 뉴스 반영 | 미구현(의도적) | 프롬프트 "외부 검색 금지" |

:::warning 가장 흔히 틀리는 부분
"#11은 D 면접 질문 생성의 입력이다"를 **현재 구현**처럼 말하면 틀린다. 정확히는 "설계 의도상 입력이지만, 현재 자동 파이프라인의 D 질문은 `interview_points`를 읽지 않고 필수·우대 스킬로 템플릿을 만든다." 이 갭을 짚으면 코드를 실제로 읽은 사람이라는 신호가 된다.
:::

## 6. 면접 답변 3단계

1. **무엇** — "면접 포인트(#11)는 공고와 기업 분석을 종합해 면접에서 검증될 기술·경험·협업 포인트를 정리하는 기능입니다. 데이터로는 `company_analysis.interview_points` 한 칸(`MEDIUMTEXT`)에 줄글로 저장됩니다."
2. **어떻게** — "별도 AI 호출이 아니라 기업 분석(#10)과 같은 LLM 호출의 출력 스키마에 `interviewPoints` 필드로 포함돼 한 번에 나옵니다. 외부 웹 조회 없이 입력(회사명/직무명/공고문)만 근거로 삼게 시스템 프롬프트가 강제하고, 비면 검증에서 걸러 규칙 폴백으로 채웁니다."
3. **연결의 정직함** — "설계상 이 포인트는 D 면접 질문 생성의 입력이지만, 현재 자동 파이프라인은 `interview_points`를 직접 쓰지 않고 공고 분석의 필수·우대 스킬로 6문항 템플릿을 만듭니다. 그래서 지금은 둘이 스킬을 공유하는 간접 연결이고, 면접 포인트는 사용자에게 보여줄 기업 분석 카드로 활용됩니다."

## 7. 꼬리질문 + 모범답안

:::details Q1. 면접 포인트가 기업 분석과 별도 AI 기능인가요?
아니요. 같은 `generateCompanyAnalysis` 호출의 출력 스키마 안에 `interviewPoints`로 들어 있습니다. #10(기업 요약)과 #11(면접 포인트)은 **한 번의 LLM 호출, 하나의 JSON 스키마**로 산출됩니다. 컨텍스트를 이미 읽은 한 호출에서 부산물로 뽑으면 비용·지연·일관성 면에서 유리하기 때문입니다.
:::

:::details Q2. 면접 포인트는 어떤 입력을 보고 만들어지나요?
회사명·직무명·공고문입니다. **외부 웹 조회는 하지 않습니다.** 시스템 프롬프트가 "외부 검색 금지, 모델 내부 지식을 검증된 사실로 쓰지 말 것, 입력에 없는 회사 정보 금지"를 명문화하므로, 면접 포인트도 공고에 적힌 책임·필수 조건을 근거로 묶입니다. 그 회사의 실제 면접 후기 같은 외부 정보는 들어가지 않습니다.
:::

:::details Q3. 그래서 D 면접 질문은 이 면접 포인트로 만드나요?
현재 구현은 아닙니다. `ApplicationCaseAutoPipelineService.createInterviewPrep`는 `interview_points`를 소비하지 않고, `jobAnalysis`의 필수·우대 스킬(`requiredSkills.get(0)`, `get(1)`)과 회사/직무명을 하드코딩 템플릿에 끼워 6문항을 만듭니다. 설계 의도는 #11이 D의 입력이지만, 실제로는 **스킬을 공유하는 간접 연결**입니다. 자유 텍스트를 파싱해 질문으로 쪼개는 것보다 구조화된 스킬 배열로 템플릿을 채우는 편이 결정론적이고 안 깨지기 때문으로 보입니다.
:::

:::details Q4. 면접 포인트가 비어 있으면 어떻게 되나요?
두 겹으로 막힙니다. 먼저 `interviewPoints`는 LLM 구조화 출력 JSON Schema의 required 필드라 모델이 비우면 스키마 위반입니다. 그다음 `validateCompanyPayload`가 `isBlank(payload.interviewPoints())`이면 예외를 던져 **규칙 폴백**(`selfRulesCompanyAnalysis`)을 트리거합니다. 폴백은 공고 원문에서 화이트리스트로 뽑은 필수 스킬을 인용해 "이 책임을 어떻게 다루는지, 어떤 근거가 필수 스킬을 뒷받침하는지 설명할 준비를 하라"는 결정론 텍스트를 채웁니다.
:::

:::details Q5. 면접 포인트는 왜 JSON이 아니라 MEDIUMTEXT인가요?
면접 포인트는 행 단위로 검증·재조립할 구조 데이터가 아니라 "면접관 입장에서 이런 걸 물을 것"이라는 서술형 가이드라서, 자유 텍스트가 적합합니다. 반대로 `verified_facts`/`ai_inferences`/`competitors`/`sources`는 `[{...}]` 형태로 검수·렌더해야 해서 JSON 컬럼으로 두고 키 스키마를 검증합니다. 프런트는 면접 포인트를 `whitespace-pre-line`으로 줄바꿈만 살려 렌더합니다.
:::

:::details Q6. 사용자가 면접 포인트를 직접 고칠 수 있나요?
네. `CompanyAnalysisPanel`의 edit 모드에 면접 준비 포인트 textarea가 있고, 저장하면 `reviewCompanyAnalysis`로 부분 갱신됩니다(null이면 기존값 유지). 관리자는 출처 메타데이터(`source_type`/`checked_at`/`refresh_recommended_at`)와 운영 메모를 다루지만, 본문 텍스트 생성 기능은 없고 검수 중심입니다.
:::

## 8. 직접 말해보기

다음을 막힘 없이 30초씩 설명할 수 있으면 이 주제를 이해한 것이다.

- "#11은 #10과 어떻게 한 호출로 묶이고, 출력 스키마의 어느 필드인가" (`interviewPoints`, company JSON Schema)
- "면접 포인트가 외부 정보로 오염되지 않게 막는 장치는?" (시스템 프롬프트 안전 불변식 + required 필드 + `validateCompanyPayload` + 규칙 폴백)
- "설계상 D의 입력인데 실제 코드에서는 왜 직접 안 쓰이나" (`createInterviewPrep`가 스킬 기반 템플릿 6문항 사용, `interview_points` 미소비)
- "면접 포인트를 JSON이 아니라 텍스트로 둔 이유" (서술형 가이드, 행 검증 불필요)

연관 주제: [기업 분석 (#10)](/area-b/company-analysis) · [공고 분석: 필수/우대 (#7/#8)](/area-b/required-preferred) · [공통 구조화 출력](/ai/openai-structured-output) · [영역 D는 적합도 결과를 어떻게 쓰나 — 영역 C](/area-c/fit-analysis)

## 퀴즈

<QuizBox question="면접 포인트(#11)는 백엔드에서 어떻게 생성되는가?" :choices="['기업 분석(#10)과 동일한 LLM 호출의 출력 스키마에 interviewPoints 필드로 함께 산출된다', '별도의 전용 AI 호출로 따로 생성된다', '영역 D의 면접 질문 생성기가 만들어 B로 역전달한다', '사용자가 항상 직접 입력해야만 채워진다']" :answer="0" explanation="generateCompanyAnalysis 한 호출의 JSON 스키마(companySummary, ..., interviewPoints, ...)에 포함되어 #10과 함께 나온다. 별도 AI 호출이 아니다." />

<QuizBox question="자동 파이프라인에서 D 면접 질문 생성(createInterviewPrep)은 company_analysis.interview_points를 어떻게 사용하는가?" :choices="['interview_points 텍스트를 파싱해 질문으로 직접 변환한다', '사용하지 않는다 — 공고 분석의 필수/우대 스킬로 하드코딩 템플릿 6문항을 만든다', 'interview_points와 스킬을 합쳐 LLM에 다시 넣는다', '면접 포인트가 비어 있을 때만 스킬을 본다']" :answer="1" explanation="createInterviewPrep는 jobAnalysis의 requiredSkills/preferredSkills와 회사·직무명만 받아 템플릿 6문항을 만든다. interview_points는 소비하지 않는 간접(스킬 공유) 연결이다." />

<QuizBox question="company_analysis.interview_points 컬럼이 JSON이 아니라 MEDIUMTEXT인 가장 적절한 이유는?" :choices="['MySQL이 JSON을 지원하지 않아서', '면접 포인트는 행 단위 검증이 필요 없는 서술형 가이드라서', '용량이 verified_facts보다 항상 커서', 'LLM이 JSON을 만들지 못해서']" :answer="1" explanation="verified_facts/ai_inferences 등은 [{...}] 구조라 JSON 컬럼+키 검증이지만, 면접 포인트는 사람이 읽는 줄글 가이드라 자유 텍스트(MEDIUMTEXT)로 둔다." />
