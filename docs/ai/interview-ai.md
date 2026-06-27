# 가상 면접 AI [영역 D/E]

> CareerTuner의 가상 면접은 "LLM 한 번 호출해서 점수 내기"가 아니라, RAG로 근거를 모으고(Retrieve) → 채점하고(Evaluate) → 적대적으로 검증하고(Critic) → 필요하면 재채점(Reevaluate)하는 **자율 에이전트 루프**다. 화상 면접은 영상을 서버로 보내지 않고 브라우저(MediaPipe)에서 표정·시선·자세를 분석하고, 아바타 면접관은 HeyGen LiveAvatar로 말한다.

::: tip 이 페이지의 위치
이 기능은 영역 D(가상 면접)·E(미디어/아바타) 담당이고, 나는 영역 C(적합도·경향 분석) 담당이다. 그래서 이 페이지는 "내가 짠 코드"가 아니라 **조원 작업을 이해해서 면접에서 설명할 수 있게** 정리한 것이다. 아키텍처 패턴(에이전트 루프, RAG, 온디바이스 분석)이 핵심이고, 영역 C와 공유하는 공통 토대(`ApiResponse`, `ai_usage_log`, 프롬프트 카탈로그 패턴)도 같이 본다.
:::

## 1. 한 줄 정의

가상 면접 AI는 **지원 건(Application Case) 기반으로 예상 질문을 생성하고, 사용자의 텍스트·음성·영상 답변을 다단계 에이전트 루프로 채점·검증해서 종합 면접 리포트를 만들어 주는** 모의면접 시스템이다.

## 2. 단어 뜻 (약자/어원 풀이)

| 용어 | 풀이 |
| --- | --- |
| Agent(에이전트) | LLM이 다음에 무엇을 할지 스스로 정해 여러 단계를 도는 구조. 여기서는 채점 흐름의 각 단계(Retrieve/Evaluate/Critic…)가 액션 |
| Orchestrator | 여러 단계(액션)를 정해진 정책에 따라 순서대로 돌리고 결과를 합치는 지휘자 |
| RAG | Retrieval-Augmented Generation. 외부 지식을 **검색해서** 프롬프트에 넣어 LLM 답을 근거 있게 만드는 기법 |
| Critic | 채점 결과를 다시 **적대적으로 검증**하는 별도 단계. LLM-as-a-judge의 한 변형 |
| Embedding | 텍스트를 의미가 담긴 숫자 벡터로 바꾼 것. 벡터끼리 가까우면 의미가 비슷함 |
| Vector DB(Qdrant) | embedding 벡터를 저장하고 "가장 비슷한 것 N개"를 빠르게 찾아 주는 DB |
| MediaPipe | 구글의 온디바이스 비전 ML 라이브러리. 브라우저에서 얼굴 랜드마크·자세를 추출 |
| Avatar(아바타) | 화면에서 말하는 AI 면접관. 여기선 HeyGen LiveAvatar SDK 사용 |
| STT / TTS | Speech-to-Text(음성→글자) / Text-to-Speech(글자→음성) |
| Late fusion | 음성 점수와 영상 점수를 따로 낸 뒤 마지막에 합치는 방식 |

## 3. 왜 필요한가 (없으면 무슨 문제가 생기나)

면접 채점은 "정답이 하나"가 아니라서 단순 LLM 1회 호출은 약점이 많다.

- **점수가 들쭉날쭉**: 같은 답변을 두 번 채점하면 점수가 흔들린다. → Critic + Reevaluate로 한쪽으로 튀는 걸 잡는다.
- **근거 없는 채점**: LLM이 "면접 채점 기준"을 모른 채 감으로 매긴다. → RAG로 루브릭·질문은행을 주입한다.
- **AI 환각·과대평가**: 빈약한 답에 후한 점수를 준다. → Critic이 적대적으로 재검증하고, 최종 점수는 서버 규칙으로 보정한다.
- **개인정보·용량 문제**: 면접 영상·음성을 서버로 올리면 저장·법적 부담이 크다. → 영상·음성은 **온디바이스 분석 후 지표만** 저장한다.
- **외부 API 의존**: OpenAI나 Qdrant가 죽으면 면접이 멈춘다. → 모든 보조 단계가 best-effort 폴백을 갖는다.

## 4. CareerTuner에서 어디에 썼나 (실제 클래스/파일/테이블)

영역 표시: **[D]** 면접 핵심 / **[E]** 미디어·아바타 / **[공통]** 전 영역 공유.

### 백엔드 (`backend/.../interview/`)

| 구성 | 클래스/파일 | 역할 |
| --- | --- | --- |
| [D] 에이전트 루프 | `service/InterviewAgentOrchestrator` | Retrieve→Evaluate→Critic→(Reevaluate/Probe) 자율 루프 |
| [D] 평가기 추상화 | `service/InterviewAnswerEvaluator` (인터페이스) | 채점·검증의 계약. 구현 교체로 모델 변경 |
| [D] 평가기 구현 | `InterviewOpenAiClient`, `OssAnswerEvaluator` | OpenAI(기본) / 자체 파인튜닝 모델(`eval.provider=oss`) |
| [D] LLM 게이트웨이 | `OpenAiLlmGateway`, `OssLlmGateway`, `AnthropicLlmGateway`, `FallbackInterviewLlmGateway` | 여러 LLM 백엔드 + 폴백 |
| [D] 프롬프트 카탈로그 | `ai/prompt/InterviewPromptCatalog` | 질문/평가/Critic/Judge/Planner/리포트 등 시스템 프롬프트 9종 |
| [D] 서비스/컨트롤러 | `service/InterviewServiceImpl`, `controller/InterviewController` | 세션 생성·질문·답변 제출·리포트 API |
| [E] RAG 지식베이스 | `rag/InterviewKnowledgeService`, `EmbeddingClient`, `QdrantClient` | 루브릭·질문은행을 벡터 검색해 근거 주입 |
| [E] 미디어 분석 | `media/InterviewMediaService`, `InterviewNonverbalClient`, `InterviewAvatarService` | 음성/영상 점수 저장, 자체 추론 서버 호출, 아바타 토큰 |
| [E] 실시간 | `realtime/InterviewRealtimeService` | 실시간 면접 세션 |
| [D] 학습 데이터 | `training/InterviewTrainingService`, `FineTuneClient` | 채점 결과를 파인튜닝/평가 하니스용으로 적재 |
| [공통] 사용량 로그 | `service/InterviewAiUsageLogService` → `ai_usage_log` | 단계별 성공/실패·토큰·모델 기록 |

### 주요 테이블

`interview_session`, `interview_question`, `interview_answer`, `interview_agent_step`(루프 단계 trace), `interview_knowledge`(RAG 원본), `interview_media_analysis`(음성/영상 지표·점수), `interview_training_sample`(학습 데이터), `ai_usage_log`(공통).

### 프런트 (`frontend/src/features/interview/`)

- **아바타 면접**: `components/AvatarTab.tsx` — `@heygen/liveavatar-web-sdk`의 `LiveAvatarSession`으로 실시간 AI 면접관. 키 없으면 `LocalAvatarTab.tsx`가 브라우저 `speechSynthesis`로 폴백.
- **온디바이스 영상 분석**: `hooks/visualAnalysis.ts` — `@mediapipe/tasks-vision`의 `FaceLandmarker`(표정·시선 blendshape) + `PoseLandmarker`(자세)로 400ms 간격 샘플링.

::: warning 구현됨 vs 계획중
- **구현됨**: 에이전트 루프, RAG(Qdrant, best-effort), OpenAI 평가, MediaPipe 온디바이스 분석, HeyGen 아바타, 학습 데이터 적재.
- **부분/토글**: 자체 파인튜닝 평가기(`OssAnswerEvaluator`)·자체 비언어 추론 서버(`InterviewNonverbalClient`)는 코드 경로는 있고 인프라/키 유무로 활성화(나는 키 미발급이라 mock·폴백으로 확인). RAG는 `INTERVIEW_RAG_ENABLED`로 켜고 끔.
:::

## 5. 핵심 동작 원리 (표/작은 코드/단계)

### 5-1. 채점 한 건의 자율 루프 (`InterviewAgentOrchestrator`)

정책(`AgentPolicy`)이 현재 상태를 보고 다음 액션을 고르는 루프다. 운영 기본은 `RulePolicy`(규칙), 시연 모드는 `LlmPolicy`(LLM이 매 턴 액션 선택, 실패 시 규칙으로 폴백).

```text
RETRIEVE  → RAG로 루브릭·질문은행 근거 검색 (없으면 그냥 진행)
EVALUATE  → 답변 채점 (실패하면 평가 불가 → 흐름 중단)
CRITIC    → 채점을 적대적으로 검증하고 점수 조정
REEVALUATE→ 원점수와 Critic 점수가 20점 이상 벌어지면 한 번 더 채점,
            재채점·Critic 점수의 평균으로 최종 확정
PROBE     → 답변이 40자 미만이거나 점수 50 미만이면 꼬리질문 권장 플래그
FINISH    → 더 할 일 없으면 종료
```

각 단계는 `interview_agent_step`에 trace로 남고(에이전트·액션·상태·요약·소요ms), 단계별로 `ai_usage_log`에 성공/실패가 기록된다. 핵심 보정 로직:

```java
// REEVALUATE: 재채점과 Critic 조정값의 중간을 최종으로 채택해 한쪽으로 튀지 않게 한다.
int reconciled = Math.round((re.score() + ctx.criticAdjusted) / 2.0f);
```

### 5-2. 평가기 추상화로 모델 교체

오케스트레이터는 `InterviewAnswerEvaluator` 인터페이스만 호출한다. 구현만 갈아끼우면 호출부를 안 고치고 평가 모델을 바꾼다.

```java
// evaluatorProvider.get() 이 설정(eval.provider)에 따라
//   InterviewOpenAiClient(기본) 또는 OssAnswerEvaluator(자체 모델) 를 돌려준다.
this.evaluator = evaluatorProvider.get();
```

이건 **전략 패턴 + 의존성 역전**이다. 면접에서 "AI 의존을 어떻게 줄였나" 물으면 이 지점이 핵심 답이다.

### 5-3. RAG로 근거 주입 (`InterviewKnowledgeService`)

원본은 MySQL(`interview_knowledge`), 벡터는 Qdrant. 검색은 best-effort라 Qdrant가 없어도 빈 컨텍스트로 그냥 진행한다(면접이 안 끊김).

```text
질문+답변 → EmbeddingClient.embed() → 벡터
        → QdrantClient.search(topK) → 유사 스니펫
        → "1. [루브릭] ..." 형태 문자열로 평가 프롬프트에 주입
```

문서 종류(KIND)는 `RUBRIC`(채점 기준), `QUESTION_BANK`(질문은행), `COMPANY`(기업 정보), `GENERAL`. 색인 실패 시 `indexed=false`로 남겨 나중에 `reindexAll`로 회복한다.

### 5-4. 비언어(영상·음성) 분석 — 온디바이스 우선 (ADR-002)

| 단계 | 처리 위치 | 무엇을 |
| --- | --- | --- |
| 표정·시선·자세 | **브라우저** (`visualAnalysis.ts`, MediaPipe) | FaceLandmarker blendshape로 미소·미간·시선이탈, PoseLandmarker로 어깨 기울기·움직임 |
| 음성/영상 점수 | 자체 추론 서버(`InterviewNonverbalClient`) | 원본을 받아 점수만 산출하고 **즉시 폐기** (late fusion) |
| 저장 | `InterviewMediaService` → `interview_media_analysis` | 트랜스크립트·지표·점수 **JSON만** 저장 (원본 영상/음성 X) |

핵심: **원본 미디어는 서버에 영구 저장하지 않는다.** 개인정보·용량 리스크를 설계로 차단한 것이라 면접에서 강조하기 좋다.

### 5-5. 아바타 면접관 (HeyGen)

`AvatarTab.tsx`가 `@heygen/liveavatar-web-sdk`로 실시간 말하는 면접관을 띄운다. 백엔드 `InterviewAvatarService`가 세션 토큰을 발급하고, `HEYGEN_API_KEY`가 없으면 프런트가 `LocalAvatarTab`(브라우저 음성합성)으로 자동 폴백한다.

## 6. 면접 답변 3단계

**초간단 (1문장)**
"가상 면접 AI는 채용공고 기반으로 질문을 만들고, RAG로 근거를 모아 채점한 뒤 별도 Critic 단계로 그 채점을 적대적으로 재검증하는 다단계 에이전트로 만들었습니다."

**기본 (30초)**
"단순 LLM 1회 채점은 점수가 흔들리고 근거가 약해서, `InterviewAgentOrchestrator`라는 자율 루프로 설계했습니다. RAG로 채점 루브릭을 주입하고(Retrieve), 채점하고(Evaluate), Critic이 적대적으로 검증해 점수를 조정하고, 원점수와 20점 이상 벌어지면 한 번 더 채점해 평균으로 확정합니다. 평가기는 인터페이스로 추상화해서 OpenAI와 자체 파인튜닝 모델을 교체할 수 있고, 화상 면접 영상은 서버로 보내지 않고 브라우저 MediaPipe에서 지표만 뽑아 저장합니다."

**꼬리질문 대응 (깊게)**
"각 단계는 `interview_agent_step`에 trace로 남기고 `ai_usage_log`로 토큰·실패를 추적해 운영에서 채점 품질과 비용을 볼 수 있습니다. RAG·Critic·재평가는 전부 best-effort라 Qdrant나 OpenAI가 장애여도 원 채점으로 폴백해 면접 흐름이 끊기지 않습니다. 최종 점수는 LLM 출력 그대로가 아니라 Critic 조정·재평가 평균이라는 서버 규칙으로 확정합니다."

## 7. 자주 나오는 꼬리질문 + 모범답안

::: details Q1. LLM 한 번 부르면 되지, 왜 Critic·Reevaluate까지 단계를 늘렸나?
채점은 정답이 하나가 아니라 같은 답변도 호출마다 점수가 흔들립니다. Critic은 채점을 적대적으로 재검증해 근거 없이 후하거나 박한 점수를 잡고, 원점수와 Critic 점수가 임계값(20점) 이상 벌어질 때만 Reevaluate를 한 번 더 돌려 두 값의 평균으로 확정합니다. 즉 비용은 필요한 경우에만 더 쓰고 채점 안정성을 올린 트레이드오프입니다.
:::

::: details Q2. RAG가 왜 면접 채점에 필요한가? 없으면?
LLM이 "이 회사·직무의 채점 기준"을 모른 채 감으로 매기는 걸 막으려고 `interview_knowledge`에 루브릭·질문은행·기업정보를 넣고, 질문+답변과 의미가 가까운 스니펫을 Qdrant로 검색해 평가 프롬프트에 주입합니다. 없으면 채점이 일반적·자의적이 되고, 회사별 기준을 반영 못 합니다. 단 RAG는 best-effort라 Qdrant가 없으면 빈 컨텍스트로 그냥 채점합니다.
:::

::: details Q3. 면접 영상을 어떻게 분석하나? 서버로 올리나?
원본 영상은 서버로 올리지 않습니다. 브라우저에서 MediaPipe `FaceLandmarker`(표정·시선 blendshape)와 `PoseLandmarker`(어깨 자세·움직임)로 400ms마다 샘플링해 지표를 계산하고, `interview_media_analysis`에는 그 지표·점수 JSON만 저장합니다(ADR-002). 자체 추론 서버로 음성/영상 점수를 낼 때도 원본은 점수 산출 후 즉시 버립니다. 개인정보·저장 비용을 설계로 차단한 것입니다.
:::

::: details Q4. OpenAI가 죽거나 키가 없으면 면접이 멈추나?
아닙니다. 평가기는 `InterviewAnswerEvaluator` 인터페이스로 추상화돼 있고 게이트웨이에 폴백(`FallbackInterviewLlmGateway`)이 있어 OpenAI·자체 모델·Anthropic 사이를 전환합니다. RAG·Critic·재평가 같은 보조 단계는 실패해도 원 채점으로 폴백하고, 아바타 키가 없으면 프런트가 브라우저 음성합성으로 폴백합니다. 핵심 채점(Evaluate)만 진짜로 불가능할 때 흐름을 끊습니다.
:::

::: details Q5. RulePolicy와 LlmPolicy 차이는?
둘 다 "다음 액션"을 고르는 정책입니다. RulePolicy는 상태를 보고 규칙으로 결정하는 운영 기본값이라 예측 가능하고 비용이 없습니다. LlmPolicy는 매 턴 LLM이 가용 액션 중 하나를 고르는 시연 모드인데, 선택지가 하나뿐이면 LLM을 안 부르고(비용 절약) 실패하면 RulePolicy로 폴백합니다. "에이전트가 스스로 계획한다"를 보여 주되 운영 안정성은 규칙으로 받칩니다.
:::

## 8. 직접 말해보기

1. 화이트보드 없이, 답변 한 건이 들어왔을 때 점수가 확정되기까지 거치는 단계를 RETRIEVE부터 FINISH까지 순서대로, 각 단계가 실패하면 어떻게 폴백하는지까지 한 번에 말해 보라.
2. "왜 면접 영상을 서버에 저장 안 하나?"를 개인정보·용량·법적 리스크 + MediaPipe 온디바이스 분석으로 40초 안에 설명해 보라.

## 퀴즈

<QuizBox question="InterviewAgentOrchestrator의 자율 루프에서, 원 채점 점수와 Critic이 조정한 점수가 임계값(20점) 이상 벌어졌을 때 일어나는 일은?" :choices="['원 점수를 그대로 최종으로 쓴다','REEVALUATE로 한 번 더 채점하고 재채점과 Critic 점수의 평균을 최종으로 쓴다','무조건 Critic 점수를 최종으로 쓴다','채점을 실패 처리하고 흐름을 끊는다']" :answer="1" explanation="bigDisagreement가 참이면 REEVALUATE가 돌고, reconciled = round((재채점 + criticAdjusted) / 2) 로 한쪽으로 튀지 않게 평균을 최종 점수로 확정한다." />

<QuizBox question="CareerTuner 가상 면접에서 사용자의 면접 영상 원본은 어디에 저장되는가?" :choices="['interview_media_analysis 테이블에 영상 파일로 저장된다','Qdrant 벡터DB에 저장된다','서버에 영구 저장하지 않고 브라우저(MediaPipe)에서 분석한 지표·점수 JSON만 저장한다','OpenAI 서버로 업로드된다']" :answer="2" explanation="ADR-002에 따라 원본 영상은 서버로 올리지 않고, MediaPipe로 온디바이스 분석한 표정·시선·자세 지표와 점수 JSON만 interview_media_analysis에 저장한다." />

<QuizBox question="평가 모델을 OpenAI에서 자체 파인튜닝 모델로 바꿔도 InterviewAgentOrchestrator 코드를 거의 안 고쳐도 되는 이유를 설계 관점에서 설명해 보라." explanation="오케스트레이터는 구체 클래스가 아니라 InterviewAnswerEvaluator 인터페이스(채점·검증 계약)에만 의존하고, 실제 구현은 InterviewEvaluatorProvider가 설정값(eval.provider)에 따라 InterviewOpenAiClient 또는 OssAnswerEvaluator로 주입한다. 전략 패턴 + 의존성 역전 덕분에 호출부는 그대로 두고 구현만 교체하면 모델이 바뀐다. 반환 레코드도 공유해 호출부 시그니처가 안 변한다." />
