# 오케스트레이터 인테이크 챗봇

> 한 줄 자연어 요청을 받아 "어느 지원 건(caseId) · 어떤 면접 모드(mode) · 원본 의도(originalQuery)"라는 슬롯 3개를 멀티턴 대화로 채운 뒤, AutoPrep 실행 입구로 넘기는 챗봇이다. 핵심은 LLM이 자유 생성한 값을 믿지 않고 **코드가 검증한 툴 호출 결과만 슬롯으로 확정**하는 "슬롯 접지(slot grounding)" 패턴.

## 1. 한 줄 정의와 이 페이지가 답하는 면접 질문

인테이크 챗봇은 영역 F가 소유한 세 번째 챗봇이다. FAQ-RAG 챗봇(질문에 답하기)이나 커뮤니티 에이전트(글 검색·요약)와 달리, 이 챗봇의 목적은 **"대화를 실행 가능한 요청 그릇으로 바꾸는 것"** 하나다. 사용자가 "네이버 백엔드 신입 면접 준비해줘"라고 입력하면, 부족한 정보를 한 번에 하나씩 되물어 결국 `AutoPrepRequest{query, applicationCaseId, mode, ...}`를 완성하고, D 영역의 AutoPrep 오케스트레이터(`/api/auto-prep/run/stream`)로 넘긴다.

이 페이지가 막힘없이 답해야 하는 면접 질문:

- 왜 폼(form)이 아니라 챗봇으로 인테이크를 받았나? 트레이드오프는?
- 멀티턴 대화에서 슬롯(caseId/mode)을 어떻게 안정적으로 유지하나?
- LLM이 caseId를 지어내면 어떻게 막나? (환각 방어)
- F가 슬롯만 모으고 실행은 D가 한다 — 이 경계를 코드로 어떻게 강제했나?

## 2. 왜 이렇게 설계했나 (의도와 트레이드오프)

### 2-1. 왜 챗봇으로 인테이크를 받았나

AutoPrep 실행에는 최소 두 개의 결정이 필요하다 — 어떤 지원 건(회사·직무)이고, 면접이 포함된다면 어떤 모드인가. 이를 폼으로 받으면 드롭다운 2개와 "시작" 버튼이 된다. 챗봇을 택한 이유:

| 폼 방식 | 챗봇 방식(채택) |
| --- | --- |
| 사용자가 먼저 모든 필드를 이해해야 함 | "면접 준비해줘" 한 줄이면 시작 |
| 면접 포함 여부를 사용자가 판단 | 의도에서 시스템이 추론(`CASE_REQUIRED` step 판정) |
| 빈 슬롯을 사용자가 채움 | 부족한 슬롯만 한 번에 하나씩 되물음 |
| 진입 장벽 = 화면 학습 비용 | 진입 장벽 = 자연어 한 문장 |

핵심 트레이드오프: 챗봇은 LLM 비결정성·환각이라는 비용을 추가로 진다. 이 비용을 상쇄하는 장치가 바로 슬롯 접지(§4)다. 즉 **"자연어 진입 + 결정적 슬롯 확정"** 의 하이브리드를 노린 설계다.

### 2-2. 왜 String 반환인가 (가장 중요한 실측 결정)

`IntakeChatAgent.chat()`의 반환 타입은 구조화 POJO가 아니라 단순 `String`이다. 주석에 박힌 실측 근거:

> qwen3:8b는 구조화 POJO/JSON 반환을 강제하면 tool_call을 건너뛰고 JSON만 즉시 뱉는 충돌이 있다.

즉 LangChain4j `@AiService`에 POJO 반환을 요구하면, 로컬 모델(qwen3:8b)이 "툴을 호출해서 검증하라"는 지시를 무시하고 머릿속 추측으로 JSON을 채워 버린다. 그래서:

- **답변 본문**은 String(사람에게 보일 한국어 문장)으로만 받는다.
- **슬롯 값**(caseId·mode)은 LLM 출력에서 파싱하지 않고, **툴 호출 결과를 코드가 검증·확정한다.**

이 한 줄의 결정이 이 챗봇 전체 아키텍처를 규정한다.

### 2-3. 왜 슬롯만 모으고 실행은 D인가

영역 경계 원칙: 커뮤니티·고객센터·챗봇은 F, AutoPrep 실행 파이프라인(자소서·면접 답변 생성)은 D 소유다. 그래서 F는 슬롯을 접지(grounding)하는 데까지만 책임지고, "준비됐는가(ready)? 다음에 뭘 물어야 하나(nextAsk)?"의 판정은 D의 `AutoPrepIntakeService.intake()`에 위임한다. 의존 그래프(어떤 step이 caseId를 요구하는지)를 F가 재구현하지 않는다.

## 3. 어떤 기술로 구현했나 (실제 클래스와 계약)

패키지는 팀장 공통 `ai/` 아래 `ai/intake/`다(커뮤니티 챗봇 `ai/chat/`과 형제). 핵심 클래스:

| 클래스 | 역할 |
| --- | --- |
| `IntakeController` | 진입점 `POST /api/chatbot/intake/ask`. 요청 검증 + `conversationId` 발급만 |
| `IntakeChatAgent` | LangChain4j `@AiService` 인터페이스. `chat(@MemoryId Long, @UserMessage String)` → **String** |
| `IntakeAgentConfig` | 에이전트 빈 빌더. qwen3:8b, 전용 메모리 윈도우 40, 툴캡 3 |
| `IntakeTools` | read-only 툴 3종: `listCases` / `chooseCase(caseId)` / `chooseMode(code)` |
| `IntakeSlotTrace` | 슬롯 접지 저장소(ThreadLocal + ConcurrentHashMap) |
| `IntakeAskService` | 한 턴 코어. 에이전트 호출 → 슬롯 스냅샷 → D에 ready 판정 위임 |
| `AutoPrepIntakeService` | **D 소유.** ready/nextAsk/candidates/modes 판정 |

산출물 계약은 `AutoPrepRequest`:

```java
record AutoPrepRequest(
    String query,              // = originalQuery (첫 발화 고정)
    Long applicationCaseId,    // = 확정된 caseId
    String mode,               // = BASIC/JOB/PERSONALITY/PRESSURE/RESUME/COMPANY
    String coverLetterText,    // 2단계 (현재 null)
    List<Long> attachmentFileIds // 2단계 (현재 null)
) {}
```

`ready=true`면 클라이언트가 이 그릇으로 D의 `POST /api/auto-prep/run/stream`을 직접 SSE로 연다.

:::tip 모델 분담
인테이크 에이전트와 화행 분류는 `qwen3:8b`(추론·툴 호출), 검열·태깅·추출·답변 생성은 `gemma4`, 임베딩은 `bge-m3`(1024차원). LLM 백엔드는 로컬 Ollama(`localhost:11434` 코드 기본)이고, 원격 4090 엔드포인트는 설정 오버라이드 값이다.
:::

## 4. 동작 원리 (슬롯 접지의 핵심)

### 4-1. 한 턴 처리 흐름

한 턴의 코어는 `IntakeAskService.ask(userId, message, conversationId)`다:

```text
1. trace.clear()                    // 이전 요청 ThreadLocal 잔재 제거
2. trace.begin(userId, convId, msg) // 요청 컨텍스트 주입 + 첫 발화면 originalQuery 고정
3. answer = agent.chat(convId, msg) // LLM이 필요하면 툴 호출(검증은 툴 내부)
4. slots  = trace.snapshot()        // 코드가 확정한 슬롯만 꺼냄
5. req    = new AutoPrepRequest(originalQuery, caseId, mode, null, null)
6. check  = autoPrepIntakeService.intake(userId, req)  // D에 ready/nextAsk 위임
7. return IntakeAskResponse(convId, answer, check.ready(), check.nextAsk(),
                           req, check.candidates(), check.modes())
8. finally: trace.clear()           // 요청 ThreadLocal만 정리(누적 슬롯은 보존)
```

LLM은 4단계에서 답변 문장만 만든다. 슬롯 값은 LLM 출력을 파싱하지 않고 4-5단계에서 `trace.snapshot()`으로 꺼낸다 — 이게 슬롯 접지의 분리점이다.

### 4-2. IntakeSlotTrace — 두 가지 보존 범위

`IntakeSlotTrace`는 의도적으로 **두 종류의 상태**를 구분한다:

| 보존 범위 | 자료구조 | 생명주기 | 이유 |
| --- | --- | --- | --- |
| 요청 스레드 컨텍스트(userId, conversationId) | `ThreadLocal<Long>` | 요청 시작 주입 → finally 제거 | 동기 요청 스레드에서 도는 동안만 유효. 툴이 "현재 누구·어느 대화"를 동시성 안전하게 읽음 |
| 대화 단위 누적 슬롯(caseId, mode, originalQuery, 후보목록) | `ConcurrentHashMap<convId, SlotState>` | 대화 수명 동안 유지 | 이전 턴에 고른 case가 다음 턴까지 살아야 ready 판정 성립 |

왜 ThreadLocal과 맵을 나눴나? 슬롯은 **여러 턴에 걸쳐 누적**되므로 요청마다 정리되면 안 된다. 반면 userId/conversationId는 **요청 단위**여야 동시 사용자 간 격리가 된다. 그래서 `clear()`는 ThreadLocal만 비우고 누적 슬롯은 보존한다(주석: "다음 턴을 위해 보존").

```java
public void clear() {
    userIdTL.remove();
    conversationIdTL.remove();
    // slotsByConversation 은 건드리지 않음 — 멀티턴 보존
}
```

`SlotState`의 필드는 모두 `volatile`이고 컨테이너는 `ConcurrentHashMap` + `computeIfAbsent` — 비동기 풀이 아닌 동기 요청 스레드 모델이지만 가시성을 보수적으로 보장한다.

### 4-3. 툴이 검증하는 방식 (지어낸 caseId 차단)

`IntakeTools`의 세 툴은 전부 read-only다 — DB write도, 실행도 없다. caseId 환각을 막는 검증 사슬:

```text
listCases()  → applicationCaseService.list(userId)  → trace.recordFetchedCases(목록)
              (= 이후 chooseCase 검증용 화이트리스트 시딩)

chooseCase(caseId)
   ├ known = trace.fetchedCases()          // 이전 턴 후보 캐시
   ├ known 비었으면 소유 목록 재조회(프로세스 재시작 대비)
   ├ match = known 중 id == caseId 인 것    // ★화이트리스트 검증
   ├ match == null → "그 지원 건을 찾을 수 없어요" (확정 안 함)
   └ match != null → trace.confirmCase(caseId)  // 검증 통과해야만 확정

chooseMode(code)
   ├ normalized = code.toUpperCase()
   ├ MODE_LABELS 에 없으면 거부
   └ 있으면 trace.confirmMode(normalized)
```

핵심: LLM이 `chooseCase(99999)`처럼 목록에 없는 id를 지어내도, `known.stream().filter(id 일치)`가 빈 결과를 내면 `confirmCase`가 호출되지 않는다. **시스템 프롬프트에 "지어내지 마라"고 적은 것에 의존하지 않고, 코드가 화이트리스트로 강제**한다. mode도 6종 enum(`BASIC/JOB/PERSONALITY/PRESSURE/RESUME/COMPANY`) 화이트리스트로 동일하게 막는다.

### 4-4. 메모리 윈도우 — 왜 40인가

`IntakeAgentConfig`는 커뮤니티 챗봇(공유 윈도우 20)과 **분리된** 전용 메모리 윈도우(`maxMessages=40`)를 별도 빈으로 신설한다:

```java
@Bean
public ChatMemoryProvider intakeChatMemoryProvider(ChatMemoryStore store) {
    return memoryId -> MessageWindowChatMemory.builder()
            .id(memoryId).maxMessages(40).chatMemoryStore(store).build();
}
```

이유: 인테이크는 되묻기("어느 지원 건?" → 목록 → 선택 → "어떤 모드?" → 선택)로 턴 수가 늘 수 있어 커뮤니티의 20보다 넉넉히 잡았다. 빈 이름이 다르므로(`intakeChatMemoryProvider`) 커뮤니티의 파라미터명 기반 주입(`chatMemoryProvider`)은 그대로 20짜리 빈으로 해소된다 — 기존 커뮤니티 챗봇 무수정 원칙.

메모리 영속은 `MyBatisChatMemoryStore`가 담당한다. `memoryId = conversationId`이고 메시지 윈도우 전체를 JSON으로 직렬화해 `chatbot_conversation_memory` 행에 보관 — 새로고침·재시작 후에도 conversationId로 복원된다.

:::warning 메모리 윈도우 ≠ 슬롯 보존
메모리 윈도우(LangChain4j, DB 영속)는 **대화 메시지** 컨텍스트다. 슬롯(`IntakeSlotTrace`)은 **확정된 caseId/mode**다. 둘은 다른 저장소다. 슬롯이 누적 맵에 따로 사는 이유 중 하나가 "윈도우 40이 밀려도 슬롯은 안전"하기 위함이다(주석 명시). 단, 슬롯 누적 맵은 JVM 인메모리라 프로세스 재시작 시 사라진다 — 이 경우 `chooseCase`가 소유 목록을 재조회해 복구한다.
:::

### 4-5. 폭주 차단

`maxSequentialToolsInvocations=3`. 로컬 추론이 툴을 무한 반복 호출하는 폭주를 막는 상한이다(커뮤니티와 동일). 툴 3종 × 상한 3이면 정상적인 인테이크(목록→케이스→모드) 한 사이클을 충분히 커버한다.

## 5. 구현 상태 (됨 vs 계획) — 정직 구분

| 항목 | 상태 | 설명 |
| --- | --- | --- |
| 슬롯 접지(caseId/mode 화이트리스트 검증) | 구현됨 | `IntakeTools` + `IntakeSlotTrace` |
| String 반환 + 툴 호출 확정 | 구현됨 | qwen3:8b 실측 충돌 회피 |
| 전용 메모리 윈도우 40 + DB 영속 | 구현됨 | `IntakeAgentConfig` + `MyBatisChatMemoryStore` |
| D에 ready/nextAsk 위임 | 구현됨 | `AutoPrepIntakeService.intake()` |
| 통합 라우터에서 재사용 | 구현됨 | `ChatbotController`가 `IntakeAskService` 공유 |
| **슬롯 세션 DB 영속화** | ⚠️ 미구현 | 누적 슬롯은 JVM 인메모리. 세션 영속은 "D·C 합의 후 별도 단계"(주석) |
| 전용/관리자 인테이크 프론트 | ◐ 일부 미연결 | 코어 흐름은 구현, 일부 화면 미연결 |
| `coverLetterText`/`attachmentFileIds` | ⚠️ 2단계 | 현재 `AutoPrepRequest`에 null로 전달 |
| LLM 폴백 | ⚠️ 없음 | Ollama 장애 시 "잠시 후 다시" 고정 문구 반환(폴백 모델 경로 없음) |

정직 요약: **슬롯 접지·툴·메모리·D 위임·라우터 재사용은 동작하지만, 슬롯 세션 DB 영속화는 인메모리 단계에 머물러 있다.**

## 6. 면접 답변 3단계

1. **무엇** — "인테이크 챗봇은 한 줄 자연어 요청을 받아 AutoPrep 실행에 필요한 슬롯 3개(지원 건 caseId, 면접 모드 mode, 원본 의도 query)를 멀티턴 대화로 채우는 챗봇입니다. F가 소유하고, 채워진 그릇을 D의 AutoPrep 오케스트레이터로 넘깁니다."

2. **왜** — "폼 대신 챗봇을 택한 이유는 진입 장벽을 자연어 한 문장으로 낮추기 위해서입니다. 대신 LLM 환각·비결정성 비용이 생기는데, 이를 '슬롯 접지'로 상쇄했습니다 — LLM이 지어낸 값을 믿지 않고, 코드가 화이트리스트로 검증한 툴 호출 결과만 슬롯으로 확정합니다."

3. **어떻게** — "`IntakeChatAgent`는 LangChain4j `@AiService`이고 qwen3:8b가 답변 문장을 String으로 만듭니다. caseId/mode는 `IntakeTools.chooseCase/chooseMode`가 검증 후 `IntakeSlotTrace`에 확정합니다. Trace는 요청 컨텍스트(ThreadLocal)와 멀티턴 누적 슬롯(ConcurrentHashMap)을 분리해, 요청이 끝나도 슬롯은 다음 턴까지 보존됩니다. ready 판정은 D의 `AutoPrepIntakeService`에 위임해 의존 그래프를 재구현하지 않습니다."

## 7. 꼬리질문 + 모범답안

:::details Q1. qwen3:8b를 그냥 JSON 반환하게 하면 안 됐나요?

실측에서 qwen3:8b는 POJO/JSON 반환을 강제하면 tool_call을 건너뛰고 추측 JSON을 즉시 뱉는 충돌이 있었습니다(`IntakeChatAgent` 주석). 그러면 caseId를 "검증 없이 모델이 지어낸 값"으로 받게 됩니다. 그래서 반환은 String(사람용 문장)으로만 두고, 슬롯은 툴 호출 결과를 코드가 검증해 확정하는 구조로 분리했습니다. 결정성을 모델이 아니라 코드에 두는 선택입니다.
:::

:::details Q2. 멀티턴에서 이전 턴에 고른 지원 건이 어떻게 유지되나요?

`IntakeSlotTrace`가 conversationId로 키링한 `ConcurrentHashMap<Long, SlotState>`에 누적 슬롯을 보존합니다. 매 요청 끝의 `clear()`는 요청 스레드의 ThreadLocal(userId/conversationId)만 비우고, 이 누적 맵은 건드리지 않습니다. 그래서 다음 턴에 같은 conversationId로 들어오면 이전 caseId가 그대로 살아 있어 ready 판정이 성립합니다. 단 JVM 인메모리라 프로세스 재시작 시엔 사라지고, 그때는 `chooseCase`가 소유 목록을 재조회해 복구합니다.
:::

:::details Q3. LLM이 목록에 없는 caseId를 호출하면요?

`chooseCase(caseId)`는 `listCases`가 기록한 후보 화이트리스트(`trace.fetchedCases()`)에서 id 일치를 검색합니다. 일치가 없으면 `confirmCase`를 호출하지 않고 "찾을 수 없어요"를 돌려줍니다. 즉 프롬프트의 "지어내지 마라"에 의존하지 않고 코드가 강제합니다. mode도 6종 enum 화이트리스트로 동일하게 막습니다.
:::

:::details Q4. ready/nextAsk 판정을 왜 F가 직접 안 하나요?

"어떤 step이 지원 건을 요구하는가"의 의존 그래프는 D의 AutoPrep 도메인 지식입니다(`CASE_REQUIRED = {JOB, FIT, INTERVIEW}`). F가 이를 복제하면 두 곳이 어긋날 위험이 생깁니다. 그래서 F는 슬롯 접지까지만 하고, `AutoPrepIntakeService.intake()`에 위임해 ready·nextAsk·candidates·modes를 D가 결정적으로 채워주게 합니다. 영역 경계를 코드 의존으로 강제한 셈입니다.
:::

:::details Q5. 메모리 윈도우 40과 슬롯은 어떤 관계인가요?

별개 저장소입니다. 메모리 윈도우는 LangChain4j가 관리하는 대화 메시지 컨텍스트로 `MyBatisChatMemoryStore`를 통해 `chatbot_conversation_memory`에 JSON으로 영속됩니다. 슬롯은 확정된 caseId/mode로 `IntakeSlotTrace`에 삽니다. 둘을 나눈 이유 중 하나가, 윈도우 40이 밀려도(오래된 메시지가 빠져도) 확정 슬롯은 영향받지 않게 하기 위함입니다.
:::

:::details Q6. 통합 라우터와 인테이크 챗봇의 관계는?

`UnifiedChatRouter`가 단일 `/api/chatbot/ask` 입구에서 질문을 FAQ로 보낼지 인테이크로 보낼지 임베딩 점수로 판정합니다. 인테이크로 보낼 때 `ChatbotController`는 인테이크 한 턴 로직을 다시 짜지 않고 같은 `IntakeAskService.ask()`를 재사용합니다(중복 제거). 즉 인테이크 진입로는 두 개(전용 `/chatbot/intake/ask`, 라우터 경유)이지만 한 턴 코어는 하나입니다.
:::

## 8. 직접 말해보기

다음을 막힘없이 30초씩 설명할 수 있는지 점검:

1. "슬롯 접지"를 한 문장으로 — LLM 출력과 슬롯 확정을 어떻게 분리했는가.
2. `IntakeSlotTrace`가 ThreadLocal과 ConcurrentHashMap을 동시에 쓰는 이유.
3. `chooseCase`가 caseId 환각을 막는 정확한 코드 경로.
4. 왜 String 반환인가 — qwen3:8b 실측 충돌과의 연결.
5. F(슬롯 수집)와 D(ready 판정·실행)의 경계가 어느 클래스에서 갈라지는가.

## 퀴즈

<QuizBox question="인테이크 챗봇이 caseId를 슬롯으로 확정하는 방식으로 옳은 것은?" :choices="['LLM이 반환한 JSON에서 caseId를 파싱한다', 'chooseCase 툴이 listCases 후보 화이트리스트에서 검증을 통과한 경우에만 confirmCase로 확정한다', '시스템 프롬프트에 caseId를 적게 한 뒤 정규식으로 추출한다', '사용자가 입력한 숫자를 그대로 신뢰한다']" :answer="1" explanation="슬롯 접지의 핵심. chooseCase는 trace.fetchedCases() 화이트리스트에서 id 일치를 확인하고, 일치할 때만 trace.confirmCase()를 호출한다. LLM 출력이나 프롬프트 지시에 의존하지 않고 코드가 강제한다." />

<QuizBox question="IntakeChatAgent.chat()이 구조화 POJO가 아니라 String을 반환하는 이유는?" :choices="['JSON 직렬화 비용을 줄이려고', 'qwen3:8b가 POJO 반환을 강제하면 tool_call을 건너뛰고 추측 JSON을 뱉는 충돌이 있어서', 'LangChain4j가 POJO 반환을 지원하지 않아서', '응답 크기를 줄이려고']" :answer="1" explanation="실측 근거(클래스 주석). 구조화 반환 강제 시 로컬 모델이 툴 호출을 건너뛰어 검증이 무력화되므로, 답변은 String으로 두고 슬롯은 툴 호출 결과를 코드가 확정한다." />

<QuizBox question="IntakeSlotTrace에서 매 요청 끝의 clear()가 비우는 것은?" :choices="['누적 슬롯(caseId/mode) 전부', '요청 스레드 ThreadLocal(userId/conversationId)만, 누적 슬롯은 보존', '메모리 윈도우 전체', 'chatbot_conversation_memory 행']" :answer="1" explanation="멀티턴 슬롯은 다음 턴까지 살아야 ready 판정이 성립하므로 clear()는 요청 ThreadLocal만 비운다. 누적 슬롯은 conversationId 키링 맵에 보존된다." />
