# 예상 면접 질문 AI 생성 [#19]

> 지원 건(회사·직무·공고)을 입력으로, 면접 모드별 예상 질문을 LLM으로 생성해 `interview_question`에 저장하고, 커밋 이후 백그라운드에서 모범답안까지 한 번에 만들어 "채점 기준 답안지"로 재사용한다.

## 1. 한 줄 정의 · 이 페이지가 답하는 면접 질문

가상 면접(영역 D)의 출발점이다. 사용자가 면접 모드를 고르면, 그 지원 건의 **회사명·직무명·공고 원문**과 **면접 모드 라벨**을 LLM에 넣어 6개 안팎의 예상 질문을 만들고 순서대로 저장한다. 질문 INSERT가 끝나면 **트랜잭션 커밋 직후 백그라운드 스레드**가 6개 모범답안을 일괄 생성해 같은 질문에 붙인다. 이 모범답안은 뒤에서 답변 채점의 **만점(100점) 기준 답안지**로 다시 쓰인다.

이 페이지는 면접에서 이런 질문에 답하기 위한 것이다.

- "예상 질문은 무슨 데이터를 보고, 어떤 프롬프트로, 어떤 모델로 생성하나요?"
- "질문 6개와 모범답안 6개를 어떻게 일관되게 만들고 저장하나요? 동시성은?"
- "기획서에는 적합도(C)·프로필(A)까지 조합한다고 돼 있는데 실제로 다 들어가나요?"
- "자체 LLM으로 질문을 생성한다고 들었는데, 지금 정말 자체 모델이 돌고 있나요?"

마지막 두 질문은 **문서(목표)와 코드(현재)의 갭**을 정직하게 구분해야 하는 지점이다. 이 페이지는 그 갭을 숨기지 않고 설명하는 데 무게를 둔다.

:::tip 핵심 단위는 공고가 아니라 "지원 건"
CareerTuner의 모든 흐름은 `application_case`(지원 건)에 종속된다. 면접 세션도 `interview_session.application_case_id`로 묶이고(`ON DELETE CASCADE`), 질문 생성은 "이 지원 건의 회사·직무·공고"를 읽어 온다. 같은 회사여도 지원 건이 다르면 다른 질문 세트가 생긴다.
:::

## 2. 왜 이렇게 설계했나 (의도 · 트레이드오프)

질문 생성은 단순히 "LLM에 프롬프트 한 번 던지기"가 아니다. 다음 세 가지 설계 결정이 이 기능의 성격을 만든다.

**(1) 모범답안 = 질문 생성과 한 묶음으로, 그러나 비동기로.**
모범답안은 나중에 채점의 만점 기준이 된다. 그렇다면 질문을 만들 때 같이 만들어 두는 게 일관성에 좋다. 하지만 6개를 LLM으로 한 번에 만드는 건 느려서, 그걸 기다리면 사용자가 질문 화면을 못 본다. 그래서 **질문은 즉시 반환하고, 모범답안은 커밋 후 백그라운드**에서 만든다. 트레이드오프: 사용자가 질문을 받자마자 곧장 답변을 제출하면 모범답안이 아직 비어 있을 수 있다. 이건 채점 시점에 "단건 즉시 생성" 폴백으로 메운다(아래 4·5절).

**(2) `afterCommit` 타이밍을 고른 이유.**
백그라운드 스레드는 별도 DB 커넥션을 쓴다. 아직 커밋되지 않은 질문 INSERT는 그 커넥션에서 보이지 않는다. 그래서 단순히 "스레드 띄우기"가 아니라 **트랜잭션이 커밋된 뒤**(`TransactionSynchronization.afterCommit`)에 백그라운드 작업을 등록한다. 커밋 가시성을 보장하지 않으면 모범답안이 "방금 만든 질문을 못 찾아" 누락된다.

**(3) LLM의 `type` 오분류를 코드로 방어.**
LLM에게 질문 유형(직무/인성/상황 등)을 분류시키면, 본질문을 `FOLLOW_UP`(꼬리질문)으로 잘못 찍는 경우가 있다. 그러면 UI에서 본질문이 꼬리질문처럼 들여쓰기돼 표시된다. 그래서 **본질문 생성 스키마의 enum에서 `FOLLOW_UP`을 아예 제거**하고, 응답을 `normalizeType`으로 한 번 더 정규화한다. 꼬리질문(`FOLLOW_UP`)은 별도 API에서만 강제 부여한다.

## 3. 어떤 기술로 구현했나 (실제 클래스 · 테이블 근거)

표준 4계층(`controller → service → mapper → domain`)에 LLM 게이트웨이가 붙는다.

| 계층 | 클래스 / 위치 | 역할 |
| --- | --- | --- |
| Controller | `InterviewController.generateQuestions` | `POST /api/interview/sessions/{sessionId}/generate-questions` |
| Service | `InterviewServiceImpl.generateQuestions` | 소유 검증·count 결정·저장·백그라운드 모범답안 등록 |
| LLM 클라이언트 | `InterviewOpenAiClient.generateQuestions` | userPrompt 포맷 + json_schema + 게이트웨이 호출 |
| 프롬프트 | `InterviewPromptCatalog.QUESTION_SYSTEM_PROMPT` | 면접관 system 프롬프트(버전 `d-v1`) |
| 게이트웨이 | `InterviewLlmGateway` / `FallbackInterviewLlmGateway` | 자체모델 → Claude(Haiku) → OpenAI 폴백 |
| 모델 설정 | `InterviewModelProperties.getGeneration()` | 생성 티어 모델(`gpt-5.4-mini`) |
| Mapper / Domain | `InterviewMapper` / `InterviewQuestion` | `interview_question` INSERT·조회 |

> 클래스 이름이 `InterviewOpenAiClient`이지만 OpenAI 전용이 아니다. 실제 호출은 `InterviewLlmGateway`(폴백 디스패처)를 거치므로, OpenAI 외에 Claude·자체 모델로도 갈 수 있다. 이름은 역사적 잔재로 보는 게 정확하다.

**소유 검증·읽기 전용 입력.** 서비스는 먼저 `accessService.requireOwned(userId, applicationCaseId)`로 이 지원 건이 정말 이 사용자 것인지 확인하고, `accessService.sourceText(caseId)`로 공고 원문을 가져온다. 둘 다 **읽기 전용** 참조다. 영역 D는 다른 영역(B 공고 분석)의 산출물을 읽기만 하고 고치지 않는다.

**소유 테이블.** 질문은 `interview_question`에 저장된다. 핵심 컬럼은 `question`, `question_type`(EXPECTED/TECH/PERSONALITY/SITUATION/FOLLOW_UP), `sort_order`(0부터), `parent_question_id`(꼬리질문이 본질문을 가리키는 self-FK), 그리고 패치로 추가된 `model_answer`(채점 기준 답안지·DTO에 노출 안 됨). `model_answer`는 본체 스키마가 아니라 패치 `20260612_d_question_model_answer.sql`로 들어왔다.

## 4. 동작 원리 (흐름 · 표 · 작은 코드)

### 4.1 전체 흐름

```text
[프런트 ExpectedQuestionsTab] POST .../generate-questions
        │
        ▼
InterviewServiceImpl.generateQuestions
  1) requireSession + requireOwned   (소유 검증)
  2) postingText = accessService.sourceText(caseId)   (공고 원문 B)
  3) count 결정   (압박=3, 그 외=6, 상한 15)
  4) aiClient.generateQuestions(case, postingText, modeLabel, count)
        └─► gateway.complete( "interview_questions" 스키마 )
              └─► 자체모델 → Claude(Haiku) → OpenAI 폴백
  5) deleteQuestionsBySessionId  → 기존 질문 삭제(재생성 멱등)
  6) for q: insertQuestion(sortOrder 0,1,2...)   useGeneratedKeys
  7) recordSuccess → ai_usage_log(INTERVIEW_QUESTION_GEN)
  8) registerSynchronization.afterCommit:
        backgroundExecutor.run( storeModelAnswers )  ← 커밋 후 6개 모범답안 일괄
        │
        ▼
  return listQuestions(...)   ← 사용자는 여기서 바로 질문을 받는다
```

### 4.2 질문 수 결정 규칙

| 모드 | 본질문 수 | 근거 상수 | 비고 |
| --- | --- | --- | --- |
| 압박(PRESSURE) | 3 | `PRESSURE_QUESTION_COUNT = 3` | 본질문 3 + 답변마다 반박 1 = 총 6 |
| 그 외 5개 모드 | 6 (기본) | `DEFAULT_QUESTION_COUNT = 6` | 요청에 count 있으면 그 값 |
| 상한 | 15 | `MAX_QUESTION_COUNT = 15` | `resolveCount`가 클램프 |

```java
// InterviewServiceImpl: count 결정 (요약)
int count = MODE_PRESSURE.equals(session.getMode())
        ? PRESSURE_QUESTION_COUNT          // 압박은 본질문 3개
        : resolveCount(request.count());   // 그 외 6개(또는 요청값, 상한 15)
```

`resolveCount`는 `count`가 null이거나 0 이하면 6, 그렇지 않으면 `min(count, 15)`를 돌려준다.

### 4.3 프롬프트 · userPrompt 조립

system 프롬프트(`QUESTION_SYSTEM_PROMPT`)는 "IT 직무 모의면접 면접관"으로서 회사·직무·공고를 바탕으로 질문만 생성하고, 면접 모드에 맞춰 성격을 맞추며, 한국어 한 문장으로 묻고, 첨삭·평가는 하지 말라고 지시한다. userPrompt는 다음 네 줄 + 공고 본문으로 조립된다(`InterviewOpenAiClient.generateQuestions`).

```text
회사명: {companyName}
직무명: {jobTitle}
면접 모드: {modeLabel}      ← "직무 면접", "압박 면접" 등 한글 라벨
생성할 질문 수: {count}

채용공고:
{postingText 또는 "(공고문 없음)"}
```

`modeLabel`은 `MODE_LABELS`로 enum을 한글 라벨로 바꾼 값이다(BASIC→기본 면접, JOB→직무 면접 등 6종).

### 4.4 구조화 출력과 `type` 정규화

게이트웨이에는 `interview_questions` JSON 스키마를 함께 넘긴다. 핵심은 **`type` enum에서 `FOLLOW_UP`을 뺀 것**이다.

```java
// questionsSchema(): 본질문 type enum — FOLLOW_UP 없음
"enum", List.of("EXPECTED", "TECH", "PERSONALITY", "SITUATION")
```

응답을 읽을 때도 `normalizeType`으로 한 번 더 막는다.

```java
// 모르는 값/FOLLOW_UP → 전부 EXPECTED 로 강등
case "TECH", "PERSONALITY", "SITUATION", "EXPECTED" -> value.toUpperCase(...);
default -> "EXPECTED";
```

즉 **스키마(생성 단계)와 정규화(파싱 단계) 두 겹**으로 본질문이 꼬리질문으로 둔갑하는 걸 막는다.

### 4.5 모범답안 백그라운드 일괄 생성

질문을 INSERT한 직후, 같은 트랜잭션 안에서 `afterCommit` 콜백을 등록한다.

```java
TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
    @Override public void afterCommit() {
        backgroundExecutor.run(() -> storeModelAnswers(userId, session, case_, modeLabel, inserted));
    }
});
return listQuestions(userId, sessionId);   // 사용자는 즉시 질문을 받는다
```

이렇게 만든 모범답안은 `model_answer` 컬럼에 저장되며, **first-writer-wins**(채워져 있으면 덮어쓰지 않는 조건부 UPDATE)로 백그라운드 일괄 생성과 채점 시점의 단건 즉시 생성이 경쟁해도 "단 하나의 모범답안"이 유지된다. 이 일관성 덕분에 **화면에 보이는 모범답안 = 채점 기준 = 블라인드 복습 채점 기준**이 항상 같아진다.

### 4.6 사용 로그

LLM 호출이 성공하면 `ai_usage_log`에 `feature_type=INTERVIEW_QUESTION_GEN`, 최종 성공 모델·토큰·크레딧이 기록된다. 폴백이 몇 번 일어났는지는 로그에 남기지 않고 앱 로그 warn으로만 남긴다(최종 성공 모델만 기록).

## 5. 구현 상태 (됨 vs 계획) — 정직 구분

이 기능은 "다 된 것"처럼 보이지만, **기획서가 약속한 입력 조합**과 **자체 LLM 가동 여부**에서 실제와 차이가 있다. 면접에서 이 갭을 정확히 말하는 게 중요하다.

| 항목 | 상태 | 근거 |
| --- | --- | --- |
| 질문 생성 #19 전체 흐름 | 구현됨 | controller→service→gateway 동작 |
| 모범답안 백그라운드 생성 + first-writer-wins | 구현됨 | `afterCommit` + 조건부 UPDATE |
| 모드별 질문 수(압박 3, 기타 6) | 구현됨 | `PRESSURE_QUESTION_COUNT` 등 |
| `type` 오분류 방어 | 구현됨 | enum 제외 + `normalizeType` |
| **C 적합도 · A 프로필 입력 조합** | **미연결(부분 구현)** | 프롬프트엔 회사·직무·공고(B)만 주입 |
| **자체 LLM(OSS)로 질문 생성** | **미가동(계획)** | `OSS_GENERATION_TASKS = Set.of()` (빈 집합) |
| 모드 6종 실사용 | 구현됨(6종) | 프런트 `InterviewMode` 6종 |

:::warning 갭 1 — "B+C+A 조합"은 아직 B만 들어간다
이 페이지의 집중 포인트는 "B 공고 + C 적합도 + A 프로필 조합 → 직무/기술/인성/상황/기업맞춤 질문"이다. **이건 목표 설계(기획·분담 문서)의 그림이다.** 실제 코드(`InterviewOpenAiClient.generateQuestions`)의 userPrompt에는 **회사명·직무명·면접 모드·공고 원문(B)만** 들어간다. 적합도(C)·프로필 스냅샷(A)은 아직 프롬프트에 주입되지 않는다. 면접에서는 "현재는 공고(B) 기반이고, C/A 입력은 데이터 경계는 잡혀 있으나 프롬프트 연결은 다음 단계"라고 말하는 게 정확하다.
:::

:::warning 갭 2 — "자체 LLM이 질문을 만든다"는 아직 아니다
폴백 게이트웨이의 화이트리스트 `OSS_GENERATION_TASKS`가 **빈 집합**이다. 코드 주석이 이유를 명시한다: QGEN(질문 생성)은 학습 데이터가 seed당 1개로 적어 형식이 불안정(질문 대신 프로필/환각을 뱉음)하다. 그래서 **현재 질문 생성은 사실상 Claude(Haiku) → OpenAI 폴백**으로 돈다. 자체 모델은 "디딤돌(Claude)"을 거쳐, 데이터 보강·재학습 후 `"interview_questions"` 같은 task를 화이트리스트에 넣어 점진 교체할 계획이다.
:::

`enum`은 6종(`BASIC/JOB/PERSONALITY/PRESSURE/RESUME/COMPANY`)이 실사용이다. 스키마 컬럼 주석에는 `REAL/PORTFOLIO`도 나열돼 있지만 이는 `VARCHAR(30)` 자유 텍스트 주석일 뿐 DB 제약이 아니며, 프런트 타입은 6종만 정의한다(미사용 잔재).

## 6. 면접 답변 3단계

**1단계 — 무엇 (한 문장).**
"지원 건의 회사·직무·공고를 LLM에 넣어 면접 모드별 예상 질문 6개 안팎을 만들고, 커밋 직후 백그라운드에서 모범답안까지 묶어 만들어 채점 기준으로 재사용하는 기능입니다."

**2단계 — 어떻게 (구조).**
"`InterviewController` → `InterviewServiceImpl.generateQuestions` → `InterviewOpenAiClient` → `FallbackInterviewLlmGateway`로 흐릅니다. 소유 검증 후 공고 원문을 읽어 userPrompt를 조립하고, `interview_questions` JSON 스키마로 강제 출력을 받아 기존 질문을 지우고 `interview_question`에 sort_order 0부터 저장합니다. 질문 INSERT 직후 `afterCommit` 콜백에 모범답안 일괄 생성을 등록해서, 사용자는 질문을 즉시 받고 모범답안은 백그라운드로 채워집니다."

**3단계 — 왜·트레이드오프 (깊이).**
"세 가지 결정이 핵심입니다. (1) 모범답안을 비동기로 만들어 질문 표시를 막지 않되, `afterCommit`으로 커밋 가시성을 보장하고 first-writer-wins로 '화면=채점=복습' 모범답안을 하나로 고정했습니다. (2) LLM의 type 오분류를 스키마 enum 제외 + `normalizeType` 두 겹으로 막았습니다. (3) 현재는 공고(B) 기반이고, 기획이 약속한 적합도(C)·프로필(A) 조합과 자체 LLM 질문 생성은 데이터 부족 때문에 아직 폴백(Claude/OpenAI)으로 두고 점진 교체를 계획 중입니다."

## 7. 꼬리질문 + 모범답안

**Q1. 모범답안을 왜 질문 생성과 같이 만드나요? 채점 때 만들면 안 되나요?**
모범답안이 곧 채점의 만점(100점) 기준 답안지이기 때문입니다. 사용자가 화면에서 본 모범답안과 채점에 쓰인 기준이 다르면 신뢰가 깨집니다. 그래서 질문 생성 시점에 같이 만들어 `model_answer`에 고정합니다. 다만 6개 일괄 생성이 느려 질문 표시를 막을 수 없으므로 백그라운드로 돌리고, 채점이 모범답안보다 먼저 들어오면 그 질문만 단건 즉시 생성으로 폴백해 기준을 보장합니다.

**Q2. 왜 그냥 스레드를 띄우지 않고 `afterCommit`을 썼나요?**
백그라운드 스레드는 별도 커넥션을 씁니다. 트랜잭션이 아직 커밋되지 않았다면 방금 INSERT한 질문이 그 커넥션에서 안 보입니다. 그러면 모범답안 UPDATE가 대상 질문을 못 찾아 누락됩니다. `TransactionSynchronization.afterCommit`은 커밋 완료 후에 실행을 보장하므로, 백그라운드가 새 질문을 확실히 보게 됩니다.

**Q3. 같은 세션에서 질문을 또 생성하면 어떻게 되나요?**
`deleteQuestionsBySessionId`로 기존 질문을 먼저 지운 뒤 다시 INSERT합니다. 즉 재생성은 멱등에 가깝게 "교체"로 동작합니다. (이전 답변·꼬리질문이 걸려 있었다면 그 정리 정책은 별도지만, 질문 자체는 새 세트로 갈립니다.)

**Q4. LLM이 본질문을 꼬리질문(FOLLOW_UP)으로 잘못 분류하면요?**
두 겹으로 막습니다. 본질문 생성용 `questionsSchema()`의 `type` enum에 `FOLLOW_UP`을 넣지 않아 구조화 출력 단계에서 원천 차단하고, 파싱 단계의 `normalizeType`이 모르는 값·`FOLLOW_UP`을 전부 `EXPECTED`로 강등합니다. `FOLLOW_UP`은 꼬리질문 생성 API에서만 코드로 강제 부여합니다.

**Q5. 클래스 이름이 `InterviewOpenAiClient`인데 OpenAI 전용인가요?**
아닙니다. 실제 호출은 `InterviewLlmGateway` → `FallbackInterviewLlmGateway`를 거쳐 자체모델 → Claude(Haiku) → OpenAI 순으로 폴백합니다. 질문 생성은 현재 자체모델 화이트리스트가 비어 있어 실질적으로 Claude→OpenAI로 갑니다. 이름은 역사적 잔재이고, 생성 모델은 `InterviewModelProperties.getGeneration()`(`gpt-5.4-mini` 티어)로 분리돼 있습니다.

**Q6. 기획서에는 적합도(C)·프로필(A)도 질문 입력으로 쓴다는데 실제로 들어가나요?**
현재 프롬프트에는 회사·직무·면접 모드·공고 원문(B)만 들어갑니다. 적합도(C)·프로필(A) 주입은 미연결 상태로, 데이터 경계(읽기 전용 참조)는 정의돼 있으나 프롬프트 연결은 다음 단계입니다. 목표 설계와 현재 구현을 구분해 말하는 게 정확합니다.

## 8. 직접 말해보기

다음을 보지 않고 30초 안에 소리 내어 설명해 보자. 막히면 해당 절로 돌아간다.

1. 질문 생성의 입력 4가지를 말하고, 그중 "지금은 빠져 있는" 두 가지(C·A)를 짚어 보라.
2. 모범답안이 왜 백그라운드인지, 왜 하필 `afterCommit`인지 한 호흡에 설명하라.
3. 압박 모드에서 본질문이 왜 3개인지(그리고 어떻게 총 6개가 되는지) 말하라.
4. "자체 LLM으로 질문을 만든다"가 왜 아직 사실이 아닌지, 코드 근거 한 줄(`OSS_GENERATION_TASKS`)로 설명하라.
5. LLM type 오분류를 막는 두 겹의 방어를 말하라.

## 퀴즈

<QuizBox question="예상 질문 생성 시 LLM 프롬프트(userPrompt)에 실제로 들어가는 입력은?" :choices="['회사명·직무명·면접 모드·공고 원문(B)', '회사·직무·공고 + C 적합도 + A 프로필 전부', 'C 적합도 점수만', '공고 원문 없이 회사·직무만']" :answer="0" explanation="코드(InterviewOpenAiClient.generateQuestions)의 userPrompt에는 회사명·직무명·면접 모드 라벨·공고 원문(B)만 들어간다. 기획이 약속한 적합도(C)·프로필(A)는 아직 프롬프트에 미연결이다." />

<QuizBox question="모범답안 생성을 트랜잭션 커밋 후(afterCommit) 백그라운드로 돌리는 가장 직접적인 이유는?" :choices="['LLM 비용을 아끼려고', '백그라운드 스레드의 별도 커넥션이 방금 INSERT한 질문을 보려면 커밋이 끝나야 하기 때문', '모범답안이 질문보다 먼저 필요해서', 'OpenAI 호출이 트랜잭션 안에서 금지돼서']" :answer="1" explanation="백그라운드 스레드는 별도 DB 커넥션을 쓴다. 커밋 전에는 방금 INSERT한 질문이 그 커넥션에서 안 보이므로 model_answer UPDATE가 누락된다. afterCommit으로 커밋 가시성을 보장한다. (질문 표시를 막지 않으려고 비동기로 돌리는 것은 또 다른 이유다.)" />

<QuizBox question="현재 예상 질문 생성이 자체 LLM(OSS)으로 돌고 있는가?" :choices="['예, 자체 모델이 1차로 생성한다', '아니오, OSS_GENERATION_TASKS가 빈 집합이라 사실상 Claude→OpenAI 폴백으로 돈다', '아바타 모드에서만 자체 모델을 쓴다', '압박 모드에서만 자체 모델을 쓴다']" :answer="1" explanation="FallbackInterviewLlmGateway의 OSS_GENERATION_TASKS = Set.of()(빈 집합)이다. QGEN 학습 데이터가 seed당 1개로 적어 불안정하기 때문에, 질문 생성은 현재 Claude(Haiku)→OpenAI 폴백으로 동작하고 자체 모델은 점진 교체 계획 단계다." />
