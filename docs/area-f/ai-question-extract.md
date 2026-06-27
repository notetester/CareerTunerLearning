# 실제 면접질문 AI 추출 [#31]

> 커뮤니티 면접후기 본문에서 "실제로 나온 질문"을 직접 화법 문장으로 구조화해 뽑아내고, 그 결과를 영역 D의 RAG 지식베이스(`interview_knowledge`)에 직접 적재하는 영역 F의 대표 AI 기능.

## 1. 한 줄 정의 · 이 페이지가 답하는 면접 질문

면접후기 글이 올라오면, 본문과 사용자가 입력한 면접 메타데이터를 LLM에 넘겨 **면접관이 실제로 물어볼 법한 직접 화법 질문 목록**을 JSON으로 추출하고, 이를 두 곳(커뮤니티 후기 행 + D의 RAG 테이블)에 저장하는 파이프라인이다.

이 페이지가 막힘없이 답하게 하려는 면접 질문:
- "사용자가 쓴 후기 글에서 어떻게 면접 질문을 뽑아내고, 그걸 다른 사람 모의면접에 어떻게 재활용하나요?"
- "LLM이 본문에 없는 질문을 지어내는 환각을 어떻게 막았나요?"
- "추출 작업이 글쓰기 응답 속도에 영향을 주지 않게 어떻게 설계했나요?"
- "영역 F와 영역 D의 데이터 경계는 어디인가요?"

핵심 클래스는 `PostModerationService.extractInterviewQuestions(Long postId)`이고, 환각 방어와 데이터 경계 두 가지가 이 기능의 진짜 난이도다.

## 2. 왜 이렇게 설계했나 (의도 · 트레이드오프)

이 기능의 본질은 "사람이 자유 형식으로 쓴 후기"를 "기계가 모의면접에 쓸 수 있는 구조화된 질문 은행"으로 바꾸는 것이다. 여기서 세 가지 설계 결정이 갈렸다.

**(1) 왜 추출 결과를 영역 D로 보내나 — F는 생산, D는 소비.**
영역 F가 소유하는 것은 커뮤니티 원문·신고 처리·노출 정책이다. 면접질문이라는 "지식"은 모의면접(영역 D)이 쓴다. 그래서 F는 후기에서 질문을 뽑아 **D가 소유한 `interview_knowledge` 테이블에 `kind=QUESTION_BANK`로 적재만** 하고, 그 지식을 벡터 색인하고 검색하는 책임은 전적으로 D에 둔다. 원본 소유권은 F(커뮤니티 글), 참고 데이터로서의 활용은 D. 이 경계 덕분에 D는 후기 작성 로직을 몰라도 되고, F는 RAG 검색 로직을 몰라도 된다.

**(2) 왜 트랜잭션과 LLM 호출을 분리했나.**
Ollama 호출은 최대 30초가 걸릴 수 있다. 이를 글 저장 트랜잭션에 묶으면 DB 커넥션을 30초간 점유해 커넥션 풀이 고갈된다. 그래서 추출은 글 저장 커밋 **이후** 별도 스레드에서 비동기로 돈다(아래 §4). 사용자는 글이 저장되는 즉시 응답을 받고, 질문 추출은 백그라운드에서 진행된다.

**(3) 왜 프롬프트가 아니라 코드가 데이터를 보증하나.**
가장 중요한 트레이드오프다. LLM은 "본문 그대로 두라"는 지시를 어기고 질문을 임의로 확장하거나, 사용자가 직접 입력한 질문을 빼먹거나 변형하는 경향이 있다. 그래서 이 파이프라인은 **프롬프트의 약속을 신뢰하지 않고, 코드가 직접** 사용자 입력 질문을 verbatim(원문 그대로) 보존하고, AI 출력에서 환각으로 의심되는 부분을 정규화·제거한다. "LLM은 분류·말투 변환만 거들고, 사실 보존은 코드가 책임진다"가 일관된 철학이다.

:::tip 한 문장 요약
F는 후기에서 질문을 **뽑고**, D는 그 질문으로 모의면접을 **돌린다**. 그 사이에서 LLM은 말투를 바꾸고 분류만 하며, 사실 보존은 자바 코드가 강제한다.
:::

## 3. 어떤 기술로 구현했나 (실제 클래스 · 테이블 근거)

| 구성요소 | 실제 식별자 | 역할 |
| --- | --- | --- |
| 진입 트리거 | `CommunityPostServiceImpl` → `InterviewExtractRequiredEvent` 발행 | INTERVIEW_REVIEW 글 생성/수정 시 이벤트 발행 |
| 비동기 리스너 | `InterviewExtractListener.on(...)` | `@TransactionalEventListener(AFTER_COMMIT)` + `@Async("moderationExecutor")` |
| 핵심 파이프라인 | `PostModerationService.extractInterviewQuestions(Long postId)` | 조회 → LLM 호출 → sanitize → 머지 → 2곳 저장 |
| LLM 클라이언트 | `community/moderation/client/OllamaClient.chat(...)` | gemma4 structured output (`format=schema`), 재시도 보유 |
| 출력 스키마 | `EXTRACT_SCHEMA`(정적 `Map`) | `questions`만 required인 JSON Schema |
| 결과 DTO | `InterviewExtractionResult` + 중첩 `ExtractedQuestion` | record 2개 |
| 시스템 프롬프트 | `prompts/interview-extract-system.txt` | 직접 화법 변환 + 환각 방지 규칙 |
| 적재 대상 (F 소유) | `community_interview_review.ai_extracted_questions` | 후기 행에 추출 JSON 보관 |
| 적재 대상 (D 소유) | `interview_knowledge` (`InterviewKnowledgeMapper.insert`) | RAG 지식, `kind=QUESTION_BANK` |
| 감사 로그 | `post_ai_result` (`task_type=INTERVIEW_EXTRACT`) | UNIQUE(post_id, task_type), 재시도 카운트 |
| 관리자 backfill | `AdminInterviewExtractController` (`/api/admin/ai/interview-extract/*`) | 배치/단건 재추출, dryRun |

LLM 백엔드는 로컬 Ollama가 기본값(`OllamaProperties`의 `baseUrl` 기본 `http://localhost:11434`)이며, 모델은 `gemma4`다. 외부 API 키 미발급 환경과 정합을 맞춘 자체 LLM 구성이고, 원격 4090 서버 엔드포인트로는 **설정 오버라이드**로 교체할 수 있다(코드 디폴트가 원격은 아니다).

`InterviewExtractionResult`의 실제 형태(축약):

```java
record InterviewExtractionResult(
    String company, String position, String interviewDate, String resultStatus,
    List<ExtractedQuestion> questions, String overallNote) {

  record ExtractedQuestion(
      String question,        // 직접 화법으로 변환된 메인 질문
      String questionType,    // TECH/PERSONALITY/SITUATION/EXPECTED/FOLLOW_UP
      String context,         // 본문에 명시된 단계/맥락 (없으면 null)
      List<String> followUps) // 부모 질문에 딸린 꼬리질문
}
```

## 4. 동작 원리 (흐름 · 표 · 작은 코드)

### 4-1. 전체 흐름

```text
[면접후기 작성 커밋]
   └─ CommunityPostServiceImpl 가 INTERVIEW_REVIEW 일 때만
        InterviewExtractRequiredEvent(postId) 발행
   └─ (트랜잭션 커밋 후) InterviewExtractListener
        @Async moderationExecutor 스레드에서 실행
   └─ PostModerationService.extractInterviewQuestions(postId)
        ① upsertPending(INTERVIEW_EXTRACT)        — 감사 로그 진행중 표시
        ② 글 + community_interview_review 메타 조회
        ③ userText 조립 (본문 + 메타 + 사용자 사전입력 질문), 8000자 절단
        ④ OllamaClient.chat(systemPrompt, userText, EXTRACT_SCHEMA)  ← gemma4
        ⑤ extractJsonObject → objectMapper.readValue → sanitizeExtractionResult
        ⑥ applyReviewFallback (AI가 메타 echo 안 하면 review 확정값으로 채움)
        ⑦ mergeUserAndAiQuestions (사용자 질문 verbatim 시딩 + dedup)
        ⑧ 저장 2곳:
             - community_interview_review.ai_extracted_questions (F)
             - interview_knowledge insert (D, kind=QUESTION_BANK)
        ⑨ complete(INTERVIEW_EXTRACT, json, model)
```

핵심은 ④~⑦이 전부 **환각 방어 단계**라는 점이다. 한 단계씩 무엇을 막는지 보자.

### 4-2. 환각 방어 4단계

| 단계 | 메서드 | 막는 문제 |
| --- | --- | --- |
| JSON 절단 | `extractJsonObject()` | gemma가 ```json 백틱·인사말을 섞어 반환 → 첫 `{`부터 마지막 `}`까지만 잘라 파싱 |
| null 정규화 | `sanitizeExtractionResult()` / `sanitizeString()` | LLM이 빈 값을 문자열 `"null"`·`"없음"`·`"N/A"`로 채우는 것을 실제 `null`로 변환 |
| 메타 보강 | `applyReviewFallback()` | AI가 회사/직무/결과를 출력에 echo 안 하면, review 행의 **확정값**으로 채움 (AI 출력에 의존 안 함) |
| verbatim 머지 | `mergeUserAndAiQuestions()` | 사용자 사전입력 질문을 **원문 그대로** 시딩하고, AI 추출분 중 중복만 제거 |

`mergeUserAndAiQuestions`의 핵심 의도(축약):

```java
// 1) 사용자 사전입력 질문을 verbatim 시딩 — 문장은 절대 수정 금지.
//    AI가 같은 질문을 echo·분류했으면 questionType/context/followUps'만' 차용.
for (String uq : userQuestions) {
    String key = normalizeForDedup(uq);          // 공백·대소문자·문장부호 정규화
    if (!seen.add(key)) continue;
    var aiMatch = findByNormalized(aiQuestions, key);
    merged.add(new ExtractedQuestion(
        uq,                                       // ← 원문 그대로
        aiMatch != null ? aiMatch.questionType() : null, ...));
}
// 2) AI 추출분 중 사용자 질문과 안 겹치는 것만 추가
```

즉 사용자가 "트랜잭션 격리수준을 물어봤다"라고 입력하면, 그 문장 자체는 **코드가 보존을 보증**하고, AI는 그 질문에 `TECH` 같은 분류 라벨만 붙이도록 역할이 제한된다. 프롬프트도 같은 지시를 하지만(우선순위 규칙 1), 신뢰는 코드에 둔다.

### 4-3. 직접 화법 변환 (프롬프트의 역할)

후기는 보통 간접 화법으로 쓰인다("트랜잭션에 대해 물어봤습니다"). 모의면접에서 가상 면접관이 읽어주려면 직접 화법이어야 한다("트랜잭션의 개념과 동작 원리에 대해 설명해 주시겠어요?"). 프롬프트 `interview-extract-system.txt`가 이 변환을 담당하되, 강한 제약이 걸린다.

- **어미만 바꾼다.** 본문에 없는 내용을 새로 추가하거나 질문을 임의로 구체화·확장하지 않는다. ("API 설계를 물어봤다" → "API 설계에 대해 설명해 주시겠어요?" O / 없던 고려사항을 덧붙이면 X.)
- `questionType`은 5종(`TECH/PERSONALITY/SITUATION/EXPECTED/FOLLOW_UP`)만 사용.
- `context`는 본문에 **명시적으로** 적힌 경우(예: "1차 기술면접에서")에만 채우고, 없으면 `null`. 추정 금지.
- 질문을 못 찾으면 `questions`를 빈 배열 `[]`로 반환.

### 4-4. 영역 D로의 적재 (F→D 경계)

추출된 질문 1건은 `buildInterviewKnowledge()`로 `InterviewKnowledge` 엔티티로 매핑된다. 가독성 있는 구조화 텍스트 본문을 만들고, 메타는 다음과 같이 채워진다.

- `kind = "QUESTION_BANK"`
- `source = "CareerTuner 커뮤니티 #" + postId` — 출처 식별자
- `content` — `[면접 질문]` / `[유형]` / `[회사]` / `[직무]` / `[면접 시기]` / `[면접 결과]` / `[맥락]` / `[꼬리질문]` / `[면접 분위기]` 섹션으로 구성
- `indexed = false` — D의 RAG 색인기(Qdrant 색인)가 나중에 집어가도록 미색인 표시

재적재 시 멱등성을 보장하려고 **`source` 기준으로 기존 행을 delete 후 재삽입**한다. 단 중요한 안전 불변식이 하나 있다:

```java
// 추출 질문이 0건이면 delete 자체를 skip 한다.
// 재적재는 비원자라, delete 후 insert가 0건이면 기존 RAG 지식이 사라진다.
if (result.questions() != null && !result.questions().isEmpty()) {
    postMapper.deleteInterviewKnowledgeBySource(source);
    for (var q : result.questions()) {
        interviewKnowledgeMapper.insert(buildInterviewKnowledge(q, result, postId, source));
    }
}
```

이 가드가 없으면, 글 수정 후 추출이 0건으로 나오는 순간 기존에 잘 쌓아둔 질문 은행이 통째로 날아간다. "delete 후 insert가 비원자"라는 점을 인지하고 막은 것이 면접 포인트.

:::warning overallNote의 이중 역할
`overallNote`(면접 분위기·총평)는 별도 요약 기능(#29)이 미구현이라, 여기서 추출한 값이 `InterviewKnowledge` content의 `[면접 분위기]` 섹션으로 흡수된다. 즉 #29의 빈자리를 #31의 부산물이 일부 메운다.
:::

## 5. 구현 상태 (됨 vs 계획) 정직 구분

| 항목 | 상태 | 설명 |
| --- | --- | --- |
| 추출 파이프라인 본체 | 구현됨 | `extractInterviewQuestions` 전 단계 동작 |
| 직접 화법 변환 + 환각 방어 | 구현됨 | 프롬프트 + 코드 4단계 방어 |
| F→D RAG 적재 | 구현됨 | `interview_knowledge`에 `kind=QUESTION_BANK` insert |
| 사용자 질문 verbatim 보존 | 구현됨 | 코드가 보증, 프롬프트 신뢰 안 함 |
| 비동기 + AFTER_COMMIT | 구현됨 | `moderationExecutor` 풀 공유 |
| 관리자 backfill/재추출 | 구현됨 | dryRun·force·status 옵션 |
| 감사 로그 | 구현됨 | `post_ai_result(INTERVIEW_EXTRACT)` |
| #29 전용 후기 요약 | 미구현(계획) | `ai_summary_json` 컬럼·`SUMMARY` enum은 선언만, 채우는 호출 0건. overallNote와 챗봇 런타임 요약이 대체 |
| D의 RAG 색인(`indexed` true 전환) | D 책임 | F는 `indexed=false`로 적재만, 색인은 영역 D 소관 |
| DB patch 공유 DB 반영 | 불확실 | F 영역 patch는 "(미적용)" 표기 관행 |

정직하게 말하면: **추출과 적재까지가 F의 완성 범위**이고, 그 질문을 실제 모의면접에서 검색·활용하는 부분은 영역 D의 RAG 파이프라인 책임이다. F는 "지식을 만들어 넘긴다"까지다.

## 6. 면접 답변 3단계

**1단계 (한 문장 정의).**
"커뮤니티 면접후기 글에서 LLM으로 실제 면접질문을 직접 화법으로 추출해, 영역 D의 RAG 지식베이스에 모의면접용 질문 은행으로 적재하는 기능입니다."

**2단계 (설계 의도).**
"핵심 난제는 두 가지였습니다. 첫째, LLM이 본문에 없는 질문을 지어내거나 사용자 입력 질문을 변형하는 환각인데, 이건 프롬프트만으로 못 막아서 코드가 사용자 질문을 verbatim 보존하고 AI 출력을 sanitize하도록 했습니다. 둘째, 30초짜리 LLM 호출을 글 저장 트랜잭션에 묶으면 커넥션 풀이 고갈되니, 트랜잭션 커밋 후 비동기 전용 스레드 풀에서 돌립니다."

**3단계 (경계와 트레이드오프).**
"이 기능은 영역 F와 D의 경계에 걸칩니다. 커뮤니티 원문 소유권은 F지만, 추출한 질문은 D가 소유한 `interview_knowledge`에 적재만 합니다. 재적재 시 source 기준 delete 후 insert가 비원자라, 추출 0건이면 delete를 건너뛰어 기존 지식을 보존하는 안전 불변식을 넣었습니다."

## 7. 꼬리질문 + 모범답안

:::details Q1. LLM이 본문에 없는 질문을 지어내면 어떻게 막나요?
다층 방어입니다. 프롬프트 차원에서 "어미만 직접 화법으로 바꾸고 내용 창작 금지, context는 명시적일 때만, 못 찾으면 빈 배열"을 강제합니다. 하지만 프롬프트는 깨질 수 있으므로 코드가 추가로 막습니다. 사용자 사전입력 질문은 `mergeUserAndAiQuestions`에서 원문 그대로 시딩되고 AI는 분류 라벨만 차용하며, 빈 값을 채운 `"null"`·`"없음"` 같은 문자열은 `sanitizeString`이 실제 `null`로 정규화합니다. "사실 보존은 코드, 말투 변환은 LLM"이라는 역할 분리가 핵심입니다.
:::

:::details Q2. 사용자가 직접 입력한 질문과 AI가 추출한 질문이 겹치면요?
`normalizeForDedup`(공백·대소문자·문장부호를 단일 공백으로 축약)으로 정규화 키를 만들어 비교합니다. 같은 질문이면 **사용자 입력을 우선**해 원문을 살리고, AI가 그 질문에 붙인 `questionType`·`context`·`followUps`만 차용합니다. AI 추출분 중 사용자 질문과 안 겹치는 것만 뒤에 덧붙입니다. 사용자 입력 안의 자체 중복도 같은 정규화로 정리합니다.
:::

:::details Q3. 추출 작업이 실패하면 글 작성도 실패하나요?
아니요. 추출은 글 저장 트랜잭션이 **커밋된 후** `@TransactionalEventListener(AFTER_COMMIT)`로 비동기 실행됩니다. 글은 이미 저장됐고 사용자 응답도 끝난 뒤이므로, 추출이 실패해도 사용자 경험에 영향이 없습니다. 실패는 `post_ai_result`에 `fail()`로 기록되고(에러 메시지 500자 절단), 리스너 레벨에서도 예외를 잡아 로그만 남깁니다. 롤백된 글은 AFTER_COMMIT이라 애초에 추출되지 않습니다.
:::

:::details Q4. 같은 글을 여러 번 수정하면 D의 질문이 중복 적재되지 않나요?
`source = "CareerTuner 커뮤니티 #{postId}"`를 키로 기존 행을 delete한 뒤 재삽입해 멱등성을 보장합니다. 다만 "delete 후 insert"가 한 트랜잭션이 아니라, **추출 결과가 0건이면 delete를 건너뜁니다.** 그렇지 않으면 수정 후 추출이 0건일 때 기존에 쌓인 질문 은행이 통째로 사라지기 때문입니다. 0건이면 기존 지식을 그대로 보존하는 게 더 안전하다는 판단입니다.
:::

:::details Q5. 추출한 질문을 D가 바로 검색에 쓸 수 있나요?
바로는 아닙니다. F는 `indexed = false`로 적재만 하고, 벡터 색인(Qdrant)은 영역 D의 RAG 색인기 책임입니다. F가 만든 `interview_knowledge` 원본 텍스트를 D가 임베딩해 색인해야 검색 대상이 됩니다. 이게 F(생산)와 D(소비)의 책임 분리이고, F는 RAG 검색 로직을 몰라도 되도록 경계를 그었습니다.
:::

:::details Q6. AI가 회사명·직무 같은 메타데이터를 출력에서 빠뜨리면요?
`applyReviewFallback`이 처리합니다. 회사/직무/결과는 `community_interview_review` 행에 사용자가 입력한 확정값이 이미 있으므로, AI 출력에서 해당 필드가 `null`이면 review 행의 값으로 채웁니다. AI 출력에 의존하지 않고 확정 데이터를 우선하는 방식입니다. 결과 코드(PASSED/FAILED 등)는 `resultStatusLabel`로 한국어 라벨(합격/불합격)로 변환해 가독성과 TTS를 고려합니다.
:::

## 8. 직접 말해보기

다음을 소리 내어 막힘없이 설명할 수 있으면 이 페이지를 이해한 것이다.

1. 면접후기가 올라온 뒤 추출이 실행되기까지의 **이벤트 흐름**을 트랜잭션 타이밍과 함께 설명하라.
2. 이 기능에서 **프롬프트가 책임지는 것**과 **코드가 책임지는 것**을 각각 두 가지씩 들어라.
3. 추출 0건일 때 delete를 건너뛰는 이유를 "비원자성"이라는 단어를 써서 설명하라.
4. 이 기능이 영역 **F와 D 중 어디까지 책임지는지** 경계를 한 문장으로 그어라.

## 퀴즈

<QuizBox question="면접질문 추출에서 사용자 사전입력 질문의 원문을 보존하는 책임은 어디에 있나?" :choices="['시스템 프롬프트의 우선순위 규칙', '자바 코드의 mergeUserAndAiQuestions 머지 로직', 'Ollama structured output 스키마', 'D의 RAG 색인기']" :answer="1" explanation="프롬프트도 verbatim 보존을 지시하지만 신뢰하지 않는다. 실제 보존은 mergeUserAndAiQuestions가 사용자 질문을 원문 그대로 시딩하고 AI 분류 라벨만 차용하는 코드 로직이 보증한다." />

<QuizBox question="추출 결과 questions가 빈 배열일 때 코드가 하는 행동은?" :choices="['interview_knowledge를 전부 delete한다', 'delete를 건너뛰어 기존 RAG 지식을 보존한다', '예외를 던져 트랜잭션을 롤백한다', '사용자에게 500 에러를 반환한다']" :answer="1" explanation="delete 후 insert가 비원자라, 추출 0건일 때 delete까지 실행하면 기존 질문 은행이 사라진다. 그래서 0건이면 delete 자체를 skip 한다." />

<QuizBox question="이 추출 기능에서 영역 F와 D의 경계로 옳은 것은?" :choices="['F가 질문 추출과 벡터 색인까지 모두 담당한다', 'F는 추출·적재까지, 색인·검색은 D가 담당한다', 'D가 후기 본문 파싱부터 담당한다', 'F와 D가 같은 테이블을 공동 소유한다']" :answer="1" explanation="F는 후기에서 질문을 뽑아 interview_knowledge에 indexed=false로 적재만 한다. 벡터 색인(Qdrant)과 RAG 검색은 D 책임이다. 생산은 F, 소비는 D." />
