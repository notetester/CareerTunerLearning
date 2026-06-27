# AI 기능 개요

> CareerTuner의 AI는 "지원 건(Application Case) 하나를 받아 공고·적합도·면접 자료를 한 번에 만들어내는 오케스트레이션 파이프라인"이다. 단일 LLM 호출이 아니라, 도메인별 프롬프트 카탈로그 + structured output + 폴백 체인 + 의존그래프 병렬 실행으로 구성된 시스템이다.

이 페이지는 CareerTuner AI 전반의 지도다. 공통 기반 기술부터 영역별(B 공고추출 / C 적합도·경향·대시보드 / D·E 면접) 기능까지, 구현된 것과 설계 단계인 것을 정직하게 구분해서 안내한다. 세부 페이지로 들어가기 전에 이 한 장을 읽으면 전체 그림이 잡힌다.

## 1. 이 영역은 무엇인가

CareerTuner는 "채용공고에 맞춰 내 스펙·면접 답변을 조정해 주는" 플랫폼이다. 그래서 AI가 단순 챗봇이 아니라 **분석 엔진**으로 박혀 있다. 사용자가 지원 건 하나를 만들면, 백엔드는 그 한 건을 입력으로 받아 여러 AI 분석을 단계적으로 돌린다.

```text
지원 건(Application Case)
   ├─ [B] 공고 분석 (JobAnalysis)        ← 공고 텍스트에서 직무·요건 구조화
   ├─ [C] 적합도 분석 (FitAnalysis)      ← 내 스펙 vs 공고 요건 매칭 점수
   ├─ [C] 취업경향 분석 (CareerTrend)    ← 여러 지원 건을 가로질러 패턴 분석
   ├─ [C] 대시보드 인사이트              ← 전체 현황 요약 한 문단
   └─ [D/E] 가상 면접 (Interview)        ← 공고 기반 질문 생성·답변 평가
```

핵심은 이 분석들이 **서로 의존한다**는 점이다. 적합도(C)와 면접(D)은 공고 분석(B)이 끝나야 시작할 수 있다. 이 의존관계를 조율하는 것이 오케스트레이터다.

## 2. 공통 기반 기술 6가지

영역에 상관없이 모든 AI 기능이 깔고 가는 공통 토대다. 각 항목은 별도 페이지로 깊이 파고들 수 있다.

| 기술 | 한 줄 정의 | 대표 클래스/위치 |
| --- | --- | --- |
| **LLM 호출** | 외부/로컬 대규모 언어모델에 프롬프트를 보내 결과를 받는 통신 계층 | `OpenAiResponsesClient` |
| **프롬프트 카탈로그** | 도메인별 시스템 프롬프트를 클래스 상수로 모아둔 패턴 | `FitAnalysisPromptCatalog` 등 |
| **Structured Output** | LLM이 자유 텍스트가 아닌 정해진 JSON 스키마로만 답하도록 강제 | `OpenAiResponsesClient.structuredRequest` |
| **LangChain4j + Ollama** | 로컬 LLM과 대화 메모리를 붙이는 Java AI 프레임워크 | `ChatMemoryConfig`, `FaqDraftAiClient` |
| **RAG** | 외부 지식을 벡터DB에서 검색해 프롬프트에 끼워넣는 기법 | `QdrantClient`(면접 RAG) |
| **오케스트레이터** | 여러 AI 단계를 의존그래프대로 병렬 실행·진행보고 | `AutoPrepOrchestrator` |

:::tip 면접에서 이 표 하나면 된다
"공통 기반은 LLM 호출 계층, 프롬프트 카탈로그, structured output, LangChain4j+Ollama, RAG, 그리고 이 단계들을 묶는 오케스트레이터입니다." — 6개 키워드만 말해도 전체 구조를 안다는 인상을 준다.
:::

### 2-1. 왜 structured output이 핵심인가

LLM에게 "적합도 점수와 부족 기술을 알려줘"라고 하면 매번 형식이 다른 자유 텍스트가 온다. 백엔드가 이걸 파싱해서 `fit_analysis` 테이블에 넣으려면 형식이 고정돼야 한다. 그래서 `OpenAiResponsesClient`는 **JSON 스키마를 요청에 함께 보내** 모델이 그 스키마로만 답하게 만든다. 파싱 실패·필드 누락이 사라지고, DB 컬럼과 1:1로 매핑된다.

### 2-2. 왜 폴백 체인인가

외부 LLM은 키 미발급·요금·장애·응답 깨짐 같은 이유로 언제든 실패할 수 있다. CareerTuner는 화면이 깨지지 않도록 **다단계 폴백**을 둔다. C 적합도의 진입점 `FallbackFitAnalysisAiService`(@Primary)가 대표 예시다.

```text
자체모델(OSS) → OpenAI → 내부 Mock
   (config가 oss이고          (키 있으면 실제 호출,     (항상 동작하는
    base-url 있을 때만)         없거나 실패하면 폴백)      안전망)
```

기본값은 `provider=openai`라서 자체모델은 명시적으로 켜야 시도된다. 덕분에 "AI가 죽어도 빈 화면이 아니라 최소한의 결과는 나온다."

## 3. 영역별 AI 기능 지도

수직 분담(A~F)에 따라 AI 기능도 담당 영역이 나뉜다. 본인은 **영역 C**다.

| 영역 | 기능 | 상태 | 대표 클래스 / 테이블 |
| --- | --- | --- | --- |
| **B** | 공고 추출 (PDF·HTML→텍스트) | 구현됨 | `JobPostingTextExtractor`, ml `job-posting-worker`(Flask) |
| **B** | 공고 분석 (구조화) | 구현됨 | `OpenAiJobAnalysisService`, `job_analysis` |
| **C** | 적합도 분석 | 구현됨 | `OpenAiFitAnalysisAiService`, `fit_analysis` |
| **C** | 장기 취업경향 분석 | 구현됨 | `CareerAnalysisRunService`, `career_analysis_run` |
| **C** | 대시보드 인사이트 | 구현됨 | `DashboardInsightAiService` |
| **C** | 자체 LLM 커리어전략 모델 | 연구·학습 단계 | ml `career-strategy-llm`, `OssFitAnalysisAiService`(연동부) |
| **D/E** | 가상 면접 질문·답변 평가 | 구현됨 | `InterviewAgentOrchestrator`, `interview_session` |
| **D/E** | 면접 RAG | 구현됨(토글) | `QdrantClient`, `INTERVIEW_RAG_ENABLED` |
| 공통 | AutoPrep 오케스트레이터 | 구현됨 | `AutoPrepOrchestrator` |
| 공통 | AI 사용량·크레딧 | 구현됨 | `ai_usage_log`, `INSUFFICIENT_CREDIT` |

:::warning 구현 vs 설계 단계 — 정직하게 말하기
**자체 LLM 커리어전략 모델**은 백엔드 연동 껍데기(`OssFitAnalysisAiService`, `CareerAnalysisOssClient`)와 ml쪽 학습·평가 파이프라인(`ml/career-strategy-llm`: LoRA 파인튜닝, RAG PoC, 멀티모델 judge 평가 하니스)은 실제로 존재한다. 다만 **운영 기본 경로는 아직 OpenAI**이고, 자체모델은 `provider=oss`로 켜야 시도되는 **연구·학습 단계**다. 면접에서 "이미 자체모델로 서비스 중"이라고 말하면 안 된다. "OpenAI로 운영하면서 자체 SLM으로 대체하는 파인튜닝·평가 파이프라인을 구축 중"이 정확한 표현이다.
:::

## 4. C가 직접 만든 부분 (영역 표시)

본인이 책임진 C 영역의 AI 코드를 한눈에 정리한다. 면접에서 "당신이 한 건 뭐냐"에 대한 답이다.

- **적합도 분석** `fitanalysis/ai/` — `FitAnalysisAiService` 인터페이스, 진입점 `FallbackFitAnalysisAiService`(@Primary, 폴백 디스패처), `OpenAiFitAnalysisAiService`(실제 호출), `MockFitAnalysisAiService`(안전망), 결과 DTO `FitAnalysisAiResult`. 점수·매칭기술·부족기술·추천학습·추천자격증·지원전략을 산출하고 `fit_analysis` 테이블에 저장. **점수와 지원 판정은 LLM 출력을 그대로 믿지 않고 서버 규칙·검증 로직으로 확정**한다.
- **장기 취업경향 분석** `analysis/ai/` — `CareerTrendAiService`/`OpenAiCareerTrendAiService`, 프롬프트 `CareerTrendPromptCatalog`, 결과 `career_analysis_run`. 여러 지원 건을 가로질러 반복 부족역량·지원패턴·다음방향을 뽑는다.
- **대시보드 인사이트** `dashboard/ai/` — `DashboardInsightAiService`, `DashboardInsightPromptCatalog`. 전체 현황을 한 문단으로 요약.
- **자체 LLM 파이프라인** `ml/career-strategy-llm/`(설계·학습 단계) — Qwen/Gemma 베이스 SLM을 LoRA로 파인튜닝하고, RAG·멀티모델 judge로 평가하는 연구 트랙. 백엔드 연동부(`OssFitAnalysisAiService`)는 폴백 체인 1순위 자리만 잡아둔 상태.

## 5. 핵심 동작 원리 — AutoPrep 오케스트레이터

여러 AI 단계를 어떻게 묶는지가 시스템의 심장이다. `AutoPrepOrchestrator`가 그 역할이다.

```text
1. Planner가 PrepPlan 생성: steps = [PROFILE, JOB, FIT, WRITE, INTERVIEW, COMMUNITY]
2. 의존그래프 적용: FIT·INTERVIEW 는 JOB 에 의존
      DEPS = { FIT→[JOB], INTERVIEW→[JOB] }
3. CompletableFuture 로 병렬 실행
      - 독립 파트(PROFILE/JOB/WRITE/COMMUNITY)는 동시 출발
      - FIT·INTERVIEW 는 JOB future 가 끝난 뒤 thenRunAsync
4. 진행 보고
      - run()      → 동기, 결과를 plan 순서로 정렬해 한 번에 반환
      - runStream()→ SSE 로 plan/part-start/substep/part-done/done 실시간 전송
5. 견고성: 핸들러 미구현/비활성 → SKIPPED, 예외 → FAILED 로 기록하고 끝까지 완주
```

핵심 설계 포인트 3가지:

| 포인트 | 무엇 | 왜 |
| --- | --- | --- |
| 의존그래프 병렬 | 독립 단계는 동시, 의존 단계만 대기 | 전체 응답 시간 단축 |
| SSE 진행보고 | 단계별 진행을 실시간 푸시 | AI는 느리니까 사용자가 멈춘 줄 알면 안 됨 |
| 부분 실패 허용 | 한 단계 실패가 전체를 안 죽임 | 6개 중 1개 실패해도 나머지 5개는 보여준다 |

## 6. 권장 학습 순서

아래 순서로 세부 페이지를 읽으면 막힘없이 이어진다. (일부 페이지는 작성 예정일 수 있다.)

1. [LLM이란](/ai/llm-and-prompt) — 대규모 언어모델 기본 개념부터
2. [프롬프트 엔지니어링](/ai/llm-and-prompt) — 시스템 프롬프트와 카탈로그 패턴
3. [Structured Output](/ai/openai-structured-output) — JSON 스키마 강제와 파싱 안정성
4. [폴백 체인 / Fallback](/ai/fallback) — OSS→OpenAI→Mock 다단계 안전망
5. [LangChain4j와 Ollama](/ai/langchain4j-ollama) — 로컬 LLM·대화 메모리
6. [RAG](/ai/rag-qdrant) — 벡터DB(Qdrant) 검색 증강 생성
7. [AutoPrep 오케스트레이터](/ai/orchestrator-autoprep) — 의존그래프 병렬 실행·SSE
8. [적합도 분석 (C)](/ai/fit-analysis) — 본인 핵심 기능 심화

관련 기반 지식: [DTO](/glossary/dto), [ApiResponse 엔벨로프](/glossary/api-response-envelope), [SSE](/glossary/sse), [JWT 보안](/backend/jwt-security)

## 7. 이 영역 단골 면접질문 5개

1. **"AI 응답이 깨지거나 LLM이 죽으면 어떻게 처리하나요?"**
   다단계 폴백 체인으로 대응합니다. `FallbackFitAnalysisAiService`가 자체모델→OpenAI→Mock 순으로 디스패치하고, structured output으로 JSON 형식을 강제해 파싱 실패를 줄입니다. 한 단계가 실패해도 다음 단계가 받습니다.

2. **"LLM이 매번 다른 형식으로 답하는 문제는 어떻게 풀었나요?"**
   `OpenAiResponsesClient`에서 요청에 JSON 스키마를 함께 보내 structured output으로 받습니다. 그 결과를 DB 테이블(`fit_analysis` 등) 컬럼과 1:1로 매핑합니다.

3. **"여러 AI 분석을 어떻게 조율하나요? 순서가 있나요?"**
   `AutoPrepOrchestrator`가 의존그래프(FIT·INTERVIEW는 JOB에 의존)를 보고 `CompletableFuture`로 병렬 실행합니다. 독립 단계는 동시에, 의존 단계만 선행 단계 완료 후 시작하고, 진행은 SSE로 실시간 보고합니다.

4. **"LLM 점수를 그대로 믿어도 되나요?"**
   안 됩니다. 적합도 점수와 지원 판정은 LLM 출력을 입력값으로만 쓰고, 최종값은 서버 규칙·검증 로직으로 확정합니다. LLM은 보조이고 결정권은 서버에 둡니다.

5. **"자체 LLM도 쓰나요?"**
   운영 기본은 OpenAI이고, 자체 SLM(Qwen/Gemma 베이스, LoRA 파인튜닝)으로 대체하는 파이프라인을 `ml/career-strategy-llm`에서 학습·평가 단계로 구축 중입니다. 백엔드 폴백 체인에 연동 자리(`OssFitAnalysisAiService`)를 미리 잡아뒀습니다.

## 8. 직접 말해보기

:::details 훈련 질문 1 — 30초 엘리베이터 피치
"CareerTuner의 AI 시스템을 30초로 설명해 보라." 다음 뼈대로 소리 내어 말해보자: ① 지원 건 하나가 입력 → ② 공고·적합도·면접 분석이 단계적으로 → ③ 의존그래프 병렬 오케스트레이션 + structured output + 폴백 체인 → ④ "내가 담당한 건 C 영역의 적합도·경향·대시보드 분석".
:::

:::details 훈련 질문 2 — 견고성 설계
"AI가 불안정한데 어떻게 사용자 경험을 지켰나?" structured output(형식 보장) + 폴백 체인(가용성 보장) + 부분 실패 허용(SKIPPED/FAILED로 완주) + SSE 진행보고(느려도 멈춘 게 아님을 표시), 이 4가지를 한 흐름으로 묶어 말해보자.
:::

## 퀴즈

<QuizBox question="CareerTuner AI에서 structured output(구조화 출력)을 쓰는 가장 큰 이유는?" :choices="['LLM 호출 비용을 줄이려고', 'LLM 응답을 고정 JSON 스키마로 받아 DB 컬럼과 안정적으로 매핑하려고', '응답 속도를 높이려고', '여러 LLM을 동시에 호출하려고']" :answer="1" explanation="OpenAiResponsesClient는 요청에 JSON 스키마를 함께 보내 모델이 그 형식으로만 답하게 강제합니다. 그래야 파싱 실패·필드 누락 없이 fit_analysis 같은 테이블 컬럼과 1:1로 매핑됩니다." />

<QuizBox question="AutoPrepOrchestrator에서 FIT(적합도)와 INTERVIEW(면접) 단계가 JOB(공고 분석) 단계 뒤에 실행되는 이유는?" :choices="['알파벳 순서라서', '적합도·면접 분석이 공고 분석 결과를 입력으로 필요로 하는 의존관계라서', '비용을 아끼려고 순차 실행해서', 'SSE 전송 순서를 맞추려고']" :answer="1" explanation="DEPS 맵에 FIT→[JOB], INTERVIEW→[JOB]로 의존이 정의돼 있습니다. 독립 단계는 CompletableFuture로 동시 출발하지만, FIT·INTERVIEW는 JOB의 future가 끝난 뒤 thenRunAsync로 시작합니다." />

<QuizBox question="면접관이 '자체 LLM으로 이미 서비스 중인가요?'라고 물으면 정직하게 어떻게 답해야 하나? 모범답안을 말해보라." explanation="운영 기본 경로는 OpenAI이고, 자체 SLM(Qwen/Gemma 베이스를 LoRA로 파인튜닝)으로 대체하는 학습·평가 파이프라인을 ml/career-strategy-llm에서 연구·구축 중이라고 답합니다. 백엔드 폴백 체인(FallbackFitAnalysisAiService)에는 OssFitAnalysisAiService로 연동 자리만 미리 잡아둔 상태이며, provider=oss로 명시 설정해야 자체모델이 시도된다고 구현 단계를 정확히 구분해 설명합니다." />
