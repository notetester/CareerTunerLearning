# LangChain4j 에이전트 — `@AiService` · `@Tool`

> 커뮤니티 챗봇과 인테이크 챗봇은 둘 다 LangChain4j `@AiService` 인터페이스 한 줄로 정의하고, 모델이 스스로 호출하는 read-only `@Tool` 들로 사이트 데이터를 접지(grounding)한다. "프롬프트로 다 시키지" 않고 "도구로 사실을 가져오게" 만든 이유와 구현을 본다.

## 1. 한 줄 정의 · 이 페이지가 답하는 면접 질문

LangChain4j 에이전트는 **선언형 LLM 호출 인터페이스(`@AiService`)** 에 **모델이 필요할 때 직접 부르는 함수(`@Tool`)** 를 붙여, "모델의 추론"과 "코드가 보장하는 사실"을 분리한 구조다. 영역 F에는 이 패턴을 쓴 에이전트가 둘 있다.

- **커뮤니티/FAQ 에이전트** `CommunityChatAgent` — 글 검색·본문 요약·FAQ 검색 툴 3종.
- **인테이크 에이전트** `IntakeChatAgent` — 지원 건 목록·선택·면접 모드 선택 툴 3종(AI 모의면접 시작 슬롯 수집).

이 페이지가 대비하는 면접 질문:

- "왜 프롬프트에 전부 넣지 않고 에이전트 + 도구(tool-calling)로 만들었나?"
- "`@AiService` 인터페이스는 어떻게 동작하나? 구현 클래스는 누가 만드나?"
- "도구를 모델이 부르게 두면 LLM이 거짓말(환각)을 못 하게 어떻게 막았나?"
- "왜 에이전트 반환 타입을 구조화 객체가 아니라 `String` 으로 뒀나?"
- "툴 호출 무한 루프나 폭주는 어떻게 막았나?"

## 2. 왜 이렇게 설계했나 (의도 · 트레이드오프)

핵심 동기는 **"LLM에게 사실을 외우게 하지 말고, 사실은 코드가 쥐고 모델은 말투만 맡게 한다"** 이다.

| 대안 | 문제 | F가 택한 것 |
| --- | --- | --- |
| 모든 글/FAQ를 프롬프트에 통째로 넣기 | 토큰 폭발, 글 늘면 못 버팀, 최신성 깨짐 | 필요할 때만 툴로 검색 |
| 백엔드가 "검색→요약" 절차를 고정 호출 | 사용자가 무엇을 원하는지 분기 폭발, 멀티턴 약함 | 모델이 "언제 어떤 툴을" 판단 |
| 모델 출력(JSON)을 그대로 신뢰 | 환각 링크·없는 글 ID·날조 | 툴이 돌려준 출처만 코드가 기록(접지) |

트레이드오프도 정직하게 본다. 모델에게 "언제 부를지"를 맡기면 **비결정성**과 **툴 폭주(같은 툴 반복 호출)** 위험이 생긴다. F는 이를 두 장치로 누른다.

1. **툴 호출 캡**: 한 응답에서 연속 tool 호출을 최대 3회로 제한(`MAX_TOOL_CALLS = 3`).
2. **FAQ 게이트(에이전트 우회)**: 운영 FAQ처럼 결정적으로 답해야 하는 질문은 에이전트에 들어가기 전에 임베딩 코사인으로 가로채 즉답한다(이 페이지 범위 밖, [통합 라우터·게이트](/area-f/intake-chatbot) 참조). 즉 에이전트는 "정말 추론이 필요한 질문"만 받는다.

:::tip 한 줄 요약
에이전트는 "무엇을 말할지"를 정하고, 툴은 "무엇이 사실인지"를 가져온다. F는 사실 판단권을 LLM에서 빼앗아 코드가 검증한 툴 결과에만 의존하게 만들었다.
:::

## 3. 어떤 기술로 구현했나 (실제 클래스 · 근거)

LangChain4j의 `@AiService` 스타일을 쓴다. **핵심은 인터페이스만 선언하면 LangChain4j가 동적 프록시로 구현체를 만든다**는 것.

```java
// ai/chat/CommunityChatAgent.java — 메서드 한 개짜리 인터페이스
public interface CommunityChatAgent {
    @SystemMessage(fromResource = "prompts/community-chat-system.txt")
    String chat(@MemoryId Long conversationId, @UserMessage String message);
}
```

| 애너테이션 | 역할 |
| --- | --- |
| `@SystemMessage(fromResource = ...)` | 시스템 프롬프트를 리소스 파일에서 로드(코드와 프롬프트 분리) |
| `@UserMessage` | 이 인자가 사용자 발화임을 표시 |
| `@MemoryId` | 대화 메모리를 묶는 키 — 여기선 `conversationId`(멀티턴 기억) |
| `@Tool` / `@P` | 모델이 부를 수 있는 함수와 그 파라미터 설명 |

빈은 자동 등록이 아니라 **`AiServices.builder` 로 직접 조립**한다. 이유는 가드레일(툴 캡)을 손으로 걸기 위해서다.

```java
// ai/chat/CommunityAgentConfig.java
return AiServices.builder(CommunityChatAgent.class)
        .chatModel(chatModel)                 // ollama 스타터가 만든 ChatModel(qwen3:8b)
        .chatMemoryProvider(chatMemoryProvider) // 메모리 윈도우 20
        .tools(communityTools)                // @Tool 빈 등록
        .maxSequentialToolsInvocations(3)     // 폭주 차단
        .build();
```

툴은 평범한 스프링 `@Component` 의 메서드에 `@Tool` 만 붙인 것이다. 모델은 메서드 시그니처가 아니라 **`@Tool`/`@P` 설명 문자열**을 보고 "언제·무슨 인자로" 부를지 정한다.

```java
// ai/chat/CommunityTools.java (요지)
@Tool("사용자가 커뮤니티의 면접 후기/자소서/취업 글을 찾거나 추천받고 싶어할 때 호출한다.")
public List<PostHit> searchCommunityPosts(@P("관심사/직무/회사/키워드") String query,
                                          @P("글 종류 필터, 불명확하면 빈 문자열") String category) {
    List<PostHit> hits = searchService.search(query, category);
    searchTrace.add(hits);   // ← 링크 접지: 실제로 돌려준 글만 기록
    return hits;
}
```

**근거가 되는 실제 클래스:**

| 영역 | 에이전트(`@AiService`) | 설정(`AiServices.builder`) | 툴(`@Tool`) | 접지 저장소 |
| --- | --- | --- | --- | --- |
| 커뮤니티/FAQ | `ai/chat/CommunityChatAgent` | `CommunityAgentConfig` | `CommunityTools`(3종) | `SearchTrace` |
| 인테이크 | `ai/intake/IntakeChatAgent` | `IntakeAgentConfig` | `IntakeTools`(3종) | `IntakeSlotTrace` |

서빙 모델은 **로컬 Ollama의 `qwen3:8b`**(에이전트 본답변·화행 분류용). LangChain4j Ollama 스타터 연동의 일반론은 [LangChain4j × Ollama](/ai/langchain4j-ollama)에서 다룬다.

## 4. 동작 원리 (흐름 · 표 · 작은 코드)

### 4-1. 한 턴의 흐름 (커뮤니티 에이전트)

```text
사용자 발화
  └→ (FAQ 게이트 통과: 추론이 필요한 질문만 여기로)
       └→ CommunityChatAgent.chat(conversationId, message)
            ├ LangChain4j가 system+memory+tool 스키마를 묶어 qwen3:8b 호출
            ├ 모델이 searchCommunityPosts / getPostContent / searchFaq 중 호출 결정
            │    └ 툴 실행 → SearchTrace 에 "실제로 돌려준 출처" 기록
            ├ (툴 결과를 다시 모델에 먹여 답 생성, 최대 3회 반복)
            └ String 답변 반환
       └→ 답변은 모델 텍스트, links 는 SearchTrace(툴 출력)에서만 생성
```

### 4-2. 세 가지 환각 방어선

이 페이지의 핵심. 모델은 똑똑하지만 **거짓 링크/없는 글 ID/날조한 사실**을 만들 수 있다. F는 세 겹으로 막는다.

| 방어선 | 무엇을 막나 | 구현 |
| --- | --- | --- |
| **출처 접지** | 모델이 만든 링크를 그대로 노출 | `SearchTrace`/`IntakeSlotTrace`에 **툴이 실제 반환한 것만** 기록, 링크는 모델 JSON이 아니라 여기서 생성 |
| **read-only 경계** | 모델이 글 삭제·결제·실행 같은 부수효과 | 툴은 전부 조회만. write/실행 액션은 애초에 노출 안 함 |
| **코드 검증 화이트리스트** | 모델이 없는 지원 건/모드를 "골랐다"고 우김 | `chooseCase`는 `listCases`가 보여준 목록 안의 id만 통과(`IntakeTools` 검증) |

```java
// ai/intake/IntakeTools.java — 모델이 고른 caseId를 코드가 다시 검증
public String chooseCase(@P("확정할 지원 건 id") Long caseId) {
    ApplicationCaseResponse match = trace.fetchedCases().stream()
            .filter(c -> caseId.equals(c.id()))   // listCases 화이트리스트 안에서만
            .findFirst().orElse(null);
    if (match == null) return "그 지원 건을 찾을 수 없어요. 먼저 목록에서 골라 주세요.";
    trace.confirmCase(caseId);  // ← 검증 통과 후에만 슬롯 확정
    return "지원 건을 \"…\" 로 정했어요.";
}
```

### 4-3. 왜 반환 타입이 `String` 인가 (실측 기반 결정)

두 에이전트 모두 `String` 을 반환한다. 코드 주석에 이유가 박혀 있다: **qwen3:8b는 구조화 POJO/JSON 반환을 강제하면 tool_call을 건너뛰고 JSON만 즉시 뱉는 충돌**이 실측됐다. 그래서 본답변은 `String` 으로 받고, 구조화가 필요한 부수 산출물은 **툴/메모리가 없는 별도 에이전트**(`QuickReplyAgent`, `List<String>` 반환)로 분리해 충돌을 피한다. 구조화 출력 자체의 일반론은 [구조화 출력](/ai/openai-structured-output) 참조.

```java
// ai/chat/QuickReplyAgent.java — 툴·메모리 없음 → 구조화 출력이 툴과 충돌하지 않음
public interface QuickReplyAgent {
    @SystemMessage("…후속 칩 1~3개, 12자 이내…")
    List<String> suggest(@UserMessage String context);
}
```

### 4-4. 슬롯 접지 (인테이크 멀티턴)

인테이크는 여러 턴에 걸쳐 "지원 건(caseId) → 면접 모드(mode)"를 모은다. `IntakeSlotTrace`는 두 보존 범위를 구분한다.

- **요청 스레드 컨텍스트**(`ThreadLocal`로 userId·conversationId): 매 요청 주입, `finally`에서 제거 — 동시성 안전.
- **대화 단위 누적 슬롯**(`ConcurrentHashMap`, conversationId 키): 이전 턴 확정값을 다음 턴까지 보존해야 `ready` 판정이 성립.

확정된 슬롯만 `AutoPrepRequest(query, caseId, mode, …)`로 조립되고, **실제 모의면접 실행 여부(ready/nextAsk)는 영역 D의 `AutoPrepIntakeService.intake()`에 위임**한다(의존 그래프 재구현 금지). 즉 인테이크 챗봇은 "슬롯 수집"까지, 실행 스트림은 D 소유. 자세한 흐름은 [인테이크 챗봇](/area-f/intake-chatbot) 참조.

## 5. 구현 상태 (됨 vs 계획) 정직 구분

| 항목 | 상태 | 비고 |
| --- | --- | --- |
| 커뮤니티 에이전트 `@AiService` + 툴 3종 | ✅ 구현됨 | 글검색·본문요약·FAQ검색, 툴 캡 3, 메모리 윈도우 20 |
| 인테이크 에이전트 `@AiService` + 툴 3종 | ✅ 구현됨 | listCases/chooseCase/chooseMode, 전용 메모리 윈도우 40 |
| 출처 접지(`SearchTrace`/`IntakeSlotTrace`) | ✅ 구현됨 | 툴 반환분만 기록, 링크 화이트리스트 |
| 대화 메모리 영속(`MyBatisChatMemoryStore`) | ✅ 구현됨 | `chatbot_conversation_memory`에 JSON 직렬화 |
| 인테이크 슬롯 세션 DB 영속 | ✅ 구현됨 | `chatbot_intake_slot` upsert, PENDING 복원, 대화 삭제 동반 정리 |
| 사용자 인테이크 프런트 | ✅ 구현됨 | 공통 챗봇 칩·파일 handoff와 AutoPrep run 연결 |
| 에이전트 LLM 폴백(장애 시 다른 모델) | ⚠️ 없음(예정) | 현재는 Ollama 장애 시 안내 메시지로 graceful degradation |

:::warning 정직 포인트
확정 슬롯은 DB에 저장되지만 아무 상태나 복원하지 않는다. 진행 중 `PENDING`만 되살리고 `READY`·`DONE`은 완료/이탈 세션의 stale 부활을 막기 위해 제외한다. 자동 TTL은 별도다.
:::

## 6. 면접 답변 3단계

1. **무엇**: "커뮤니티·인테이크 챗봇을 LangChain4j `@AiService` 인터페이스로 선언하고, 모델이 필요할 때 직접 부르는 read-only `@Tool`(글검색·요약·FAQ / 지원건·모드 선택)로 사이트 데이터를 접지했습니다."
2. **왜**: "프롬프트에 모든 사실을 넣는 대신 도구로 가져오게 해서 토큰·최신성 문제를 피하고, 사실 판단권을 LLM에서 코드로 옮겨 환각을 막으려는 의도였습니다."
3. **어떻게**: "`AiServices.builder`로 직접 빈을 만들어 툴 캡 3을 걸고, 모델이 만든 링크가 아니라 `SearchTrace`에 기록된 실제 툴 출력으로만 링크를 생성합니다. 인테이크는 `chooseCase`가 `listCases` 화이트리스트로 모델 선택을 재검증해, 검증 통과한 슬롯만 확정합니다."

## 7. 꼬리질문 + 모범답안

:::details Q1. `@AiService` 인터페이스에는 구현 코드가 없는데 어떻게 실행되나?
LangChain4j가 **동적 프록시**로 구현체를 생성한다. 인터페이스의 `@SystemMessage`·`@UserMessage`·`@MemoryId`와 등록된 `@Tool`들을 읽어, 호출 시 시스템 프롬프트 + 대화 메모리 + 툴 스키마를 묶어 LLM(qwen3:8b)을 호출하고, 모델이 tool_call을 내면 해당 자바 메서드를 실행해 결과를 다시 모델에 먹이는 루프를 돌린다. 우리는 자동 등록 대신 `AiServices.builder`로 만들어 `maxSequentialToolsInvocations(3)` 같은 가드레일을 명시적으로 건다.
:::

:::details Q2. 모델이 툴을 부르게 두면 거짓 링크를 만들지 않나?
링크를 **모델 출력에서 뽑지 않는다**. 툴이 실제로 돌려준 출처만 `SearchTrace`(요청 범위 ThreadLocal)에 기록하고, 응답의 링크는 그 기록에서만 생성한다. 모델 텍스트엔 URL을 넣지 말라고 시스템 프롬프트로도 지시하고, 커뮤니티 글 링크는 정규식 화이트리스트로 검증한다. 즉 모델이 어떤 URL을 지어내도 출력 경로에 끼어들 수 없다.
:::

:::details Q3. 왜 에이전트 반환을 구조화 객체가 아니라 `String`으로 뒀나?
실측에서 qwen3:8b는 구조화 POJO/JSON 반환을 강제하면 tool_call을 건너뛰고 JSON만 즉시 뱉는 충돌이 있었다. 그래서 본답변은 `String`으로 받고, 슬롯 같은 구조화 값은 LLM이 만든 JSON이 아니라 **툴 호출 결과를 코드가 검증·확정**한다. 구조화가 꼭 필요한 보조 산출물(quickReplies)은 툴·메모리가 없는 별도 에이전트로 분리해 충돌을 회피했다.
:::

:::details Q4. 커뮤니티 에이전트와 인테이크 에이전트의 메모리는 왜 따로인가?
커뮤니티는 공유 메모리 윈도우 20, 인테이크는 전용 윈도우 40이다. 인테이크는 지원 건·모드를 되묻느라 대화가 길어질 수 있어 더 긴 윈도우가 필요하다. 빈 이름이 달라(`intakeChatMemoryProvider`) 커뮤니티 쪽 주입(윈도우 20)은 그대로 두고 무수정으로 분리했다. 메모리 자체는 `MyBatisChatMemoryStore`가 `chatbot_conversation_memory`에 JSON으로 영속화해 재시작 후에도 conversationId로 복원된다.
:::

:::details Q5. 툴 호출이 무한 루프에 빠지면?
`maxSequentialToolsInvocations(3)`으로 한 응답의 연속 tool 호출을 3회로 캡한다. 로컬 추론 모델이 같은 툴을 반복 호출하는 폭주를 끊기 위한 가드레일이고, 두 에이전트 모두 동일하게 3이다.
:::

:::details Q6. 인테이크 에이전트가 실제 모의면접을 실행하나?
아니다. 인테이크는 **슬롯 수집까지**다. `chooseCase`/`chooseMode`로 확정한 슬롯을 `AutoPrepRequest`로 조립한 뒤, ready/nextAsk 판정은 영역 D의 `AutoPrepIntakeService.intake()`에 위임한다. 준비 완료면 클라이언트가 D의 실행 스트림으로 직접 연결한다. 툴에는 write·실행 액션을 노출하지 않아 경계를 강제한다.
:::

## 8. 직접 말해보기

다음을 막힘없이 30초 안에 설명할 수 있는지 점검한다.

- `@AiService` 인터페이스 한 줄이 어떻게 실행 가능한 에이전트가 되는가(동적 프록시 + 툴 루프).
- 환각 방어 3겹(출처 접지 / read-only 경계 / 코드 검증 화이트리스트)을 각각 한 문장으로.
- `String` 반환을 택한 실측 근거와, 그래도 구조화가 필요한 quickReplies를 어떻게 분리했는지.
- 인테이크 슬롯이 "수집"이고 "실행"은 D 소유라는 경계.

## 퀴즈

<QuizBox question="커뮤니티/인테이크 에이전트의 본답변 메서드 반환 타입을 구조화 객체가 아니라 String으로 둔 직접적인 이유는?" :choices="['String이 직렬화 비용이 더 싸서', 'qwen3:8b가 구조화 출력을 강제하면 tool_call을 건너뛰고 JSON만 뱉는 충돌이 실측돼서', 'LangChain4j가 POJO 반환을 지원하지 않아서', '프론트가 JSON 파싱을 못 해서']" :answer="1" explanation="코드 주석에 명시된 실측 결과다. 그래서 본답변은 String으로 받고, 슬롯은 툴 호출 결과를 코드가 검증·확정하며, 구조화가 필요한 quickReplies는 툴·메모리 없는 별도 에이전트로 분리해 충돌을 피한다." />

<QuizBox question="에이전트 응답의 링크(출처)는 어디에서 생성되는가?" :choices="['모델이 반환한 JSON의 url 필드', '시스템 프롬프트에 하드코딩된 링크', '툴이 실제로 돌려준 출처를 기록한 SearchTrace', 'DB에서 매번 전체 글을 다시 조회']" :answer="2" explanation="링크는 모델 출력이 아니라 SearchTrace(요청 범위 ThreadLocal)에 기록된 실제 툴 반환분에서만 생성한다. 모델이 URL을 지어내도 출력 경로에 끼어들 수 없는 환각 방어의 핵심이다." />

<QuizBox question="인테이크 에이전트가 모델이 고른 caseId를 신뢰하지 않고 검증하는 방식은?" :choices="['모든 caseId를 항상 거부한다', 'listCases가 보여준 목록(화이트리스트) 안의 id만 chooseCase에서 통과시킨다', 'caseId가 양수면 무조건 통과시킨다', '모델에게 한 번 더 물어본다']" :answer="1" explanation="chooseCase는 trace.fetchedCases()(=listCases가 돌려준 화이트리스트) 안에서만 매칭되는 id를 confirm한다. 코드가 검증한 슬롯만 확정하는 슬롯 접지 원칙이다." />
