# 꼬리 질문 AI 생성 [#20]

> 답변의 빈틈을 검증하는 후속 질문을, 원질문-답변에 묶어 동적으로 생성·저장하고, **압박 면접 전용**으로 좁혀 자체 LLM 학습을 집중시킨 기능.

## 1. 한 줄 정의 · 이 페이지가 답하는 면접 질문

꼬리 질문 생성(#20)은 **지원자가 방금 제출한 답변을 입력으로 받아, 그 답변의 약점·근거 부족·모순을 파고드는 후속 질문을 만들어** 원질문 밑에 인접 저장하는 기능이다. 예상 질문 생성(#19)이 "면접 시작 전 한 번에 6개"를 만든다면, 꼬리 질문은 "답변이 들어온 뒤에야 만들 수 있는" 동적 질문이다.

이 페이지가 답하는 면접 질문:

- "정적인 예상 질문과 달리, 사용자의 답변에 반응하는 꼬리 질문은 어떻게 구현했나요?"
- "왜 꼬리 질문을 모든 모드가 아니라 압박 면접에만 붙였나요?"
- "원질문-답변-꼬리질문의 부모-자식 관계를 DB에서 어떻게 저장하고 정렬했나요?"

핵심 엔트리 포인트는 `POST /api/interview/questions/{questionId}/follow-ups` → `InterviewController.generateFollowUps`(`controller/InterviewController.java:105-110`) → `InterviewServiceImpl.generateFollowUps`(`service/InterviewServiceImpl.java:265-311`)다.

## 2. 왜 이렇게 설계했나 (의도 · 트레이드오프)

이 기능의 설계는 "꼬리 질문을 어디까지 허용할 것인가"라는 **범위 결정**이 핵심이다.

| 결정 | 선택 | 이유 / 트레이드오프 |
| --- | --- | --- |
| 적용 모드 | **압박 면접 전용** | 모든 모드에 붙이면 세션이 길어지고, 자체 LLM의 PROBE(후속질문) 학습 데이터가 모드별로 분산된다. 압박에 집중해 학습을 모은다. |
| 답변 선행 | **필수** | 꼬리 질문은 정의상 답변의 빈틈을 찌르는 것이라 답변이 없으면 만들 근거가 없다. |
| 생성 개수 | 압박은 **1개 고정** | "국비 주니어 수준에서 한 번만 깊게 찌르고 멈춘다"는 면접 페르소나. 무한 반박은 면접이 아니라 추궁이 된다. |
| type 처리 | 응답 무시, **항상 FOLLOW_UP 강제** | LLM이 type을 `EXPECTED`로 잘못 뱉어도 화면에서 꼬리질문 배지가 깨지지 않게 한다. |
| 정렬 | 부모 질문 **바로 밑에 인접** | "Q3 → Q3의 반박 → Q4" 순으로 읽혀야 대화 맥락이 살아난다. |

:::tip 왜 압박 전용인가 — 코드 주석이 직접 말한다
`InterviewServiceImpl.java:276`의 주석: *"반박(꼬리) 질문은 압박 면접 전용. 다른 모드는 본질문 6개로 끝낸다(자체 LLM PROBE 태스크를 압박에 집중)."* 이는 일반적인 "모든 답변에 꼬리질문" 설계보다 **의도적으로 좁힌** 것이며, 학습 데이터 집중이라는 자체 LLM 로드맵과 직결된 결정이다.
:::

다른 모드 세션에서 이 API를 호출하면 `INVALID_INPUT` 예외로 거부한다(`:277-279`). 즉 "압박이 아니면 꼬리 질문 자체가 존재하지 않는다"가 서버가 강제하는 불변식이다.

## 3. 어떤 기술로 구현했나 (실제 클래스 · 테이블 근거)

| 계층 | 클래스 / 파일 | 역할 |
| --- | --- | --- |
| Controller | `InterviewController.generateFollowUps` | `POST .../questions/{questionId}/follow-ups` 진입 |
| Service | `InterviewServiceImpl.generateFollowUps` (`:265-311`) | 모드 검증 → 답변 조회 → LLM 호출 → 인접 저장 |
| LLM 호출 | `InterviewOpenAiClient.generateFollowUps` (`:172-212`) | 프롬프트 포맷 + 게이트웨이 호출 + type 강제 |
| 프롬프트 | `InterviewPromptCatalog` (`:57-71`) | `FOLLOWUP_SYSTEM_PROMPT`(일반) / `PRESSURE_FOLLOWUP_SYSTEM_PROMPT`(압박 반박형) |
| 전송 | `FallbackInterviewLlmGateway` | 자체모델 → Claude(Haiku) → OpenAI 폴백 체인 |
| 매퍼 | `InterviewMapper` (`InterviewMapper.xml`) | `findLatestAnswerByQuestionId`, `findMaxSortOrder`, `insertQuestion`, `findQuestionsBySessionId` |
| 테이블 | `interview_question` | `parent_question_id`(self-FK), `question_type`, `sort_order` |

프롬프트 2종은 톤이 명확히 다르다. 일반 프롬프트(`FOLLOWUP_SYSTEM_PROMPT`)는 *"답변의 빈틈·근거 부족·추가로 검증할 포인트를 파고드는 후속 질문"* 을, 압박 프롬프트(`PRESSURE_FOLLOWUP_SYSTEM_PROMPT`)는 *"약점·근거 부족·모순·과장을 짚어 반박... 단 인신공격이 아니라 답변 내용에 대한 압박"* 을 지시한다. 둘 다 *"평가·첨삭은 하지 말고 질문만 생성"* 으로 채점기와 책임을 분리한다.

:::warning 현재 실행 경로는 항상 압박 프롬프트
서비스 단에서 압박이 아니면 아예 예외를 던지므로(`:277-279`), `generateFollowUps`로 들어오는 호출은 **항상 `pressure=true`**다(`:286`). 즉 `FOLLOWUP_SYSTEM_PROMPT`(일반)는 코드상 존재하지만 현재 일반 경로로는 도달하지 않는다 — 클라이언트에서 분기를 다시 열 때를 대비한 분기 자산이다.
:::

## 4. 동작 원리 (흐름 · 표 · 작은 코드)

### 4.1 전체 흐름

```text
[지원자] 본질문에 답변 제출 (압박 모드)
   │
   ▼  POST /questions/{questionId}/follow-ups
[1] findQuestionByIdAndUserId  ─ 질문 + 소유권 검증
[2] requireSession / requireOwned ─ 세션·지원건 소유 확인
[3] mode == PRESSURE 아니면 → INVALID_INPUT (거부)
[4] findLatestAnswerByQuestionId ─ 그 질문의 "최신 답변" 조회
       └ 답변 없거나 공백 → INVALID_INPUT
[5] aiClient.generateFollowUps(원질문, 답변, case, count=1, pressure=true)
       └ 게이트웨이: 자체모델→Claude→OpenAI 폴백
[6] 결과 type 무시, FOLLOW_UP 강제
[7] findMaxSortOrder → ++order 로 새 sort_order 부여
[8] insertQuestion(parent_question_id = 원질문 id)
[9] listQuestions(...) ─ 인접 정렬된 전체 목록 반환
```

### 4.2 부모-자식 연결 (저장의 핵심)

꼬리 질문은 자기 자신이 아니라 **원질문을 가리키는 self-FK**로 묶인다. 저장 로직(`:299-309`)을 축약하면:

```java
Integer maxOrder = interviewMapper.findMaxSortOrder(sessionId); // 세션 전체 max
int order = maxOrder == null ? 0 : maxOrder;
for (GeneratedQuestion q : generated.questions()) {
    interviewMapper.insertQuestion(InterviewQuestion.builder()
        .interviewSessionId(sessionId)
        .parentQuestionId(question.getId())   // ← 원질문에 종속
        .questionType("FOLLOW_UP")            // ← 응답 무시, 강제
        .sortOrder(++order)                   // ← 세션 끝에 append
        .build());
}
```

여기서 `sort_order`는 **세션 전체의 max+1**로, 물리적으로는 테이블 끝에 붙는다. 그런데 화면에서는 부모 바로 밑에 보여야 한다. 이 모순은 **저장이 아니라 조회 시점의 정렬**로 해결한다.

### 4.3 인접 정렬 — 조회 SQL이 부모 밑으로 끌어온다

`findQuestionsBySessionId`(`InterviewMapper.xml:118-128`)는 자기 자신을 LEFT JOIN해 부모의 `sort_order`로 그룹핑한다.

```sql
SELECT q.*
FROM interview_question q
LEFT JOIN interview_question p ON p.id = q.parent_question_id
WHERE q.interview_session_id = #{sessionId}
ORDER BY COALESCE(p.sort_order, q.sort_order),   -- ① 부모 sort_order로 그룹
         (q.parent_question_id IS NOT NULL),     -- ② 같은 그룹은 본질문(0) 먼저, 꼬리(1) 뒤
         q.sort_order, q.id                       -- ③ 안정 정렬
```

`COALESCE(p.sort_order, q.sort_order)`가 핵심이다. 꼬리 질문은 자기 `sort_order`(테이블 끝)가 아니라 **부모의 `sort_order`**를 정렬 키로 빌려 와서, 결과적으로 "본질문 → 그 본질문의 꼬리 → 다음 본질문" 순으로 정렬된다.

### 4.4 "최신 답변" 조회

꼬리 질문의 입력 답변은 `findLatestAnswerByQuestionId`(`InterviewMapper.xml:156-162`)로 `ORDER BY id DESC LIMIT 1`. 같은 질문에 여러 번 답할 수 있으므로(재제출), **가장 최근 답변**을 근거로 삼는다.

### 4.5 개수 결정 로직

압박 경로는 `count=1`로 고정되지만(`:287`), 일반 경로용 헬퍼는 별도로 있다(`resolveFollowUpCount`, `:559-564`): 요청값이 없거나 0 이하면 `DEFAULT_FOLLOWUP_COUNT=2`, 있으면 `MAX_FOLLOWUP_COUNT` 상한. 현재 실행 경로는 압박뿐이라 항상 1개다.

## 5. 구현 상태 (됨 vs 계획) 정직 구분

| 항목 | 상태 |
| --- | --- |
| 압박 모드 답변 → 반박 1개 생성·저장 | **구현됨** (런타임 동작) |
| 부모-자식 self-FK + 인접 정렬 조회 | **구현됨** |
| 프론트 압박 모드 자동 반박 (답변 직후 1회) | **구현됨** (`ExpectedQuestionsTab` `handleFollowUp`) |
| `ai_usage_log`에 `INTERVIEW_FOLLOWUP_GEN` 기록 | **구현됨** (`:294-297`) |
| 일반 모드(비압박) 꼬리 질문 | **비활성** — 서버가 `INVALID_INPUT`로 거부. 프롬프트·`resolveFollowUpCount`는 분기 자산으로 존재하나 도달 불가 |
| 자체 LLM의 PROBE(꼬리질문) 태스크 | **계획** — `OSS_GENERATION_TASKS`가 빈 집합이라 생성은 전부 Claude→OpenAI 폴백. 압박 집중은 이 학습을 모으기 위한 사전 정지작업 |

:::warning 정직하게 — "AI가 답변을 보고 추궁한다"의 실체
현재 꼬리 질문 생성에 실제로 쓰이는 모델은 **자체 LLM이 아니라 Claude Haiku(1차 폴백) 또는 OpenAI**다. 자체 모델 PROBE 태스크는 화이트리스트(`OSS_GENERATION_TASKS`)가 비어 있어 아직 가동하지 않는다. 압박 전용으로 좁힌 것은 그 학습 데이터를 한 모드에 모으기 위한 설계 의도다.
:::

## 6. 면접 답변 3단계

1. **무엇** — "꼬리 질문은 사용자가 방금 낸 답변을 입력으로, 그 답변의 약점·근거 부족·모순을 파고드는 후속 질문을 만드는 동적 질문입니다. 예상 질문이 면접 전 정적 생성이라면, 꼬리 질문은 답변이 들어와야 만들 수 있습니다."
2. **왜** — "모든 모드에 붙이지 않고 **압박 면접 전용**으로 좁혔습니다. 세션이 무한정 길어지는 걸 막고, 자체 LLM의 후속질문(PROBE) 학습 데이터를 한 모드에 집중시키기 위해서입니다. 서버가 압박이 아니면 `INVALID_INPUT`으로 거부해 이 범위를 강제합니다."
3. **어떻게** — "원질문을 가리키는 `parent_question_id` self-FK로 묶어 저장하고, `sort_order`는 세션 끝에 붙이되 조회 SQL이 부모를 LEFT JOIN해 `COALESCE(부모.sort_order, 자기.sort_order)`로 정렬해 화면에서는 부모 바로 밑에 인접 배치합니다. LLM 응답의 type은 무시하고 항상 `FOLLOW_UP`으로 강제해 배지가 깨지지 않게 합니다."

## 7. 꼬리질문 + 모범답안

::: details Q1. 왜 꼬리 질문에 `sort_order`를 부모 바로 다음이 아니라 세션 끝(max+1)으로 붙이나요?
중간 삽입은 뒤따르는 모든 질문의 `sort_order`를 재배열해야 해서 동시성·일관성 비용이 큽니다. 대신 **저장은 단순 append(max+1)**로 끝내고, 화면 순서는 조회 SQL이 부모의 `sort_order`를 빌려와 정렬합니다(`COALESCE(p.sort_order, q.sort_order)`). 저장은 가볍게, 표현은 조회에서 — 책임을 분리한 설계입니다.
:::

::: details Q2. LLM이 반환한 type을 왜 그대로 안 쓰고 항상 FOLLOW_UP으로 강제하나요?
꼬리 질문 스키마는 본질문과 공유하는 `questionsSchema()`라 enum에 `FOLLOW_UP`이 없습니다(`InterviewOpenAiClient.java:377-389`). LLM은 `EXPECTED`/`TECH` 같은 값을 뱉습니다. 하지만 이 질문은 정의상 꼬리질문이므로, 응답 type을 무시하고 코드에서 `FOLLOW_UP`을 강제합니다(`:204-205`). 본질문 쪽도 대칭으로 `normalizeType`에서 `FOLLOW_UP`을 enum에서 제외해, LLM이 본질문을 꼬리질문으로 오분류하는 버그를 양방향으로 막습니다(`:362-369`).
:::

::: details Q3. 답변이 없으면 어떻게 되나요? 빈 답변 처리는?
`findLatestAnswerByQuestionId`로 답변을 조회한 뒤, 답변이 `null`이거나 `answerText`가 공백이면 `INVALID_INPUT`으로 거부합니다(`:282-284`). 꼬리 질문은 답변의 빈틈을 찌르는 것이라 근거가 되는 답변이 반드시 선행해야 합니다.
:::

::: details Q4. 압박 모드에서 꼬리 질문이 무한히 생성되지 않게 어떻게 막나요?
세 겹입니다. (1) 서버: count를 압박일 때 **1로 고정**(`:287`). (2) 프롬프트: *"국비 주니어 수준에서 한 번만 깊게 찌르고 멈춘다"*. (3) 프론트: `ExpectedQuestionsTab`이 `rebuttalRequested` 플래그와 `alreadyHasRebuttal`(`questions.some(x => x.parentQuestionId === q.id)`)로 같은 질문에 반박을 두 번 만들지 않습니다(`:95-99, 354`). 꼬리질문 카드 자체에는 다시 꼬리질문을 달지 않습니다(`!isFollowUp` 가드).
:::

::: details Q5. 일반 면접에서 꼬리 질문 API를 부르면요?
`MODE_PRESSURE`가 아니면 `BusinessException(INVALID_INPUT, "반박(꼬리) 질문은 압박 면접에서만 생성됩니다.")`로 거부합니다(`:277-279`). 일반용 `FOLLOWUP_SYSTEM_PROMPT`와 `resolveFollowUpCount(기본 2개)` 헬퍼는 코드에 남아 있지만 현재 실행 경로로는 도달하지 않는 분기 자산입니다.
:::

::: details Q6. 프론트에서 압박 모드 꼬리 질문은 어떻게 보이고 흐르나요?
답변 평가(`submitAnswer`)가 끝나면, 압박 모드이고 본질문이며 아직 반박을 요청하지 않았을 때 자동으로 `handleFollowUp()`을 1회 호출합니다(`ExpectedQuestionsTab.tsx:95-99`). 반환된 전체 질문 목록을 `setQuestions`로 갈아끼우는데, `loadExisting` 같은 전체 리로드를 쓰지 않습니다 — 이미 답변·평가가 채워진 카드가 언마운트돼 "초기화"처럼 보이는 걸 막기 위해서입니다(`:67-70`). 꼬리질문 카드는 indigo 배지 + 들여쓰기로 본질문과 시각 구분합니다(`:122-128`).
:::

## 8. 직접 말해보기

다음을 막힘없이 설명할 수 있으면 이 주제를 이해한 것이다.

- 예상 질문(#19)과 꼬리 질문(#20)이 **언제·무엇을 입력으로** 생성되는지 한 문장씩 대비
- 꼬리 질문을 압박 모드로 좁힌 이유 2가지(세션 길이 + 자체 LLM 학습 집중)
- `parent_question_id`(저장) + `COALESCE(p.sort_order, q.sort_order)`(조회)가 어떻게 협력해 부모 밑 인접 배치를 만드는지
- type을 양방향으로 강제/제외하는 이유(`normalizeType` vs `FOLLOW_UP` 강제)
- 무한 반박을 막는 3겹 가드(서버 count=1 / 프롬프트 페르소나 / 프론트 플래그)

이어서 볼 페이지: [예상 질문 생성](/area-d/question-generation) · [답변 평가(멀티에이전트)](/area-d/answer-evaluation) · [폴백 게이트웨이](/area-d/fallback-gateway) · [영역 D 개요](/area-d/)

## 퀴즈

<QuizBox question="꼬리 질문(#20)이 압박 면접 전용으로 좁혀진 가장 큰 설계 의도는?" :choices="['OpenAI 비용 절감', '세션 길이 제한 + 자체 LLM의 PROBE 학습 데이터를 한 모드에 집중', '압박 모드만 답변 저장을 지원해서', '관리자 요구사항']" :answer="1" explanation="코드 주석(InterviewServiceImpl.java:276)이 직접 밝힌다: 다른 모드는 본질문 6개로 끝내고, 자체 LLM PROBE 태스크 학습을 압박에 집중시키기 위함이다. 동시에 세션이 무한정 길어지는 것도 막는다." />

<QuizBox question="꼬리 질문이 화면에서 부모 본질문 바로 밑에 인접 배치되는 메커니즘은?" :choices="['INSERT 시 중간 sort_order를 계산해 삽입', '조회 SQL이 자기 자신을 LEFT JOIN해 COALESCE(부모.sort_order, 자기.sort_order)로 정렬', '프론트가 parentQuestionId로 클라이언트 정렬', 'parent_question_id 컬럼이 없어 ID 순서대로 표시']" :answer="1" explanation="저장은 max+1로 테이블 끝에 append하고, findQuestionsBySessionId가 self LEFT JOIN으로 부모의 sort_order를 빌려와 정렬한다. 저장은 가볍게, 표현은 조회에서 처리하는 분리 설계다." />

<QuizBox question="LLM이 꼬리 질문 응답의 type을 'EXPECTED'로 잘못 반환하면 시스템은 어떻게 처리하나?" :choices="['그대로 EXPECTED로 저장한다', '예외를 던지고 재생성한다', 'type을 무시하고 항상 FOLLOW_UP으로 강제 저장한다', '사용자에게 수정을 요청한다']" :answer="2" explanation="generateFollowUps는 응답 type을 버리고 항상 FOLLOW_UP을 부여한다(InterviewOpenAiClient.java:204-205). 본질문 쪽은 대칭으로 normalizeType에서 FOLLOW_UP을 enum에서 제외해 오분류를 양방향으로 막는다." />
