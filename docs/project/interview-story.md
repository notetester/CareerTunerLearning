# 프로젝트 면접 스토리

> "채용공고에 맞춰 스펙·면접 답변을 조정해 주는 AI 취업 전략 플랫폼이고, 저는 6명 팀의 영역 C — 적합도·취업경향·대시보드 인사이트 같은 'AI 분석' 도메인 — 을 처음부터 끝까지 맡았습니다."

이 페이지는 면접에서 이 프로젝트를 **자기 입으로** 설명하기 위한 답변 세트다. 외울 대상이 아니라, 같은 사실을 여러 각도(STAR)로 꺼내 쓰는 훈련용이다. 모든 답변은 실제 클래스/파일/테이블 이름으로 뒷받침한다.

## 1. 한 줄 정의

CareerTuner는 **"공고 하나가 아니라 지원 건(Application Case) 단위"** 로 사용자의 스펙·면접 답변을 그 회사에 맞게 조정해 주는 AI 취업 전략 플랫폼이다. 나는 그 안에서 **AI 분석 도메인(영역 C)** — 적합도 분석, 장기 취업경향 분석, 대시보드 인사이트 — 의 백엔드·프론트·관리자 화면을 수직으로 담당했다.

## 2. 단어 뜻 (핵심 용어 풀이)

| 용어 | 뜻 |
| --- | --- |
| **STAR** | Situation(상황) · Task(과제) · Action(행동) · Result(결과). 경험을 구조화해 답하는 면접 프레임 |
| **Application Case (지원 건)** | "이 사람이 이 회사 이 공고에 지원한다"는 한 건. 분석의 핵심 단위 |
| **적합도 분석 (Fit Analysis)** | 공고 요구 역량 vs 내 프로필을 비교해 점수·부족역량·전략을 내는 C의 대표 기능 |
| **수직 분담** | 한 기능을 프론트~백엔드~DB~관리자까지 한 사람이 끝까지 책임지는 분업 방식 |
| **폴백(Fallback)** | 1차 수단이 실패하면 자동으로 2차·3차로 넘어가 화면이 깨지지 않게 하는 안전망 |

## 3. 왜 이 프로젝트인가 (문제 정의)

기존 취업 도구는 "이력서를 잘 써준다" 수준에 머문다. 하지만 실제 지원자는 **같은 스펙이라도 회사·공고마다 강조점을 바꿔야** 한다. CareerTuner는 그 조정을 자동화한다.

- 공고 하나가 아니라 **지원 건 단위**로 관리 → 같은 사람이 A사·B사에 지원할 때 각각 다른 전략이 나온다.
- 단발 분석이 아니라 **누적 데이터로 경향**을 본다 → "너는 매번 클라우드 역량에서 막힌다" 같은 장기 인사이트(`career_analysis_run`)를 준다.
- AI를 쓰되 **점수·판정은 서버 규칙으로 확정** → AI가 흔들려도 사용자에게 보이는 숫자는 일관된다.

## 4. 내 역할과 전체 아키텍처 (영역 C)

```text
backend/   Spring Boot 4.0.6 + Java 21 + MyBatis + MySQL 8   (REST, :8080)
frontend/  React 18 + Vite 6 + TypeScript + Tailwind v4       (SPA, :5173)
ml/        Python 공고추출 워커 (영역 B)
Qdrant     가상면접 RAG 벡터DB (영역 D)
```

내가 구현한 것(영역 C, 실제 파일):

| 기능 | 백엔드 | 테이블 | 상태 |
| --- | --- | --- | --- |
| 적합도 분석 | `FitAnalysisServiceImpl`, `FitAnalysisAiService`, `FallbackFitAnalysisAiService` | `fit_analysis` | 구현됨 |
| 장기 취업경향 | `CareerAnalysisRunService`, `CareerTrendAiService`, `CareerAnalysisOpenAiClient` | `career_analysis_run` | 구현됨 |
| 대시보드 인사이트 | `DashboardInsightAiCommand`, `DashboardInsightPromptCatalog` | (집계) | 구현됨 |
| 프롬프트 카탈로그 | `FitAnalysisPromptCatalog`, `CareerTrendPromptCatalog` 등 | — | 구현됨 |
| 자체 LLM 커리어전략 모델 | `careertuner-c-career-strategy` (Qwen/Gemma 베이스) | — | **설계 단계(미구현)** |

:::tip 정직하게 구분하기
면접에서 "자체 LLM도 만들었나요?"라고 물으면, **"적합도·경향·대시보드 분석은 OpenAI 기반으로 동작하고, 자체 LLM 커리어전략 모델은 폴백 체인(캐시→규칙엔진→OpenAI→Mock)과 학습 파이프라인까지 설계해 둔 단계"** 라고 답한다. 구현과 설계를 섞어 부풀리지 않는 것이 신뢰를 만든다.
:::

전체 아키텍처도 설명할 수 있어야 한다: 모든 응답은 `ApiResponse<T>` 엔벨로프, 영속성은 MyBatis만(JPA 금지), 인증은 JWT+Spring Security, AI 오케스트레이터 `AutoPrepOrchestrator`가 의존 그래프(JOB→FIT·INTERVIEW)대로 파트를 병렬 실행하고 SSE로 진행을 보고한다.

## 5. STAR 기반 모범 답변 세트

### (S/T) 프로젝트 설명 + 맡은 역할

> "CareerTuner는 지원 건 단위로 스펙·면접 답변을 회사에 맞게 조정하는 AI 취업 전략 플랫폼입니다. 6명이 기능별 수직 분담을 했고, 저는 AI 분석 영역 C를 맡아 적합도 분석·장기 취업경향·대시보드 인사이트를 프론트부터 백엔드, DB, 관리자 화면까지 책임졌습니다. 핵심은 적합도 분석으로, 공고 요구 역량과 사용자 프로필을 비교해 점수·부족역량·추천학습·지원전략을 내고 그 결과를 `fit_analysis` 테이블에 누적합니다."

### (A) 어려웠던 점 + 행동

> "가장 어려웠던 건 **AI 결과의 불안정성을 어떻게 사용자에게 안정적으로 보이게 하느냐** 였습니다. LLM은 같은 입력에도 점수가 흔들리고, 키가 없거나 모델이 죽을 수도 있습니다. 그래서 두 가지로 풀었습니다.
> 첫째, **신뢰도와 점수를 AI에 맡기지 않고 서버에서 결정적으로 계산**했습니다. `FitAnalysisConfidence.evaluate()`는 입력 데이터(공고 분석·프로필)가 비어 있으면 100점에서 항목별로 감점하는 규칙이라, mock이든 실제 AI든 동일한 신뢰도가 나옵니다.
> 둘째, **폴백 체인**입니다. `FallbackFitAnalysisAiService`가 `@Primary` 진입점이 되어 자체모델(OSS)→OpenAI→Mock 순으로 시도하고, 어느 단계가 실패해도 화면은 깨지지 않습니다."

### (A) 기술 선택 이유

> "영속성을 **MyBatis만** 쓴 건 팀 합의였습니다. AI 분석은 여러 테이블을 조인해 집계하는 쿼리가 많아 SQL을 직접 제어하는 편이 유리했습니다. AI 호출은 인터페이스(`FitAnalysisAiService`)에 의존하게 설계해, OpenAI 구현체를 Mock·OSS로 갈아끼워도 호출부(`FitAnalysisServiceImpl`)는 손대지 않습니다. 비동기 다단계 분석은 `CompletableFuture` 의존 그래프로 병렬화하고 진행 상황은 SSE로 실시간 전송했습니다."

### (R) 결과

> "결과적으로 적합도 분석은 신뢰도·점수가 일관되고, AI 장애 시에도 Mock으로 완주하는 구조가 됐습니다. CI에서 `OpenAiFitAnalysisAiServiceTest` 등 45개 이상의 JUnit 테스트와 프론트 타입체크가 돌아 회귀를 막습니다."

### (R) 개선한다면

> "지금은 자체 LLM 커리어전략 모델(`careertuner-c-career-strategy`)이 설계 단계입니다. OpenAI 비용·지연을 줄이고 도메인 특화 답변을 내기 위해 Qwen/Gemma 베이스로 파인튜닝하고 Ollama로 서빙하는 구조를 잡아 뒀습니다. 학습 데이터(`ml/career-strategy-llm`) 생성과 규칙엔진 폴백을 완성하는 게 다음 단계입니다."

## 6. 면접 답변 3단계 (난이도별)

| 단계 | 답변 |
| --- | --- |
| **1문장** | "공고에 맞춰 스펙·면접 답변을 조정하는 AI 취업 플랫폼에서, 저는 적합도 분석 같은 AI 분석 도메인을 맡았습니다." |
| **기본(30초)** | "6명 수직 분담 중 영역 C를 담당했고, 적합도 분석은 공고 요구 역량과 프로필을 비교해 점수·부족역량·전략을 내는 기능입니다. AI가 흔들려도 일관되게 보이도록 신뢰도/점수는 서버 규칙으로 확정하고, AI 호출은 폴백 체인으로 안전망을 뒀습니다." |
| **꼬리질문 대응** | 구체 클래스로 내려간다 — `FallbackFitAnalysisAiService`(@Primary 폴백), `FitAnalysisConfidence`(결정적 신뢰도), `AutoPrepOrchestrator`(의존 그래프 병렬+SSE), `ApiResponse` 엔벨로프, MyBatis 매퍼 구조. |

## 7. 자주 나오는 꼬리질문 + 모범답안

:::details Q1. AI 점수를 그대로 보여주지 않은 이유는?
LLM은 같은 입력에도 출력이 흔들립니다. 사용자에게 보이는 숫자가 새로고침마다 바뀌면 신뢰를 잃습니다. 그래서 `FitAnalysisConfidence.evaluate()`처럼 **입력 상태(공고 분석/프로필 유무) 기반의 결정적 계산**으로 신뢰도를 산정하고, 점수도 서버 검증 로직으로 확정합니다. 숫자(score 0~100)를 원천으로 두고 레벨(HIGH/MEDIUM/LOW)은 구간으로 파생해 둘이 어긋나지 않게 했습니다.
:::

:::details Q2. AI 호출이 실패하면 어떻게 되나요?
`FallbackFitAnalysisAiService`가 `@Primary` 진입점입니다. provider가 OSS이고 자체모델이 살아 있으면 1차로 시도하고, 실패하면 OpenAI로 넘어갑니다. OpenAI도 키가 없거나 실패하면 `OpenAiFitAnalysisAiService` 내부에서 Mock으로 폴백합니다. 다단계 오케스트레이션(`AutoPrepOrchestrator`)에서도 한 파트가 죽으면 그 파트만 `FAILED`로 기록하고 나머지는 완주합니다.
:::

:::details Q3. 왜 JPA가 아니라 MyBatis인가요?
팀 아키텍처 규칙이고(JPA 금지), AI 분석 도메인 특성상 여러 테이블을 조인·집계하는 복잡한 읽기 쿼리가 많아 SQL을 직접 제어하는 MyBatis가 유리했습니다. `@Mapper` 인터페이스 + `resources/mapper/**/*.xml`에 쿼리를 두고 map-underscore-to-camel-case로 매핑합니다.
:::

:::details Q4. 협업은 어떻게 했나요? 충돌은 없었나요?
기능별 **수직 분담**이라 각자 프론트~DB~관리자까지 한 도메인을 끝까지 책임집니다. 공통 영역(`common/`, `routes.ts`, `schema.sql`, 프롬프트 공통 엔진)은 팀장 승인이 필요하고, 협업은 **개인 브랜치 → dev로 PR**(보호 브랜치 직접 push 금지)로 합니다. 예를 들어 D가 만든 인터뷰 폴백 패턴을 C 적합도 도메인으로 가져올 때 D 파일은 건드리지 않고 같은 패턴만 차용해 영역 경계를 지켰습니다.
:::

:::details Q5. AI가 여러 단계로 나뉘는데 순서·병렬은 어떻게 처리했나요?
`AutoPrepOrchestrator`가 `PrepPlan`의 step들을 의존 그래프대로 실행합니다. 독립 파트(프로필·공고·자소서·커뮤니티)는 `CompletableFuture`로 동시에 출발하고, FIT(C)·INTERVIEW(D)는 JOB(공고 분석)이 DB에 커밋된 뒤 `thenRunAsync`로 시작합니다. 진행 상황은 `SseEmitter`로 plan/part-start/substep/part-done 이벤트를 실시간 전송하며, 병렬 파트가 동시에 전송하므로 emitter 단위로 동기화했습니다.
:::

## 8. 직접 말해보기 (말하기 훈련)

1. 면접관이 "이 프로젝트에서 가장 기술적으로 자랑할 만한 한 가지는?"이라고 물었다고 가정하고, **STAR 순서로 90초 안에** 적합도 분석의 폴백 체인 + 결정적 신뢰도를 설명해 보라. (클래스 이름 2개 이상 포함)
2. "AI 부분은 그냥 OpenAI API 부른 것 아니냐"는 다소 공격적인 질문에, 방어가 아니라 **설계 의도(불안정성 흡수·인터페이스 추상화·서버 확정 규칙)** 로 받아치는 답변을 직접 소리내어 말해 보라.

## 퀴즈

<QuizBox question="CareerTuner에서 적합도 분석의 신뢰도/점수를 AI가 아니라 서버 규칙으로 확정한 가장 큰 이유는?" :choices="['서버가 더 빠르기 때문', 'LLM 출력이 흔들려도 사용자에게 보이는 숫자를 일관되게 유지하기 위해', 'OpenAI 비용을 줄이려고', 'MyBatis가 AI를 지원하지 않아서']" :answer="1" explanation="LLM은 같은 입력에도 출력이 달라질 수 있어, FitAnalysisConfidence.evaluate()처럼 입력 상태 기반 결정적 계산으로 신뢰도를 산정해 일관성을 보장했다." />

<QuizBox question="FallbackFitAnalysisAiService가 시도하는 폴백 순서로 올바른 것은?" :choices="['OpenAI 먼저, 실패 시 자체모델', 'Mock 먼저, 실패 시 OpenAI', '자체모델(OSS) 먼저, 실패 시 OpenAI, 그래도 안되면 Mock', '항상 Mock만 사용']" :answer="2" explanation="@Primary 진입점인 FallbackFitAnalysisAiService는 provider=OSS이고 자체모델이 살아있으면 1차 시도, 실패 시 OpenAI, OpenAI도 키 없거나 실패하면 내부에서 Mock으로 폴백한다." />

<QuizBox question="면접에서 자체 LLM 커리어전략 모델(careertuner-c-career-strategy)에 대해 질문받았다. 정직하고 설득력 있게 답하는 방법을 한 문장으로 설명하라." explanation="적합도·취업경향·대시보드 분석은 OpenAI 기반으로 실제 동작하는 구현 단계이고, 자체 LLM 커리어전략 모델은 Qwen/Gemma 베이스 파인튜닝과 캐시→규칙엔진→OpenAI→Mock 폴백 체인, Ollama 서빙까지 설계해 둔 단계라고 구현과 설계를 명확히 구분해 답한다. 부풀리지 않는 정직함이 오히려 신뢰를 높인다." />
