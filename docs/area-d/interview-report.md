# 면접 리포트 AI 생성 [#23]

> 한 세션의 질문·답변·개별 점수를 한 번 더 LLM에 통째로 넣어 **총점 + 항목별 점수 + 종합 피드백**을 만들고, 그 결과가 곧 세션을 닫는다. 생성된 리포트는 캐시되고, 이전 세션 점수와 비교되며, C 영역의 장기 경향 분석 입력이 된다.

## 1. 한 줄 정의 · 이 페이지가 답하는 면접 질문

면접 리포트(#23)는 **세션 전체를 다시 한 번 평가**하는 기능이다. 개별 답변 평가(#22)가 "질문 1개 × 답변 1개"를 채점한다면, 리포트는 "세션의 모든 Q&A"를 하나의 트랜스크립트로 묶어 LLM에 넣고 면접 전반에 대한 **총점·항목별 점수·핵심 피드백**을 받아 화면과 DB에 고정한다.

면접에서 자주 받는 질문은 이렇다.

- "면접 끝나고 나오는 리포트는 어떻게 만들어요? 답변 점수를 그냥 평균 낸 거예요?"
- "리포트 생성이랑 세션 종료는 어떻게 연결돼요? 따로 종료 버튼이 있나요?"
- "이전 면접 대비 몇 점 올랐다는 건 어디서 계산해요?"
- "이 면접 점수가 다른 영역(장기 경향 분석)에서도 쓰인다던데, 경계는 어떻게 잡았어요?"

핵심 엔트리는 `InterviewController.getReport` → `GET /api/interview/sessions/{sessionId}/report`, 서비스는 `InterviewServiceImpl.getReport`(`service/InterviewServiceImpl.java:385-430`)이다.

## 2. 왜 이렇게 설계했나 (의도 · 트레이드오프)

### 2.1 왜 개별 점수 평균이 아니라 리포트를 다시 생성하나

답변별 점수(`interview_answer.score`)를 단순 평균하면 "이 사람이 면접 전반에서 어떤 강점·약점을 보였는가"가 사라진다. 평균 72점이라는 숫자만으로는 *왜 72점인지*, *무엇을 다음에 연습해야 하는지*를 말할 수 없다. 그래서 리포트는 개별 점수를 **입력 신호 중 하나로만** 쓰고(트랜스크립트에 `(개별 점수: N)` 형태로 포함), LLM이 세션 전체 맥락을 보고 **항목별로 다시 채점 + 종합 코멘트**를 생성한다.

### 2.2 캐시 우선 — 리포트는 한 번만 만든다

리포트 생성은 비싼 LLM 호출이다. 같은 세션 리포트를 화면을 다시 열 때마다 재생성하면 비용·지연·점수 흔들림(같은 입력에도 LLM 출력이 미세하게 다름)이 모두 나빠진다. 그래서 `interview_session.report`(JSON)에 한 번 쓰고, 이후 조회는 **재생성 없이 파싱만** 한다(`:391-396`). 트레이드오프: 답변을 추가로 수정해도 리포트는 갱신되지 않는다 — 리포트는 "그 시점의 면접 스냅샷"이라는 정의를 택했다.

### 2.3 세션 종료 = 리포트 생성

별도의 "면접 종료" API를 두지 않았다. `getReport`가 마지막에 `updateSessionResult(..., LocalDateTime.now())`로 `ended_at`을 세팅하면서 세션을 닫는다(`:428`). 사용자 입장에서 "리포트 보기"가 곧 "면접 끝내기"가 되어 UX가 단순해진다. 대신 "리포트를 한 번도 안 본 세션은 영원히 안 끝난 세션"이라는 의미가 된다.

### 2.4 모델 티어 선택 — 채점 모델이 아니라 생성 모델

리포트는 답변 채점(#22)이 아니라 **생성 task**로 분류된다. `generateReport`는 `modelProperties.getGeneration()`(기본 `gpt-5.4-mini`)을 쓴다(`InterviewOpenAiClient.java:263`). "공정성이 핵심인 단건 채점"은 한 단계 위 모델(`gpt-5.4`)을 쓰지만, 리포트는 이미 채점된 신호를 종합·요약하는 성격이라 빠르고 저렴한 생성 모델로 충분하다고 본 선택이다.

## 3. 어떤 기술로 구현했나 (실제 클래스 · 테이블 근거)

| 레이어 | 구현체 | 역할 |
| --- | --- | --- |
| Controller | `InterviewController.getReport` (`controller:130-134`) | `GET /sessions/{id}/report` 엔트리 |
| Service | `InterviewServiceImpl.getReport` (`:385-430`) | 캐시 확인 → 트랜스크립트 빌드 → 생성 → 저장 |
| 트랜스크립트 | `buildTranscript` (`:570-591`) | 질문·답변·개별점수를 `Q/A/(점수)` 텍스트로 조립 |
| LLM 호출 | `InterviewOpenAiClient.generateReport` (`:259-286`) | 게이트웨이로 `interview_report` 스키마 호출 |
| 프롬프트 | `REPORT_SYSTEM_PROMPT` (`InterviewPromptCatalog.java:102-108`) | 종합 평가 지시문, 버전 `d-v1` |
| 스키마 | `reportSchema()` (`:427-436`) | `totalScore/categories/summaryFeedback` 구조화 출력 |
| 응답 DTO | `InterviewReportResponse` | 프런트 계약(아래 4.3) |
| 게이트웨이 | `FallbackInterviewLlmGateway` | 자체모델→Claude(Haiku)→OpenAI 폴백 |
| 저장 | `interview_session.total_score / report / ended_at` (`schema.sql:491-506`) | 점수·JSON 원문·종료 시각 |
| 이전 점수 | `findLatestScoredSessionScore` (`InterviewMapper.xml:80-88`) | 같은 지원 건의 직전 채점 세션 점수 |

리포트 생성도 다른 LLM 호출과 동일하게 **성공 시 `ai_usage_log`에 `INTERVIEW_REPORT_GEN` 기록**(`:413`), 실패 시 `recordFailure`(`:410`)로 남긴다. 영속성은 프로젝트 규칙대로 MyBatis만 사용한다(JPA 금지).

## 4. 동작 원리 (흐름 · 표 · 작은 코드)

### 4.1 전체 흐름

```text
getReport(userId, sessionId)
  │
  ├─ requireSession          소유 검증
  ├─ report 컬럼 있음? ──── YES ─▶ readReport(JSON) → 그대로 반환  (재생성 X · 세션 안 닫음)
  │        │ NO
  ├─ findAnswersBySessionId  답변 0건이면 INVALID_INPUT (거부)
  ├─ buildTranscript         "Q1/A1/(개별 점수)" 텍스트 조립
  ├─ aiClient.generateReport → 게이트웨이 → LLM → {totalScore, categories, summaryFeedback}
  ├─ findLatestScoredSessionScore  같은 지원 건의 직전 점수(previousScore)
  ├─ updateSessionResult     total_score + report(JSON) + ended_at = now()  ← 세션 종료
  └─ return InterviewReportResponse
```

### 4.2 LLM에 들어가는 입력 (트랜스크립트)

`buildTranscript`는 질문 순서대로 돌면서 **답변이 있는 질문만** 골라 다음 형태로 조립한다(`:570-591`).

```text
아래는 모의면접 질문과 지원자 답변입니다.

Q1. (질문 텍스트)
A1. (답변 텍스트)
(개별 점수: 78)

Q2. ...
```

여기서 중요한 점: **개별 답변 점수가 이미 매겨져 있으면 트랜스크립트에 함께 넣는다**(`:584-586`). 즉 리포트 LLM은 "백지에서 다시 채점"하는 게 아니라 "이미 채점된 결과를 참고해 종합 평가"한다. 답변이 없는 질문은 건너뛰므로, 일부만 답한 세션도 답한 부분만으로 리포트가 만들어진다.

### 4.3 LLM 출력 구조 (`reportSchema` · `REPORT_SYSTEM_PROMPT`)

프롬프트는 세 필드를 요구한다.

| 필드 | 의미 | 예시 어휘 |
| --- | --- | --- |
| `totalScore` | 0~100 종합 점수 | `74` |
| `categories[]` | 평가 항목별 점수 `{label, score}` | 답변 내용 / 직무 적합성 / 구체성 / 논리성 / 표현력 / 자신감 / 태도 / 시간 관리 |
| `summaryFeedback[]` | 핵심 피드백 3개 내외 한국어 문장 | "직무 적합성은 높지만 구체적 사례가 부족합니다." |

스키마(`reportSchema()`)는 세 필드를 모두 `required`로 지정하고, `objectSchema`가 `additionalProperties:false`를 강제한다(`:427-465`). 점수는 항상 `clampScore`로 0~100 범위로 클램프된다(`:272,285`) — LLM이 105점이나 음수를 뱉어도 화면이 깨지지 않게 하는 안전 불변식이다.

여기서 "강점/약점/다음 연습 과제"는 **별도 필드가 아니라 `summaryFeedback` 문장 안에 녹여서** 표현된다. 프롬프트가 항목 점수의 높낮이(강점=높은 categories, 약점=낮은 categories)와 보완 방향을 종합 코멘트로 쓰게 만드는 구조다.

### 4.4 응답 조립과 저장

```java
// InterviewServiceImpl.getReport (요지)
Integer previousScore =
    interviewMapper.findLatestScoredSessionScore(caseId, sessionId); // 직전 세션 점수
InterviewReportResponse response = new InterviewReportResponse(
    payload.totalScore(), previousScore, answers.size(),
    durationLabel(session.getStartedAt()), categories, payload.summaryFeedback());
interviewMapper.updateSessionResult(
    sessionId, payload.totalScore(), writeReport(response), LocalDateTime.now());
```

- `previousScore`: **같은 application_case**의 다른 세션 중 `total_score`가 있는 가장 최근 세션 점수(`InterviewMapper.xml:80-88`, `id DESC LIMIT 1`, 현재 세션 제외). 지원 건 단위 성장 추적의 근거.
- `questionCount`: 답변 개수(`answers.size()`).
- `durationLabel`: `started_at`부터 지금까지 분 단위(`durationLabel`, `:593-599`).
- `writeReport`: `InterviewReportResponse`를 `ObjectMapper`로 직렬화해 JSON 원문 문자열로 `report` 컬럼에 저장(`:601-607`). 다음 조회 때 `readReport`로 역직렬화(`:609-615`).

`report` 컬럼에는 `previousScore`까지 포함한 응답 전체가 저장된다. 즉 캐시 히트 시 그 시점의 "이전 대비"까지 그대로 복원된다.

### 4.5 프런트 표시 (`InterviewReportTab`)

`InterviewReportTab.tsx`는 리포트와 미디어 분석을 **독립·병렬**로 로드해 한쪽이 실패해도 다른 쪽을 보여준다.

```ts
const [rep, med] = await Promise.all([
  getInterviewReport(session.id).catch(() => null),
  listMediaResults(session.id).catch(() => [] as MediaAnalysis[]),
]);
```

- 총점 카드에 `previousScore`가 있으면 `총점 − 이전점수` 증감 배지를 표시(`총점 (이전 +6점)`).
- `categories`는 항목별 `Progress` 바, `summaryFeedback`은 "AI 종합 피드백" 불릿 목록.
- VOICE/AVATAR 미디어 분석은 별도 섹션에서 점수·트랜스크립트 토글로 보여준다(리포트와 별개 데이터).

구조화 출력의 provider별 처리(OpenAI strict json_schema / Anthropic 프롬프트 임베드 / OSS jsonspan 정제)는 [공통 구조화 출력](/ai/openai-structured-output)과 [폴백 게이트웨이](/ai/fallback)를 참고.

## 5. 구현 상태 (됨 vs 계획) 정직 구분

::: tip 됨 (런타임 동작)
- 세션 전체 트랜스크립트 기반 리포트 생성, 캐시 우선 반환, `ended_at` 세팅으로 세션 종료
- `previousScore` 이전 세션 대비 증감, 답변 0건 거부, `clampScore` 0~100 클램프
- `INTERVIEW_REPORT_GEN` 사용량 로그, 폴백 게이트웨이 경유(자체모델→Haiku→OpenAI)
- 프런트 총점·증감·항목 Progress·종합 피드백·미디어 분석 병렬 표시
:::

::: warning 계획 / 진행중 (정직히 밝힐 점)
- **리포트 생성도 자체 LLM은 미가동.** 리포트는 생성 task인데 `OSS_GENERATION_TASKS`가 빈 집합이라(`FallbackInterviewLlmGateway.java:45`) 사실상 **Claude(Haiku)→OpenAI 폴백**으로만 생성된다. 자체 모델로의 점진 교체는 [자체 LLM 전략](/ai/self-llm-strategy) 참고.
- **강점/약점/다음 연습 과제는 별도 구조 필드가 아니다.** `summaryFeedback` 문장 안에 자연어로 녹아 있고, "다음 연습 과제"를 구조화된 액션 아이템으로 분리해 저장하는 건 아직 없다. 복습(블라인드 PracticeTab)·꼬리질문(PROBE)이 사실상의 "다음 연습" 경로다.
- **리포트는 답변 수정에 자동 반응하지 않는다.** 한 번 캐시되면 재생성되지 않으므로 갱신하려면 새 세션이 필요하다.
- **`summaryFeedback`이 비면 종합 피드백 섹션 자체가 숨는다**(프런트 `length > 0` 가드) — LLM이 빈 배열을 줄 가능성에 대한 방어.
:::

## 6. 면접 답변 3단계

1. **한 줄 정의** — "면접 리포트는 세션의 모든 Q&A를 하나의 트랜스크립트로 묶어 LLM에 다시 넣고, 총점·항목별 점수·종합 피드백을 받아 세션에 고정하는 기능입니다. 개별 답변 점수의 단순 평균이 아니라, 그 점수들을 입력 신호로 포함해 전체 맥락을 종합 재평가합니다."
2. **설계 의도** — "캐시 우선이라 한 번만 생성하고, 별도 종료 API 없이 리포트 생성이 `ended_at`을 세팅하며 세션을 닫습니다. 같은 지원 건의 직전 세션 점수와 비교해 성장 추적이 가능합니다. 리포트는 채점 task가 아니라 생성 task로 분류해 빠른 생성 모델(`gpt-5.4-mini`)을 씁니다."
3. **경계·정직** — "이 면접 점수와 리포트는 D 영역이 소유하지만, C 영역의 장기 경향 분석이 이를 **읽기전용 입력**으로 참조합니다. 그리고 솔직히 리포트 생성도 자체 LLM은 아직 미가동이라 Claude→OpenAI 폴백으로 만들어집니다."

## 7. 꼬리질문 + 모범답안

::: details Q1. 리포트 점수와 개별 답변 점수(`interview_answer.score`)는 무슨 관계인가요?
개별 점수는 **리포트 LLM의 입력**입니다. `buildTranscript`가 각 답변 뒤에 `(개별 점수: N)`을 붙여 트랜스크립트에 넣고(`:584-586`), LLM은 이를 참고해 `categories`와 `totalScore`를 다시 산출합니다. 즉 `totalScore`는 개별 점수의 산술 평균이 보장되지 않으며, LLM이 세션 전체를 보고 매기는 별도 종합 점수입니다. (목록 카드용 `avgAnswerScore`는 리포트가 아직 없을 때 평균으로 폴백하는 별개 값입니다.)
:::

::: details Q2. 같은 세션 리포트를 두 번 열면 어떻게 되나요?
두 번째부터는 LLM을 호출하지 않습니다. `getReport`가 맨 앞에서 `session.getReport()`가 비어 있지 않은지 확인하고, 있으면 `readReport`로 JSON을 파싱해 그대로 반환합니다(`:391-396`). 비용·지연·점수 흔들림을 막는 캐시 우선 설계입니다. 단점은 답변을 나중에 수정해도 리포트가 갱신되지 않는다는 것 — 리포트는 "그 시점의 스냅샷"이라는 정의입니다.
:::

::: details Q3. '이전 면접 대비 +N점'은 어디서 계산하나요?
`findLatestScoredSessionScore(applicationCaseId, sessionId)`가 같은 지원 건의 다른 세션 중 `total_score`가 있는 가장 최근(`id DESC LIMIT 1`) 세션 점수를 가져옵니다(`InterviewMapper.xml:80-88`). 현재 세션은 `id <> #{excludeSessionId}`로 제외합니다. 이 값이 `previousScore`로 응답·저장되고, 프런트가 `총점 − previousScore`로 증감 배지를 그립니다. 직전 채점 세션이 없으면 `null`이라 배지를 숨깁니다.
:::

::: details Q4. 세션은 어떻게 '종료'되나요? 종료 버튼이 따로 있나요?
없습니다. `getReport`가 마지막에 `updateSessionResult(sessionId, totalScore, reportJson, LocalDateTime.now())`를 호출하면서 `ended_at`을 현재 시각으로 세팅합니다(`:428`). 즉 리포트 생성이 곧 세션 종료입니다. 이렇게 한 이유는 "리포트 보기 = 면접 끝내기"로 UX를 단순화하기 위함이고, 트레이드오프로 "리포트를 안 본 세션은 종료되지 않은 채 남는다"는 의미가 생깁니다.
:::

::: details Q5. 이 면접 점수가 C 영역(장기 경향 분석)에서도 쓰인다던데, 경계는 어떻게 잡았나요?
데이터 소유는 D, 참조는 C입니다. C의 장기 취업 경향 분석은 여러 지원 건의 `interview_session`(면접 결과)과 `interview_answer`(답변 평가)를 **읽기전용 입력으로만** 가져가 반복 약점·직무 패턴을 해석하고, 원본은 절대 수정하지 않습니다(`TEAM_WORK_DISTRIBUTION.md:643-644,820`). 반대로 D는 C의 적합도를 질문 생성 입력으로 참조만 합니다. 양방향 모두 "읽기전용 참조"로 경계를 그어 영역 간 결합을 끊었습니다. 자세한 흐름은 [장기 경향 분석](/ai/career-trend-analysis)·[영역 C 경향](/area-c/career-trend)을 참고.
:::

::: details Q6. 리포트 LLM 호출이 실패하면 어떻게 되나요?
`generateReport`는 `FallbackInterviewLlmGateway`를 거치므로 1차 자체모델(현재 비활성)→Claude(Haiku)→OpenAI 순으로 폴백을 시도합니다. 모든 단계가 실패하면 `BusinessException`이 올라오고, `getReport`가 이를 잡아 `aiUsageLogService.recordFailure`로 `INTERVIEW_REPORT_GEN` 실패를 기록한 뒤 예외를 다시 던집니다(`:409-412`). 이때 `updateSessionResult`까지 도달하지 못하므로 **세션은 종료되지 않고**(`ended_at` 미설정), 사용자는 재시도할 수 있습니다.
:::

## 8. 직접 말해보기

다음을 막힘없이 말할 수 있으면 이 페이지를 이해한 것이다.

- `getReport`의 5단계 흐름(소유검증 → 캐시확인 → 답변검증 → 트랜스크립트 → 생성·저장)을 순서대로
- 리포트 `totalScore`가 개별 답변 점수의 평균이 *아닌* 이유와, 개별 점수가 입력으로 들어가는 방식
- "세션 종료 = 리포트 생성"이라는 설계와 그 트레이드오프
- `previousScore`가 어디서(어떤 쿼리로) 오고 무엇을 위한 값인지
- D의 면접 점수와 C의 장기 경향 분석 사이의 읽기전용 경계
- 리포트 생성이 채점 모델이 아니라 생성 모델(`gpt-5.4-mini`)을 쓰는 이유

## 퀴즈

<QuizBox question="면접 리포트의 totalScore는 어떻게 결정되는가?" :choices="['interview_answer.score 들의 산술 평균', '세션 전체 트랜스크립트를 LLM이 종합 평가한 별도 점수(개별 점수는 입력 신호)', '가장 높은 개별 답변 점수', '카테고리 점수들의 합계']" :answer="1" explanation="buildTranscript가 개별 점수를 (개별 점수: N) 형태로 트랜스크립트에 포함하지만, totalScore는 LLM이 세션 전체를 보고 매기는 별도 종합 점수다. 평균이 보장되지 않는다." />

<QuizBox question="이미 report 컬럼이 채워진 세션에 대해 getReport를 다시 호출하면?" :choices="['LLM을 다시 호출해 새 리포트를 생성한다', '저장된 JSON을 readReport로 파싱해 재생성 없이 반환한다', '에러를 던진다', '평균 점수만 다시 계산한다']" :answer="1" explanation="캐시 우선 설계다. session.getReport()가 비어 있지 않으면 LLM 호출 없이 readReport로 파싱해 그대로 반환한다(비용·지연·점수 흔들림 방지)." />

<QuizBox question="CareerTuner에서 면접 세션을 '종료'(ended_at 세팅)시키는 동작은?" :choices="['POST /sessions/{id}/end 전용 API', '리포트 생성(getReport)이 updateSessionResult로 ended_at을 세팅', '마지막 답변 제출 시점', '사용자가 브라우저를 닫을 때']" :answer="1" explanation="별도 종료 API가 없다. getReport가 마지막에 updateSessionResult(..., LocalDateTime.now())로 ended_at을 세팅하며 세션을 닫는다. 리포트 생성이 곧 세션 종료다." />
