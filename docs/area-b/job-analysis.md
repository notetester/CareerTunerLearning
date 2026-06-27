# 공고문 AI 분석 [#6]

> 공고 원문을 한 덩어리로 "요약 생성"하지 않는다. 문장을 라벨링한 뒤 LLM이 `JSON Schema`에 맞춰 채워 넣고, 코드가 환각·오분류를 후처리로 깎아내 사용자 확정까지 잇는 **구조화 추출** 파이프라인이다.

## 1. 한 줄 정의와 이 페이지가 답하는 면접 질문

공고문 AI 분석(#6)은 **추출된 공고 텍스트 한 건**을 입력받아 `고용형태 / 경력수준 / 필수역량 / 우대역량 / 담당업무 / 자격요건 / 난이도 / 요약 / 근거 / 모호조건`이라는 **고정 스키마**로 구조화하는 영역 B의 첫 AI 기능이다. 이 한 번의 분석에서 #7(필수)·#8(우대)·#9(담당업무)가 같이 산출되므로, "공고 → 직무·요구역량·업무범위" 구조화의 본체다.

이 페이지가 답하는 면접 질문:

- "공고를 통째로 LLM에 넣어 요약하면 되는데, 왜 굳이 스키마로 쪼갰나?"
- "소형 파인튜닝 모델을 쓰면 품질이 흔들릴 텐데 어떻게 신뢰성을 확보했나?"
- "LLM이 공고에 없는 스킬을 지어내면 어떻게 막나?"
- "분석 결과를 사용자가 고칠 수 있나? 공고가 바뀌면 옛 분석은 어떻게 되나?"

:::tip 핵심 클래스 한 장 요약
`BAnalysisGenerationService.generateJobAnalysis()`가 엔진이고, 전처리는 `BJobSentenceClassifier`, LLM 호출은 `BLocalLlmClient`, 프롬프트·스키마는 `JobAnalysisPromptCatalog`, 트랜잭션·상태 전이는 `JobAnalysisService.createJobAnalysis()`가 맡는다.
:::

## 2. 왜 이렇게 설계했나 (의도·트레이드오프)

영역 B의 자체 AI 철학은 **"공고문 전체를 한 번에 생성형으로 대체하지 않는다"**이다. 공고 텍스트를 문장 단위로 쪼개 필수/우대/담당업무/기술스택으로 분류하는 **구조화 추출**이 본질이고, OCR은 입력 텍스트를 확보하는 앞단계일 뿐이다.

이 철학이 만드는 설계 결정:

| 결정 | 이유 | 트레이드오프 |
| --- | --- | --- |
| 자유 텍스트 요약이 아니라 **고정 JSON 스키마** | C(적합도)·D(면접)가 `required_skills`/`duties`를 기계적으로 소비해야 함. 구조가 흔들리면 하위 영역이 깨짐 | 스키마를 넘는 미묘한 뉘앙스는 못 담음 |
| **문장 분류 전처리** 후 LLM 호출 | 모델에 "이 줄은 우대, 저 줄은 담당업무"라는 신호를 미리 줘 분류 품질을 끌어올림 | 분류기(규칙)의 한계가 곧 신호의 한계 |
| 소형 **파인튜닝 R1 모델** + 규칙 폴백 | 비용·데이터 주권·오프라인성. 자체 LLM 단계는 무과금(credit=0) | 작은 모델은 오분류가 잦음 → 코드 후처리 필수 |
| **근거(evidence)·모호조건 동반 출력** | "어느 원문 구절에서 뽑았는지"를 못 박아 환각을 사용자가 검증 가능 | 출력 토큰·검증 로직이 늘어남 |

핵심은 마지막 줄이다. 작은 모델을 비용 때문에 선택했으므로, **모델이 틀리는 것을 전제로 코드가 교정**한다. 이 후처리 계층이 영역 B 설계의 백미다(아래 §4).

:::warning 설계서 vs 현재 런타임
과거 클래스 설계서는 "OpenAI 직결(`gpt-5`)"을 기준으로 쓰여 있고, `jobanalysis/ai/` 패키지(`OpenAiJobAnalysisService`, `OssJobAnalysisClient`, `JobAnalysisAiProvider` 등)가 그 흔적이다. 그러나 현재 런타임의 활성 경로는 **`BAnalysisGenerationService → BLocalLlmClient`(Ollama) 단일 경로**이고, `jobanalysis/ai/`는 외부에서 주입·호출되지 않는 **미배선(죽은) 코드**다. 면접에서 "두 코드가 공존하는 이유"를 물으면 "설계가 OpenAI 직결에서 자체 LLM으로 이전했고 추상화 잔재가 남았다"고 정직하게 답하면 된다.
:::

## 3. 어떤 기술로 구현했나 (실제 클래스·테이블 근거)

흐름을 따라가며 각 단계의 실제 코드를 본다.

| 단계 | 담당 클래스/메서드 | 역할 |
| --- | --- | --- |
| 진입(동기 단건) | `JobAnalysisService.createJobAnalysis()` | 소유 검증·상태 전이·트랜잭션 경계 |
| 진입(비동기 자동) | `ApplicationCaseAutoPipelineService.runAfterExtractionPass()` | 추출 PASS 후 B+C+D 일괄 생성 |
| 엔진 | `BAnalysisGenerationService.generateJobAnalysis()` | LLM+규칙 하이브리드, 후처리, grounding |
| 전처리 | `BJobSentenceClassifier.classify()` | 문장을 11라벨로 분류 |
| LLM 호출 | `BLocalLlmClient.chat()` | Ollama `/api/chat`, JSON Schema 강제 |
| 프롬프트/스키마 | `JobAnalysisPromptCatalog`, `jobAnalysisSchema()` | 시스템 프롬프트(`b-v1`)·출력 계약 |
| 저장 | `JobAnalysisMapper.insertJobAnalysis()` | `job_analysis` 테이블 적재 |
| 사용자 확정/수정 | `JobAnalysisService.reviewJobAnalysis()` | 부분 필드 갱신·`confirmed_at` 기록 |

두 진입 경로(동기 단건 재생성 `POST /job-analysis`, 비동기 자동 파이프라인)는 **모두 같은 엔진** `generateJobAnalysis()`로 수렴한다. 차이는 트랜잭션 오케스트레이션뿐이다.

**저장 테이블 `job_analysis`의 형태**(schema.sql):

```sql
required_skills      JSON NULL,   -- #7
preferred_skills     JSON NULL,   -- #8
duties               MEDIUMTEXT,  -- #9
qualifications       MEDIUMTEXT,
difficulty           VARCHAR(20), -- EASY/NORMAL/HARD
summary              MEDIUMTEXT,
evidence             JSON NULL,   -- {field, quote}[]
ambiguous_conditions JSON NULL,   -- {condition, assumption}[]
job_posting_id       BIGINT,      -- ON DELETE SET NULL (원문 삭제돼도 분석 보존)
job_posting_revision INT,         -- 분석 시점 원문을 "동결"
confirmed_at         DATETIME     -- 사용자 확정 시각
```

`required_skills`/`preferred_skills`/`evidence`/`ambiguous_conditions`를 정규화 테이블이 아니라 **JSON 컬럼**으로 둔 이유: 길이·구조가 가변인 "근거 인용 배열"이라 행으로 쪼개는 비용이 크고, 검수 시 키 스키마만 검증하면 충분하기 때문이다.

## 4. 동작 원리 (흐름·표·작은 코드)

### 4.1 전체 흐름

```text
공고 텍스트(추출·품질게이트 통과본)
   │
   ▼  BJobSentenceClassifier.classify()       ── 줄/문장을 11라벨로(REQUIRED/PREFERRED/RESPONSIBILITY/TECH_STACK …)
분류 신호(JSON, 4000자 절단) + 원문(12000자 절단)
   │
   ▼  BLocalLlmClient.chat()                   ── Ollama /api/chat, format=JSON Schema, temperature=0
LLM JSON 응답
   │
   ▼  parseLocalJobPayload()                   ── ★ 후처리: reconcileExperienceLevel / filterSkillItems
   ▼  validateGrounding()                      ── ★ 환각 검증: 스킬이 원문에 실제 등장하는가
   │   └─(검증 실패/예외)→ selfRulesJobAnalysis()  결정론 규칙엔진 폴백
   ▼
JobAnalysisService: TransactionTemplate으로 insert + 상태 READY + usage 로그
```

LLM 호출의 실제 파라미터(`BLocalLlmClient.chat`): `stream=false`, `think=false`, `temperature=0`, `num_ctx=8192`, read-timeout 480초, 기본 모델 `careertuner-b-jobposting-r1`. **출력 형식은 프롬프트로 부탁하는 게 아니라 `format` 필드에 JSON Schema를 직접 넣어 Ollama가 강제**한다. 스키마는 `experienceLevel`을 `JUNIOR/MID/SENIOR`, `difficulty`를 `EASY/NORMAL/HARD` enum으로 못 박는다.

엔진은 `maxRetries=1`이라 LLM을 최대 2회 시도하고, 둘 다 실패하면 규칙 폴백으로 내려간다.

### 4.2 소형 모델 결함 후처리 (이 기능의 핵심)

R1 모델은 작아서 알려진 오류 패턴이 있고, 이를 **결정론 코드로 교정**한다. `BAnalysisGenerationService`의 실제 메서드들:

**(a) 경력 수준 보정 — `reconcileExperienceLevel`**

R1이 "경력 5년 이상"을 JUNIOR로 오분류하는 사례가 있어, 공고 원문에서 연차를 정규식으로 파싱해 보정한다.

```java
Integer years = maxStatedYears(postingText);
if (years >= 5) return "SENIOR";          // 5년↑은 시니어
if (years >= 1 && "JUNIOR".equals(v)) return "MID";  // 연차 있는데 주니어면 미들로
```

`EXPERIENCE_YEARS_PATTERN`은 단순히 "N년"을 잡지 않는다. **연차 숫자가 경력 키워드(경력/경험/실무, experience/exp)와 결합된 경우만** 인정해서, "설립 10년차"(연혁)·"2024년"(날짜)·"5년 연속 성장"(기간) 같은 오탐을 구조적으로 배제한다. `NOT_IRRELEVANT` lookahead는 "경력 무관/상관없이" 같은 **부정어를 연차로 오인하지 않게** 막고, 1~30년 범위(`MAX_REALISTIC_YEARS`)만 통과시킨다.

**(b) 업무 문장 제거 — `filterSkillItems` / `looksLikeSkill`**

R1이 `requiredSkills`에 "결제 시스템 백엔드 API 설계 및 개발" 같은 **업무 문장**을 스킬로 섞는다. 길이 30자 초과·단어 4개 초과·`및/또는/담당` 패턴이면 스킬로 보지 않는다.

```java
private boolean looksLikeSkill(String value) {
  if (v.length() > 30) return false;            // 너무 길면 문장
  if (v.split("\\s+").length > 4) return false; // 단어 4개 초과면 문장
  return !SKILL_SENTENCE_PATTERN.matcher(v).find(); // 및/또는/담당 …
}
```

전부 걸러져 빈 배열이 되면 규칙 추출(`KNOWN_SKILLS` 화이트리스트)로 폴백해 **빈 결과를 막는다**.

**(c) 환각 검증 — `validateGrounding` (★)**

추출된 스킬이 **실제 공고 원문에 토큰으로 등장하는지** 검사한다. grounded 비율이 임계값(`groundingThreshold`, 기본 0.6) 미만이면 예외를 던져 폴백시킨다. "근거 기반"이라는 말의 실제 코드 구현이다.

```java
double ratio = (double) grounded / allSkills.size();
if (ratio < threshold) throw new IllegalStateException("Grounding check failed: ...");
```

`validateJobPayload`도 한 겹 더 댄다 — `requiredSkills`가 비거나, `summary`가 20자 미만이거나, `duties`/`qualifications`가 누락이면 폴백을 유발한다.

### 4.3 규칙 폴백 — `selfRulesJobAnalysis`

LLM 없이 결정론으로 같은 스키마를 채운다. 스킬은 `KNOWN_SKILLS`(46종 화이트리스트) 부분문자열 매칭, 담당업무는 분류기의 `RESPONSIBILITY` 라벨 문장 join, `difficulty`는 SENIOR이거나 스킬 8개 이상이면 HARD. 근거(`evidence`)는 스킬별 원문 인용으로 만든다. 즉 **LLM이 죽어도 사용자에게는 같은 모양의 결과**가 나간다(가용성 우선).

### 4.4 트랜잭션·상태 전이 — `JobAnalysisService.createJobAnalysis`

가장 중요한 패턴: **"AI는 트랜잭션 밖, payload 수령 후에만 DB 쓰기."** 최대 수 분 걸리는 LLM 호출이 DB 커넥션을 잡지 않도록, 응답을 받은 뒤에만 `TransactionTemplate`으로 INSERT+상태 전이+로그를 묶는다.

```java
ensureAnalysisRunnable(status);              // DRAFT/READY만 허용, ANALYZING이면 CONFLICT
JobPosting posting = accessService.latestPostingRequired(caseId); // 공고 없으면 거부
statusService.markAnalyzing(...);            // REQUIRES_NEW 트랜잭션으로 상태 선점
GeneratedJobAnalysis g = bAnalysis.generateJobAnalysis(case, text); // ← AI는 여기서, 트랜잭션 밖
transactionTemplate.execute(s -> {
  jobAnalysisMapper.insertJobAnalysis(... posting.getRevision() ...); // revision 동결
  statusService.markReadyAfterAnalysis(...);
  if (g.fellBack()) aiUsageLogService.recordFailure(...);  // 폴백도 FAILED로 기록
  aiUsageLogService.recordLocalSuccess(... credit=0 ...);  // 자체 LLM은 무과금
});
```

실패 시 `restorePreviousStatus`로 이전 상태를 되돌리고, `userFacingFailureMessage`가 SQL·스택트레이스·프레임워크 클래스명(`com.mysql`/`org.springframework`)을 사용자 노출에서 마스킹한다.

### 4.5 사용자 확정·수정 — `reviewJobAnalysis`

사용자는 분석 결과를 **부분 수정·확정**할 수 있다. `request`의 각 필드가 null이면 기존값을 유지(`defaultString`)하고, JSON 필드(`evidence`/`ambiguousConditions`)는 `BAnalysisJsonValidator`로 키 스키마를 검증한 뒤에만 덮어쓴다. `confirmed=true`면 `confirmed_at`에 현재 시각을 기록해 "사용자가 검토를 끝냈다"는 신호를 남긴다.

## 5. 구현 상태 (됨 vs 계획) 정직 구분

| 항목 | 상태 | 근거 |
| --- | --- | --- |
| 로컬 LLM(Ollama R1) 공고 분석 | **구현·기본 ON** | `application.yaml` `B_ANALYSIS_LOCAL_LLM_ENABLED:true`, `BLocalLlmClient` |
| `self-rules-v1` 규칙 폴백 | **구현** | `selfRulesJobAnalysis` |
| 연차/스킬/grounding 후처리 | **구현** | `reconcileExperienceLevel`·`filterSkillItems`·`validateGrounding` |
| JSON Schema 강제 출력 | **구현** | `BLocalLlmClient`의 `format` 필드 |
| revision 동결·원문 보존 | **구현** | insert 시 `posting.getRevision()`, FK `ON DELETE SET NULL` |
| 사용자 확정/부분 수정 | **구현** | `reviewJobAnalysis`, `confirmed_at` |
| `jobanalysis/ai`(OpenAI/OSS provider 추상화) | **죽은 코드(미배선)** | 외부 참조 0, 활성 경로는 `BLocalLlmClient` 단일 |
| KLUE-RoBERTa 문장 분류 모델 | **계획** | 현재 런타임은 규칙·키워드 기반 `BJobSentenceClassifier` |
| 프롬프트 버전 | **런타임 `b-v1`** | `JobAnalysisPromptCatalog.VERSION="b-v1"` (스토리보드의 `b-v3.2`는 mock 데모 값, 인용 금지) |

:::warning 인용 주의값
프롬프트 버전은 코드의 `b-v1`이 정답이다. 스토리보드/데모 캡처의 수치(예: `b-v3.2`)는 `VITE_USE_MOCK` 빌드의 mock 값이라 실제 런타임과 다르다. `local-llm.enabled`도 Java 기본값은 false지만 yaml이 true로 오버라이드하므로 **"실행 기본 ON"**이 맞다.
:::

## 6. 면접 답변 3단계

1. **무엇** — "공고문 AI 분석은 추출된 공고 텍스트를 고정 JSON 스키마(고용형태·경력·필수/우대 역량·담당업무·자격·난이도·요약·근거·모호조건)로 구조화하는 영역 B의 첫 AI 기능입니다. 한 번의 분석에서 필수(#7)·우대(#8)·담당업무(#9)가 함께 나옵니다."
2. **왜·어떻게** — "전체를 요약 생성하지 않고 구조화 추출을 택한 건, 적합도·면접 영역이 필수역량·업무 목록을 기계적으로 소비해야 하기 때문입니다. 문장 분류로 신호를 만든 뒤 자체 호스팅 Ollama R1 모델에 JSON Schema를 강제해 호출하고, 작은 모델이 틀리는 경력 오분류·업무 문장 혼입을 코드로 후처리합니다."
3. **신뢰성** — "환각이 취업 의사결정을 왜곡하지 않도록, 추출 스킬이 원문에 실제 등장하는지 grounding으로 검증하고, 통과 못 하면 결정론 규칙엔진으로 폴백합니다. LLM 호출은 트랜잭션 밖에서 끝낸 뒤 DB 쓰기를 묶어 커넥션 고갈도 막습니다."

## 7. 꼬리질문 + 모범답안

::: details Q1. 공고를 통째로 LLM에 넣어 요약하면 간단한데, 왜 스키마로 쪼갰나?
하위 영역의 입력 계약 때문입니다. C(적합도)는 `required_skills`/`preferred_skills`를 판정 기준으로, D·E는 업무·요약을 맥락으로 소비합니다. 자유 텍스트 요약은 파싱이 불안정해 하위가 깨집니다. 그래서 `experienceLevel`·`difficulty`를 enum으로 못 박은 JSON Schema를 출력 계약으로 삼고, Ollama `format`으로 강제했습니다. 대가로 스키마 밖의 미묘한 정보는 못 담지만, 그건 `summary`·`evidence`로 보완합니다.
:::

::: details Q2. 작은 R1 모델을 쓰면 품질이 흔들릴 텐데 어떻게 신뢰성을 확보했나?
"모델이 틀리는 걸 전제"로 코드 후처리 계층을 뒀습니다. 세 가지가 핵심입니다. (1) `reconcileExperienceLevel`이 원문 연차를 정규식으로 파싱해 경력 오분류를 보정하고, (2) `filterSkillItems`가 스킬 자리에 섞인 업무 문장을 길이·단어수·패턴으로 걸러내며, (3) `validateGrounding`이 추출 스킬이 원문에 실제 등장하는지 비율로 검사합니다. 어느 단계든 검증 실패면 `self-rules-v1` 규칙엔진으로 폴백해 항상 같은 스키마를 보장합니다.
:::

::: details Q3. LLM이 공고에 없는 스킬을 지어내면?
`validateGrounding`이 막습니다. 추출된 모든 스킬을 토큰으로 쪼개 정규화된 원문에 등장하는지 세고, grounded 비율이 임계값(기본 0.6) 미만이면 예외를 던져 폴백합니다. 2토큰 이하 짧은 스킬은 1개만 맞아도 인정하고, 긴 스킬은 절반 이상 토큰이 매칭돼야 인정하는 식으로 정밀도와 재현율을 절충했습니다. 환각이 "검증된 사실"처럼 사용자에게 보이는 걸 데이터가 아닌 코드 레벨에서 차단하는 것이 핵심입니다.
:::

::: details Q4. 분석 중에 LLM이 5분씩 걸리면 DB는 어떻게 보호하나?
"AI는 트랜잭션 밖" 원칙입니다. `markAnalyzing`으로 상태를 `REQUIRES_NEW` 트랜잭션에서 먼저 선점(ANALYZING)하고, 느린 LLM 호출은 어떤 트랜잭션에도 들지 않은 채 실행합니다. payload를 받은 뒤에야 `TransactionTemplate`으로 INSERT·상태 전이(READY)·usage 로그를 짧은 트랜잭션 하나에 묶습니다. 실패하면 `restorePreviousStatus`로 상태를 되돌립니다. 덕분에 커넥션 풀이 LLM 대기 시간만큼 점유되지 않습니다.
:::

::: details Q5. 공고가 바뀌면 옛 분석은 어떻게 되나? (stale 추적)
분석을 만들 때 그 시점의 `job_posting_revision`을 함께 저장해 **원문 버전을 동결**합니다. 공고는 append-only revision이라 새 공고가 등록되면 revision이 올라가고, 프런트(`JobAnalysisPanel`)는 `analysis.jobPostingRevision !== latestJobPostingRevision`이면 "이전 공고 rev 기준" 배지와 재분석 배너를 띄웁니다. 원문이 삭제돼도 FK가 `ON DELETE SET NULL`이라 분석 자체는 보존됩니다. 재현성과 stale 판정을 동시에 만족시키는 설계입니다.
:::

::: details Q6. 폴백이 발생하면 로그·과금은 어떻게 처리되나?
자체 LLM 단계는 무과금이라 성공 시 `recordLocalSuccess`로 credit=0을 기록합니다. 폴백이 일어나면 "시도한 LLM 모델 + 폴백 사유"를 `recordFailure`로 FAILED 로그에 남기고(메인 트랜잭션이 롤백돼도 `REQUIRES_NEW`로 잔존), 동시에 규칙엔진 성공도 기록합니다. 사용자는 `GET /{id}/ai-usage/b/failures`로 "이후 같은 기능의 성공이 없는 실패만" 필터해 볼 수 있어, 일시적 폴백이 영구 실패처럼 보이지 않습니다.
:::

## 8. 직접 말해보기

아래를 소리 내어 1분 안에 설명할 수 있으면 이 페이지를 이해한 것이다.

1. `generateJobAnalysis`가 입력을 받아 결과를 내기까지의 5단계를, 클래스 이름과 함께 순서대로.
2. 소형 모델 결함 후처리 3종(`reconcileExperienceLevel`·`filterSkillItems`·`validateGrounding`)이 각각 어떤 오류를 잡는지.
3. "AI는 트랜잭션 밖" 원칙이 해결하는 문제와, 실패 시 상태 롤백 흐름.
4. `job_posting_revision`을 동결하는 이유와, 공고 변경 시 프런트가 보이는 stale 신호.

관련 페이지: [지원 건 생애주기](/area-b/application-lifecycle) · [필수·우대 조건](/area-b/required-preferred) · [기업 분석](/area-b/company-analysis) · [구조화 출력](/area-b/structured-output) · [영역 B 개요](/area-b/)

## 퀴즈

<QuizBox question="공고문 AI 분석(#6)이 공고를 '통째로 요약 생성'하지 않고 고정 JSON 스키마로 구조화하는 가장 직접적인 이유는?" :choices="['LLM 토큰 비용을 줄이려고', 'C(적합도)·D(면접) 등 하위 영역이 required_skills·duties를 기계적으로 소비해야 하므로', 'OpenAI API 제약 때문에', '한국어 출력 품질이 더 좋아서']" :answer="1" explanation="구조화 추출은 영역 B의 철학이자 출력 계약입니다. 적합도·면접 영역이 필수역량·업무 목록을 파싱해 쓰므로 구조가 흔들리면 하위가 깨집니다." />

<QuizBox question="validateGrounding이 하는 일은?" :choices="['LLM 응답이 valid JSON인지 검사', '추출된 스킬이 실제 공고 원문에 토큰으로 등장하는지 비율로 검증해 환각을 차단', '경력 연차를 정규식으로 파싱', '사용자 확정 여부를 기록']" :answer="1" explanation="grounded 비율이 임계값(기본 0.6) 미만이면 예외를 던져 self-rules 폴백으로 보냅니다. 환각을 코드 레벨에서 막는 핵심 장치입니다." />

<QuizBox question="'AI는 트랜잭션 밖' 원칙이 해결하려는 문제는?" :choices="['LLM 응답의 환각', '느린 LLM 호출이 DB 커넥션을 점유해 커넥션 풀이 고갈되는 문제', '소형 모델의 경력 오분류', '공고 revision의 stale 판정']" :answer="1" explanation="최대 수 분 걸리는 LLM 호출을 트랜잭션 밖에서 끝내고, payload 수령 후에만 짧은 트랜잭션으로 INSERT·상태전이·로그를 묶어 커넥션 점유 시간을 최소화합니다." />
