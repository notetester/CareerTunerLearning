# 면접 후기 AI 요약 [#29]

> 기획에는 "후기 글을 기업·직무·면접유형·난이도·핵심질문·키워드로 요약"하는 기능이 있지만, **전용 요약 파이프라인은 미구현이다.** 이 페이지는 "기능 번호가 있는데 왜 코드가 없는지", 그리고 "그 자리를 무엇이 대신 메우는지"를 정확히 설명한다.

## 1. 한 줄 정의 · 이 페이지가 답하는 면접 질문

면접후기 요약(#29)은 "사용자가 올린 면접 후기 게시글을 읽고, **기업 / 직무 / 면접유형 / 난이도 / 핵심질문 / 키워드** 같은 구조화된 요약 카드를 생성"하려던 기획상 AI 기능이다.

이 페이지가 답하는 면접 질문은 두 가지다.

1. "면접후기 요약 기능은 어떻게 구현했나요?" → **정직하게: 전용 배치 요약 파이프라인은 만들지 않았다.** 대신 두 가지 우회 경로로 같은 사용자 가치를 일부 채운다.
2. "그러면 `AiTaskType.SUMMARY` enum과 `ai_summary_json` 컬럼은 뭔가요?" → **선언만 되어 있고 채우는 코드가 0건인 자리표시자(placeholder)다.** 이걸 "구현됐다"고 말하면 안 된다.

:::warning 정직 구분이 이 페이지의 핵심
번호가 있는 AI 기능이라고 전부 구현된 게 아니다. #29는 **계획됨, 미구현**이다. 면접에서 이걸 "구현했다"고 답하면 후속 질문("그럼 결과는 어느 테이블에 저장되나요?")에서 무너진다. 처음부터 "전용 파이프라인은 미구현이고, 부산물·런타임 요약으로 대체한다"고 말하는 게 정확하고 더 신뢰를 준다.
:::

## 2. 왜 이렇게 설계했나 (의도 · 트레이드오프)

기획 문서에는 #29가 명확한 기능으로 적혀 있는데 왜 전용 코드를 만들지 않았나. 이건 "빼먹은 것"이 아니라 **우선순위와 중복 회피 판단**으로 읽는 게 맞다.

| 판단 | 이유 |
| --- | --- |
| 사전 배치 요약을 따로 만들지 않음 | 같은 후기 글을 이미 **#31 면접질문 추출**이 LLM으로 한 번 통째로 읽는다. 거기서 나오는 `overallNote`(면접 분위기·총평)가 요약의 핵심 절반을 이미 생산한다. 같은 글을 두 번 LLM에 태우는 중복이 생긴다. |
| 기업·직무·난이도는 이미 정형 데이터 | `community_interview_review` 테이블에 `company_name`, `job_role`, `interview_type`, `difficulty`(TINYINT), `result_status`가 **사용자 입력 정형 컬럼**으로 이미 존재한다. 이 차원은 AI가 "요약"할 필요 없이 그대로 카드로 렌더하면 된다. 즉 #29 요약의 상당 부분이 AI 없이도 충족된다. |
| 핵심질문 요약은 #31이 흡수 | "핵심질문 N개"는 #31 추출이 `questions[]`로 이미 구조화한다. 별도 SUMMARY 작업이 또 질문을 뽑으면 두 결과가 충돌·불일치할 위험이 있다. |
| "지금 보는 글 요약해줘"는 런타임이 더 적합 | 사용자가 특정 글을 가리키며 "요약해줘"라고 할 때는 챗봇이 **대화 중 즉석 요약**하는 편이 자연스럽다. 모든 글을 미리 요약해 저장하는 배치는 과투자다. |

트레이드오프는 분명하다. **장점**: LLM 호출 중복 제거, 스키마 단순화, 정형 데이터 재사용. **단점**: "후기 목록에서 각 글의 AI 요약 카드를 미리 보여준다"는 기획 UX는 빠져 있다. 그래서 프론트 community 디렉터리에 요약 렌더 코드가 0건이다(화면 부재가 미구현의 근거).

## 3. 어떤 기술로 구현했나 (실제 클래스 · 테이블 근거)

집중 포인트로 지목된 `CommunityAiService`는 **현재 코드베이스에 존재하지 않는다**(grep 0건). 기획 단계 가칭으로 보이며, 실제 커뮤니티 AI 로직은 `community/moderation/PostModerationService`(검열·태깅·추출·신고분류)와 `ai/chat`(챗봇)으로 흩어져 구현됐다. 면접에서 클래스명을 댈 때 주의해야 할 지점이다.

#29와 직접 관련된 **실재 코드 자산**은 다음과 같다.

| 자산 | 위치 | 상태 |
| --- | --- | --- |
| `AiTaskType.SUMMARY` enum 상수 | `community/moderation/domain/AiTaskType.java:4` | ⚠️ 선언만. enum에 `SUMMARY`가 있으나 이 값으로 작업을 만드는 서비스 호출 0건 |
| `ai_summary_json` JSON 컬럼 | `schema.sql:1168` (`community_interview_review`) | ⚠️ 컬럼 존재. 도메인 필드 `CommunityInterviewReview.aiSummaryJson`도 있으나 **mapper에 이 컬럼을 쓰는 UPDATE/INSERT가 없음** |
| `COMMUNITY_INTERVIEW_SUMMARY` AI 제품 시드 | `schema.sql:1035` (`ai_product` 등록) | ⚠️ 과금/제품 카탈로그에 이름만 등록 |
| `POST_SUMMARY_READY` 알림 타입 | `NotificationCategories.java:33`, 프론트 `notification.ts:112` | ⚠️ 타입 정의만. "요약 완료 시 알림"을 보내는 발신 코드는 없음 |

핵심 증거: `CommunityInterviewReview`를 갱신하는 매퍼는 `ai_extracted_questions`(#31 결과)만 SET 한다.

```xml
<!-- CommunityPostMapper.xml:243 — 추출 결과만 저장, ai_summary_json은 건드리지 않음 -->
UPDATE community_interview_review
   SET ai_extracted_questions = #{aiExtractedQuestions}
 WHERE post_id = #{postId}
```

`ai_summary_json` 컬럼을 SET 하는 SQL은 매퍼 전체에 0건이다. 그래서 "선언만 있고 채우는 코드 없음"이라고 단정할 수 있다.

## 4. 동작 원리 (대체 경로 흐름 · 표 · 작은 코드)

#29의 사용자 가치는 두 갈래로 **부분 대체**된다.

### 대체 1 — #31 추출의 부산물 `overallNote` (배치, 영속됨)

면접질문 추출(#31)이 후기 글을 LLM으로 읽을 때, 스키마에 `overallNote`(면접 분위기/총평) 필드가 들어 있다.

```text
EXTRACT_SCHEMA.properties:
  company, position, interviewDate, resultStatus,
  questions[] { question, questionType, context, followUps[] },
  overallNote   ← 요약의 "분위기/총평" 부분
```

이 `overallNote`는 D의 RAG 지식(`interview_knowledge`)으로 적재될 때 content 본문에 `[면접 분위기]` 섹션으로 흡수된다.

```java
// PostModerationService.java:796 부근 — 추출 결과를 RAG content로 조립
if (result.overallNote() != null) {
    contentSb.append("\n\n[면접 분위기]\n").append(result.overallNote());
}
```

즉 "이 면접의 총평"이라는 요약 차원은 #31의 부산물로 **이미 생산·저장**된다. 다만 그 저장 위치는 #29가 원래 의도한 `ai_summary_json`이 아니라 #31의 추출 결과·RAG content다.

### 대체 2 — 챗봇 런타임 요약 (on-demand, 영속 안 됨)

사용자가 챗봇에게 특정 글을 가리키며 "요약해줘"라고 하면, 커뮤니티 에이전트가 `getPostContent` 툴로 본문을 가져와 **모델이 직접 요약**한다. 사전 배치가 아니라 대화 중 실시간 요약이다.

```java
// CommunityTools.java:56 — 툴 설명에 "네가 직접 요약해 답하라"가 박혀 있음
@Tool("커뮤니티 글 1개의 본문을 가져온다. ... 반환된 본문을 네가 직접 요약해 답한다.")
public String getPostContent(@P("글 ID") Long postId) {
    CommunityPost post = postMapper.findById(postId);
    if (post == null || !"PUBLISHED".equals(post.getStatus()))
        return "해당 글을 찾을 수 없습니다.";
    String content = post.getContent();
    if (content.length() > SUMMARY_SOURCE_MAX)        // SUMMARY_SOURCE_MAX = 2000
        content = content.substring(0, 2000) + "…";
    return "제목: " + post.getTitle() + "\n본문:\n" + content;
}
```

요약 대상 본문을 2000자(`SUMMARY_SOURCE_MAX`)로 절단해 컨텍스트·비용을 제한한다. 요약문은 챗봇 응답으로만 흘러가고 DB에 영속되지 않는다.

### 세 경로 비교

| 차원 | #29 기획 (전용 파이프라인) | 대체1: #31 overallNote | 대체2: 챗봇 런타임 |
| --- | --- | --- | --- |
| 트리거 | 후기 글 작성 시 자동 | 후기 글 작성 시 자동 | 사용자가 "요약해줘" |
| 산출 차원 | 기업·직무·유형·난이도·핵심질문·키워드 | 면접 분위기·총평(+추출질문) | 자유 요약 텍스트 |
| 저장 위치 | `ai_summary_json` (미사용) | `interview_knowledge` content / 추출결과 | 저장 안 함 |
| 상태 | ⚠️ 미구현 | ✅ 구현됨(#31 부산물) | ✅ 구현됨 |

:::tip 정형 차원은 AI가 필요 없다
기업·직무·면접유형·난이도·결과는 `community_interview_review`의 사용자 입력 컬럼으로 이미 정형화돼 있다. 프론트의 면접 메타카드(`PostDetailView`)가 이 컬럼들을 그대로 렌더한다. 즉 #29 요약의 "정형 6차원" 중 상당수는 AI 요약 없이도 화면에 나온다 — 빠진 건 "AI가 글을 읽고 만든 키워드/한줄요약 카드"다.
:::

## 5. 구현 상태 (됨 vs 계획) 정직 구분

| 항목 | 상태 | 근거 |
| --- | --- | --- |
| 전용 SUMMARY 작업 경로 | ❌ 미구현 | `AiTaskType.SUMMARY`를 인스턴스화하는 서비스 호출 0건 |
| `ai_summary_json` 저장 | ❌ 미구현 | 컬럼·도메인 필드 존재하나 매퍼에 SET 없음 |
| `POST_SUMMARY_READY` 알림 발신 | ❌ 미구현 | 타입 정의만, 발신 코드 없음 |
| 프론트 요약 카드 UI | ❌ 미구현 | community 디렉터리에 summary 렌더 0건 |
| #31 overallNote(분위기 총평) | ✅ 구현됨 | 추출 스키마에 포함, `[면접 분위기]`로 RAG 적재 |
| 챗봇 런타임 요약 | ✅ 구현됨 | `getPostContent` + 시스템프롬프트 "직접 요약" 지시 |
| 정형 메타(기업/직무/유형/난이도/결과) | ✅ 구현됨 | 사용자 입력 컬럼, 메타카드 렌더 |

한 줄 결론: **"#29는 전용 요약 파이프라인 미구현. #31 추출의 overallNote(배치) + 챗봇 런타임 요약(on-demand)으로 대체하며, 정형 메타 차원은 사용자 입력 컬럼으로 충족된다."**

## 6. 면접 답변 3단계

1. **무엇 (한 문장)**: "#29 면접후기 AI 요약은 후기 글을 기업·직무·유형·난이도·핵심질문·키워드로 요약하려던 기획 기능인데, **전용 배치 파이프라인은 의도적으로 만들지 않았습니다.**"
2. **왜 (트레이드오프)**: "같은 글을 이미 #31 면접질문 추출이 LLM으로 읽고 `overallNote`로 총평을 생산하고, 기업·직무·난이도는 사용자 입력 정형 컬럼으로 이미 존재합니다. 전용 SUMMARY 작업을 또 만들면 LLM 호출이 중복되고 두 결과가 불일치할 위험이 있어 우선순위에서 뒤로 뺐습니다."
3. **어떻게 (대체 경로)**: "그래서 두 경로로 대체합니다. 배치 쪽은 #31 추출의 `overallNote`가 `[면접 분위기]`로 RAG에 적재되고, 실시간 쪽은 챗봇이 `getPostContent` 툴로 본문을 가져와 직접 요약합니다. enum의 `SUMMARY`와 `ai_summary_json` 컬럼은 채우는 코드가 없는 자리표시자라는 점은 정직하게 구분해 말씀드립니다."

## 7. 꼬리질문 + 모범답안

:::details Q1. `AiTaskType.SUMMARY` enum이 있는데 왜 미구현이라고 하나요?
enum 상수가 정의돼 있는 것과 그 값으로 동작하는 코드가 있는 것은 다릅니다. `SUMMARY`를 `new AiTask`나 `post_ai_result(task_type=SUMMARY)`로 쓰는 호출이 서비스 전체에서 0건입니다. 실제로 인스턴스화되는 task_type은 MODERATION/TAG/INTERVIEW_EXTRACT/REPORT뿐입니다. SUMMARY/EMBEDDING은 스키마 예약어처럼 남겨둔 자리표시자입니다.
:::

:::details Q2. `ai_summary_json` 컬럼이 비어 있는데 테이블에 둔 이유는?
스키마 마이그레이션 비용을 줄이려는 선반영입니다. 나중에 #29 전용 파이프라인을 붙일 때 ALTER TABLE 없이 바로 채울 수 있도록 컬럼·도메인 필드를 미리 선언해 둔 겁니다. 다만 현재는 어떤 매퍼도 이 컬럼을 SET 하지 않습니다 — 매퍼는 `ai_extracted_questions`만 갱신합니다.
:::

:::details Q3. 그러면 사용자는 면접 후기 요약을 전혀 못 보나요?
정형 차원(기업·직무·유형·난이도·결과)은 사용자 입력 컬럼이라 메타카드로 그대로 보입니다. "AI가 읽고 만든 총평"은 #31 추출의 `overallNote`로 생산되지만, 이건 D의 RAG 지식 content에 흡수되는 형태라 후기 화면에 카드로 전시되진 않습니다. 그리고 "이 글 요약해줘"라고 챗봇에 물으면 실시간 요약은 받습니다. 즉 "후기 목록의 미리 만든 AI 요약 카드 UX"만 빠진 상태입니다.
:::

:::details Q4. 챗봇 런타임 요약과 전용 배치 요약의 차이가 뭔가요?
배치는 글 작성 시점에 모든 글을 미리 요약해 DB에 저장하는 방식이고, 런타임은 사용자가 요청한 그 순간 그 글만 요약합니다. 런타임은 저장 비용·갱신 동기화 문제가 없고 사용자가 실제 요청한 글만 LLM에 태우므로 비용 효율이 좋습니다. 대신 "목록을 훑으며 각 글의 요약을 미리 본다"는 UX는 못 줍니다. #29처럼 "모든 후기에 요약 카드"가 목표라면 배치가 맞지만, 트래픽·우선순위를 보고 런타임 우회를 택한 겁니다.
:::

:::details Q5. 챗봇이 요약할 때 본문을 2000자로 자르는 이유는?
`getPostContent`가 `SUMMARY_SOURCE_MAX = 2000`으로 본문을 절단합니다. 컨텍스트 윈도우와 토큰 비용을 제한하고, 매우 긴 글이 들어와도 모델 응답 시간이 폭주하지 않게 하는 안전장치입니다. 면접 후기는 보통 2000자 안에서 핵심이 끝나므로 요약 품질 손실은 작다고 판단한 절충입니다.
:::

:::details Q6. #29를 제대로 구현하려면 무엇이 필요한가요?
세 가지입니다. (1) `community/moderation`에 SUMMARY 작업 경로를 추가해 후기 작성 AFTER_COMMIT 이벤트에 요약을 비동기로 걸고, (2) 결과를 `ai_summary_json`에 저장하면서 `post_ai_result(task_type=SUMMARY)`로 감사 기록을 남기고, (3) 완료 시 `POST_SUMMARY_READY` 알림을 발신하고 프론트에 요약 카드 컴포넌트를 추가합니다. 인프라(이벤트·풀·structured output)는 #30/#31에 이미 다 있으므로, 사실상 스키마 1개와 리스너 1개만 추가하면 됩니다 — 그래서 "미구현이지만 붙이기 쉬운 상태"라고 봅니다.
:::

## 8. 직접 말해보기

다음 질문에 막힘없이 답할 수 있으면 이 페이지를 이해한 것이다.

- "#29 면접후기 요약은 구현됐나요?"라는 질문에 30초로 정직하게 답해보라. (전용 미구현 → 대체 경로 → enum/컬럼은 자리표시자)
- `AiTaskType.SUMMARY`, `ai_summary_json`, `POST_SUMMARY_READY`가 각각 "선언만 있고 비어 있다"는 걸 코드 근거(매퍼에 SET 없음)로 설명해보라.
- 같은 후기 글을 두 번 LLM에 태우지 않으려고 #29를 #31에 흡수시킨 트레이드오프를, 장단점 한 쌍으로 말해보라.
- 챗봇 런타임 요약과 배치 요약 중 이 프로젝트가 왜 후자를 미루고 전자를 택했는지 설명해보라.

연관 학습: [면접질문 추출 #31](/area-f/ai-question-extract) (overallNote가 나오는 곳), [커뮤니티 데이터 모델](/area-f/community-data-model), [LangChain4j 에이전트](/area-f/langchain4j-agent) (챗봇 런타임 요약 툴).

## 퀴즈

<QuizBox question="#29 면접후기 요약의 실제 구현 상태로 가장 정확한 것은?" :choices="['전용 배치 요약 파이프라인이 완성되어 ai_summary_json에 저장된다', '전용 파이프라인은 미구현이고, #31 추출의 overallNote와 챗봇 런타임 요약으로 부분 대체된다', '챗봇만 요약하고 #31과는 무관하다', 'AiTaskType.SUMMARY 작업이 글 작성 시마다 자동 실행된다']" :answer="1" explanation="#29는 전용 SUMMARY 경로가 미구현이다. AiTaskType.SUMMARY enum과 ai_summary_json 컬럼은 선언만 있고 채우는 코드가 0건이며, #31 추출의 overallNote(배치)와 챗봇 getPostContent(런타임)가 그 자리를 부분적으로 대체한다." />

<QuizBox question="ai_summary_json 컬럼이 '미사용'이라고 단정할 수 있는 가장 직접적인 코드 근거는?" :choices="['프론트에 요약 카드 UI가 없어서', '매퍼에 이 컬럼을 SET 하는 SQL이 0건이고, 매퍼는 ai_extracted_questions만 갱신해서', 'AiTaskType enum에서 SUMMARY가 마지막에 있어서', '알림 타입 POST_SUMMARY_READY가 정의돼 있어서']" :answer="1" explanation="CommunityPostMapper.xml은 ai_extracted_questions(#31 결과)만 UPDATE 한다. ai_summary_json을 쓰는 INSERT/UPDATE가 매퍼 전체에 없다는 것이 '채우는 코드 없음'의 직접 증거다. UI 부재는 정황 근거일 뿐이다." />

<QuizBox question="챗봇 런타임 요약(getPostContent)에서 본문을 2000자(SUMMARY_SOURCE_MAX)로 절단하는 주된 이유는?" :choices="['DB 저장 용량 절약', '컨텍스트/토큰 비용 제한과 응답 시간 폭주 방지', '개인정보 마스킹', '면접질문 추출과 결과를 일치시키려고']" :answer="1" explanation="런타임 요약은 DB에 저장하지 않으므로 저장 용량과는 무관하다. 절단은 LLM 컨텍스트 윈도우/토큰 비용을 제한하고 매우 긴 글에서 응답 시간이 폭주하지 않게 하는 안전장치다." />
