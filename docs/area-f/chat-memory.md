# 챗봇 세션 메모리 영속화

> 대화 메모리는 MySQL(`chatbot_conversation_memory`)에 행 단위 JSON으로 영속하고, 인테이크 슬롯은 JVM 인메모리에 둔다 — 둘의 "보존 범위"가 의도적으로 다르다.

## 1. 한 줄 정의 · 이 페이지가 답하는 면접 질문

CareerTuner의 챗봇은 멀티턴 에이전트(LangChain4j `@AiService`)다. 한 번의 LLM 호출이 아니라 여러 턴에 걸쳐 맥락을 쌓는다. 그러면 **그 맥락을 어디에 보관하느냐**가 설계 문제가 된다.

이 페이지가 답하는 면접 질문:

- "챗봇이 새로고침/재시작 뒤에도 이전 대화를 기억하는데, 어떻게 구현했나?"
- "LangChain4j의 `ChatMemoryStore`를 직접 구현했다는데, 무엇을 어떤 테이블에 저장하나?"
- "대화 메모리는 DB에 영속하면서 인테이크 슬롯은 왜 JVM 인메모리에 두나? 그 차이가 의도적인가?"
- "벡터 DB도 외부 세션 스토어(Redis 등)도 안 쓰는데, 그 선택의 트레이드오프는?"

핵심 클래스는 단 두 개로 좁혀진다: `ai/chat/MyBatisChatMemoryStore`(메모리 영속 어댑터) + `ai/chat/ChatMemoryMapper`(MyBatis 매퍼). 거기에 대조군으로 `ai/intake/IntakeSlotTrace`(인메모리 슬롯)가 붙는다.

## 2. 왜 이렇게 설계했나 (의도·트레이드오프)

### 2-1. 왜 메모리를 영속하나

LangChain4j의 기본 메모리 스토어(`InMemoryChatMemoryStore`)는 JVM 힙에 메시지를 들고 있다. 문제는:

- **서버 재시작이면 전부 증발한다.** 배포 한 번에 모든 진행 중 대화가 날아간다.
- **사용자가 탭을 닫았다 다시 열면** 이전 맥락이 사라진다. "아까 그 회사 말한 거 이어서" 같은 흐름이 끊긴다.
- **스케일 아웃 시** 인스턴스 A에 붙었던 대화가 B로 라우팅되면 메모리가 없다.

CareerTuner 챗봇은 단순 FAQ 봇이 아니라 **인테이크 오케스트레이터**까지 같은 대화창에서 돈다(자기소개 모드 선택 → 지원 케이스 확정 → 실행 스트림). 멀티턴이 길어지므로 "이어보기/이어가기"가 제품 가치다. 그래서 메시지 윈도우를 MySQL에 영속하기로 했다.

### 2-2. 왜 별도 인프라(Redis·벡터 DB)를 안 썼나

| 선택지 | 안 쓴 이유 |
| --- | --- |
| Redis 세션 스토어 | 운영 인프라 추가 비용. 이미 MySQL이 단일 진실원이라 일관성·백업·접근제어를 재사용. 대화 메모리는 쓰기 빈도가 낮고(턴당 1회) 행이 작다 |
| 벡터 DB | 메모리는 의미검색 대상이 아님. "최근 N개 메시지를 순서대로" 복원이면 되므로 RDB의 PK 조회로 충분 |
| 메시지마다 1행 (정규화) | 매 턴 윈도우 전체를 읽고 다시 쓰는 접근이라, 행을 쪼개면 N개 조회/삭제가 든다. **윈도우 전체를 한 행 JSON으로** 두면 읽기 1쿼리, 쓰기 1 upsert로 끝난다 |

트레이드오프: 한 행 JSON은 "특정 메시지만 검색/수정"에는 불리하다. 하지만 LangChain4j `ChatMemoryStore` 계약 자체가 `getMessages`/`updateMessages`(윈도우 통째 읽기·쓰기)라, 행 단위 JSON이 계약과 정확히 맞는다. 인터페이스가 요구하는 입출력 단위에 저장 단위를 맞춘 것이다.

### 2-3. 왜 슬롯은 영속 안 했나 (정직한 미완성)

대화 메모리는 영속하지만, **인테이크 슬롯**(확정된 지원 케이스 id·모드·최초 발화)은 1단계에서 JVM 인메모리(`ConcurrentHashMap`)에 둔다. 이유는 "스키마 변경 없이 멀티턴부터 동작시키자"는 단계적 접근이고, 슬롯 세션 DB 영속화는 D·C 합의 후 별도 단계로 미뤄둔 상태다(`IntakeSlotTrace` 클래스 주석에 명시). 5절에서 이 갭을 정직하게 다룬다.

## 3. 어떤 기술로 구현했나 (실제 클래스·테이블 근거)

### 3-1. LangChain4j `ChatMemoryStore` 어댑터

`MyBatisChatMemoryStore`는 LangChain4j의 `dev.langchain4j.store.memory.chat.ChatMemoryStore` 인터페이스를 구현한 스프링 `@Component`다. 어댑터 패턴 — 프레임워크 계약을 우리 DB에 연결한다.

```java
@Component
public class MyBatisChatMemoryStore implements ChatMemoryStore {
    // memoryId = conversationId(Long)
    @Override public List<ChatMessage> getMessages(Object memoryId) {
        String json = mapper.findMessages(toLong(memoryId));
        return (json == null || json.isBlank())
            ? List.of()
            : ChatMessageDeserializer.messagesFromJson(json); // JSON → 메시지
    }
    @Override public void updateMessages(Object memoryId, List<ChatMessage> messages) {
        mapper.upsert(toLong(memoryId), ChatMessageSerializer.messagesToJson(messages)); // 메시지 → JSON upsert
    }
    @Override public void deleteMessages(Object memoryId) { mapper.delete(toLong(memoryId)); }
}
```

핵심은 `ChatMessageSerializer`/`ChatMessageDeserializer`다. LangChain4j가 제공하는 표준 직렬화기로, `UserMessage`/`AiMessage`/`ToolExecutionResultMessage` 등 메시지 타입을 그대로 JSON 배열로 보존한다. 우리는 포맷을 손대지 않고 프레임워크 직렬화 결과를 그대로 저장한다 — 메시지 구조가 바뀌어도 LangChain4j 직렬화기가 흡수한다.

### 3-2. `ChatMemoryStore`를 메모리 윈도우에 얹는 설정

`ChatMemoryConfig`가 `ChatMemoryProvider` 빈을 만든다. `@AiService`(`@MemoryId` 파라미터)가 이 프로바이더를 자동으로 쓴다.

```java
@Bean
public ChatMemoryProvider chatMemoryProvider(ChatMemoryStore chatMemoryStore) {
    return memoryId -> MessageWindowChatMemory.builder()
            .id(memoryId)
            .maxMessages(20)                 // LLM 입력에 실리는 최근 윈도우
            .chatMemoryStore(chatMemoryStore) // ← MyBatis 스토어를 주입
            .build();
}
```

`MessageWindowChatMemory`(LangChain4j)가 "최근 20개"라는 슬라이딩 윈도우를 책임지고, 그 윈도우의 영속 백엔드만 우리 MyBatis 스토어로 갈아끼운 것이다. 즉 **윈도우 정책은 프레임워크, 저장 매체만 우리 것**으로 분리했다.

:::tip 윈도우 크기는 LLM 입력 한정
`maxMessages=20`은 "LLM 프롬프트에 실리는 최근 메시지 수"다. UI에 보여주는 전체 이력과는 별개다. 인테이크 에이전트는 되묻기로 대화가 길어져서 `IntakeAgentConfig`에서 `maxMessages=40`의 **별도 빈**(`intakeChatMemoryProvider`)을 쓴다. 두 에이전트가 같은 `ChatMemoryStore`(MyBatis) 위에 서로 다른 윈도우 크기를 얹는 구조다.
:::

### 3-3. 테이블 — `chatbot_conversation_memory`

DB 패치 `20260623_f_chatbot_memory.sql` + `20260623_f_chatbot_user_link.sql`로 정의된다(★`schema.sql` 본체엔 미반영, patch로만 관리).

| 컬럼 | 타입 | 역할 |
| --- | --- | --- |
| `conversation_id` | `BIGINT AUTO_INCREMENT` PK | 대화 세션 ID, 서버가 새 대화 시작 시 발급 = LangChain4j `memoryId` |
| `user_id` | `BIGINT NULL` | 소유자(로그인 유저). **NULL = 익명 세션 → 복원 대상 아님** |
| `messages_json` | `JSON NOT NULL` | LangChain4j 메시지 윈도우 직렬화 결과 |
| `updated_at` | `DATETIME` `ON UPDATE CURRENT_TIMESTAMP` | 최근 대화 정렬 키 |

`user_id`는 "유저별 이전 대화 자동 복원"의 토대다. 복원 조회 패턴 `WHERE user_id = ? ORDER BY updated_at DESC LIMIT 1`을 위해 **복합 인덱스 `(user_id, updated_at)`** 를 건다 — 단일 인덱스 탐색으로 최근 대화 1건을 뽑는다.

### 3-4. MyBatis 매퍼 (`mapper/ai/ChatMemoryMapper.xml`)

```sql
-- findMessages: 윈도우 JSON 1행 조회
SELECT messages_json FROM chatbot_conversation_memory WHERE conversation_id = #{conversationId}

-- upsert: 있으면 덮어쓰기 (윈도우 통째 갱신)
INSERT INTO chatbot_conversation_memory (conversation_id, messages_json)
VALUES (#{conversationId}, #{messagesJson})
ON DUPLICATE KEY UPDATE messages_json = VALUES(messages_json)

-- createConversation: 빈 대화 생성, AUTO_INCREMENT id 회수
INSERT INTO chatbot_conversation_memory (user_id, messages_json) VALUES (#{userId}, '[]')
-- useGeneratedKeys="true" keyProperty="id" keyColumn="conversation_id"
```

`ON DUPLICATE KEY UPDATE`로 "최초 저장 = INSERT, 이후 턴 = UPDATE"를 단일 쿼리로 처리한다(매 턴 존재 여부 확인 쿼리 불필요). `createConversation`은 `useGeneratedKeys`로 발급된 `conversation_id`를 즉시 회수해 LangChain4j `memoryId`로 쓴다.

## 4. 동작 원리 (흐름·표·작은 코드)

### 4-1. 한 턴의 메모리 라이프사이클

`POST /api/chatbot/ask`(body: `{ question, conversationId? }`)가 진입점이다.

```text
1. conversationId 결정
   - 요청에 있으면 그대로(이어가기)
   - 없으면 memoryStore.createConversation(userId) → 새 행 + AUTO_INCREMENT id
2. 라우팅/응답 생성 (FAQ 게이트 · 인테이크 · 커뮤니티 에이전트)
3. 에이전트 호출 시: agent.chat(conversationId, question)
   - @MemoryId=conversationId 로 ChatMemoryProvider 가 윈도우 로드
   - LangChain4j 가 getMessages(conversationId) → DB JSON 역직렬화
   - LLM 호출 후 updateMessages(conversationId, newWindow) → DB upsert
4. 응답 envelope 반환 (conversationId 포함 → 클라가 다음 턴에 재전송)
```

프레임워크가 `getMessages`/`updateMessages`를 자동으로 호출하므로, 컨트롤러 코드는 "메모리를 직접 관리"하지 않는다. `conversationId`만 올바르게 전달하면 LangChain4j가 우리 스토어를 통해 읽고 쓴다.

### 4-2. 이전 대화 복원 (이어보기)

`GET /api/chatbot/conversations/recent`(인증 필요):

```java
Long conversationId = memoryStore.findRecentConversation(authUser.id());
if (conversationId == null) return ok(null);          // 이전 대화 없음 → 빈 채팅
List<ChatHistoryMessage> messages = memoryStore.getMessages(conversationId)
        .stream().map(this::toHistoryMessage).filter(Objects::nonNull).toList();
return ok(new ChatHistoryResponse(conversationId, messages)); // UI {role,text} 변환
```

비로그인은 `user_id=NULL`로 저장되므로 `findRecentConversationByUser`에 잡히지 않는다 — **익명 대화는 영속은 되되 복원 대상이 아니다.** 프론트는 위젯 마운트 시 `restoreRecent`로 이 엔드포인트를 한 번 쳐서 직전 대화를 복구하고, 이후 `conversationIdRef`로 같은 세션을 이어붙인다.

### 4-3. 두 가지 보존 범위 — 메모리 vs 슬롯

이 영역의 핵심 통찰: **"무엇을 영속하고 무엇을 인메모리에 두는지"가 데이터 성격에 따라 갈린다.**

| 구분 | 대화 메모리 | 인테이크 슬롯 |
| --- | --- | --- |
| 저장소 | MySQL `chatbot_conversation_memory` | JVM `ConcurrentHashMap`(`IntakeSlotTrace`) |
| 키 | `conversation_id` | `conversationId` → `SlotState` |
| 내용 | 직렬화된 메시지 윈도우 | 확정된 caseId·mode·originalQuery |
| 수명 | 영속(재시작·재접속 후 복원) | 프로세스 수명 동안(재시작 시 소실) |
| 채우는 주체 | LangChain4j(메시지 자동 누적) | **코드 검증 통과한 툴 호출 결과만**(LLM 출력 불신) |

슬롯은 왜 LLM 출력을 안 믿는가? `IntakeSlotTrace`는 "슬롯 접지(slot grounding)" 저장소다. `chooseCase`는 `listCases`가 돌려준 화이트리스트 안의 caseId만 `confirmCase`로 확정한다. LLM이 환각으로 만들어낸 caseId는 슬롯에 들어가지 못한다. 메모리(대화 텍스트)는 "기록"이라 그대로 직렬화해도 되지만, 슬롯(실행 파라미터)은 "확정 사실"이라 코드 검증을 거친다 — 같은 멀티턴 상태인데 신뢰 모델이 다르다.

`IntakeSlotTrace`는 ThreadLocal 두 개(요청 스레드 컨텍스트: userId·conversationId, finally에서 `clear()`)와 대화 단위 누적 맵을 분리한다. ThreadLocal은 요청마다 지우되, **대화 누적 슬롯은 다음 턴을 위해 보존**한다 — 이 보존 덕에 멀티턴 ready 판정이 성립한다.

## 5. 구현 상태 (됨 vs 계획) 정직 구분

| 항목 | 상태 | 비고 |
| --- | --- | --- |
| 대화 메모리 DB 영속 | ✅ 구현됨 | `MyBatisChatMemoryStore` + `chatbot_conversation_memory`, upsert/복원 동작 |
| 유저별 이전 대화 복원 | ✅ 구현됨 | `user_id` + `(user_id, updated_at)` 인덱스, `GET /conversations/recent` |
| 커뮤니티/인테이크 윈도우 분리 | ✅ 구현됨 | 20(공유) vs 40(인테이크 전용 빈), 동일 MyBatis 스토어 공유 |
| 익명 세션 처리 | ✅ 구현됨 | `user_id=NULL` 저장은 되되 복원 제외 |
| **인테이크 슬롯 DB 영속** | ⚠️ **미구현(계획)** | 1단계 JVM 인메모리(`ConcurrentHashMap`). 재시작 시 슬롯 소실. D·C 합의 후 별도 단계 |
| DB patch 공유DB 반영 | ⚠️ **불확실** | 모든 F patch가 "(미적용)" 표기, `schema.sql`과 patch 분리 관리. 선행조건 미적용 시 `createConversation`이 `user_id` INSERT에서 실패 |
| 메모리 만료/정리(TTL·GC) | ⚠️ 없음 | 오래된 대화 행 삭제 정책 미구현 — 행은 무한 누적 |

:::warning 정직한 갭
"챗봇이 대화를 기억한다"는 두 층으로 나뉜다. **대화 텍스트(메모리)는 영속**되지만, **인테이크 실행 슬롯은 인메모리**다. 따라서 인테이크 진행 중 서버가 재시작되면 대화 기록은 복원되지만 "어느 케이스·어느 모드를 고르던 중이었는지"(슬롯)는 사라져 다시 물어보게 된다. 면접에서 "다 영속됩니다"라고 뭉뚱그리면 안 되고, 이 경계를 정확히 말해야 한다.
:::

## 6. 면접 답변 3단계

1. **무엇** — "챗봇 대화 메모리를 MySQL 단일 행 JSON으로 영속합니다. LangChain4j의 `ChatMemoryStore` 인터페이스를 `MyBatisChatMemoryStore`로 구현해서, 프레임워크의 메시지 윈도우 백엔드만 우리 DB로 갈아끼웠습니다. `conversationId`가 곧 LangChain4j `memoryId`이자 테이블 PK입니다."

2. **왜** — "재시작·재접속에도 멀티턴 맥락을 잇기 위해서입니다. 챗봇이 FAQ뿐 아니라 인테이크 오케스트레이터까지 같은 창에서 도는 긴 대화라 '이어보기'가 제품 가치였습니다. Redis나 벡터 DB를 따로 두지 않은 건, 메모리는 의미검색 대상이 아니고 'PK로 윈도우 통째 읽고 쓰기'면 충분해서, 이미 단일 진실원인 MySQL을 재사용한 트레이드오프입니다."

3. **어떻게/한계** — "`updateMessages`는 `ON DUPLICATE KEY UPDATE`로 매 턴 윈도우를 통째 upsert하고, 복원은 `(user_id, updated_at)` 인덱스로 최근 대화 1건을 뽑습니다. 다만 정직하게 구분하면, **대화 텍스트는 영속하지만 인테이크 실행 슬롯은 아직 JVM 인메모리**라 재시작 시 슬롯은 소실됩니다 — 슬롯 DB 영속은 다음 단계로 합의해 둔 상태입니다."

## 7. 꼬리질문 + 모범답안

:::details Q1. 왜 메시지를 행마다 쪼개지 않고 한 행 JSON으로 저장했나?
LangChain4j `ChatMemoryStore` 계약 자체가 `getMessages`(윈도우 통째 읽기)/`updateMessages`(윈도우 통째 쓰기)다. 입출력 단위가 "메시지 배열"이므로 저장 단위도 한 행 JSON으로 맞추면 읽기 1쿼리·쓰기 1 upsert로 끝난다. 행을 쪼개면 매 턴 N개 조회/삭제가 들어 인터페이스 계약과 어긋난다. 대신 "특정 메시지만 검색"에는 불리한데, 메모리는 그런 쿼리 대상이 아니라 트레이드오프가 맞다.
:::

:::details Q2. `conversationId`는 누가 어떻게 발급하나?
서버다. 요청에 `conversationId`가 없으면 `memoryStore.createConversation(userId)`가 `chatbot_conversation_memory`에 빈 행(`messages_json='[]'`)을 INSERT하고, `useGeneratedKeys`로 받은 `AUTO_INCREMENT` 값을 회수해 반환한다. 이 id가 응답 envelope에 실려 클라이언트로 가고, 다음 턴부터 클라가 재전송한다. 즉 conversationId는 DB가 발급한 PK이자 LangChain4j `memoryId`다.
:::

:::details Q3. 비로그인 사용자의 대화는 어떻게 처리되나?
`user_id=NULL`로 저장된다. 영속 자체는 되지만 `findRecentConversationByUser`(WHERE user_id = ?)에 잡히지 않아 **복원 대상이 아니다**. 같은 브라우저 세션에서 `conversationId`를 들고 있으면 그 세션 안에서는 이어가지만, 탭을 닫으면 익명 대화는 추적 불가다. 로그인 유저만 "이전 대화 자동 복원"을 받는다.
:::

:::details Q4. 커뮤니티 에이전트와 인테이크 에이전트가 같은 스토어를 쓰는데 메모리가 섞이지 않나?
안 섞인다. 분리축은 `conversationId`(PK)다. 같은 `MyBatisChatMemoryStore`(단일 빈)를 공유하되, 각 에이전트는 자기 `conversationId`로만 읽고 쓴다. 추가로 **윈도우 크기 빈이 분리**돼 있다 — 커뮤니티는 `chatMemoryProvider`(20), 인테이크는 `intakeChatMemoryProvider`(40)를 `@Qualifier`로 주입한다. 저장 매체는 하나, 윈도우 정책만 둘이다.
:::

:::details Q5. 대화 메모리는 영속하면서 인테이크 슬롯은 왜 인메모리인가?
데이터 성격과 단계적 구현 때문이다. 메모리는 "대화 텍스트 기록"이라 LangChain4j가 직렬화해 그대로 보존하면 되지만, 슬롯은 "실행 파라미터(어느 케이스·모드)"라 LLM 환각을 거르려고 **코드 검증 통과한 툴 호출 결과만** `IntakeSlotTrace`에 확정한다(슬롯 접지). 1단계는 스키마 변경 없이 멀티턴부터 동작시키려고 `ConcurrentHashMap` 인메모리로 뒀고, 슬롯 세션 DB 영속화는 D·C 합의 후 별도 단계로 미뤘다. 그래서 재시작 시 대화는 복원되지만 진행 중 슬롯은 소실되는 갭이 남아 있다.
:::

:::details Q6. 오래된 대화 행은 어떻게 정리하나? TTL이 있나?
현재 TTL·GC 정책은 없다 — 정직한 미완성 지점이다. 행은 무한 누적된다. `updated_at`이 있어 "N일 이상 미갱신 익명 대화 삭제" 같은 배치를 붙이기는 쉽지만 미구현이다. 면접에서 물으면 "복원 정렬용 `updated_at`은 이미 있으니 정리 배치 추가는 저비용 후속 작업"이라고 답하면 된다.
:::

## 8. 직접 말해보기

아래를 막힘없이 설명할 수 있으면 이 페이지를 이해한 것이다.

1. `MyBatisChatMemoryStore`가 구현하는 인터페이스 이름과 그 세 메서드(`getMessages`/`updateMessages`/`deleteMessages`)가 각각 어떤 SQL로 매핑되는지.
2. `conversationId`가 LangChain4j `memoryId`이자 테이블 PK라는 점, 그리고 누가 발급하는지.
3. 복원 쿼리 `WHERE user_id = ? ORDER BY updated_at DESC LIMIT 1`과 그걸 받치는 복합 인덱스.
4. 같은 스토어 위에 윈도우 20(커뮤니티) / 40(인테이크)이 어떻게 공존하는지.
5. "대화 메모리는 영속, 인테이크 슬롯은 인메모리"라는 경계와 그 이유(신뢰 모델 차이 + 단계적 구현).

## 퀴즈

<QuizBox question="MyBatisChatMemoryStore가 한 행에 저장하는 messages_json은 무엇으로 직렬화되나?" :choices="['우리가 만든 커스텀 JSON 직렬화기', 'LangChain4j의 ChatMessageSerializer', 'Jackson ObjectMapper 직접 호출', 'MyBatis TypeHandler']" :answer="1" explanation="LangChain4j 표준 ChatMessageSerializer.messagesToJson으로 메시지 윈도우를 통째 직렬화하고, 복원 시 ChatMessageDeserializer.messagesFromJson으로 되돌린다. 포맷을 우리가 손대지 않아 메시지 타입 변경을 프레임워크가 흡수한다." />

<QuizBox question="대화 메모리는 MySQL에 영속하는데, 인테이크 슬롯(확정 케이스·모드)을 1단계에서 JVM 인메모리에 둔 이유로 가장 정확한 것은?" :choices="['MySQL이 ConcurrentHashMap보다 느려서', '슬롯은 보안상 DB에 두면 안 되는 데이터라서', '스키마 변경 없이 멀티턴부터 동작시키려는 단계적 구현이고, 슬롯 영속은 D·C 합의 후 별도 단계라서', '슬롯은 LangChain4j가 자동 관리하므로 우리가 저장할 필요가 없어서']" :answer="2" explanation="IntakeSlotTrace 주석대로 1단계는 스키마 변경 없이 인메모리로 멀티턴을 보존하고, 세션 영속화는 D·C 합의 후 별도 단계다. 그래서 재시작 시 대화는 복원되지만 진행 중 슬롯은 소실되는 갭이 남는다." />

<QuizBox question="user_id가 NULL인 대화 행의 동작으로 옳은 것은?" :choices="['저장 자체가 거부된다', '저장은 되지만 findRecentConversationByUser 복원 대상에서 제외된다', '24시간 후 자동 삭제된다', '모든 유저에게 공유 대화로 노출된다']" :answer="1" explanation="user_id=NULL은 익명 세션이라 영속은 되되 WHERE user_id=? 복원 쿼리에 잡히지 않는다. 로그인 유저만 '이전 대화 자동 복원' 대상이다." />
