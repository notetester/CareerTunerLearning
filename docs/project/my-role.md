# 내 역할 — 영역 C

> 저는 CareerTuner에서 "지원 건(Application Case) 단위로 사용자의 적합도를 분석하고, 부족한 역량·학습·자격증을 추천하며, 장기 취업 경향과 대시보드 요약을 만드는" AI 분석 파트(영역 C)를 맡았습니다. 핵심은 점수와 판정은 서버가 규칙으로 확정하고 LLM은 설명만 생성하는 뉴로-심볼릭 구조로 안정성을 잡은 것입니다.

## 1. 한 줄 정의

영역 C는 **"이 사람이 이 공고에 얼마나 맞는가, 무엇이 부족하고 어떻게 메울 것인가"를 데이터로 답하는 AI 분석 계층**이다. 6명 수직 분담 중 한 축이며, 적합도(Fit)·취업경향(Career Trend)·대시보드 인사이트(Dashboard Insight)를 소유한다.

## 2. 단어 뜻

| 용어 | 풀이 |
| --- | --- |
| 지원 건 (Application Case) | CareerTuner의 핵심 단위. "공고 1개"가 아니라 "내가 이 공고에 지원하는 건 1개". 같은 공고도 사람·시점마다 다른 케이스 |
| Fit Analysis | 공고 요구조건 vs 내 프로필을 비교해 적합도 점수·매칭/부족 역량·전략을 산출 |
| Career Trend | 여러 지원 건을 가로질러 본 장기 패턴(반복 부족 역량, 지원 성향, 다음 방향) |
| 뉴로-심볼릭 (Neuro-symbolic) | 신경망(LLM)과 규칙엔진(symbolic)을 결합. C에서는 **설명=LLM, 점수/판정=규칙** |
| AutoPrep | 한 번의 실행으로 여러 영역(A~F) 준비를 의존 그래프대로 병렬 실행하는 오케스트레이터 |

## 3. 왜 필요한가

채용 앱이 "공고 보여주기"에서 끝나면 사용자는 "나는 합격 가능한가?"라는 진짜 질문에 답을 못 받는다. 영역 C가 없으면:

- 점수·근거 없이 막연한 지원만 반복 → 사용자가 자기 격차를 모른다
- LLM에게 점수까지 맡기면 **같은 입력에 점수가 흔들리고**, 환각으로 없는 자격증을 추천한다
- 한 건씩만 보면 "나는 매번 SQL이 부족하다" 같은 **장기 패턴**을 놓친다

그래서 C는 (1) 결정적인 점수 산정 + (2) 근거 가드를 건 LLM 설명 + (3) 여러 건을 가로지른 경향 분석을 함께 제공한다.

## 4. CareerTuner에서 어디에 썼나 (실제 클래스/파일/테이블)

전부 백엔드 `com.careertuner` 패키지 아래, 영역 C 소유.

| 기능 | 핵심 클래스 | 테이블 | 상태 |
| --- | --- | --- | --- |
| 적합도 분석 | `fitanalysis.service.FitAnalysisServiceImpl`, `fitanalysis.ai.FitAnalysisAiResult`, `fitanalysis.ai.prompt.FitAnalysisPromptCatalog` | `fit_analysis` | 구현됨 (OpenAI 기반) |
| 적합도 폴백 디스패처 | `fitanalysis.ai.FallbackFitAnalysisAiService` (`@Primary`) | — | 구현됨 |
| 부족역량/학습/자격증 추천 | `FitGapRecommendation`, `FitLearningRoadmapItem`, `FitCertificateRecommendation` | `fit_analysis` 하위 `learning_task`/`condition_match` | 구현됨 |
| 장기 취업경향 | `analysis.ai.CareerAnalysisRunService`, `OpenAiCareerTrendAiService`, `CareerTrendPromptCatalog` | `career_analysis_run` | 구현됨 |
| 대시보드 요약 | `dashboard.ai.OpenAiDashboardInsightAiService`, `DashboardInsightPromptCatalog` | — | 구현됨 |
| 오케스트레이터 FIT 파트 | `ai.autoprep.handler.FitPrepHandler`, `ai.autoprep.AutoPrepOrchestrator` | — | 구현됨 |
| 자체 LLM 커리어전략 모델 | `ml/career-strategy-llm/` (학습/평가 하니스), `OssFitAnalysisAiService` (서빙 자리) | — | **평가·설계 단계** |
| 자동 스토리보드 파이프라인 | `docs/storyboard/C/` (서브모듈) | — | 구현됨 |

:::tip 정직하게 구분
적합도·취업경향·대시보드 요약 **3개는 OpenAI 기반으로 실제 구현·동작**한다. 자체 LLM(Qwen2.5 3B + LoRA)은 골든셋 평가·RAG PoC까지 진행한 **연구/설계 단계**이고, 프로덕션 기본 경로는 아직 OpenAI다. `FallbackFitAnalysisAiService`가 자체모델(OSS) 자리를 미리 비워뒀고 기본값은 `provider=openai`다.
:::

## 5. 핵심 동작 원리

### 5-1. 적합도 1건이 만들어지는 흐름 (`FitAnalysisServiceImpl.generate`)

```text
1. fit_analysis 소스 조회: 공고 요구/우대 스킬 + 내 프로필 스킬/자격증 (mapper.findGenerationSource)
2. FitAnalysisAiCommand 조립 → fitAnalysisAiService.generate() 호출 (LLM이 설명/근거 생성)
3. 신뢰도는 LLM이 아니라 입력 상태로 결정적 계산: FitAnalysisConfidence.evaluate(command)
4. 점수 분해도 서버가 규칙으로 재구성: scoreBreakdown() = 필수45/우대25/프로젝트15/경력10/프로필5
5. fit_analysis row + history(점수 델타·획득/해소/신규 격차) + condition_match + learning_task 저장
6. ai_usage_log 기록(크레딧 차감), 성공 시 알림(Notification) 발송
```

핵심은 **4번**이다. `weightedConditionScore`가 조건 매칭(MET=1.0, PARTIAL=0.5, UNMET=0)을 가중 합산해 점수 구간을 서버가 확정한다. LLM이 "80점"이라고 말해도 그 숫자를 그대로 믿지 않고, 조건 매트릭스에서 점수를 역산·정합화한다.

### 5-2. 뉴로-심볼릭 분담

| 역할 | 담당 | 이유 |
| --- | --- | --- |
| 매칭/부족 역량, 전략 문장, 학습 과제 설명 | LLM | 자연어 생성이 강점 |
| 적합도 점수 분해, 신뢰도, 격차 델타 | 서버 규칙 | 재현성·검증 가능성 |
| 점수 합산 검증, 잔여 점수 재분배 | 서버 규칙 | LLM 환각 점수 차단 |

### 5-3. 3단 폴백 (`FallbackFitAnalysisAiService`)

```text
provider=oss + base-url 있음? → 자체모델(OSS) 시도
  실패 → OpenAI (OpenAiFitAnalysisAiService)
    키 없음/실패 → 내부 Mock
```

자체모델이 죽거나 응답이 깨져도 화면은 안 깨진다. 이 패턴은 영역 D의 `FallbackInterviewLlmGateway`를 C 도메인으로 가져온 것(D 파일은 안 건드림 = 영역 경계 준수).

### 5-4. AutoPrep에서 FIT의 위치 (`AutoPrepOrchestrator`)

오케스트레이터는 `PrepPlan`의 단계를 **의존 그래프대로 병렬** 실행한다. 의존은 단순하다:

```text
DEPS = { FIT: [JOB], INTERVIEW: [JOB] }
```

FIT(C)와 INTERVIEW(D)는 공고 분석 JOB(B)이 DB에 커밋된 뒤 시작한다(`CompletableFuture.allOf(depFutures).thenRunAsync`). 진행 상황은 SSE로 실시간 전송된다. `FitPrepHandler`는 "근거 검색 → 채점 → 검증" 서브스텝을 보고하고 `fitAnalysisService.generate()`를 호출한다. 미구현/비활성 파트는 SKIPPED, 실패해도 FAILED로 기록하고 전체는 완주한다.

## 6. 면접 답변 3단계

- **초간단(1문장):** "저는 지원 건마다 적합도 점수·부족 역량·학습/자격증 추천과 장기 취업 경향을 만드는 AI 분석 파트를 담당했습니다."
- **기본:** "핵심 설계 원칙은 점수와 합격 판정은 서버 규칙엔진이 확정하고 LLM은 설명만 생성하는 뉴로-심볼릭 구조입니다. LLM이 점수를 흔들거나 없는 자격증을 환각하는 문제를 차단하려고, `FitAnalysisServiceImpl`에서 조건 매칭(MET/PARTIAL/UNMET)을 가중 합산해 필수45·우대25 식으로 점수를 서버가 재구성합니다. AI 호출은 자체모델→OpenAI→Mock 3단 폴백으로 가용성을 보장했고, AutoPrep 오케스트레이터에서는 공고 분석(JOB) 완료 후 FIT이 시작하도록 의존 그래프를 걸었습니다."
- **꼬리질문 대응:** "추가로 자체 LLM(Qwen2.5 3B + LoRA)을 학습·평가하는 하니스를 따로 운영했는데, 골든 60케이스로 환각·근거 위반(grounding)·점수 정합성을 측정했습니다. 7B로 키워도 점수가 안 올라서 모델 크기가 아니라 근거(grounding)가 병목임을 데이터로 확인하고 RAG 방향으로 PoC를 했습니다. 이건 프로덕션 기본 경로(OpenAI)와 분리한 연구 트랙입니다."

## 7. 자주 나오는 꼬리질문 + 모범답안

:::details Q. LLM이 점수까지 내면 안 되나요? 왜 서버가 다시 계산하나요?
LLM 점수는 **재현성이 없습니다.** 같은 입력에 80점, 75점이 왔다 갔다 하면 사용자가 신뢰할 수 없고, 재분석 시 점수가 출렁입니다. 그래서 조건 매트릭스(필수/우대 × MET/PARTIAL/UNMET)를 서버가 가중 합산해 점수를 결정적으로 산정합니다(`weightedConditionScore`). 신뢰도(`FitAnalysisConfidence`)도 LLM 판단이 아니라 입력 완성도로 계산해서 Mock이든 실제 AI든 동일하게 나옵니다.
:::

:::details Q. AI가 죽으면 화면이 깨지나요?
안 깨집니다. `FallbackFitAnalysisAiService`가 `@Primary` 진입점이고 자체모델→OpenAI→Mock 순으로 폴백합니다. OpenAI 키가 없으면 `OpenAiFitAnalysisAiService` 내부에서 Mock으로 떨어지고, 결과 status를 FAILED/SUCCESS로 구분해 저장합니다. AutoPrep에서도 한 파트가 실패해도 FAILED로 기록만 하고 나머지는 끝까지 실행합니다.
:::

:::details Q. AutoPrep에서 FIT은 왜 바로 시작 못 하나요?
적합도는 공고 요구조건이 있어야 매칭할 수 있는데, 그 요구조건은 영역 B의 공고 분석(JOB)이 만들어 DB에 넣습니다. 그래서 `DEPS`에 `FIT: [JOB]`을 걸어 JOB future가 끝난 뒤 `thenRunAsync`로 FIT을 시작합니다. 반대로 프로필(A)·자소서(E) 같은 독립 파트는 동시에 출발합니다.
:::

:::details Q. 자체 LLM은 실제 서비스에 쓰나요?
현재 프로덕션 기본 경로는 OpenAI입니다. 자체 LLM은 `ml/career-strategy-llm/`의 학습·평가 하니스와 골든셋으로 진행한 연구 트랙이고, 폴백 디스패처에 `OssFitAnalysisAiService` 자리를 미리 만들어 뒀습니다. 7B vs 3B LoRA 비교에서 7B가 이점이 없어(success 0.892 vs 0.867) 3B LoRA 유지 + RAG 우선으로 방향을 정했고, 점수/판정은 절대 LLM에 넘기지 않는 안전 불변식을 끝까지 지켰습니다.
:::

:::details Q. 한 건 분석과 장기 경향 분석의 차이는?
적합도(`fit_analysis`)는 지원 건 1개 안에서 공고 vs 프로필을 봅니다. 장기 취업경향(`career_analysis_run`, `CareerTrendAiResult`)은 여러 지원 건을 가로질러 "반복적으로 부족한 역량, 지원 성향, 다음에 노릴 방향"을 요약합니다. 단건이 진단이라면 경향은 처방에 가깝습니다.
:::

## 8. 직접 말해보기

1. 면접관이 "당신이 만든 기능 중 가장 기술적으로 어려웠던 결정 하나"라고 물으면, **뉴로-심볼릭 점수 분담**을 30초 안에 설명해 보라. "왜 LLM에 점수를 안 맡겼나"가 핵심.
2. "AI가 불안정한데 어떻게 신뢰성을 확보했나?"에 대해, **3단 폴백 + 결정적 신뢰도 계산 + 서버 점수 검증** 세 가지를 한 호흡에 말해 보라.

## 퀴즈

<QuizBox question="영역 C의 적합도 분석에서 최종 점수는 누가 확정하는가?" :choices="['LLM이 생성한 점수를 그대로 사용한다','서버 규칙엔진이 조건 매칭을 가중 합산해 확정한다','사용자가 직접 입력한다','OpenAI와 자체모델의 평균을 낸다']" :answer="1" explanation="FitAnalysisServiceImpl의 weightedConditionScore가 MET/PARTIAL/UNMET을 가중 합산해 필수45·우대25 등으로 점수를 결정적으로 산정한다. LLM은 설명·근거만 생성하는 뉴로-심볼릭 구조다." />

<QuizBox question="AutoPrep 오케스트레이터에서 FIT(C) 단계가 JOB(B) 완료 후에 실행되는 이유를 설명하라." explanation="적합도는 공고 요구조건과 프로필을 매칭해야 하는데, 그 요구조건은 영역 B의 공고 분석(JOB)이 산출해 DB에 커밋한다. 따라서 AutoPrepOrchestrator의 DEPS에 FIT: [JOB] 의존을 걸고, JOB의 CompletableFuture가 끝난 뒤 thenRunAsync로 FIT을 시작한다. 의존이 없는 프로필·자소서 등은 동시에 병렬 출발한다." />

<QuizBox question="FallbackFitAnalysisAiService의 폴백 순서로 옳은 것은?" :choices="['OpenAI → 자체모델 → Mock','Mock → OpenAI → 자체모델','자체모델(OSS) → OpenAI → Mock','OpenAI → Mock 만 사용']" :answer="2" explanation="provider=oss이고 base-url이 있으면 자체모델을 먼저 시도하고, 실패하면 OpenAI, 키가 없거나 실패하면 내부 Mock으로 떨어진다. 기본값 provider=openai에서는 자체모델을 건너뛴다." />
