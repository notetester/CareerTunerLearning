# 면접 세션 데이터 모델

> 가상 면접의 모든 흐름은 `interview_session`을 뿌리로 하는 4개 테이블(session → question → answer + file_asset)의 관계로 표현된다. 꼬리질문(self-FK), 모범답안(블라인드), 최신 답변, soft delete가 핵심이다.

## 1. 한 줄 정의 · 이 페이지가 답하는 면접 질문

영역 D의 가상 면접은 **지원 건(application_case) 1건에 종속된 세션**을 만들고, 그 세션 아래로 질문을 달고, 질문 아래로 답변을 달아 평가·리포트까지 이어간다. 이 페이지는 그 데이터를 담는 스키마와 관계, 특히 **세션–질문–답변–평가를 어떻게 연결하고 꼬리질문의 부모/순서를 어떻게 표현하는지**를 다룬다.

면접에서 받을 법한 질문:

- "면접 세션 데이터를 어떻게 모델링했나요? 테이블이 몇 개고 관계가 어떻게 됩니까?"
- "꼬리질문은 일반 질문과 같은 테이블인가요, 별도 테이블인가요? 순서는 어떻게 보장하죠?"
- "모범답안은 어디에 저장되고, 왜 사용자에게 바로 안 보여줍니까?"
- "음성·영상 원본은 DB에 저장하나요?"

## 2. 왜 이렇게 설계했나 (의도·트레이드오프)

핵심 설계 결정 4가지다.

| 결정 | 이유 | 트레이드오프 |
| --- | --- | --- |
| **세션을 지원 건에 종속**(`application_case_id` FK, `ON DELETE CASCADE`) | 이 제품의 핵심 단위는 공고가 아니라 "지원 건". 지원 건이 사라지면 그 면접 기록도 함께 정리되는 게 자연스럽다 | 지원 건 없이 떠도는 연습 세션은 만들 수 없음(의도된 제약) |
| **꼬리질문을 별도 테이블이 아니라 같은 `interview_question`에 self-FK로** | 본질문과 꼬리질문은 같은 "질문"이고, 둘을 한 테이블에서 정렬·조회하는 편이 단순하다 | 조회 시 부모를 LEFT JOIN해 인접 정렬하는 약간의 쿼리 복잡도를 감수 |
| **모범답안을 `interview_question`에 두되 DTO에서 가림(블라인드)** | 모범답안 = 화면 표시 = 채점 만점 기준 = 블라인드 복습 채점 기준을 **단 하나로 일치**시키려면 질문에 1개만 고정해야 한다 | 복습 테스트가 블라인드여야 하므로 응답 DTO에서 의도적으로 제외하고 별도 API로만 노출 |
| **음성·영상 원본 미저장**(URL/메타만) | 프라이버시(ADR-002). 원본 미디어 대신 점수·트랜스크립트만 남긴다 | 사후에 원본을 다시 들을 수 없음 — 분석 결과만 신뢰 자산으로 남김 |

## 3. 어떤 기술로 구현했나 (실제 테이블·클래스 근거)

영속성은 **MyBatis만** 사용한다(JPA 금지). 도메인 클래스 ↔ `resources/mapper/interview/InterviewMapper.xml` ↔ 테이블이 1:1로 대응한다. 스키마 정의는 `backend/src/main/resources/db/schema.sql:491-603`, 모범답안 컬럼은 가드형 ALTER 패치 `db/patches/20260612_d_question_model_answer.sql`로 나중에 추가됐다.

소유 테이블과 책임:

| 테이블 | schema.sql | 책임 |
| --- | --- | --- |
| `interview_session` | `491-506` | 세션 1건(모드·총점·리포트 JSON·soft delete·복습 시각) |
| `interview_question` | `508-520` (+`model_answer` 패치) | 본질문·꼬리질문(self-FK)·모범답안 |
| `interview_answer` | `522-535` | 질문당 답변(여러 개 가능)·채점 결과·미디어 URL |
| `interview_agent_step` | `539-554` | 멀티에이전트 채점 trace(자세한 건 [답변 평가](/area-d/answer-evaluation)) |
| `file_asset` | `588-603` | 업로드 파일 메타(실제 바이트는 디스크) |

서비스 진입은 `InterviewServiceImpl`(`service/InterviewServiceImpl.java`), DTO는 `dto/InterviewQuestionResponse`·`InterviewAnswerResponse`, 프론트 타입은 `frontend/src/features/interview/types/interview.ts`가 이 스키마와 "1:1로 맞춘다"라고 파일 주석에 명시돼 있다.

### 3.1 세 테이블의 컬럼 요점

`interview_session` 핵심 컬럼:

```text
application_case_id  FK → application_case (ON DELETE CASCADE)
mode                 VARCHAR(30)  -- BASIC/JOB/PERSONALITY/PRESSURE/RESUME/COMPANY
total_score          INT  NULL    -- 리포트 생성 시 채워짐
report               JSON NULL    -- 리포트 원문(캐시)
started_at/ended_at  DATETIME     -- ended_at 은 리포트 생성이 세팅(세션 종료=리포트)
deleted_at           DATETIME NULL  -- soft delete (NULL=활성)
last_resumed_at      DATETIME NULL  -- 복습 복원 시각(최근 기록 정렬용)
admin_memo           TEXT NULL    -- 운영자 메모(사용자 미노출)
```

`interview_question` 핵심 컬럼:

```text
interview_session_id  FK → interview_session (CASCADE)
parent_question_id    FK → interview_question (self, CASCADE)  -- 꼬리면 원질문 id, 본질문이면 NULL
question              MEDIUMTEXT
model_answer          MEDIUMTEXT NULL  -- 채점 기준 답안지 (패치로 추가, DTO 미노출)
question_type         VARCHAR(30)  -- EXPECTED/TECH/PERSONALITY/SITUATION/FOLLOW_UP
sort_order            INT  -- 0부터
```

`interview_answer` 핵심 컬럼:

```text
question_id      FK → interview_question (CASCADE)
answer_text      MEDIUMTEXT
audio_url        VARCHAR(512) NULL
video_url        VARCHAR(512) NULL
score / feedback / improved_answer  -- 채점 결과(평가기가 채움)
created_at       -- 같은 질문에 답변이 여러 개일 수 있어 "최신"을 가르는 기준
```

:::tip 모드는 schema.sql 주석과 코드가 다르다
`schema.sql:494`의 컬럼 주석은 8종(`...REAL/PORTFOLIO...`)을 나열하지만 이건 `VARCHAR(30)` 위의 **자유 텍스트 주석**일 뿐 DB enum 제약이 아니다. 프론트 `types/interview.ts:8-14`가 실제로 정의하는 사용자 선택 모드는 **6종**(`BASIC/JOB/PERSONALITY/PRESSURE/RESUME/COMPANY`)이다. 코드 기준으로 6종이 정답이고 `REAL/PORTFOLIO`는 미사용 잔재로 본다.
:::

## 4. 동작 원리 (관계 그래프 + 쿼리 + 작은 코드)

### 4.1 관계 그래프

```text
application_case (다른 영역 소유, 읽기전용 참조)
  └─1:N─ interview_session            (deleted_at 으로 soft delete)
            ├─1:N─ interview_question
            │         ├─ parent_question_id ─ self ─▶ interview_question  (꼬리→본질문)
            │         └─1:N─ interview_answer        (재작성하면 여러 행, 최신=가장 큰 id)
            │                   └ audio_url / video_url ── 느슨하게 ── file_asset
            └─1:N─ interview_agent_step  (채점 trace)
```

세 단계 FK가 모두 `ON DELETE CASCADE`이므로 세션을 **하드 삭제**하면 질문·답변·trace가 함께 지워진다. 다만 사용자 "기록 삭제"는 보통 하드 삭제가 아니라 `deleted_at`을 채우는 **soft delete**라서 복원·복습 흐름이 살아 있다. 한편 `interview_training_sample`만은 **일부러 FK가 없어**(`schema.sql:557` 주석) 세션이 지워져도 학습 데이터가 남는다.

### 4.2 질문 생성 — 기존 질문 삭제 후 0부터 INSERT

`InterviewServiceImpl.generateQuestions`(`:116-167`)는 LLM이 만든 질문을 저장하기 전에 **세션의 기존 질문을 통째로 삭제**(`deleteQuestionsBySessionId`)하고 `sort_order`를 0부터 다시 매긴다. 재생성 시 잔재가 섞이지 않게 하는 단순한 멱등 전략이다.

```java
interviewMapper.deleteQuestionsBySessionId(sessionId);
int order = 0;
for (GeneratedQuestion q : generated.questions()) {
    InterviewQuestion entity = InterviewQuestion.builder()
        .interviewSessionId(sessionId)
        .question(q.question())
        .questionType(q.type())
        .sortOrder(order++)
        .build();
    interviewMapper.insertQuestion(entity); // useGeneratedKeys 로 id 채워짐
}
```

질문 INSERT 직후 **트랜잭션 커밋 이후**(`afterCommit`) 백그라운드 스레드가 모범답안 6개를 일괄 생성해 `model_answer`에 채운다. 커밋 후에 거는 이유는 백그라운드의 별도 커넥션이 방금 INSERT한 질문을 봐야 하기 때문이다. 자세한 건 [질문 생성](/area-d/question-generation) 참고.

### 4.3 꼬리질문 — self-FK + 인접 정렬

꼬리질문도 같은 `interview_question` 행이고, `parent_question_id`에 원 질문 id를, `sort_order`에 세션 max+1(`findMaxSortOrder`)을 넣는다. 즉 **저장 순서(sort_order)는 부모 바로 옆이 아니지만**, 조회 쿼리가 부모를 기준으로 다시 묶어 인접하게 정렬한다(`InterviewMapper.xml:118-128`):

```sql
SELECT q.*
FROM interview_question q
LEFT JOIN interview_question p ON p.id = q.parent_question_id
WHERE q.interview_session_id = #{sessionId}
ORDER BY COALESCE(p.sort_order, q.sort_order),   -- ① 부모 sort_order 로 그룹
         (q.parent_question_id IS NOT NULL),     -- ② 같은 그룹 안: 본질문(0) 먼저, 꼬리(1) 뒤
         q.sort_order, q.id                      -- ③ 동률 tie-break
```

`COALESCE(p.sort_order, q.sort_order)`가 포인트다. 본질문은 부모가 없으니 자기 `sort_order`로, 꼬리질문은 **부모의** `sort_order`로 그룹핑돼 같은 그룹으로 묶이고, 두 번째 정렬키 `(parent_question_id IS NOT NULL)`(false=0, true=1)로 본질문이 먼저·꼬리가 뒤에 온다. 결과적으로 화면에는 "본질문 → 그 본질문의 꼬리 → 다음 본질문" 순으로 인접해 보인다. 꼬리질문은 **압박 모드 전용**이라는 점은 [꼬리 질문](/area-d/followup-questions)에서 다룬다.

### 4.4 "최신 답변" — 같은 질문에 여러 답변

`interview_answer`에는 질문당 행이 여러 개일 수 있다(재작성·재제출). "이 질문의 답"을 고를 때는 **가장 큰 id를 최신**으로 본다. `getSessionReview`(`:177-189`)와 꼬리질문 생성의 `findLatestAnswerByQuestionId`가 이 규칙을 쓴다.

```java
// 질문별 최신 답변(가장 큰 id)만 남긴다 — 재작성으로 답변이 여러 개일 수 있다.
for (InterviewAnswer answer : interviewMapper.findAnswersBySessionId(sessionId)) {
    InterviewAnswer current = latestByQuestion.get(answer.getQuestionId());
    if (current == null || answer.getId() > current.getId()) {
        latestByQuestion.put(answer.getQuestionId(), answer);
    }
}
```

### 4.5 답변 제출이 세 가지를 한 트랜잭션에 묶는다

`submitAnswer`(`:313-349`)는 (1) 채점 기준 모범답안 결정 → (2) 멀티에이전트 채점 → (3) `interview_answer` INSERT를 한 흐름에 처리한다. 모범답안은 **프론트가 보낸 값 > 질문에 저장된 값 > 즉시 단건 생성** 우선순위로 정해진다(`:326-333`).

```java
String referenceModelAnswer = blankToNull(request.modelAnswer());            // ① 프론트 값
if (referenceModelAnswer == null)
    referenceModelAnswer = blankToNull(question.getModelAnswer());            // ② 질문 저장값
if (referenceModelAnswer == null)
    referenceModelAnswer = generateModelAnswerForGrading(...);                // ③ 즉시 생성

OrchestratedEvaluation evaluation = orchestrator.evaluateAnswer(..., referenceModelAnswer);

InterviewAnswer answer = InterviewAnswer.builder()
    .questionId(questionId).answerText(request.answerText())
    .audioUrl(blankToNull(request.audioUrl())).videoUrl(blankToNull(request.videoUrl()))
    .score(evaluation.score()).feedback(evaluation.feedback())
    .improvedAnswer(evaluation.improvedAnswer())
    .build();
interviewMapper.insertAnswer(answer);
```

### 4.6 모범답안 블라인드 — DTO가 컬럼을 가린다

`interview_question.model_answer`는 도메인 클래스에는 있지만 **응답 DTO `InterviewQuestionResponse`에는 필드 자체가 없다**(`dto/InterviewQuestionResponse.java`는 `id/sessionId/parentQuestionId/question/questionType/sortOrder`만 노출). 복습 테스트가 블라인드가 되도록 한 의도적 설계이고, 모범답안은 별도 `POST /api/interview/questions/{id}/model-answer`로만 조회한다.

모범답안 갱신은 first-writer-wins다. `updateQuestionModelAnswer`가 `model_answer IS NULL OR ''`일 때만 UPDATE하므로(`InterviewMapper.xml:98-105`), 백그라운드 일괄 생성과 평가 시 지연 단건 생성이 경쟁해도 **단 하나의 모범답안이 고정**돼 "채점=표시=복기"가 항상 일치한다.

### 4.7 미디어 — URL 직접 저장 + 느슨한 file_asset

답변의 `audio_url`/`video_url`은 `submitAnswer`가 요청 값을 그대로 받아 저장한다. `file_asset`은 업로드 파일 메타(`kind=AUDIO/VIDEO`, `ref_type=INTERVIEW_ANSWER`, `ref_id`, `storage_key`)를 들고 실제 바이트는 로컬 디스크에 둔다. 다만 현재 `interview_answer`와 `file_asset`은 **느슨하게만** 연결된다 — 답변은 URL 문자열을 직접 저장하고, `file_asset`은 `ref_type/ref_id`로만 매칭되는 별도 메커니즘이다. 음성·영상 **원본 자체는 저장하지 않고**(ADR-002), 분석 결과는 `interview_media_analysis`(패치 테이블)에 트랜스크립트·지표·점수 JSON으로만 남긴다. 미디어 처리는 [미디어 처리](/area-d/media-handling) 참고.

## 5. 구현 상태 (됨 vs 계획) 정직 구분

| 항목 | 상태 |
| --- | --- |
| session/question/answer 3테이블 + self-FK 꼬리질문 + 인접 정렬 | 구현됨 |
| 모범답안 컬럼·블라인드 DTO·first-writer-wins | 구현됨 |
| soft delete(`deleted_at`) + 복습 복원(`last_resumed_at`) | 구현됨 |
| 최신 답변(=max id) 규칙, 질문당 다중 답변 | 구현됨 |
| 세션 종료 = 리포트 생성(`ended_at` 세팅), 별도 종료 API 없음 | 구현됨(의도된 단순화) |
| `interview_media_analysis`(VOICE/AVATAR 분석 JSON) | 구현됨, schema.sql 본체엔 없고 패치로만 존재 |
| `file_asset` ↔ `interview_answer` 강한 연결 | **느슨함** — URL 직접 저장이 현 동작, ref 메커니즘은 메타 보관용 |
| 모드 `REAL/PORTFOLIO` | **미사용** — 코드가 정의하는 실사용 모드는 6종 |
| 채점 trace 실시간 SSE 스트리밍 | **계획** — 현재는 저장된 `interview_agent_step`을 클라이언트가 순차 재생 |

## 6. 면접 답변 3단계

**1단계(한 줄):** "면접 데이터는 지원 건에 종속된 세션을 뿌리로 session → question → answer 3계층으로 모델링했고, 꼬리질문은 같은 질문 테이블의 self-FK로 표현합니다."

**2단계(구조):** "세션은 `application_case`에 `ON DELETE CASCADE`로 묶이고, 질문은 `parent_question_id` self-FK로 본질문/꼬리질문을 구분합니다. 답변은 질문당 여러 개가 쌓일 수 있어 가장 큰 id를 최신으로 봅니다. 채점 기준이 되는 모범답안은 질문에 1개만 고정하되 응답 DTO에서는 가려 복습을 블라인드로 만듭니다."

**3단계(이유·디테일):** "모범답안을 질문에 고정하고 first-writer-wins UPDATE로 보호한 건 화면 표시·채점 기준·블라인드 복습 채점을 하나로 일치시키기 위해서입니다. 꼬리질문 순서는 부모를 LEFT JOIN해 `COALESCE(부모.sort_order, 자기.sort_order)`로 그룹핑하고 `parent_question_id IS NOT NULL`을 두 번째 정렬키로 둬 본질문 바로 밑에 인접시킵니다. 미디어 원본은 프라이버시(ADR-002)로 저장하지 않고 분석 결과만 별도 테이블에 남깁니다."

## 7. 꼬리질문 + 모범답안

:::details Q1. 꼬리질문은 왜 별도 테이블이 아니라 같은 `interview_question`에 넣었나요?
본질문과 꼬리질문은 본질적으로 같은 "질문"이라 컬럼이 동일합니다. 별도 테이블로 나누면 조회 시 UNION이나 두 번 쿼리가 필요한데, 같은 테이블에 `parent_question_id` self-FK 하나만 두면 한 번의 `SELECT`로 정렬까지 끝납니다. 꼬리면 부모 id, 본질문이면 `NULL`이라는 단순 규칙으로 구분합니다.
:::

:::details Q2. 같은 질문에 답변이 여러 개면 어느 걸 점수로 쓰나요?
`interview_answer`는 질문당 여러 행이 쌓일 수 있어서(재작성·재제출) **가장 큰 id를 최신 답변**으로 봅니다. `getSessionReview`가 질문별로 최신 답변만 매핑하고, 꼬리질문 생성도 `findLatestAnswerByQuestionId`로 최신 답을 입력으로 씁니다. 과거 답변을 지우지 않으므로 이력이 보존됩니다.
:::

:::details Q3. 모범답안을 질문 테이블에 두면서 사용자에게는 어떻게 숨기나요?
컬럼(`model_answer`)은 도메인 객체엔 있지만 응답 DTO(`InterviewQuestionResponse`)에 필드를 두지 않아 직렬화 단계에서 빠집니다. 복습 테스트를 블라인드로 유지하려는 의도이고, 모범답안이 필요하면 별도 `POST /questions/{id}/model-answer` 엔드포인트로만 가져옵니다. 즉 "보기" 버튼을 눌러야만 모범답안이 내려옵니다.
:::

:::details Q4. 모범답안 생성이 백그라운드인데, 채점 시 아직 없으면 어떻게 되나요?
`submitAnswer`가 모범답안을 프론트 값 > 질문 저장값 > 즉시 단건 생성 순으로 해결합니다. 백그라운드 일괄 생성이 아직 안 끝났으면 채점 시점에 그 질문 하나만 즉시 생성해 기준을 보장합니다. 둘이 동시에 써도 `model_answer IS NULL OR ''`일 때만 UPDATE하는 first-writer-wins라 단 하나의 답안지로 고정됩니다.
:::

:::details Q5. 세션 삭제하면 질문·답변도 다 지워지나요?
FK가 전부 `ON DELETE CASCADE`라 세션을 **하드 삭제**하면 질문·답변·agent_step이 연쇄 삭제됩니다. 하지만 사용자 "기록 삭제"는 보통 `deleted_at`을 채우는 **soft delete**라 데이터가 남고 복원·복습이 가능합니다. 예외로 `interview_training_sample`은 일부러 FK가 없어 세션이 지워져도 학습 데이터가 보존됩니다.
:::

:::details Q6. 음성·영상 파일은 DB에 저장하나요?
원본 바이트는 저장하지 않습니다(프라이버시, ADR-002). `interview_answer`에는 `audio_url`/`video_url` 문자열만, `file_asset`에는 메타(`kind`, `ref_type`, `storage_key` 등)만 두고 실제 파일은 로컬 디스크에 둡니다. 비언어 분석은 원본 대신 트랜스크립트·지표·점수 JSON으로 `interview_media_analysis`에만 남깁니다.
:::

## 8. 직접 말해보기

아래를 막힘없이 설명할 수 있으면 이 주제는 통과다.

1. 세션–질문–답변 3테이블의 FK 방향과 `ON DELETE CASCADE`가 어디에 걸려 있는지, soft delete와 어떻게 공존하는지.
2. 꼬리질문이 self-FK로 어떻게 표현되고, `COALESCE` 정렬이 왜 부모 밑에 꼬리를 인접시키는지.
3. 모범답안이 "표시·채점 기준·블라인드 복습"을 하나로 일치시키는 흐름(백그라운드 생성 + afterCommit + first-writer-wins + DTO 블라인드).
4. 같은 질문에 답변이 여러 개일 때 "최신"을 어떻게 정하는지, 미디어 원본을 왜 저장하지 않는지.

## 퀴즈

<QuizBox question="꼬리질문(FOLLOW_UP)은 데이터 모델에서 어떻게 표현되나?" :choices="['별도 interview_followup 테이블에 저장한다', '같은 interview_question 테이블에 parent_question_id self-FK로 표현한다', 'interview_answer 행에 플래그로 표시한다', 'report JSON 안에 인라인으로 들어간다']" :answer="1" explanation="꼬리질문도 같은 interview_question 행이며, parent_question_id 가 원 질문 id 를 가리킨다(본질문은 NULL). 조회 시 부모를 LEFT JOIN 해 인접 정렬한다." />

<QuizBox question="interview_question.model_answer(모범답안)가 일반 질문 응답 DTO에 노출되지 않는 이유는?" :choices="['컬럼 크기가 커서 성능 때문', '복습 테스트를 블라인드로 유지하려고 의도적으로 가린다', '아직 구현되지 않은 컬럼이라서', '관리자만 쓰는 값이라 보안 등급이 달라서']" :answer="1" explanation="모범답안은 채점 기준이자 표시값이지만, 복습 테스트가 블라인드가 되도록 InterviewQuestionResponse 에서 필드를 빼고 별도 POST /questions/{id}/model-answer 로만 조회한다." />

<QuizBox question="같은 interview_question 에 대해 답변이 여러 행 쌓였을 때 '최신 답변'을 고르는 기준은?" :choices="['created_at 이 가장 이른 행', '가장 큰 id 를 가진 행', 'score 가 가장 높은 행', '랜덤으로 하나']" :answer="1" explanation="재작성·재제출로 질문당 답변이 여러 개일 수 있고, 코드(getSessionReview, findLatestAnswerByQuestionId)는 가장 큰 id 를 최신으로 본다. 과거 답변은 지우지 않아 이력이 남는다." />
