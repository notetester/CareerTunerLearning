# LangChain4j와 로컬 LLM (Ollama)

> LangChain4j는 자바에서 LLM을 인터페이스 호출처럼 쓰게 해주는 프레임워크고, Ollama는 그 LLM을 우리 서버에서 직접 돌려 비용·프라이버시를 잡는 로컬 추론 엔진입니다.

## 1. 한 줄 정의

- **LangChain4j**: 자바/스프링 환경에서 LLM 호출, 대화 메모리, 도구(tool) 호출, 구조화 출력을 표준화해주는 라이브러리. 핵심은 `@AiService`로 **자바 인터페이스 하나가 곧 LLM 에이전트**가 되는 추상화다.
- **Ollama**: GGUF 같은 오픈소스 모델(qwen, gemma 등)을 로컬/사내 서버에서 띄우고 `/api/chat` HTTP로 추론을 제공하는 LLM 서빙 런타임.

CareerTuner는 이 둘을 결합해 **커뮤니티 챗봇 에이전트**를 외부 API 비용 없이 자체 GPU에서 굴린다.

## 2. 단어 뜻 (약자/어원 풀이)

| 용어 | 풀이 |
| --- | --- |
| LangChain4j | "LangChain **for Java**". 파이썬 LangChain의 자바 포팅 계열. `dev.langchain4j` 패키지. |
| Ollama | 로컬에서 LLM을 `ollama run <model>` 한 줄로 띄우는 도구. REST(`:11434`)로도 노출. |
| `@AiService` | 인터페이스를 LLM 백엔드로 자동 구현해주는 LangChain4j 애너테이션 |
| ChatMemory | 대화 맥락(이전 메시지들)을 모델 입력에 함께 실어주는 메모리 추상화 |
| ChatMemoryStore | 그 메모리를 어디에 보관할지(인메모리/DB) 정하는 저장소 인터페이스 |
| `@MemoryId` | 어떤 대화 세션의 메모리인지 식별하는 키(여기선 conversationId) |
| Tool calling | 모델이 "검색이 필요하다" 판단하면 우리가 등록한 자바 메서드를 호출하는 기능 |
| GGUF | 양자화된 로컬 LLM 가중치 포맷. Ollama가 이 포맷을 서빙 |

## 3. 왜 필요한가 (없으면 무슨 문제가 생기나)

LLM을 직접 HTTP로 호출하면 매번 다음을 손으로 짜야 한다.

- 프롬프트 문자열 조립, JSON 요청/응답 파싱, 타임아웃·예외 처리
- 대화 이력을 직접 DB에 넣고 빼고, 토큰 한도 안 넘게 잘라서 다시 합치기
- "검색해야 할 때"를 모델이 판단하면 함수 호출로 연결하는 라우팅 로직

**LangChain4j가 없으면** 이 보일러플레이트가 서비스마다 중복된다. `@AiService`는 이를 인터페이스 메서드 시그니처 + 애너테이션으로 압축한다.

**Ollama(로컬 LLM)가 없으면**:

- 챗봇처럼 호출량 많은 기능을 OpenAI로 돌리면 **비용이 선형으로 폭증**한다.
- 사용자 글·이력서 같은 데이터가 **외부 API로 나간다**(프라이버시·데이터 주권 이슈).
- 외부 API 장애 = 서비스 장애. 로컬 모델이 있으면 자체 통제 가능.

:::tip 핵심 트레이드오프
**OpenAI = 품질·구조화 출력 강점 / 호출당 비용**. **Ollama = 비용 0·프라이버시 / 운영 부담·작은 모델의 품질 한계**. CareerTuner는 "양 많고 단순한 작업은 로컬, 정확도가 돈이 되는 작업은 OpenAI"로 나눈다.
:::

## 4. CareerTuner에서 어디에 썼나 (실제 클래스/파일/테이블)

영역 표시: [F] 커뮤니티/챗봇, [C] 본인 담당(적합도·취업분석), [B] 공고추출.

| 용도 | 클래스/파일 | 방식 | 상태 |
| --- | --- | --- | --- |
| 커뮤니티 챗봇 에이전트 [F] | `ai/chat/CommunityChatAgent` (인터페이스) | LangChain4j `@AiService` + 툴 호출 | 구현됨 |
| 챗봇 빈 빌드·툴캡 [F] | `ai/chat/CommunityAgentConfig` | `AiServices.builder` 직접 조립 | 구현됨 |
| 인테이크(되묻기) 에이전트 | `ai/intake/IntakeChatAgent`, `IntakeAgentConfig` | 챗봇 구성 복제 + 메모리 윈도우 40 | 구현됨 |
| 대화 메모리 윈도우 | `ai/chat/ChatMemoryConfig` | `MessageWindowChatMemory`(최근 20개) | 구현됨 |
| 메모리 영속화 | `ai/chat/MyBatisChatMemoryStore` (+`ChatMemoryMapper`) | `ChatMemoryStore` → MySQL JSON 직렬화 | 구현됨 |
| FAQ 답변 초안 생성 [F] | `admin/chatbot/ai/FaqDraftAiClient` | LangChain4j 미사용, Ollama `/api/chat` 직접 호출 | 구현됨 |
| 공고추출 로컬 LLM [B] | `applicationcase/service/BLocalLlmClient` | Ollama 직접 호출(자체 파인튜닝 모델) | 구현됨 |
| 취업분석 OSS 클라이언트 [C] | `analysis/ai/provider/CareerAnalysisOssClient` | OpenAI 호환 엔드포인트, base-url 미설정 시 비활성 | 구현됨 |
| 자체 커리어전략 LLM [C] | `careertuner-c-career-strategy-3b`, `ml/career-strategy-llm` | LoRA 학습·Ollama 서빙·Fallback 체인 | 학습·연결 검증됨, 기본 provider는 OpenAI |

:::warning 영역과 기본값 구분
챗봇 에이전트(`ai/chat`)는 영역 F 소유다. C는 별도의 OSS client와 학습 모델을 실제 적합도 경로에 연결했다. 다만 `provider=openai`가 저장소 기본값이고, OSS endpoint를 주입한 환경에서만 자체 모델이 활성화된다.
:::

## 5. 핵심 동작 원리 (표/작은 코드/단계)

### (1) `@AiService` — 인터페이스 = 에이전트

CareerTuner의 챗봇은 메서드 하나짜리 인터페이스다.

```java
public interface CommunityChatAgent {
    @SystemMessage(fromResource = "prompts/community-chat-system.txt")
    String chat(@MemoryId Long conversationId, @UserMessage String message);
}
```

- `@SystemMessage`: 시스템 프롬프트를 리소스 파일에서 로드.
- `@MemoryId`: conversationId로 대화별 메모리를 구분.
- `@UserMessage`: 사용자 입력.
- 반환 타입이 `String`인 이유는 6항·7항의 "JSON 충돌" 때문이다(의도적 선택).

### (2) 빈 조립 — `AiServices.builder`

자동 등록 대신 빌더로 직접 만들어 **가드레일**을 건다.

```java
return AiServices.builder(CommunityChatAgent.class)
        .chatModel(chatModel)                  // Ollama 스타터가 자동 구성
        .chatMemoryProvider(chatMemoryProvider) // 대화 메모리
        .tools(communityTools)                  // 검색 등 도구
        .maxSequentialToolsInvocations(3)       // 툴 호출 폭주 차단
        .build();
```

`maxSequentialToolsInvocations(3)`은 작은 로컬 모델이 도구를 무한 반복 호출하는 추론 루프를 막는 안전장치다.

### (3) ChatMemory — 윈도우 + MySQL 영속화

```java
MessageWindowChatMemory.builder()
        .id(memoryId)
        .maxMessages(20)             // LLM 입력에 싣는 최근 메시지 수
        .chatMemoryStore(store)      // ← MyBatisChatMemoryStore
        .build();
```

`MyBatisChatMemoryStore`는 메시지 윈도우를 통째로 JSON 직렬화해 `chatbot_conversation_memory` 테이블에 행 단위로 upsert한다. 서버 재시작/새로고침 후에도 conversationId로 복원된다. 인테이크 에이전트는 되묻기로 대화가 길어져 윈도우를 40으로 따로 둔다.

```text
사용자 입력
  → @AiService.chat(conversationId, message)
  → ChatMemoryStore.getMessages(conversationId)  (MySQL에서 이전 20개 로드)
  → [시스템프롬프트 + 이전 메시지 + 신규 입력] → Ollama /api/chat
  → 모델이 필요시 tool 호출(searchCommunityPosts) → 결과 다시 모델에
  → 응답 String
  → ChatMemoryStore.updateMessages(...)  (갱신된 윈도우 MySQL 저장)
```

### (4) Ollama 서빙 설정 (스타터 오토컨피그)

```yaml
langchain4j:
  ollama:
    chat-model:
      base-url: ${AI_OLLAMA_BASE_URL:<OLLAMA_BASE_URL>}  # 공유 GPU 서버 주소(자리표시자)
      model-name: ${AI_AGENT_MODEL:qwen3:8b}             # env로 모델만 독립 오버라이드
      temperature: 0.0     # 라우팅 일관성
      think: false         # 추론 토큰 끄기(응답 노이즈 제거)
```

`langchain4j-ollama-spring-boot4-starter`가 위 설정을 읽어 `ChatModel` 빈을 자동 생성한다. 기준 SHA의 Spring Boot 4 전용 스타터와 Ollama 스타터는 `1.17.2-beta27`이고, Anthropic·OpenAI 모듈은 `1.17.2`다.

## 6. 면접 답변 3단계 (초간단 / 기본 / 꼬리질문 대응)

**초간단 1문장**
"LangChain4j로 자바 인터페이스 하나를 LLM 에이전트로 만들고, 그 모델을 Ollama로 사내 GPU에서 직접 서빙해 챗봇 비용을 0으로 낮췄습니다."

**기본**
"커뮤니티 챗봇을 `@AiService` 인터페이스(`CommunityChatAgent`)로 정의해 시스템 프롬프트·메모리·도구 호출을 애너테이션으로 선언했습니다. 대화 메모리는 `MessageWindowChatMemory`로 최근 20개를 유지하되, `MyBatisChatMemoryStore`로 MySQL에 JSON 직렬화해 영속화했고, 모델은 Ollama로 사내 서버에서 돌립니다. 도구 호출 폭주를 막으려고 `maxSequentialToolsInvocations`로 캡을 걸었습니다."

**꼬리질문 대응(왜 OpenAI 안 쓰고 로컬?)**
"챗봇은 호출량이 많아 로컬 모델의 비용·프라이버시 이점이 큽니다. C 적합도 분석도 LoRA 모델 경로를 연결했지만, 안정적인 기본값은 OpenAI로 유지했습니다. OSS endpoint가 없는 환경에서는 OpenAI와 규칙 기반 안전망이 서비스 연속성을 지킵니다."

## 7. 자주 나오는 꼬리질문 + 모범답안

:::details Q1. `@AiService`를 왜 자동 등록 안 하고 `AiServices.builder`로 직접 만들었나?
가드레일 때문이다. 자동 등록은 편하지만 `maxSequentialToolsInvocations` 같은 안전 파라미터를 세밀하게 못 건다. 작은 로컬 모델은 도구를 무한 호출하는 추론 루프에 빠지기 쉬워서, 빌더로 직접 조립해 툴 호출 상한 3을 걸었다.
:::

:::details Q2. 챗봇 반환 타입을 왜 POJO가 아닌 String으로 뒀나?
Ollama는 구조화 출력(`RESPONSE_FORMAT_JSON_SCHEMA`)을 켜면 tool_call을 생략하고 즉시 JSON만 뱉는 충돌이 있다(실측). 검색 의도인데도 `searchCommunityPosts`를 안 부르는 치명적 문제라, 반환은 검증된 String으로 두고, 링크는 모델 JSON이 아니라 실제 툴 출력(`SearchTrace`)에서 접지(grounding)하고, quickReplies는 별도 `QuickReplyAgent`가 생성한다.
:::

:::details Q3. 대화 메모리는 어떻게 영속화하나? 토큰 한도는?
`MessageWindowChatMemory`가 "최근 N개" 윈도우로 모델 입력을 제한한다(챗봇 20, 인테이크 40). UI에 보이는 전체 이력과는 별개로, LLM 입력에 싣는 건 윈도우뿐이라 토큰이 무한정 늘지 않는다. 저장은 `ChatMemoryStore` 인터페이스를 `MyBatisChatMemoryStore`로 구현해 윈도우를 JSON 직렬화 후 MySQL에 upsert한다. memoryId=conversationId라 재시작 후에도 복원된다.
:::

:::details Q4. OpenAI vs Ollama를 어떤 기준으로 고르나?
세 축으로 판단한다. (1) 비용·호출량: 챗봇처럼 많이 부르면 로컬. (2) 프라이버시: 사용자 데이터가 외부로 나가면 안 되면 로컬. (3) 출력 정밀도: 엄격한 구조화 JSON·고품질이 필요하면 OpenAI. CareerTuner는 application.yaml에서 `provider: openai|oss` 토글과 base-url로 런타임에 갈아끼울 수 있게 했고, base-url이 비면 OpenAI로 폴백한다.
:::

:::details Q5. Ollama 서버 주소·모델은 어떻게 관리하나?
환경변수 기본값 패턴(`${ENV:기본값}`)으로 둔다. base-url과 model-name 모두 env(`AI_OLLAMA_BASE_URL`, `AI_AGENT_MODEL`)로 오버라이드 가능해서, CI나 운영에서 챗봇 모델만 독립적으로 바꿀 수 있다. 검열/FAQ용 모델(`ai.ollama`)과 에이전트 모델(`langchain4j.ollama`)을 네임스페이스로 분리해 서로 충돌하지 않게 했다. 실제 서버 IP는 코드에 박지 않고 시크릿/env로만 주입한다.
:::

## 8. 직접 말해보기 (말하기 훈련용)

1. 화이트보드 없이 30초 안에: "`@AiService` 인터페이스 한 줄이 어떻게 LLM 에이전트가 되는가"를 메모리·툴·프롬프트 세 요소로 설명해보라.
2. "왜 챗봇은 Ollama, 적합도 분석은 OpenAI인가?"를 비용·프라이버시·정밀도 세 축으로 1분 안에 말해보라. 폴백 설계까지 언급하면 만점.

## 관련 페이지

- [DTO](/glossary/dto)
- [ApiResponse 엔벨로프](/glossary/api-response-envelope)
- [JWT 보안](/backend/jwt-security)
- [OpenAI 구조화 출력](/ai/openai-structured-output)

## 퀴즈

<QuizBox question="LangChain4j에서 자바 인터페이스 하나를 LLM 에이전트로 만들어주는 핵심 애너테이션은?" :choices="['@RestController', '@AiService', '@Mapper', '@Configuration']" :answer="1" explanation="@AiService(또는 AiServices.builder)로 인터페이스를 LLM 백엔드로 자동 구현한다. CommunityChatAgent가 그 예다." />

<QuizBox question="CareerTuner 챗봇이 반환 타입을 구조화 POJO가 아니라 String으로 둔 이유로 가장 정확한 것은?" :choices="['자바는 JSON을 못 다뤄서', 'Ollama는 구조화 출력을 켜면 tool_call을 생략하고 JSON만 반환하는 충돌이 있어서', 'String이 항상 더 빨라서', 'LangChain4j가 POJO를 지원하지 않아서']" :answer="1" explanation="구조화 출력 포맷을 강제하면 검색 의도에도 도구를 안 부르는 충돌이 실측돼, 검증된 String을 반환하고 링크는 실제 툴 출력에서 접지한다." />

<QuizBox question="챗봇에 OpenAI 대신 로컬 LLM(Ollama)을 쓰는 이유와, 반대로 적합도 분석은 OpenAI를 쓰는 이유를 비용·프라이버시·정밀도 축으로 설명해보라." explanation="챗봇은 호출량이 많아 외부 API면 비용이 선형 증가하고 사용자 글이 외부로 나가므로 비용·프라이버시 측면에서 로컬 Ollama가 유리하다. 반대로 적합도 분석은 점수·구조화 JSON의 정밀도가 제품 가치에 직결되어 품질이 높은 OpenAI를 쓴다. CareerTuner는 application.yaml의 provider 토글(openai/oss)과 base-url로 런타임 전환을 지원하고, base-url 미설정 시 OpenAI로 자동 폴백하도록 설계해 자체 LLM 미서빙 환경에서도 동작하게 했다." />
