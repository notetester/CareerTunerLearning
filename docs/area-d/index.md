# 영역 D 개요 — 가상 면접 (AI #19-23)

> 영역 D는 **하나의 지원 건(Application Case)에 대한 모의 면접 전체**를 책임진다. 예상 질문을 만들고, 답변을 받아 채점하고, 꼬리질문으로 파고들고, 세션을 리포트로 닫는다. 설계 정체성은 두 가지로 압축된다 — **"모범답안을 만점 기준으로 삼는 비교 채점"** 과 **"한 모델에 운명을 걸지 않는 폴백 게이트웨이(자체 모델 → Claude Haiku → OpenAI)"**.

[← 영역별 심화 전체 개요](/areas/) · 인접 영역: [영역 C 적합도·전략](/area-c/) · [영역 E 첨삭·결제](/area-e/) · [영역 F 커뮤니티·챗봇](/area-f/)

---

## 1. 영역 D의 정체성 — 한 문장으로

영역 D는 지원 건 하나에 종속된 **면접 세션**을 만들고, 그 아래로 질문을 달고, 질문 아래로 답변을 달아 **채점·리포트**까지 끊김 없이 이어가는 영역이다. 핵심 단위는 공고가 아니라 지원 건이므로, 면접 기록도 `interview_session.application_case_id`로 지원 건에 묶여 함께 관리된다.

다른 영역과 결정적으로 다른 점: **면접 평가는 "한 번 점수 물어보기"가 아니다.** 답변을 제출하면 모범답안을 만점(100점) 기준으로 놓고, 채점 → 적대적 검증 → 필요 시 재채점을 도는 멀티에이전트 루프가 점수와 피드백을 만든다. 또한 영역 D는 프로젝트 전체에서 **자체 LLM(Qwen 계열 LoRA) 연구가 가장 활발한** 영역인데, 답변마다 학습 데이터가 1건씩 쌓이는 채점 task의 특성 때문이다.

:::tip 이 페이지가 답하는 면접 질문
"영역 D가 정확히 뭘 하나요?" / "면접 데이터를 어떻게 모델링했나요?" / "답변 채점을 그냥 GPT에 점수 물어본 건가요?" / "LLM이 죽으면 면접이 멈추나요?" / "자체 모델은 정말 돌고 있나요, 계획인가요?"
이 개요만 막힘없이 말할 수 있으면, 하위 페이지는 디테일을 채우는 역할이다.
:::

---

## 2. 6개 영역 속에서 D의 위치

CareerTuner는 6명이 한 지원 건을 수직 분담으로 함께 채운다. 아래 표에서 D의 위치와 데이터 흐름을 본다.

| 영역 | 책임 | AI 번호 | D와의 관계 |
| --- | --- | --- | --- |
| A | 회원·프로필·인증 | #1~5 | A `user_profile` 스냅샷 → D 질문 생성 입력(읽기전용) |
| B | 지원건·공고·기업분석 | #6~11 | B `job_analysis`·면접 포인트(#11) → D 질문 생성 입력(읽기전용) |
| C | 적합도·전략·대시보드 | #12~18 | C 적합도(#12) → D 질문 입력 / D 평가(#22) → C 장기경향(#16) 순환 |
| **D** | **가상 면접·리포트** | **#19~23** | **A·B·C 결과가 여기서 합류, 결과는 C·E로** |
| E | 첨삭·결제·크레딧 | #24~28 | D 답변·평가(#22) → E 면접답변 첨삭(#24) 진입 |
| F | 커뮤니티·고객센터·챗봇 | #29~34 | F 실제 면접질문(#31) → D 질문 풀로 순환 환류 |

### 데이터는 어디서 와서 어디로 가나

```text
[읽기전용 참조 입력]
 A user_profile 스냅샷 ─┐
 B job_analysis/#11    ─┼──▶ [D #19 예상질문] ─▶ 세션 ─▶ #20 꼬리질문
 C fit_analysis(#12)   ─┘                        ├─▶ #21 면접관 진행
                                                 └─▶ #22 답변평가 ─┬─▶ #23 리포트
                                                                   ├─▶ E #24 첨삭
                                                                   └─▶ C #16 장기경향(순환)
```

핵심 두 가지. **(1)** D는 A·B·C 세 영역의 산출물이 합류하는 지점이다 — 질문은 프로필 스냅샷·공고 분석·적합도를 한꺼번에 입력으로 받는다. **(2)** D의 답변평가(#22)는 **출력이 세 갈래로 갈라지는 분기점**이다(리포트 #23 / E 첨삭 #24 / C 장기경향 #16). 데이터 소유권 원칙대로, D는 자기 결과(`interview_*`)를 소유하고 타 영역 원본은 **읽기전용으로 참조하며 절대 수정하지 않는다.**

전체 그림은 [전체 흐름](/flow/)과 [AI #1-34 맵](/flow/ai-function-map)에서, 소유권 규칙은 [데이터 소유권](/flow/data-ownership)에서 본다.

---

## 3. 담당 AI 기능 — #19 ~ #23

영역 D가 소유한 AI 기능은 5개다. 모두 단일 면접 세션 위에서 동작하며, LLM 호출은 전부 하나의 폴백 게이트웨이를 거친다.

| # | 기능 | 한 줄 설명 | 주요 산출물 |
| --- | --- | --- | --- |
| 19 | 예상 질문 생성 | 회사·직무·공고 + 모드로 6개 안팎 질문 생성, 커밋 후 모범답안까지 백그라운드 일괄 생성 | `interview_question`, `model_answer` |
| 20 | 꼬리 질문 생성 | 제출된 답변의 약점·근거 부족을 파고드는 동적 후속 질문(압박 면접 특화) | `interview_question`(self-FK) |
| 21 | 면접관 대화 진행 | "다음 질문 / 재질문 / 종료"를 서버 상태에서 매번 재계산(텍스트·실시간 음성 2갈래) | 진행 상태(무상태 재계산) |
| 22 | 답변 평가 | 모범답안을 만점 기준으로, 멀티에이전트 루프(채점→검증→재채점)로 0~100점 | `interview_answer` 점수, `interview_agent_step` trace |
| 23 | 면접 리포트 | 세션 전체 Q&A를 묶어 총점·항목별 점수·종합 피드백, 세션을 닫음 | `interview_session.report`, `total_score` |

세부: [예상 질문 생성](/area-d/question-generation) · [꼬리 질문](/area-d/followup-questions) · [면접관 진행](/area-d/interviewer-flow) · [답변 평가](/area-d/answer-evaluation) · [면접 리포트](/area-d/interview-report)

---

## 4. 설계 정체성 두 가지

영역 D가 "데모용 장난감"이 아닌 이유는 다음 두 축으로 요약된다.

### 4.1 모범답안 기준 비교 채점 — 점수가 흔들리지 않게

LLM에 "이 답변 채점해"만 던지면 모델이 매번 머릿속 기준을 새로 만들어 같은 답변에도 점수가 출렁인다. 그래서 D는 #19에서 질문을 만들 때 **모범답안(model_answer)을 함께 생성**해 질문에 1개만 고정하고, 이를 채점의 만점 기준으로 재사용한다. 모범답안은 곧 **화면 표시 = 만점 기준 = 블라인드 복습 채점 기준**을 단 하나로 일치시키는 장치라, 응답 DTO에서는 의도적으로 가린다(블라인드).

채점은 단일 호출이 아니라 `InterviewAgentOrchestrator`의 **멀티에이전트 자율 루프**(채점 → 적대적 검증 → 필요 시 재채점)로 돌고, 모든 판단 단계는 `interview_agent_step`에 trace로 남아 사후 감사가 가능하다.

### 4.2 폴백 게이트웨이 — 한 모델에 운명을 걸지 않는다

면접 도메인의 모든 구조화 LLM 호출은 단 하나의 `@Primary` 디스패처 `FallbackInterviewLlmGateway`를 거친다. 호출부(`InterviewOpenAiClient`)는 추상 타입 `InterviewLlmGateway`만 주입받아 `gateway.complete(...)` 한 줄로 호출하므로, **provider를 바꿔도 호출부 코드는 한 줄도 변하지 않는다**(Strategy + Chain of Responsibility).

| 단계 | provider | 역할 |
| --- | --- | --- |
| 자체 모델 | OSS(Ollama/vLLM, Qwen LoRA) | 학습한 task부터 점진 교체 — 현재 생성 화이트리스트 비어 있음 |
| 1차 폴백 | Claude Haiku(`claude-haiku-4-5`) | 한국어 구조화 출력 양호, 자체 모델로 가는 "디딤돌"(선생 + 과도기 런타임) |
| 2차 폴백 | OpenAI(`gpt-5`, Responses API) | 최종 폴백, `json_schema strict` |

장기 목표는 **자체 파인튜닝 모델로의 점진 교체**다. 자체 모델이 한 task씩 안정화되면 화이트리스트(`OSS_GENERATION_TASKS`)에 추가해 Claude를 그 task에서 은퇴시킨다.

자세히: [면접 폴백 게이트웨이](/area-d/fallback-gateway) · [자체 LLM 파인튜닝](/area-d/self-llm-finetune)

---

## 5. 구현 상태 — 정직하게

면접에서 과장은 가장 위험하다. D의 상태는 다음과 같이 정직하게 구분한다.

| 구현 완료 (현재 동작) | 골격 완성·기본값 off / 키 발급 후 |
| --- | --- |
| 4테이블 세션 모델, 질문·꼬리질문·모범답안 생성·저장 | 자체 LoRA 모델 학습·서빙(파이프라인 완성, 운영 기본값은 OpenAI) |
| 멀티에이전트 답변 평가·trace, 리포트·총점·캐시 | 생성 task 자체모델 화이트리스트 = **빈 집합**(현재 Claude→OpenAI 폴백) |
| 폴백 게이트웨이 배선(자체→Claude→OpenAI) | RAG 근거 주입 — 코드 완비, `enabled=false` 기본 off |
| AutoPrep 오케스트레이터 SSE, 프론트 단일 페이지+탭 | OpenAI/Anthropic 실 키 연동 활성화 |

:::warning 정직한 한 줄
"자체 모델을 학습해 면접 평가에 붙이는 **파이프라인 전체**(데이터 적재 → JSONL → LoRA → 서빙 → 폴백 연결점)는 구현돼 있다. 다만 **운영 기본값은 OpenAI**이고, 생성 task는 자체모델 화이트리스트가 비어 사실상 Claude→OpenAI로 폴백된다. 목적은 '성능 1등'이 아니라 '직접 학습해 서비스에 붙였다는 증거 확보'다."
:::

---

## 6. 권장 학습 순서

하위 페이지를 아래 묶음 순서로 읽으면 "데이터 → 생성 → 채점 → 신뢰성 장치 → 시스템·화면" 으로 자연스럽게 깊어진다.

**1단계 — 데이터 골격**
1. [면접 세션 데이터 모델](/area-d/session-model) — session→question→answer + file_asset, 꼬리질문 self-FK, 모범답안 블라인드

**2단계 — 질문·진행 생성**
2. [예상 질문 생성 #19](/area-d/question-generation) — 모드별 질문 + 모범답안 백그라운드 일괄 생성
3. [꼬리 질문 #20](/area-d/followup-questions) — 답변 약점 파고들기, 압박 면접 특화
4. [면접관 대화 진행 #21](/area-d/interviewer-flow) — 서버 상태 무상태 재계산, 답변 비수정

**3단계 — 채점·리포트**
5. [답변 평가 #22](/area-d/answer-evaluation) — 모범답안 기준 멀티에이전트 채점·검증·trace
6. [면접 리포트 #23](/area-d/interview-report) — 세션 종합 평가, 세션 종료

**4단계 — 신뢰성·인프라 장치**
7. [면접 폴백 게이트웨이](/area-d/fallback-gateway) — 자체→Claude→OpenAI, provider 무관 호출부
8. [자체 LLM 파인튜닝](/area-d/self-llm-finetune) — Qwen LoRA, 데이터 선순환, 점진 교체
9. [면접 RAG·근거 주입](/area-d/rag-grounding) — Qdrant 벡터 검색, 기본 off, best-effort
10. [음성·영상 미디어 처리](/area-d/media-handling) — 원본 미저장, 점수·트랜스크립트만

**5단계 — 시스템 연결·화면**
11. [SSE 실시간 면접 진행](/area-d/sse-streaming) — SseEmitter + CompletableFuture, 폴링·WebSocket 대비
12. [오케스트레이터 INTERVIEW 파트](/area-d/orchestrator-interview) — 얇은 어댑터, JOB 완료 후 출발
13. [D 프론트엔드 UI/UX](/area-d/frontend-ui) — 단일 InterviewPage + 8탭, API 계약
14. [면접 플레이북](/area-d/interview-playbook) — 종합 답변 대본

연관: [AI 오케스트레이터](/flow/ai-orchestrator) · [AI 공급자·폴백](/flow/ai-providers-fallback) · [전체 프로젝트 면접](/flow/interview-whole-project)

---

## 7. D 면접 단골질문 5개 (요약 답안)

:::details Q1. "면접 데이터를 어떻게 모델링했나요?"
지원 건에 종속된 `interview_session`을 뿌리로, 그 아래 `interview_question`(본질문·꼬리질문이 self-FK로 한 테이블), `interview_answer`(질문당 여러 답변·채점 결과), 채점 trace `interview_agent_step`, 업로드 메타 `file_asset`까지 4~5개 테이블의 관계입니다. 영속성은 MyBatis만 씁니다.
:::

:::details Q2. "답변 채점, 그냥 GPT에 점수 물어본 건가요?"
아니요. 질문 생성 시 만든 **모범답안을 만점(100점) 기준**으로 고정하고, `InterviewAgentOrchestrator`가 채점 → 적대적 검증 → 필요 시 재채점을 도는 멀티에이전트 루프로 0~100점을 냅니다. 모든 단계는 `interview_agent_step`에 trace로 남아 사후 감사가 됩니다.
:::

:::details Q3. "LLM이 죽거나 한도가 차면 면접이 멈추나요?"
아니요. 면접의 모든 구조화 호출은 `FallbackInterviewLlmGateway` 하나를 거쳐 자체 모델 → Claude Haiku → OpenAI 순으로 자동 폴백합니다. 호출부는 어느 provider가 응답했는지 모르고, 한 곳만 갈아끼우면 전 호출의 provider가 바뀝니다.
:::

:::details Q4. "자체 LLM은 실제로 돌고 있나요, 계획인가요?"
파이프라인 전체(데이터 적재 → JSONL → LoRA 학습 → vLLM/Ollama 서빙 → 폴백 연결)는 구현돼 있고, 운영 기본값은 OpenAI입니다. 생성 task는 자체모델 화이트리스트가 빈 집합이라 사실상 Claude→OpenAI로 폴백됩니다. 목적은 최고 성능이 아니라 "직접 학습해 붙였다는 증거 확보"입니다.
:::

:::details Q5. "오케스트레이터에서 면접은 어떻게 한 단계가 되나요?"
`InterviewPrepHandler`라는 얇은 어댑터가 기존 `InterviewService.createSession` + `generateQuestions`를 그대로 위임 호출합니다(면접 로직 중복 없음). 질문이 공고 원문을 입력으로 쓰므로 의존 순서를 코드 상수로 못 박아 **JOB(B) 완료 후** 출발합니다.
:::

---

## 8. 직접 말해보기

아래를 보지 않고 60초 안에 말할 수 있으면 D 개요는 통과다.

- D가 답하는 흐름(세션 → 질문 → 답변·채점 → 리포트)과 핵심 단위가 지원 건이라는 점
- 6영역 속 D의 위치 — **A·B·C 입력 합류**, 평가(#22) 출력이 **리포트·E·C 세 갈래**로 분기
- 담당 AI 5개(#19~23) 이름과 각 한 줄
- 설계 두 축 — **모범답안 기준 비교 채점**, **자체→Claude→OpenAI 폴백 게이트웨이**
- 구현 **완료 vs 골격 완성·기본 off** 경계(자체 모델·RAG)

---

## 퀴즈

<QuizBox question="영역 D의 답변 평가(#22)에서 채점의 '만점(100점) 기준' 역할을 하는 것은?" :choices="['LLM이 채점할 때마다 새로 만드는 루브릭', '질문 생성 시 함께 만들어 질문에 고정한 모범답안(model_answer)', '사용자가 직접 입력한 기대 답변', '관리자가 운영 메모로 지정한 점수표']" :answer="1" explanation="#19에서 질문과 함께 생성한 모범답안을 질문에 1개만 고정하고, 이를 만점 기준으로 비교 채점한다. 화면 표시·만점 기준·블라인드 복습 채점 기준을 단 하나로 일치시키는 장치다." />

<QuizBox question="면접 도메인의 LLM 폴백 게이트웨이가 provider를 시도하는 순서로 옳은 것은?" :choices="['OpenAI → Claude Haiku → 자체 모델', '자체 모델 → Claude Haiku → OpenAI', 'Claude Haiku → 자체 모델 → OpenAI', '자체 모델만 사용하고 폴백 없음']" :answer="1" explanation="FallbackInterviewLlmGateway(@Primary)가 자체 모델(현재 생성 화이트리스트는 비어 있음) → Claude Haiku(1차) → OpenAI(2차) 순으로 폴백한다. 호출부는 어느 provider가 응답했는지 모른다." />

<QuizBox question="6영역 데이터 흐름에서 D의 답변 평가(#22) 출력이 갈라지는 세 갈래로 옳은 것은?" :choices="['A 프로필 / B 공고분석 / F 커뮤니티', '리포트(#23) / E 면접답변 첨삭(#24) / C 장기경향(#16)', '리포트(#23)만 단일 출력', 'C 적합도(#12) / E 결제 / F 챗봇']" :answer="1" explanation="#22는 분기점이다. 같은 세션 안의 리포트(#23)로, E의 면접답변 첨삭(#24)으로, 그리고 C의 장기경향(#16)으로 순환 환류한다." />

<QuizBox question="자체 LLM 파인튜닝의 현재 운영 상태를 가장 정확히 설명한 것은?" :choices="['학습·서빙이 완료되어 모든 면접 task가 자체 모델로 동작한다', '파이프라인은 구현됐으나 운영 기본값은 OpenAI이고 생성 task 화이트리스트는 비어 있다', '자체 모델 코드가 전혀 없고 계획만 있다', 'Claude를 자체 모델로 영구 대체했다']" :answer="1" explanation="데이터 적재→JSONL→LoRA→서빙→폴백 연결까지 골격은 완성됐지만 운영 기본값은 OpenAI다. 생성 task는 OSS_GENERATION_TASKS가 빈 집합이라 사실상 Claude→OpenAI로 폴백된다. 목적은 성능 1등이 아니라 직접 학습해 붙였다는 증거 확보다." />
