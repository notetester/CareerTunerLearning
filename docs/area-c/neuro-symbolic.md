# 뉴로-심볼릭 아키텍처 — 규칙엔진 + LLM 분리

> 영역 C의 가장 중요한 설계 결정. **점수와 판단은 결정적 규칙엔진이 소유·확정하고, LLM은 한국어 설명 텍스트만 생성한다.** 둘을 병합하되, 규칙엔진이 항상 권위(authority)다.

## 1. 한 줄 정의 · 이 페이지가 답하는 면접 질문

뉴로-심볼릭(Neuro-Symbolic)은 **신경망(LLM, neural)** 과 **규칙엔진(symbolic)** 을 한 흐름에 결합하되 **역할을 엄격히 분리**한 설계다. CareerTuner 영역 C에서는 적합도 점수·지원판단·조건매트릭스 같은 *숫자와 결론*은 규칙엔진(`MockFitAnalysisAiService`)이 결정론적으로 계산하고, LLM(`careertuner-c-career-strategy`, Qwen 계열 자체 파인튜닝 모델)은 *그 값을 설명하는 한국어 텍스트*만 만든다.

이 페이지가 대비하는 면접 질문:

- "AI가 점수를 매긴다면, 왜 같은 입력에 다른 점수가 나오지 않나요?"
- "LLM이 환각으로 '지원하세요'라고 하면 그대로 사용자에게 보여주나요?"
- "그럼 LLM은 도대체 무슨 일을 하나요? 규칙엔진만 있으면 되는 거 아닌가요?"
- "OSS 모델이 점수를 출력하면 그 점수를 쓰나요?"

::: tip 한 문장 암기
**"점수·판단은 규칙엔진이 소유(authority), 모델은 설명만(neural). 모델이 점수를 뱉어도 안 읽는다 — 화이트리스트로 구조적으로 차단한다."**
:::

## 2. 왜 이렇게 설계했나 — 설계 의도와 트레이드오프

순수 LLM(점수까지 LLM이 산출)으로 가면 네 가지가 동시에 무너진다. 영역 C는 이걸 5대 가치로 정리해서 설계 근거로 삼았다.

| 가치 | 순수 LLM의 문제 | 뉴로-심볼릭의 해법 |
| --- | --- | --- |
| **Credibility(신뢰)** | "왜 72점?"에 근거가 없다 | `scoreBreakdown` 5카테고리 가중·`condition_matrix` 행 단위 근거로 점수를 분해 |
| **Consistency(재현성)** | 같은 입력에 매번 다른 점수 | 규칙엔진이 결정론 → 같은 입력 = 같은 점수, 감사·재현 가능 |
| **Accountability(책임)** | 모순된 판단(필수 미충족인데 APPLY)을 그대로 노출 | `guardApplyDecision` 가드레일로 강등, 보정 사유 기록 |
| **Cost(비용)** | 매 분석마다 토큰 비용 | 점수는 규칙엔진(0원), 모델은 설명만 → 토큰 절약, 캐시로 재실행 억제 |
| **Reliability(가용성)** | 모델 죽으면 화면이 깨짐 | 3단 폴백 최후단이 규칙엔진(Mock)이라 항상 성공 |

### 대안과 트레이드오프

- **대안 A — 점수도 LLM이 산출:** 자유도는 높지만 위 4가지가 다 깨진다. 채용 의사결정 도메인에서는 "왜"를 못 대면 제품 가치가 없다. 기각.
- **대안 B — LLM 없이 규칙엔진만:** 신뢰·재현은 완벽하지만 설명이 기계적이고 딱딱하다("필수 3개 중 1개 매칭"). 사용자 설득력이 떨어진다.
- **선택 — 뉴로-심볼릭:** 규칙엔진으로 *무엇을(what)* 을 확정하고, LLM으로 *어떻게 풀어 설명할지(how to explain)* 를 맡긴다. 두 약점을 서로 메운다.

::: warning 트레이드오프 (정직하게)
규칙엔진의 점수 공식 자체가 단순하면(예: 단어 매칭 기반), 뉴로-심볼릭이라도 "점수 산정의 정교함"은 규칙엔진 품질에 묶인다. 그래서 향후 과제는 규칙엔진 정교화(임베딩 유사도 매칭 등)이지, LLM에 점수를 넘기는 게 아니다. 분리 원칙은 유지한다.
:::

## 3. 어떤 기술로 구현했나 — 실제 클래스·메서드·테이블 근거

핵심은 인터페이스 하나에 4개 구현 + 디스패처(Strategy + Fallback 패턴)다.

| 클래스 | 역할 | 뉴로-심볼릭에서 위치 |
| --- | --- | --- |
| `FitAnalysisAiService` | 적합도 AI 인터페이스 | 계약 |
| `MockFitAnalysisAiService` | **규칙엔진(symbolic)** — 점수·매칭·판단 결정론 계산 | 권위(authority) |
| `OssFitAnalysisAiService` | 자체 OSS 모델 통합 — 규칙엔진 골격 + 모델 설명 병합 | **뉴로-심볼릭 조립기** |
| `OpenAiFitAnalysisAiService` | OpenAI 경로 + `guardApplyDecision` 재검증 | neural + 가드 |
| `FallbackFitAnalysisAiService` | `@Primary` 디스패처 — OSS→OpenAI→Mock | 폴백 체인 |
| `FitAnalysisPromptCatalog` | `FIT_EXPLAIN_SYSTEM_PROMPT`, `fitExplainUserPrompt(...)` | 프롬프트(train/serve 정합) |

저장 테이블(영역 C 소유): `fit_analysis`(불변, JSON 컬럼 다수 + `source_snapshot`), `fit_analysis_condition_match`(조건매트릭스 정규화), `fit_analysis_learning_task`, `fit_analysis_history`, `career_analysis_run`(캐시). 모든 분석에 `model`/`prompt_version`/`status`가 기록된다.

가장 중요한 메서드는 `OssFitAnalysisAiService.generate(FitAnalysisAiCommand)`다. 여기가 "조립" 그 자체다.

## 4. 동작 원리 — `OssFitAnalysisAiService.generate()` 5단계

데이터 흐름을 그대로 따라가 보자. 이게 면접에서 화이트보드로 그릴 수 있어야 한다.

```text
[command]
   │
   ▼ 1. ruleEngine.generate(command)   ← MockFitAnalysisAiService
[skeleton: fitScore, applyDecision, conditionMatrix, gaps, roadmap, certs]  ← 서버 권위(symbolic)
   │
   ▼ 2. fitExplainUserPrompt(... fitScore, applyDecision, matched, missing ...)
[규칙엔진 사전계산값을 '입력'으로 넣은 모델 프롬프트]
   │
   ▼ 3. ossClient.requestFitExplain(SYSTEM, user)  → grounding guard 루프
[explain: fitSummary, strengths, risks, strategyActions, learningTaskReasons]  ← neural
   │
   ▼ 4. 병합: skeleton(권위) + explain(텍스트만), 금지키는 안 읽음
[FitAnalysisAiResult: 점수·판단=규칙엔진, 설명=모델]
```

### 단계별로

1. **규칙엔진 골격 생성.** `FitAnalysisAiResult skeleton = ruleEngine.generate(command)`. 점수 공식은 `10 + 필수충족비율*70 + 우대충족비율*20`(0~100 클램핑). 매칭/부족, `condition_matrix`, `applyDecision`, 로드맵, 자격증이 전부 여기서 확정된다.

2. **모델 입력 구성.** `fitExplainUserPrompt(...)`로 회사/직무/공고 요구/프로필 **그리고 규칙엔진이 이미 계산한 `fitScore`·`applyDecision`·매칭·부족**을 "규칙엔진 사전계산 (서버 확정값 — 변경 금지)" 섹션에 넣어 모델에 준다. 모델은 점수를 *만드는 게 아니라 설명하는* 입장이 된다.

3. **모델 호출 + grounding guard.** `ossClient.requestFitExplain(FIT_EXPLAIN_SYSTEM_PROMPT, userPrompt)`. 응답에서 `fitSummary`가 비면 `BusinessException` → 폴백. `groundingViolation(...)`이 위반을 찾으면 `groundingRetries`만큼 재호출, 소진 시 throw → 폴백. (가드 상세는 [가드레일 페이지](/area-c/guardrails) 참고.)

4. **병합.** 결과는 규칙엔진 골격을 그대로 두고, **텍스트 필드만 모델 값으로 교체**한다.

| 결과 필드 | 출처 | 비고 |
| --- | --- | --- |
| `fitScore` | 규칙엔진 | 권위 |
| `applyDecision` | 규칙엔진 | 권위 |
| `conditionMatrix` | 규칙엔진 | 권위 |
| `matchedSkills`/`missingSkills` | 규칙엔진 | 권위 |
| `strategy`(설명) | 모델 `fitSummary` | neural |
| `strategyActions` | 모델(비면 규칙엔진) | neural |
| gap의 `reason` | 모델 `learningTaskReasons`(skill 매칭 시) | neural, category/priority는 규칙엔진 유지 |

### 화이트리스트 — 모델이 점수를 뱉어도 "안 읽는다"

핵심 방어선은 검증이 아니라 **구조**다. 병합 코드는 모델 응답에서 **`fitSummary`/`strategyActions`/`learningTaskReasons`만 읽는다.** 모델이 `fitScore`·`score`·`applyDecision`·`decision` 같은 금지키를 출력해도 그 키를 *읽는 코드가 아예 없으므로* 결과에 반영될 길이 없다. "검증해서 버린다"가 아니라 "읽지 않아서 존재하지 않는다"가 더 강한 보장이다.

```java
// 병합 — 화이트리스트만 읽는다 (추상화)
List<String> modelActions = strings(explain.path("strategyActions"));
String fitSummary = explain.path("fitSummary").asText("").trim();
List<FitGapRecommendation> gaps =
    enrichGapReasons(skeleton.gapRecommendations(), explain.path("learningTaskReasons"));
// explain.path("fitScore") / ("decision") 를 읽는 코드는 없다 → 구조적으로 무력화
return new FitAnalysisAiResult(
    skeleton.fitScore(),        // 규칙엔진
    ...,
    fitSummary,                 // 모델 설명만
    ...,
    skeleton.applyDecision(),   // 규칙엔진
    usage, "SUCCESS", null, false);
```

### grounding guard의 보수적 판정과 자격증 예외

- **보수적 판정:** `groundingViolation`은 한 문장에 '보유/강점/숙련' 같은 `POSSESSION` 표현이 있고 *동시에* '부족/없/않' 같은 `LACK` 표현이 **없을 때만** 위반으로 본다. "Kubernetes 경험이 부족"은 정상으로 통과시켜 false-positive(과도 폴백)를 피한다.
- **보유 자격증 제외:** 규칙엔진은 자격증을 스킬로 치지 않아 보유 자격증이 `missing`에 남을 수 있다. 안 빼면 모델이 "정보처리기사 보유"(사실)를 말해도 위반으로 오탐 → 과도 폴백이 난다. 그래서 병합 전에 `profileCertificates`를 `missing`에서 제거한다.

## 5. 구현 상태 — 됨 vs 향후 (정직 구분)

| 항목 | 상태 |
| --- | --- |
| 규칙엔진 점수/판단/조건매트릭스/신뢰도 | **구현됨** (결정론, 테스트 존재) |
| `OssFitAnalysisAiService` 5단계 조립·화이트리스트·grounding guard·자격증 예외 | **구현됨** (통합 코드 + 단위 테스트) |
| `guardApplyDecision` 재검증(OpenAI 경로) | **구현됨** |
| 3단 폴백 배선(OSS→OpenAI→Mock) | **구현됨** (`@Primary` 디스패처) |
| `fit_analysis` 외 4테이블 저장·히스토리·학습과제·조건매트릭스 | **구현됨** |
| 프롬프트 train/serve 정합(`FIT_EXPLAIN_SYSTEM_PROMPT`가 학습 데이터 system과 동일) | **구현됨** (코드 주석에 동기화 근거 명시) |
| **실제 OSS 파인튜닝 모델 학습·서빙(Ollama)** | **향후** — 코드는 호출 준비 완료, 모델 가중치 학습·배포는 키/리소스 확보 후 |
| **OpenAI 키 연동** | **향후** — 키 발급 시 `OpenAiFitAnalysisAiService` 활성화 |

::: warning 면접에서 정직하게
"아키텍처(분리·폴백·가드·화이트리스트·캐시·저장)는 완성되어 결정론적 데모로 동작하고, 화면·계약은 실제 LLM과 동일하다. 실제 LLM 가중치 학습과 외부 키 연동만 향후 활성화 단계"라고 말한다. "다 돌아간다"고 과장하지 않는다 — 이 정직함 자체가 영역 C의 신뢰 철학과 일관된다.
:::

## 6. 면접 답변 3단계

**초간단(15초):** "점수와 지원 판단은 결정적 규칙엔진이 확정하고, LLM은 그 결과를 한국어로 설명만 합니다. 신뢰·재현·책임·비용 때문입니다."

**기본(60초):** "`OssFitAnalysisAiService.generate`에서 먼저 규칙엔진(`MockFitAnalysisAiService`)이 점수·매칭·조건매트릭스·지원판단을 결정론으로 계산합니다. 그 값을 *입력*으로 자체 모델에 넘겨 `fitSummary`·강점·위험·액션 같은 설명 텍스트만 받습니다. 병합할 때 모델 응답에서는 화이트리스트(`fitSummary`/`strategyActions`/`learningTaskReasons`)만 읽고, 모델이 `fitScore`나 `decision`을 뱉어도 그 키를 읽는 코드가 없어 구조적으로 무시됩니다. 점수·판단의 권위는 항상 규칙엔진입니다."

**꼬리질문 대응:** "모델이 환각으로 부족 역량을 '보유'로 서술하면 grounding guard가 잡아 재호출하고, 소진되면 예외를 던져 OpenAI→Mock으로 폴백합니다. 어느 경로가 실패해도 최후단이 규칙엔진(Mock)이라 화면은 깨지지 않습니다."

## 7. 자주 나오는 꼬리질문 + 모범답안

**Q1. 그럼 LLM은 왜 쓰나요? 규칙엔진만 있으면 되잖아요.**
규칙엔진 설명은 "필수 3개 중 1개 매칭"처럼 기계적입니다. 사용자를 설득하고 맥락을 자연스럽게 풀어주는 한국어 설명은 LLM이 훨씬 낫습니다. *판단은 규칙, 설득은 모델* — 각자 잘하는 일을 시킵니다.

**Q2. 모델이 점수를 출력하면 어떻게 막나요?**
검증으로 거르는 게 아니라 **읽지 않습니다.** 병합 코드가 `fitSummary`/`strategyActions`/`learningTaskReasons`만 파싱하고, `fitScore`·`decision` 같은 키를 읽는 코드 자체가 없습니다. 화이트리스트 기반 구조적 차단이라 "깜빡하고 통과"가 원천적으로 불가능합니다.

**Q3. train/serve skew는 어떻게 막았나요?**
`FIT_EXPLAIN_SYSTEM_PROMPT`와 `fitExplainUserPrompt`의 구조를 학습 데이터 생성 스크립트(`build_fit_user`/`FIT_EXPLAIN_SYS`)와 *동일*하게 맞췄습니다. 코드 주석에 "학습 데이터와 동일해야 한다"는 동기화 근거를 남겨, 한쪽만 바뀌는 drift를 방지합니다.

**Q4. grounding guard가 정상 문장을 위반으로 오탐하면요?**
보수적으로 설계했습니다. 한 문장에 보유 표현(`POSSESSION`)이 있고 *동시에* 결핍 표현(`LACK`)이 없을 때만 위반으로 봅니다. "경험이 부족"은 통과, 보유 자격증은 사전 제외합니다. 과도 폴백(라이브 회귀에서 관찰됨)을 줄이려는 의도적 보정입니다.

**Q5. 규칙엔진(Mock)이 권위인데, 이름이 'Mock'이라 임시처럼 보이지 않나요?**
이름은 "외부 호출 없는 결정적 구현"이라는 뜻이지 가짜라는 뜻이 아닙니다. 점수 공식·조건매트릭스·`applyDecision` 로직이 실제 비즈니스 규칙입니다. 폴백 최후단이자 *권위*라서 영역 C에서 가장 중요한 클래스입니다.

**Q6. OpenAI 경로는 LLM이 판단을 내는데, 거기선 분리가 깨지지 않나요?**
OpenAI 경로에서는 LLM이 `applyDecision`을 제안하지만 `guardApplyDecision`이 `fitScore>=70 AND requiredUnmet==0`을 다시 검사해, 충족하지 않으면 `COMPLEMENT`로 강등하고 보정 사유를 기록합니다. *제안은 LLM, 확정은 규칙* — 경로가 달라도 분리 원칙은 동일합니다.

## 8. 직접 말해보기

다음을 막힘없이 말할 수 있으면 이 페이지를 통과한 것이다.

- `OssFitAnalysisAiService.generate`의 5단계를 순서대로 (규칙엔진 골격 → 모델 입력 구성 → 모델 호출+가드 → 병합 → 결과).
- 화이트리스트 3키와 금지키 예시를 들고, "검증이 아니라 안 읽음"의 차이를 설명.
- 5대 가치(신뢰·재현·책임·비용·가용성) 각각을 뉴로-심볼릭이 어떻게 만족시키는지 한 줄씩.
- grounding guard의 보수적 판정(`POSSESSION` 있고 `LACK` 없을 때만)과 보유 자격증 예외의 이유.
- "구현됨 vs 향후"를 정직하게 구분.

관련 페이지: [규칙엔진 점수](/area-c/score-engine) · [가드레일](/area-c/guardrails) · [3단 폴백](/area-c/fallback-chain) · [구조화 출력](/ai/openai-structured-output) · [가드 재검증과 JWT 보안 맥락](/backend/jwt-security)

## 퀴즈

<QuizBox question="OssFitAnalysisAiService에서 적합도 점수(fitScore)와 지원판단(applyDecision)의 최종 권위를 가진 것은?" :choices="['자체 OSS 모델의 응답', '서버 규칙엔진(MockFitAnalysisAiService)', 'OpenAI Responses API', '프론트엔드의 scoreTone 계산']" :answer="1" explanation="뉴로-심볼릭 분리 원칙에 따라 점수·판단은 결정적 규칙엔진(MockFitAnalysisAiService)이 소유·확정한다. 모델은 그 값을 입력으로 받아 설명 텍스트만 생성한다." />

<QuizBox question="자체 OSS 모델이 응답에 fitScore와 decision 키를 출력했을 때 일어나는 일은?" :choices="['결과에 그대로 반영된다', '예외를 던져 즉시 폴백한다', '병합 코드가 그 키를 읽지 않아 무시된다', '관리자에게 알림이 간다']" :answer="2" explanation="병합은 화이트리스트(fitSummary/strategyActions/learningTaskReasons)만 읽는다. 금지키를 읽는 코드가 아예 없으므로 모델이 출력해도 결과에 반영될 길이 없다 — 검증이 아니라 구조적 차단이다." />

<QuizBox question="규칙엔진과 LLM을 분리한 뉴로-심볼릭 설계의 핵심 동기 4~5가지를 키워드로 말해보라(주관식)." explanation="모범답안: 신뢰(credibility, 점수 근거 분해)·재현성(consistency, 같은 입력 같은 점수)·책임(accountability, guardApplyDecision으로 모순 차단)·비용(cost, 점수는 0원·설명만 토큰)·가용성(reliability, 최후단 규칙엔진이라 항상 성공). 순수 LLM은 이 다섯이 동시에 무너진다." />
