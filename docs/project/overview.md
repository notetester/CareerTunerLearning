# CareerTuner 한눈에 (1분·3분 설명)

> CareerTuner는 "이 공고에 내가 얼마나 맞고, 뭘 더 채워야 하는지"를 AI가 분석해 주는 취업 전략 플랫폼이고, 모든 데이터는 공고 하나하나가 아니라 **지원 건(Application Case)** 단위로 묶입니다.

## 1. 한 줄 정의

채용공고에 맞춰 내 스펙과 면접 답변을 조정해 주는 **AI 취업 전략 플랫폼**. 공고를 분석해 적합도 점수를 매기고, 부족한 역량과 학습 로드맵을 제시하며, 그 흐름을 면접 준비까지 이어 줍니다.

## 2. 단어 뜻 (핵심 용어 풀이)

| 용어 | 뜻 | 왜 중요한가 |
| --- | --- | --- |
| Career + Tuner | "커리어를 (공고에 맞게) 튜닝한다" | 제품 철학 그 자체. 일반 조언이 아니라 **이 공고에 맞춘** 조정 |
| 지원 건 (Application Case) | "내가 이 회사 이 공고에 지원하는 한 건"을 묶는 단위 | 공고·분석·면접이 전부 이 단위에 매달림 |
| 적합도 (Fit) | 내 스펙과 공고 요구의 일치 정도 | 점수 + 매칭/부족 근거로 행동을 유도 |
| 부족 역량 (Gap) | 공고가 요구하는데 내가 없는 것 | 학습 로드맵·자격증 추천의 출발점 |
| RAG | 검색으로 근거 문서를 끌어와 LLM에 붙이는 기법 | 면접 질문/답변 평가의 정확도를 올림 |

:::tip 면접에서 이 한 가지만은 기억
"핵심 단위가 **공고가 아니라 지원 건**"이라는 점. 이걸 말하면 도메인을 제대로 이해했다는 신호가 됩니다.
:::

## 3. 왜 필요한가 (없으면 무슨 문제가 생기나)

구직자는 공고마다 요구사항이 다른데, 보통은 같은 자소서·같은 스펙으로 여러 곳에 지원합니다. 그래서 생기는 문제:

- **개인화 부재** — "내 스펙으로 이 공고가 될까?"에 답이 없다. 막연한 자기소개서 첨삭만 있다.
- **흩어진 맥락** — 공고 캡처, 분석 메모, 면접 예상질문이 따로 논다. 한 지원 건을 다시 볼 때 맥락이 사라진다.
- **행동으로 안 이어짐** — "부족하다"까지만 말하고, "그래서 뭘 공부하라"가 없다.

CareerTuner는 이 셋을 **지원 건 단위로 통합**해서 푼다. 공고를 한 건에 묶고 → 적합도를 점수화하고 → 부족 역량을 학습 과제로 변환하고 → 같은 맥락을 면접 준비로 넘긴다.

## 4. CareerTuner에서 어디에 썼나 (실제 클래스/파일/테이블)

전체 흐름을 코드 기준으로 보면:

| 단계 | 담당 영역 | 핵심 클래스/파일 | 테이블 |
| --- | --- | --- | --- |
| 지원 건 생성 | 공통/A·B | `ApplicationCase`(domain), `ApplicationCaseServiceImpl` | `application_case` |
| 공고 추출·분석 | B | `JobPostingTextExtractor`, `OpenAiResponsesClient`, ml `job-posting-worker` | `job_posting`, `job_analysis` |
| **적합도 분석** | **C(본인)** | `FitAnalysisServiceImpl`, `FitAnalysisAiService`, `FitAnalysisAiResult`, `FitAnalysisPromptCatalog` | `fit_analysis` |
| **장기 취업경향** | **C(본인)** | `CareerAnalysisRunService`, `CareerAnalysisOpenAiClient`, `CareerTrendPromptCatalog` | `career_analysis_run` |
| **대시보드 요약** | **C(본인)** | `DashboardInsightAiCommand`, `DashboardInsightPromptCatalog` | (집계) |
| 면접 준비 | D/E | `InterviewAgentOrchestrator`, Qdrant RAG | `interview_session`, `interview_answer` |
| 오케스트레이션 | 공통 | `AutoPrepOrchestrator`, `FitPrepHandler` 등 handler | — |

:::warning 정직하게 구분: 구현됨 vs 설계 단계
- **구현됨**: 위 표의 C 기능(적합도·취업경향·대시보드)은 OpenAI 기반으로 동작. 점수/판정은 LLM 그대로가 아니라 서버 규칙·검증으로 확정.
- **설계 단계**: 자체 LLM 커리어전략 모델(`careertuner-c-career-strategy`, Qwen/Gemma 베이스)은 아직 **계획**이다. Fallback 사다리(캐시→규칙엔진→OpenAI→Mock)와 학습데이터 파이프라인은 설계만 되어 있다.
:::

## 5. 핵심 동작 원리 (단계)

데이터 흐름을 한 줄로: **공고 분석(B) → 적합도(C) → 부족역량·학습(C) → 면접 준비(D)**.

이 흐름을 묶는 게 `AutoPrepOrchestrator`다. 두뇌가 세운 계획(`PrepPlan`)의 단계를 **의존 그래프대로 병렬 실행**한다:

```text
독립 파트 (동시 출발): A 프로필 · B 공고 · E 자소서 · F 커뮤니티
의존 파트 (JOB 끝난 뒤):  FIT(C) · INTERVIEW(D)
```

```java
// AutoPrepOrchestrator: FIT·INTERVIEW 는 JOB 완료 뒤 시작
private static final Map<String, List<String>> DEPS = Map.of(
        "FIT", List.of("JOB"),
        "INTERVIEW", List.of("JOB"));
```

- 진행 상황은 `runStream`이 **SSE**(plan / part-start / substep / part-done / done)로 실시간 보고한다.
- 미구현·비활성 단계는 멈추지 않고 `SKIPPED`, 실패해도 `FAILED`로 기록하고 **끝까지 완주**한다.
- 적합도 결과는 `FitAnalysisAiResult` 한 레코드에 점수·매칭기술·부족기술·추천학습·추천자격증·지원전략을 모아 `fit_analysis`에 저장한다.

응답은 전부 `ApiResponse<T>` 엔벨로프(`success` / `code` / `message` / `data`)로 감싼다.

## 6. 면접 답변 3단계

**초간단(1문장)**
"공고에 맞춰 스펙·면접답변을 튜닝해 주는 AI 취업 플랫폼이고, 핵심 단위는 공고가 아니라 지원 건입니다."

**기본(30초)**
"구직자가 공고를 등록하면 그걸 하나의 지원 건으로 묶습니다. AI가 공고를 분석하고, 제 스펙과의 적합도를 점수로 매긴 다음, 부족한 역량과 학습 로드맵을 뽑아 줍니다. 그 맥락이 그대로 가상 면접 준비로 이어집니다. 저는 그중 적합도 분석·취업경향 분석·대시보드 요약을 맡았습니다."

**꼬리질문 대응(기술 깊이)**
"백엔드는 Spring Boot 4 + Java 21 + MyBatis, 응답은 `ApiResponse` 엔벨로프로 통일했습니다. AI 단계는 `AutoPrepOrchestrator`가 의존 그래프 기반으로 병렬 실행하고, FIT과 INTERVIEW는 공고 분석(JOB)이 끝난 뒤에만 시작하도록 의존을 걸었습니다. 진행은 SSE로 스트리밍합니다."

## 7. 자주 나오는 꼬리질문 + 모범답안

:::details Q1. 왜 '공고'가 아니라 '지원 건'이 핵심 단위인가요?
같은 공고라도 사람마다 적합도·부족역량·면접 답변이 다릅니다. 또 한 사람이 같은 회사에 다른 직무로 지원할 수도 있죠. 분석 결과를 재사용·비교·이력 관리하려면 "내가 이 공고에 지원하는 한 건"을 식별 단위로 잡아야 합니다. 그래서 `application_case`가 중심 테이블이고 공고·적합도·면접이 전부 여기에 매달립니다.
:::

:::details Q2. AI가 매긴 점수를 그대로 믿어도 되나요?
아니요. LLM 출력을 그대로 노출하지 않습니다. 적합도 점수와 지원 판정은 서버의 규칙·검증 로직으로 확정합니다. LLM은 매칭/부족 근거 같은 텍스트 생성에 쓰고, 숫자와 판정은 코드가 책임집니다. 환각·일관성 문제를 줄이기 위한 설계입니다.
:::

:::details Q3. 여러 AI 단계가 있는데 순서는 어떻게 관리하나요?
`AutoPrepOrchestrator`가 의존 그래프로 관리합니다. 독립 단계(프로필·공고·자소서·커뮤니티)는 동시에 출발하고, FIT·INTERVIEW는 JOB(공고 분석)이 DB에 커밋된 뒤에만 시작합니다. `CompletableFuture.allOf`로 선행 단계를 기다린 뒤 비동기 실행합니다.
:::

:::details Q4. 본인이 맡은 부분(영역 C)은 정확히 무엇인가요?
적합도 분석(`fit_analysis`), 장기 취업경향 분석(`career_analysis_run`), 대시보드 요약 인사이트입니다. 도메인별 시스템 프롬프트를 클래스로 분리한 **프롬프트 카탈로그 패턴**(`FitAnalysisPromptCatalog` 등)을 적용했고, 자체 LLM 커리어전략 모델은 현재 설계 단계입니다.
:::

:::details Q5. 한 단계가 실패하면 전체가 멈추나요?
멈추지 않습니다. 미구현·비활성 단계는 `SKIPPED`, 예외가 나면 `FAILED`로 기록하고 나머지는 끝까지 실행합니다. 사용자는 부분 결과라도 받을 수 있고, SSE로 어느 단계가 실패했는지 실시간으로 확인합니다.
:::

## 8. 직접 말해보기

1. 타이머를 켜고 **1분 안에** "CareerTuner가 무엇이고, 왜 공고가 아니라 지원 건이 핵심인지"를 끊김 없이 말해 보세요.
2. 면접관이 "AI 점수 신뢰할 수 있나요?"라고 물었다고 가정하고, **LLM 출력과 서버 규칙의 역할 분리**를 한 문단으로 설명해 보세요.

관련 페이지: [DTO](/glossary/dto) · [ApiResponse 엔벨로프](/glossary/api-response-envelope) · [JWT 보안](/backend/jwt-security) · [AutoPrep 오케스트레이터](/ai/orchestrator-autoprep)

## 퀴즈

<QuizBox question="CareerTuner에서 데이터를 묶는 핵심 단위는 무엇인가?" :choices="['채용공고', '지원 건(Application Case)', '사용자 계정', '면접 세션']" :answer="1" explanation="같은 공고라도 사람마다 적합도와 답변이 달라, 분석을 재사용·비교하려면 '내가 이 공고에 지원하는 한 건'을 식별 단위로 잡아야 한다. 그래서 application_case가 중심 테이블이다." />

<QuizBox question="AutoPrepOrchestrator에서 FIT(적합도) 단계는 어떤 단계가 끝난 뒤에 시작하는가?" :choices="['프로필(A) 분석', '공고(JOB) 분석', '자소서(E) 작성', '의존 없이 즉시 시작']" :answer="1" explanation="DEPS 맵에 FIT과 INTERVIEW는 JOB에 의존하도록 정의되어 있다. 공고 분석 결과가 DB에 커밋된 뒤에야 적합도·면접 단계가 시작된다." />

<QuizBox question="적합도 점수를 LLM이 출력한 값 그대로 사용자에게 보여주는 대신, 어떻게 처리하는지 한 문단으로 설명하라." explanation="LLM 출력을 그대로 노출하지 않는다. 점수와 지원 판정 같은 숫자·결정은 서버의 규칙·검증 로직으로 확정하고, LLM은 매칭 근거·부족 역량 설명 같은 텍스트 생성에만 활용한다. 이렇게 역할을 분리하면 환각과 출력 비일관성의 영향을 줄이고, 동일 입력에 대해 신뢰 가능한 점수를 보장할 수 있다." />
