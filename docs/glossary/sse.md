# SSE (Server-Sent Events)

> 서버가 하나의 HTTP 연결을 끊지 않고 붙잡은 채, 진행 상황을 클라이언트로 계속 흘려보내는 단방향 실시간 스트림. CareerTuner의 AutoPrep 오케스트레이터가 AI 6단계 진행을 SSE로 실시간 보고한다.

## 1. 한 줄 정의

SSE는 **서버 → 클라이언트 단방향**으로, 하나의 HTTP 응답 연결을 열어둔 채 여러 개의 이벤트를 시간차로 밀어내는(push) 표준 기술이다.

## 2. 단어 뜻 (약자·어원)

- **Server-Sent Events** = "서버가 보낸 이벤트". 클라이언트가 매번 묻는 게 아니라, **서버가 먼저 보낸다**는 방향성이 이름에 박혀 있다.
- 전송 형식은 MIME 타입 `text/event-stream`. 응답 본문이 한 번에 끝나지 않고 계속 이어지는 **텍스트 스트림**이다.
- 한 이벤트의 기본 문법은 줄 단위다. `event:` 줄(이벤트 이름), `data:` 줄(본문), 그리고 **빈 줄 하나(`\n\n`)**가 "이 이벤트 끝" 구분자다.
- 브라우저 표준 클라이언트는 `EventSource` API. (단, CareerTuner는 뒤에서 보듯 이걸 안 쓴 이유가 있다.)

```text
event: substep
data: {"key":"FIT","name":"임베딩 조회","desc":"..."}
              ← 빈 줄 = 이벤트 경계
event: part-done
data: {"key":"FIT","status":"DONE"}
```

## 3. 왜 필요한가 (없으면 무슨 문제)

AI 작업은 응답까지 수십 초가 걸린다. AutoPrep은 공고분석·적합도·면접 등 **여러 단계를 병렬로** 돌린다. 이때 선택지를 비교해 보자.

| 방식 | 방향 | 실시간성 | 비용 | 한계 |
| --- | --- | --- | --- | --- |
| **단순 요청/응답** | 양방향 1회 | 없음 | 낮음 | 30초간 빈 화면 → 멈춘 줄 안다 |
| **폴링(polling)** | 클라가 반복 질문 | 주기만큼 지연 | 높음(헤더 낭비·요청 폭증) | "진행률" 받으려고 1초마다 때림 |
| **SSE** | 서버 → 클라 단방향 | 즉시 push | 낮음(연결 1개) | 클라가 서버로 못 보냄 |
| **WebSocket** | 양방향 | 즉시 | 중간 | 프로토콜 업그레이드·인프라 부담 |

SSE가 없다면 사용자는 "분석 중..." 스피너만 보다가 멈춘 건지 도는 건지 불안해한다. 폴링으로 흉내 내면 요청이 폭증한다. **서버가 일방적으로 진행 상황만 알려주면 충분한** 이 시나리오에 SSE가 정확히 들어맞는다. (양방향 채팅처럼 클라가 도중에 끼어들어야 하면 [WebSocket](/ai/orchestrator-autoprep)이 맞다.)

## 4. CareerTuner에서 어디에 썼나 (실제 근거)

핵심은 **AutoPrep 오케스트레이터**의 스트리밍 실행 엔드포인트다.

| 위치 | 파일 | 역할 |
| --- | --- | --- |
| 컨트롤러 | `backend/.../ai/autoprep/AutoPrepController.java` | `POST /api/auto-prep/run/stream`, `produces = TEXT_EVENT_STREAM_VALUE`, 반환 타입 `SseEmitter` |
| 오케스트레이터 | `backend/.../ai/autoprep/AutoPrepOrchestrator.java` | `runStream()` — 별도 스레드풀에서 6파트 병렬 실행, 단계마다 이벤트 전송 |
| 프런트 API | `frontend/src/features/autoprep/api/autoPrepApi.ts` | `runStream()` — `fetch` + ReadableStream으로 스트림 파싱 |
| 진행 UI | `frontend/src/features/autoprep/components/AutoPrepWorkView.tsx` | 받은 이벤트로 단계별 타임라인 표시 |

보내는 이벤트 종류(컨트롤러 주석에 명시): `plan`(세운 계획) → `part-start`(파트 시작) → `substep`(세부 진행) → `part-done`(파트 완료) → `done`(전체 완료) → 실패 시 `error`.

:::tip 동기 버전도 함께 있다
같은 `AutoPrepOrchestrator`에 `run()`(동기, 결과 한 번에 반환)과 `runStream()`(SSE) 두 경로가 있고, **내부 병렬 실행 로직은 공유**한다. 차이는 진행 이벤트를 "버리느냐(NOOP_LISTENER)" "SSE로 흘리느냐"뿐. 면접에서 "왜 둘 다?"를 물으면, 진행 표시가 필요 없는 호출(예: 배치)은 동기로, 사용자 화면은 SSE로 라고 답하면 된다.
:::

## 5. 핵심 동작 원리 (표·작은 코드)

### 서버: SseEmitter

Spring MVC는 `SseEmitter`로 SSE를 구현한다. 컨트롤러가 이 객체를 **반환만 하고 메서드는 즉시 끝난다.** 실제 전송은 별도 스레드가 연결을 붙잡은 채 진행한다.

```java
// AutoPrepOrchestrator.runStream — 요지
SseEmitter emitter = new SseEmitter(SSE_TIMEOUT_MS); // 타임아웃 5분(300_000ms)
sseExecutor.execute(() -> {                          // 요청 스레드가 아닌 전용 풀에서
    try {
        send(emitter, "plan", plan);                 // 단계마다 push
        executeParallel(..., listener -> send(...));  // part-start/substep/part-done
        send(emitter, "done", Map.of("message", "완료"));
        emitter.complete();                          // 정상 종료 → 연결 닫음
    } catch (RuntimeException ex) {
        emitter.completeWithError(ex);               // 실패도 명시적으로 닫음
    }
});
return emitter; // 컨트롤러는 여기서 리턴. 전송은 백그라운드에서 계속된다.
```

설계에서 주목할 세 가지(실제 코드 근거):

1. **전용 스레드풀** `sseExecutor`로 실행 — 요청 스레드를 오래 점유하지 않는다.
2. **타임아웃** `SSE_TIMEOUT_MS = 300_000L`(5분) — 무한 대기 방지.
3. **전송 동기화** — 6파트가 병렬이라 여러 스레드가 동시에 `emitter.send`를 부른다. `send()`는 `synchronized (emitter)`로 감싸 직렬화한다. 안 그러면 이벤트 텍스트가 뒤섞여 깨진다.

```java
private void send(SseEmitter emitter, String event, Object data) {
    synchronized (emitter) {                 // 병렬 파트의 동시 send 직렬화
        emitter.send(SseEmitter.event().name(event).data(data, MediaType.APPLICATION_JSON));
    }
}
```

### 클라이언트: 왜 EventSource를 안 썼나

표준 `EventSource`는 **GET만 가능하고 커스텀 헤더를 못 붙인다.** CareerTuner는 (1) 요청 본문이 큰 POST이고 (2) [JWT Bearer 토큰](/backend/jwt-security)을 헤더로 실어야 한다. 그래서 `EventSource` 대신 `fetch` + `ReadableStream`으로 직접 스트림을 읽는다.

```ts
const res = await fetch(`${BASE}/auto-prep/run/stream`, {
  method: "POST",
  headers: { Accept: "text/event-stream", Authorization: `Bearer ${token}` },
  body: JSON.stringify(req),
});
const reader = res.body.getReader();
const decoder = new TextDecoder();
let buffer = "";
for (;;) {
  const { value, done } = await reader.read();
  if (done) break;
  buffer += decoder.decode(value, { stream: true });
  let sep;
  while ((sep = buffer.indexOf("\n\n")) >= 0) {   // 빈 줄 = 이벤트 경계
    on(parseEvent(buffer.slice(0, sep)));
    buffer = buffer.slice(sep + 2);
  }
}
```

:::warning SSE는 ApiResponse 엔벨로프를 안 탄다
CareerTuner의 일반 응답은 전부 [`ApiResponse<T>` 엔벨로프](/glossary/api-response-envelope)로 감싸고, 프런트는 공용 `api()` 래퍼로 파싱한다. 그런데 **SSE 스트림은 엔벨로프 형태가 아니다.** 그래서 `autoPrepApi.ts`는 `api()`를 못 쓰고 `fetch`를 직접 호출하며, 토큰도 수동으로 붙인다. 코드 주석에 그대로 적혀 있다. 면접 꼬리질문으로 잘 나온다.
:::

## 6. 면접 답변 3단계

- **초간단:** "SSE는 서버가 한 연결을 열어둔 채 진행 상황을 클라이언트로 계속 밀어주는 단방향 실시간 기술입니다."
- **기본:** "AI 자동 준비가 여러 단계를 수십 초 동안 도는데, 사용자에게 단계별 진행을 보여줘야 했습니다. 폴링은 요청이 폭증하고, WebSocket은 양방향이 필요 없어 과합니다. 서버가 진행만 일방 통지하면 되니 SSE를 택했고, Spring의 `SseEmitter`로 `plan → part-start → substep → part-done → done` 이벤트를 흘려보냅니다."
- **꼬리질문 대비:** "표준 `EventSource`는 GET·헤더 제약이 있어, POST 본문과 JWT 헤더가 필요한 우리 요청엔 못 씁니다. 그래서 프런트는 `fetch` + `ReadableStream`으로 직접 `text/event-stream`을 파싱합니다. 또 6파트가 병렬이라 `emitter.send`를 동기화해 이벤트 충돌을 막았고, 5분 타임아웃과 전용 스레드풀로 요청 스레드 고갈을 피했습니다."

## 7. 꼬리질문 + 모범답안

:::details Q1. SSE와 WebSocket의 차이는? 왜 WebSocket이 아니라 SSE인가?
WebSocket은 **양방향** 풀 듀플렉스라 클라이언트도 서버로 자유롭게 보낼 수 있고, HTTP 업그레이드 핸드셰이크와 별도 프로토콜(ws://)을 씁니다. SSE는 **서버→클라 단방향**, 그냥 HTTP 위 `text/event-stream`이라 프록시·인프라 호환이 좋고 구현이 가볍습니다. AutoPrep은 "진행 상황 통지"만 필요하지 클라가 도중에 명령을 보낼 일이 없어 SSE가 정확히 맞습니다. 채팅처럼 양방향이면 WebSocket으로 갔을 겁니다.
:::

:::details Q2. SSE인데 왜 표준 EventSource를 안 쓰고 fetch로 직접 구현했나?
`EventSource`는 (1) GET 메서드만 지원하고 (2) `Authorization` 같은 커스텀 헤더를 못 붙입니다. 우리 스트림 요청은 본문이 큰 POST이고 JWT Bearer 토큰을 헤더로 실어야 해서 둘 다 위반합니다. 그래서 `fetch`로 POST하고 응답 `body`의 `ReadableStream`을 직접 읽어, 빈 줄(`\n\n`)을 경계로 이벤트를 잘라 파싱합니다. 트레이드오프로 `EventSource`가 공짜로 주는 자동 재연결·`Last-Event-ID` 재전송은 직접 구현해야 합니다.
:::

:::details Q3. 6파트가 병렬인데 이벤트가 섞이지 않나? 어떻게 막았나?
여러 스레드가 동시에 `emitter.send`를 호출하면 한 이벤트의 텍스트 청크가 다른 이벤트와 인터리브되어 스트림이 깨질 수 있습니다. 그래서 전송 헬퍼 `send()`에서 `synchronized (emitter)`로 묶어 emitter 단위로 직렬화했습니다. 병렬 실행 자체는 그대로 두되, **출력 지점만 동기화**해 처리량과 안전성을 둘 다 챙긴 설계입니다.
:::

:::details Q4. 연결이 너무 오래 살아 있으면? 클라이언트가 중간에 닫으면?
연결은 무한정 두지 않고 `SseEmitter`에 5분(`SSE_TIMEOUT_MS = 300_000`) 타임아웃을 걸었습니다. 전송 작업은 요청 스레드가 아니라 전용 스레드풀에서 돌려 서버 스레드 고갈을 막습니다. 클라이언트가 끊으면 `emitter.send`가 `IOException`을 던지고, 우리는 이를 잡아 "클라이언트 종료"로 처리해 백그라운드 작업을 멈춥니다. 프런트는 `AbortSignal`로 사용자가 모달을 닫으면 fetch를 취소합니다.
:::

:::details Q5. SSE 응답은 왜 ApiResponse 엔벨로프를 안 쓰나?
일반 REST 응답은 `success/code/message/data` 구조의 `ApiResponse<T>`로 일관되게 감싸지만, SSE는 "JSON 객체 하나"가 아니라 **시간에 걸쳐 이어지는 여러 이벤트 텍스트 스트림**이라 그 엔벨로프 모델에 안 맞습니다. 대신 이벤트 이름(`plan`, `done`, `error` 등)으로 타입을 구분하고, 각 `data:`에 JSON을 담습니다. 그래서 프런트도 공용 `api()` 래퍼를 우회해 직접 파싱합니다.
:::

## 8. 직접 말해보기

다음을 막힘 없이 설명할 수 있으면 이 페이지를 이해한 것이다.

1. SSE 한 이벤트의 텍스트 문법(이벤트 이름·데이터·경계)을 입으로 그려보기.
2. 폴링·WebSocket과 비교해 "왜 AutoPrep엔 SSE였나"를 30초 안에.
3. "표준 EventSource를 왜 버렸나"와 그 대가(자동 재연결을 직접 구현)까지.
4. 병렬 6파트에서 이벤트가 안 섞이게 한 한 줄 트릭(`synchronized (emitter)`).
5. 타임아웃·전용 스레드풀·`AbortSignal`이 각각 막는 문제.

## 퀴즈

<QuizBox question="SSE의 가장 정확한 설명은?" :choices="['클라이언트와 서버가 양방향으로 자유롭게 메시지를 주고받는 프로토콜', '서버가 하나의 HTTP 연결을 유지한 채 클라이언트로 이벤트를 단방향으로 밀어주는 기술', '클라이언트가 일정 주기로 서버에 반복 요청해 새 데이터를 받는 방식', '서버가 정적 파일을 한 번에 내려주는 캐싱 기법']" :answer="1" explanation="SSE는 text/event-stream으로 서버→클라 단방향 push. 양방향은 WebSocket, 주기적 반복 요청은 폴링이다." />

<QuizBox question="CareerTuner의 AutoPrep 프런트엔드가 표준 EventSource 대신 fetch + ReadableStream으로 SSE를 구현한 핵심 이유는?" :choices="['EventSource가 구형 브라우저에서만 동작해서', 'POST 본문과 Authorization(JWT) 헤더가 필요한데 EventSource는 GET·헤더 제약이 있어서', 'fetch가 EventSource보다 항상 빨라서', 'ApiResponse 엔벨로프를 자동으로 파싱해줘서']" :answer="1" explanation="EventSource는 GET만 되고 커스텀 헤더를 못 붙인다. POST 본문 + Bearer 토큰이 필요해 fetch 스트리밍으로 직접 구현했다." />

<QuizBox question="AutoPrep은 6개 파트를 병렬로 실행한다. 여러 스레드가 동시에 emitter.send를 호출할 때 이벤트 스트림이 깨지지 않도록 한 조치를 한 문장으로 설명하라. (주관식)" explanation="전송 헬퍼 send()에서 synchronized (emitter)로 묶어 emitter 단위로 send 호출을 직렬화했다. 병렬 실행은 유지하되 출력 지점만 동기화해 이벤트 텍스트가 인터리브되는 것을 막는다." />
