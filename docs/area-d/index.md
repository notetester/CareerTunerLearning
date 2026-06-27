# 영역 D 심화 개요 — 가상 면접

> 영역 D는 **지원 건(Application Case) 하나에 대한 모의 면접의 전체 흐름**을 책임진다. 세션 생성 → 예상 질문 → 답변 평가 → 리포트 → 다음 연습까지가 하나의 끊김 없는 사이클이다. 이 영역의 설계 정체성은 두 가지로 요약된다: **2-축 LLM 추상화**(생성 vs 채점을 의도적으로 분리), 그리고 **자체 LLM(OSS)으로의 점진 교체**가 가장 활발히 진행되는 실험장이라는 점.

---

## 1. 영역 D의 정체성 — 한 문장으로

영역 D는 **공고가 아니라 "지원 건"을 단위로** 모의 면접 한 라운드를 끝까지 돌리는 영역이다. 모든 세션은 `interview_session.application_case_id`로 지원 건에 종속되며, FK는 `ON DELETE CASCADE`라 지원 건이 사라지면 면접 기록도 함께 정리된다.

:::tip 이 페이지가 답하는 면접 질문
"영역 D가 정확히 뭘 하나요?" / "면접 전체 흐름을 한 번 설명해 주세요." / "왜 LLM 경로를 둘로 나눴나요?" / "자체 모델은 실제로 돌아가나요?"
이 개요만 막힘없이 말할 수 있으면, 세부 페이지는 디테일을 채우는 역할이다.
:::

### 면접 한 사이클 — 5단계 흐름

| 단계 | 무엇을 | 핵심 클래스 | AI 기능 |
| --- | --- | --- | --- |
| ① 세션 생성 | 지원 건 + 모드 선택 → 세션 row | `InterviewServiceImpl.createSession` | — |
| ② 예상 질문 | 공고 기반 본질문 생성(+ 모범답안 백그라운드) | `generateQuestions` / `generateFollowUps` | #19, #20 |
| ③ 면접 진행 | 텍스트 진행 / 음성(Realtime) / 아바타(HeyGen) | `getProgress` / `InterviewRealtimeService` / `InterviewAvatarService` | #21 |
| ④ 답변 평가 | 멀티에이전트 채점 루프 | `InterviewAgentOrchestrator.evaluateAnswer` | #22 |
| ⑤ 리포트 | 총점·카테고리·피드백, 세션 종료 | `getReport` | #23 |

핵심: **별도 "면접 종료" API가 없다.** 리포트 생성(`getReport`)이 `interview_session.ended_at`을 세팅하면서 세션을 닫는다. "리포트 = 세션 종료"라는 단순화가 의도적 설계다.

---

## 2. 담당 AI 기능 — #19 ~ #23

영역 D가 소유한 AI 기능은 5개다. 모든 LLM 호출은 성공 시 `ai_usage_log`(공통)에 `feature_type`/`status`/`model`/`token_usage`/`credit_used`로 기록되고, 점수는 항상 `clampScore`로 0~100 범위에 갇힌다.

| # | 기능 | 엔트리(POST/GET) | 모델 티어 | 한 줄 |
| --- | --- | --- | --- | --- |
| 19 | 예상 질문 생성 | `POST .../sessions/{id}/generate-questions` | 생성 | 공고 기반 본질문 + 모범답안 백그라운드 일괄 생성 |
| 20 | 꼬리 질문 생성 | `POST .../questions/{id}/follow-ups` | 생성 | **압박 모드 전용** 반박 1개 |
| 21 | 면접관 진행 | `GET .../report`(진행) / `POST .../realtime`·`/avatar-token` | 혼합 | 텍스트 진행기 + 음성(Realtime) + 아바타(HeyGen) |
| 22 | 답변 평가 | `POST .../questions/{id}/answers` | 채점 | 멀티에이전트 자율 루프(채점·Critic·재평가) |
| 23 | 면접 리포트 | `GET .../sessions/{id}/report` | 생성 | 총점·카테고리·종합 피드백, 캐시 우선 |

### 두 가지 깊은 설계 포인트(개요에서 꼭 알 것)

1. **모범답안 = 만점 기준 = 표시 = 블라인드 복습 채점, 하나로 고정.** 질문 생성 직후 트랜잭션 커밋 이후(`afterCommit`) 백그라운드 스레드가 6개 모범답안을 일괄 생성한다. 이 모범답안이 채점 시 "만점(100점) 기준 답안지"로 재사용된다. 동시 생성 경쟁은 `first-writer-wins`(XML 조건부 UPDATE: `model_answer IS NULL OR ''`일 때만)로 단 하나만 살아남게 한다.

2. **꼬리질문은 압박 모드 전용.** 다른 모드에서 `generateFollowUps`를 호출하면 `INVALID_INPUT` 예외다. 이유는 코드 주석에 명시돼 있다 — "다른 모드는 본질문 6개로 끝낸다(자체 LLM PROBE 태스크를 압박에 집중)." 문서의 일반적 설명보다 의도적으로 좁다.

---

## 3. 다른 영역의 산출물을 어떻게 받나 (B / C / A 입력)

D는 다른 영역의 산출물을 **읽기전용으로만** 참조하고 원본을 절대 수정하지 않는다. 진입점은 `ApplicationCaseAccessService`다.

```text
requireOwned(caseId, userId)   // 소유 검증 (남의 지원 건 차단)
sourceText(caseId)             // 공고 원문 텍스트 (읽기전용)
```

| 영역 | 산출물(이론) | 실제로 질문 프롬프트에 들어가나? |
| --- | --- | --- |
| **B** 공고/기업 분석 | 공고 원문, 회사명·직무명 | ✅ 들어감 (`sourceText`) |
| **C** 적합도 분석 | 적합도 점수·부족역량 | ❌ 아직 미연결 |
| **A** 프로필 스냅샷 | 보유 역량·경험 | ❌ 아직 미연결 |

:::warning ★구현 vs 계획 갭 (정직하게)
설계 문서(`TEAM_WORK_DISTRIBUTION.md`)는 질문 생성 입력으로 "C의 적합도 + A의 프로필"을 약속한다. 그러나 실제 코드(`InterviewOpenAiClient.generateQuestions`)는 **회사명·직무명·면접 모드·공고 원문(B)만** 프롬프트에 주입한다. C/A 직접 주입은 **미연결 = 부분 구현**이다. 면접에서는 "현재는 B만 들어가고, C·A 연결은 로드맵"이라고 정확히 말하는 게 맞다.
:::

반대 방향 경계도 있다: **C는 면접 점수를 장기 경향 분석에 "참조만"** 한다. 면접이 적합도 점수를 건드리지 않듯, 적합도도 면접 점수를 다시 쓰지 않는다. 영역 간 데이터는 단방향 읽기다.

---

## 4. 영역의 설계 정체성 — 2-축 추상화

D를 이해하는 가장 빠른 길은 "LLM을 어떻게 두 갈래로 나눴나"를 이해하는 것이다.

```text
                     ┌─ 자체모델(OSS) ─ 학습된 생성 task만
[전송축] InterviewLlmGateway (생성) ─┼─ Claude(Haiku) ─ 1차 폴백
                     └─ OpenAI ─ 최종 폴백

[평가축] InterviewAnswerEvaluator (채점) ─┬─ OpenAI (기본)
                       └─ OssAnswerEvaluator (자체모델)
```

- **전송축** `InterviewLlmGateway`: 질문·꼬리·모범답안·리포트 **생성**. `FallbackInterviewLlmGateway`가 자체 → Claude → OpenAI 순으로 폴백 체인(Chain of Responsibility)을 돈다.
- **평가축** `InterviewAnswerEvaluator`: 답변 **채점·Critic**. `InterviewEvaluatorProvider`가 OpenAI vs 자체모델을 런타임 토글로 분기한다.

두 축은 **의도적으로 분리**된다. `FallbackInterviewLlmGateway` 주석에 직접 적혀 있다: "채점(EVAL)·Critic은 이 게이트웨이가 아니라 `InterviewEvaluatorProvider`가 `OssAnswerEvaluator`로 분기하므로 화이트리스트에 넣지 않는다(이중 경로 방지)." 이유는 **생성과 채점의 폴백 정책·모델 티어·과금·자체모델 교체 진척이 모두 다르기** 때문이다. 한 게이트웨이에 섞으면 채점 폴백이 의도치 않게 달라진다.

### 자체 LLM은 실제로 돌아가나? (정직 구분)

```java
private static final Set<String> OSS_GENERATION_TASKS = Set.of(); // 빈 집합
```

- 생성 task의 자체모델 화이트리스트는 **빈 집합**이다. 즉 **질문/꼬리/모범답안/리포트 생성은 현재 사실상 Claude → OpenAI 폴백으로만 동작**한다.
- 이유는 코드 주석에 명시: QGEN(질문 생성)은 학습 데이터가 seed당 1개로 적어 형식이 불안정(질문 대신 프로필/환각을 뱉음). 채점(EVAL)은 데이터가 많아 안정적이라 평가축에서 따로 처리한다.
- 전략: Claude는 "자체모델로 갈아끼우기 위한 **디딤돌(선생 + 과도기 런타임)**". 학습이 충분한 task부터 화이트리스트에 추가해 점진 교체하고, 전 task가 덮이면 Claude 게이트웨이를 폐기한다.

이 "Claude Haiku 폴백이 실재하는 곳"은 사실상 **면접(D) 도메인뿐**이다(다른 영역은 OpenAI 직행).

---

## 5. 다른 영역과의 경계 — 무엇이 D이고 무엇이 아닌가

| D가 소유 | D가 아님(읽기전용/타 영역) |
| --- | --- |
| `interview/**`, `admin/interview`, `file` 미디어 메타 | `application_case` 원본(A/B/C가 채움) |
| 세션·질문·답변·리포트·에이전트 trace 테이블 | 적합도 점수(C 소유), 프로필 스냅샷(A 소유) |
| 멀티에이전트 평가 루프·RAG·자체 LLM 학습 파이프라인 | 공통 `schema.sql` 본체·인증/권한·`ApiResponse` envelope(팀장) |
| 음성/아바타 비언어 점수, 자체 STT | 홈 오케스트레이터 SSE 코어(AutoPrep, D는 **핸들러만**) |

:::details 헷갈리기 쉬운 경계 — AutoPrep SSE
홈 화면의 한 줄 입력 → SSE 스트리밍(`plan|part-start|substep|part-done|done`)은 **D 면접 화면이 아니라 AutoPrep 오케스트레이터의 것**이다. D는 그 파이프라인의 ⑤단계 핸들러(`InterviewPrepHandler`: "세션 생성 + 예상 질문 생성")만 제공한다. 면접 자체 화면(8탭)은 **일반 REST**로 동작한다.
:::

---

## 6. 권장 학습 순서

데이터 모델 → 핵심 흐름(생성·평가·리포트) → 폴백/자체 LLM → 미디어·프론트 순으로 읽으면 막힘이 없다.

1. [세션·질문·답변 데이터 모델](/area-d/session-model) — 테이블이 머리에 있어야 나머지가 보인다
2. [예상 질문 생성 (#19)](/area-d/question-generation) — 모범답안 백그라운드·first-writer-wins
3. [꼬리 질문 (#20)](/area-d/followup-questions) — 왜 압박 모드 전용인가
4. [면접관 진행 (#21)](/area-d/interviewer-flow) — 텍스트/음성/아바타 3갈래
5. [답변 평가 (#22)](/area-d/answer-evaluation) — 멀티에이전트 자율 루프(이 영역의 심장)
6. [면접 리포트 (#23)](/area-d/interview-report) — 캐시·이전 점수 비교·세션 종료
7. [폴백 게이트웨이 + 2-축 추상화](/area-d/fallback-gateway) — 영역의 척추
8. [자체 LLM 파인튜닝 파이프라인](/area-d/self-llm-finetune) — 학습 데이터·judge·점진 교체
9. [미디어 처리(음성/아바타/STT)](/area-d/media-handling) — 비언어 점수·프라이버시
10. [프론트엔드 UI(8탭 구조)](/area-d/frontend-ui) — 시간기반 진행바·튜토리얼 모드

배경 지식이 필요하면 [공통 구조화 출력](/ai/openai-structured-output)과 [영역 C 뉴로-심볼릭](/area-c/)을 먼저 읽으면 좋다(C는 "AI에게 점수를 안 맡기는" 반대 철학이라 대비가 명확하다).

---

## 7. 단골 면접 질문 5개

면접관이 영역 D에 대해 가장 자주 묻는 질문과 한 줄 모범 방향.

::: details Q1. 면접 한 사이클 전체 흐름을 설명해 주세요.
세션 생성(지원 건 + 모드) → 예상 질문 생성(+ 모범답안 백그라운드) → 진행(텍스트/음성/아바타) → 멀티에이전트 답변 평가 → 리포트. 리포트 생성이 곧 세션 종료(`ended_at` 세팅)라는 점을 짚으면 좋다.
:::

::: details Q2. LLM 경로를 왜 생성/채점 두 갈래로 나눴나요?
생성과 채점은 폴백 정책·모델 티어(`gpt-5.4-mini` vs `gpt-5.4`)·과금·자체모델 교체 진척이 전부 다르다. 한 게이트웨이에 섞으면 이중 경로가 생겨 채점 폴백이 의도치 않게 달라진다. 그래서 `InterviewLlmGateway`(전송)와 `InterviewEvaluatorProvider`(평가)를 명시적으로 분리했다.
:::

::: details Q3. 자체 모델(OSS)은 실제로 돌아가나요?
정직하게: 생성 task는 `OSS_GENERATION_TASKS`가 빈 집합이라 **현재 비활성**(QGEN 학습 데이터 부족). 질문/리포트 생성은 Claude→OpenAI 폴백으로 동작한다. 채점용 자체 모델(`OssAnswerEvaluator`)은 구현돼 있으나 기본값은 OpenAI다. Claude는 자체모델로 가는 디딤돌이고, 학습이 충분한 task부터 점진 교체하는 로드맵이다.
:::

::: details Q4. 모범답안을 왜 백그라운드로 미리 만들고 채점 기준으로 재사용하나요?
사용자가 보는 모범답안, 채점의 만점 기준, 블라인드 복습의 채점 기준이 어긋나면 신뢰가 깨진다. 그래서 질문 INSERT 직후 `afterCommit` + 백그라운드 스레드로 6개를 일괄 생성하고, `first-writer-wins`(조건부 UPDATE)로 단 하나만 고정해 세 곳이 항상 일치하게 만든다.
:::

::: details Q5. 다른 영역(B/C/A) 데이터를 어떻게 쓰나요?
`ApplicationCaseAccessService`로 소유 검증 후 읽기전용 참조한다. 현재 질문 프롬프트에 실제로 들어가는 건 B(회사·직무·공고 원문)뿐이고, C(적합도)·A(프로필) 직접 주입은 미연결 상태라 솔직히 "로드맵"이라고 말한다. 반대로 C가 면접 점수를 장기 경향에 참조만 하는 단방향 경계도 함께 설명하면 깊이가 산다.
:::

---

## 퀴즈

<QuizBox question="영역 D에서 '면접 종료'를 담당하는 동작은 무엇인가?" :choices="['별도의 POST /sessions/{id}/end API', '리포트 생성(getReport)이 ended_at을 세팅', '세션 생성 시 만료 타이머 설정', '관리자가 수동으로 종료']" :answer="1" explanation="별도 종료 API가 없다. getReport가 updateSessionResult로 ended_at을 세팅하면서 세션을 닫는다 — '리포트 = 세션 종료'가 의도적 단순화다." />

<QuizBox question="OSS_GENERATION_TASKS가 빈 집합인 것이 의미하는 바로 옳은 것은?" :choices="['자체 모델이 모든 생성을 담당한다', '질문·리포트 생성이 현재 Claude→OpenAI 폴백으로만 동작한다', '채점이 비활성화됐다', '폴백 체인이 꺼졌다']" :answer="1" explanation="화이트리스트가 비어 있어 생성 task는 자체 모델로 가지 않고 Claude→OpenAI 폴백으로 동작한다. QGEN 학습 데이터가 seed당 1개로 부족한 것이 명시된 이유다." />

<QuizBox question="현재 코드 기준, 예상 질문 생성 프롬프트에 실제로 주입되는 입력은?" :choices="['회사·직무·모드·공고 원문(B)만', 'C의 적합도 점수까지 포함', 'A의 프로필 스냅샷까지 포함', 'B·C·A 전부']" :answer="0" explanation="문서는 C·A 입력을 약속하지만 InterviewOpenAiClient.generateQuestions는 회사명·직무명·모드·공고 원문(B)만 주입한다. C·A 직접 연결은 부분 구현(로드맵)이다." />
