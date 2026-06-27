# AI 퀴즈

> CareerTuner의 AI 계층(LLM·프롬프트·structured output·RAG·오케스트레이터·적합도/경향 분석·자체 LLM 계획)을 자기 입으로 설명할 수 있는지 점검하는 10문항 이상 퀴즈. 헷갈리면 각 문제 해설의 링크를 따라가서 다시 읽어라.

## 1. 이 퀴즈로 점검하는 것

이 페이지는 새 개념을 가르치는 페이지가 아니라 **이미 읽은 AI 영역 지식을 면접용으로 굳히는** 페이지다. 다음 축을 다룬다.

| 축 | 핵심 질문 |
| --- | --- |
| LLM / 프롬프트 | 시스템 vs 유저 프롬프트, 프롬프트 카탈로그 패턴 |
| Structured Output | JSON 스키마 강제, 왜 "그냥 텍스트 파싱"보다 나은가 |
| RAG | 검색 증강 생성, Qdrant, 언제 켜지나 |
| 오케스트레이터 | AutoPrep, 의존 그래프, SSE 진행 보고 |
| 적합도/경향(C) | 뉴로-심볼릭, grounding guard, 폴백 체인 |
| 구현 vs 계획 | 무엇이 돌아가고 무엇이 설계 단계인가 |

:::tip 정직하게 구분하라
면접에서 가장 위험한 건 **계획 단계인 걸 다 만든 것처럼 말하는 것**이다. "자체 파인튜닝 LLM"은 코드 골격·평가 하니스·데이터 파이프라인은 있지만 **프로덕션 서빙은 설계/실험 단계**다. 이 퀴즈에 그 구분 문제가 일부러 들어 있다.
:::

## 2. 출제 범위 한눈에 (실제 코드 기준)

아래는 문제 근거가 되는 실제 클래스/파일이다. 답이 막히면 여기부터 다시 본다.

- 적합도 진입점: `FallbackFitAnalysisAiService`(`@Primary`) → `OssFitAnalysisAiService` → `OpenAiFitAnalysisAiService` → 내부 `MockFitAnalysisAiService`
- 프롬프트 카탈로그: `FitAnalysisPromptCatalog`, `CareerTrendPromptCatalog`, `DashboardInsightPromptCatalog`, `JobAnalysisPromptCatalog`, `CompanyAnalysisPromptCatalog`
- Structured output: `OpenAiResponsesClient`(JSON 스키마 강제)
- 오케스트레이터: `AutoPrepOrchestrator`, `AutoPrepPlanner`, `ai/autoprep/handler`(`FitPrepHandler` 등)
- 경향 분석: `CareerAnalysisRunService`, `CareerTrendAiCommand`, `CareerAnalysisOpenAiClient`, 테이블 `career_analysis_run`
- 적합도 결과 저장: 테이블 `fit_analysis`
- 자체 LLM(설계/실험): `ml/career-strategy-llm`(학습·평가·judge 하니스), 모델 코드네임 `careertuner-c-career-strategy`

관련 학습 페이지: [LLM 기초](/ai/llm-and-prompt), [프롬프트 엔지니어링](/ai/llm-and-prompt), [Structured Output](/ai/openai-structured-output), [RAG](/ai/rag-qdrant), [AutoPrep 오케스트레이터](/ai/orchestrator-autoprep), [적합도 분석](/ai/fit-analysis)

## 3. 풀이 요령

1. 객관식은 **왜 나머지가 틀렸는지**까지 말로 설명할 수 있어야 진짜 아는 것이다.
2. 주관식은 30초 안에 핵심 1문장 → 근거 2~3개 순서로 답한다.
3. 틀린 문제는 해설 링크로 돌아가 읽고, 다음 날 다시 푼다(간격 반복).

---

## 퀴즈

<QuizBox
  question="CareerTuner 적합도 분석에서 '점수(fitScore)와 지원판단(applyDecision)을 누가 결정하는가'로 가장 정확한 설명은?"
  :choices="['LLM이 자유 텍스트로 점수를 써주고 그대로 저장한다', '서버 규칙엔진(MockFitAnalysisAiService)이 결정론적으로 계산하고 LLM은 설명 텍스트만 생성한다', '프론트엔드가 매칭 기술 개수를 세서 계산한다', 'OpenAI가 점수를 정하고 규칙엔진은 사용하지 않는다']"
  :answer="1"
  explanation="뉴로-심볼릭 구조다. 점수·매칭/부족 역량·지원판단·조건매트릭스 같은 '판단값'은 서버 규칙엔진이 결정론적으로 계산하고, 자체모델(OssFitAnalysisAiService)은 그 값을 입력으로 받아 한국어 설명(fitSummary 등)만 생성한다. 모델이 fitScore 같은 금지키를 출력해도 화이트리스트(fitSummary/strategyActions/learningTaskReasons)만 읽으므로 점수에 영향이 없다." />

<QuizBox
  question="시스템 프롬프트(system prompt)와 유저 프롬프트(user prompt)의 역할 구분으로 옳은 것은?"
  :choices="['둘은 동일하며 길이만 다르다', '시스템 프롬프트는 모델의 역할/규칙/출력형식을 고정하고, 유저 프롬프트는 매 요청의 가변 입력(공고·프로필)을 담는다', '유저 프롬프트가 모델 가중치를 바꾼다', '시스템 프롬프트는 매 호출마다 사용자가 직접 입력한다']"
  :answer="1"
  explanation="FitAnalysisPromptCatalog.SYSTEM_PROMPT는 '커리어 적합도 분석가' 역할과 JSON 스키마 준수 규칙을 고정하고, userPrompt(...)는 회사/직무/필수역량/프로필 같은 가변 입력을 채워 넣는다. 역할·규칙은 시스템, 데이터는 유저로 분리하는 게 카탈로그 패턴의 핵심." />

<QuizBox
  question="CareerTuner가 '프롬프트 카탈로그 패턴'(도메인별 PromptCatalog 클래스)을 쓰는 주된 이유로 가장 적절한 것은?"
  :choices="['프롬프트를 코드 곳곳 문자열로 흩뿌리지 않고 도메인별 한 곳에 모아 버전·재현성을 관리하려고', 'LLM 호출 비용을 0으로 만들려고', '프롬프트를 사용자가 런타임에 자유롭게 바꾸게 하려고', 'JPA 매핑을 자동 생성하려고']"
  :answer="0"
  explanation="FitAnalysisPromptCatalog에는 VERSION 상수(v0.2)까지 있다. 도메인별(Fit/CareerTrend/Dashboard/Job/Company)로 프롬프트를 한 클래스에 모으면 변경 추적·재현·train/serve 정합 관리가 쉬워진다. 비용을 0으로 만들거나 사용자가 마음대로 바꾸는 것과는 무관." />

<QuizBox
  question="Structured Output(구조화 출력)을 쓰는 핵심 이점은?"
  :choices="['응답이 항상 더 길어진다', '모델 출력이 미리 정의한 JSON 스키마를 따르도록 강제해, 깨진 자유 텍스트를 정규식으로 긁어내는 취약함을 없앤다', '네트워크 지연이 사라진다', '프롬프트가 필요 없어진다']"
  :answer="1"
  explanation="OpenAiResponsesClient는 job_analysis 같은 이름과 JSON 스키마를 함께 보내 structured request를 만든다. 스키마를 강제하면 서버가 안정적으로 파싱·매핑할 수 있고, '모델이 가끔 형식을 어겨 파싱이 깨지는' 문제를 구조적으로 막는다." />

<QuizBox
  question="AutoPrep 오케스트레이터의 의존 그래프에서 FIT(적합도)와 INTERVIEW(면접)가 공통으로 의존하는 단계는?"
  :choices="['PROFILE', 'JOB(공고분석)', 'COMMUNITY', '없다 — 모두 독립 실행된다']"
  :answer="1"
  explanation="AutoPrepPlanner의 DEPS 맵은 FIT→[JOB], INTERVIEW→[JOB]로 정의돼 있다. 적합도·면접질문은 공고분석 결과가 있어야 의미가 있으므로, 사용자가 'FIT만' 골라도 코드가 JOB을 의존 클로저로 함께 끌어와 defaultSteps 순서로 정렬해 실행한다." />

<QuizBox
  question="AutoPrep이 단계 진행 상황을 프론트에 실시간으로 흘려보내는 방식은?"
  :choices="['1초마다 클라이언트가 폴링', 'SSE(Server-Sent Events) 스트림으로 단계별 진행을 push', 'WebSocket 양방향 채팅', '이메일로 단계마다 발송']"
  :answer="1"
  explanation="AutoPrep은 SSE로 단계별 실시간 진행보고를 한다. 긴 다단계 파이프라인(JOB→FIT/INTERVIEW...)에서 사용자가 '지금 무슨 단계인지' 보게 하려고 서버→클라 단방향 스트림을 쓴다." />

<QuizBox
  question="적합도 분석의 폴백(fallback) 체인 중 '현재 구현되어 있는' 순서로 옳은 것은?"
  :choices="['Mock → OpenAI → 자체모델', '자체모델(OSS) → OpenAI → Mock', 'OpenAI만 호출하고 폴백 없음', 'RAG → 규칙엔진 → 사람 검토']"
  :answer="1"
  explanation="FallbackFitAnalysisAiService(@Primary)가 provider=oss이고 ossClient.available()일 때 자체모델을 먼저 시도하고, 실패하면 OpenAiFitAnalysisAiService로, 그것도 키가 없거나 실패하면 내부 Mock으로 폴백한다. 자체모델이 죽거나 응답이 깨져도 화면은 안 깨지는 게 목적." />

<QuizBox
  question="'자체 파인튜닝 커리어 전략 LLM(careertuner-c-career-strategy)'의 현재 상태로 가장 정직한 설명은?"
  :choices="['프로덕션에서 모든 적합도 요청을 처리하는 메인 모델이다', '학습 데이터 파이프라인·평가/judge 하니스 등 골격은 있으나 프로덕션 서빙은 설계·실험 단계이고, 평소엔 OpenAI/규칙엔진/Mock 폴백이 동작한다', '아예 코드가 한 줄도 없다', 'OpenAI를 완전히 대체해 비용이 0이 되었다']"
  :answer="1"
  explanation="ml/career-strategy-llm에 데이터 조립(assemble_dataset)·LoRA 파인튜닝·평가/judge 하니스 등 골격은 존재한다. 하지만 상시 프로덕션 서빙은 설계/실험 단계이고, FallbackFitAnalysisAiService 기본값은 provider=openai라 자체모델은 비활성. 면접에서 '계획/실험'과 '운영 중'을 섞어 말하지 말 것." />

<QuizBox
  question="자체모델이 '부족 역량(missing skill)을 보유한 강점처럼 서술'하는 환각을 막는 OssFitAnalysisAiService의 장치는?"
  :choices="['모델 출력을 그대로 신뢰한다', 'grounding guard로 fitSummary/strengths 문장을 검사해 위반이면 재호출하고, 재시도가 소진되면 예외를 던져 OpenAI/Mock으로 폴백한다', '사용자에게 오타를 신고받는다', 'JPA 트랜잭션 롤백으로 처리한다']"
  :answer="1"
  explanation="groundingViolation(...)이 '보유' 류 표현이 있고 '부족/없/않' 같은 결핍 표현이 없는 문장에 missing 스킬이 등장하면 위반으로 판정한다. 위반 시 groundingRetries만큼 재호출, 소진되면 BusinessException을 던져 상위 폴백이 OpenAI→Mock으로 이어받게 한다." />

<QuizBox
  question="RAG(Retrieval-Augmented Generation)와 CareerTuner의 Qdrant 사용에 대한 설명으로 옳은 것은?"
  :choices="['RAG는 모델을 매번 재학습하는 기법이다', 'RAG는 벡터DB(Qdrant)에서 관련 문서를 검색해 프롬프트에 끼워 넣어 모델이 근거 기반으로 답하게 하는 기법이며, 면접 RAG는 INTERVIEW_RAG_ENABLED 플래그로 토글된다', 'Qdrant는 관계형 DB라 MyBatis로 직접 매핑한다', 'RAG는 항상 켜져 있어 끌 수 없다']"
  :answer="1"
  explanation="RAG는 검색(retrieval)으로 외부 지식을 가져와 생성(generation)을 보강한다. CareerTuner는 Qdrant 벡터DB(QDRANT_URL)를 쓰고, 가상면접 쪽 RAG는 INTERVIEW_RAG_ENABLED 플래그로 켜고 끈다. 재학습이 아니라 '추론 시 컨텍스트 주입'이라는 점이 핵심." />

<QuizBox
  question="장기 취업경향 분석(C 구현됨)에서 결과가 저장되는 테이블과 호출 클라이언트의 짝으로 옳은 것은?"
  :choices="['fit_analysis 테이블 / FitAnalysisController', 'career_analysis_run 테이블 / CareerAnalysisOpenAiClient', 'ai_usage_log 테이블 / JwtTokenProvider', 'job_posting 테이블 / JobPostingTextExtractor']"
  :answer="1"
  explanation="경향 분석은 CareerAnalysisRunService가 CareerTrendAiCommand를 만들어 CareerAnalysisOpenAiClient로 호출하고, 반복 부족역량·지원패턴·다음 방향 같은 결과를 career_analysis_run 테이블에 적재한다. fit_analysis는 적합도(건별) 결과 저장용." />

<QuizBox
  question="train/serve skew(학습-서빙 불일치)를 줄이기 위해 FitAnalysisPromptCatalog가 신경 쓰는 것은?"
  :choices="['프롬프트를 매번 랜덤으로 생성한다', '자체모델용 시스템 프롬프트(FIT_EXPLAIN_SYSTEM_PROMPT)와 입력 본문 구조를 학습 데이터 생성 스크립트와 동일하게 맞춘다', '서빙 때는 더 짧은 프롬프트를 쓴다', '프롬프트를 프론트에서 만든다']"
  :answer="1"
  explanation="FIT_EXPLAIN_SYSTEM_PROMPT는 학습 데이터의 system 메시지와 같아야 하고, fitExplainUserPrompt(...)의 입력 구조도 데이터 조립 스크립트(build_fit_user)와 동일해야 한다. 학습 때와 서빙 때 입력이 다르면(skew) 성능이 무너지기 때문." />

<QuizBox
  question="(주관식) 면접관이 'CareerTuner의 적합도 분석에서 AI를 믿을 수 있게 만든 설계가 뭐냐'고 물으면 어떻게 답하겠는가? 1문장 핵심 + 근거 2~3개로 말해보라."
  explanation="모범답안: '점수 같은 판단은 LLM이 아니라 서버 규칙엔진이 결정론적으로 계산하고, LLM은 그 값을 입력으로 받아 설명만 생성하는 뉴로-심볼릭 구조로 만들었습니다.' 근거 (1) 규칙엔진(MockFitAnalysisAiService)이 fitScore·applyDecision·매칭/부족을 소유하고, 모델 출력은 화이트리스트(fitSummary/strategyActions/learningTaskReasons)만 읽어 금지키를 구조적으로 차단한다. (2) grounding guard가 '부족 역량을 보유로 서술'하는 환각을 검사해 재호출/폴백한다. (3) FallbackFitAnalysisAiService가 자체모델→OpenAI→Mock 폴백을 보장해 AI가 죽어도 화면이 깨지지 않는다. 이렇게 '판단의 권위는 코드, 표현은 모델'로 나눈 게 신뢰의 핵심이라고 말하면 된다." />

<QuizBox
  question="(주관식) 'AutoPrep 오케스트레이터'를 비개발자 면접관에게 1분 안에 설명한다면? 무엇을 받고, 어떻게 단계를 정하고, 어떻게 결과를 보여주는지 포함해 말해보라."
  explanation="모범답안: AutoPrep은 '면접 통째로 준비해줘' 같은 한 줄 요청을 받아, LLM으로 회사·직무·모드 슬롯과 필요한 단계를 추출하는 AI 오케스트레이터다. 단계 선택은 동적이라 '면접만'이면 INTERVIEW만 돌리지만, FIT·INTERVIEW는 공고분석(JOB)에 의존하므로 코드가 의존 클로저로 JOB을 함께 끌어와 정해진 순서로 정렬한다. 실행 중에는 SSE로 단계별 진행을 실시간 push해 사용자가 지금 어느 단계인지 보게 한다. 의도 파싱이 실패하면 빈 슬롯·전체 단계로 안전하게 폴백한다는 점까지 덧붙이면 좋다." />
