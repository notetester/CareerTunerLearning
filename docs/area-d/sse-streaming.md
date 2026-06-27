# SSE 실시간 면접 진행 — 긴 LLM 작업을 흐름으로 보여주기

> 면접 준비처럼 여러 LLM 호출이 줄줄이 이어지는 긴 작업을, 끝날 때까지 멍하니 기다리게 하지 않고 `SseEmitter` + `CompletableFuture` 전용 스레드풀로 "지금 무엇을 하고 있는지"를 실시간으로 흘려보내는 구조다.

## 1. 한 줄 정의 · 이 페이지가 답하는 면접 질문

영역 D에서 **실제로 동작하는 서버 푸시(Server-Sent Events) 스트리밍**은 면접 화면 자체가 아니라 **AutoPrep 오케스트레이터**(D 코어가 소유한 자동 준비 파이프라인)에 있다. 한 줄 요청을 받아 6개 파트(그중 하나가 면접 세션 생성 + 예상 질문 생성)를 의존 그래프대로 병렬 실행하면서, `plan → part-start → substep → part-done → done` 이벤트를 한 줄씩 브라우저로 밀어 보낸다.

이 페이지가 답하는 면접 질문은 다음과 같다.

- "여러 번의 LLM 호출이 묶인 긴 작업을 사용자에게 어떻게 보여줬나?"
- "왜 폴링이나 WebSocket이 아니라 SSE를 골랐나?"
- "Spring MVC에서 `SseEmitter`로 동시에 끝나는 병렬 작업의 이벤트를 어떻게 안전하게 쏘나?"
- "면접 채점 타임라인은 진짜 실시간 스트리밍인가?"

:::warning 정직한 경계 — 이 페이지의 핵심
면접 **도메인 코드(`interview/**`)에는 `SseEmitter`가 단 하나도 없다.** (`SseEmitter|text/event-stream|EventSource` grep 결과 0건.) 실시간 스트리밍은 `ai/autoprep`의 오케스트레이터에 구현돼 있고, 면접은 그 6파트 중 한 스텝(`InterviewPrepHandler`)으로 참여한다. 면접 채점 화면의 "에이전트가 일하는" 연출은 SSE가 아니라 **저장된 step을 클라이언트가 순차 재생**하는 것이다(아래 5장에서 정직히 구분).
:::

## 2. 왜 이렇게 설계했나 (의도 · 트레이드오프)

### 2.1 문제: LLM 호출은 진행률을 모른다

LLM 호출은 "요청 → 블랙박스 → 응답"이라 중간 진행률을 알 수 없다. AutoPrep 한 번은 공고 분석(JOB) → 적합도(FIT) → 면접 준비(INTERVIEW) 등 **여러 파트**가 각각 LLM을 호출하므로, 동기 응답 하나로 묶으면 수십 초 동안 흰 화면이 멈춰 있게 된다. 사용자는 "멈췄나?"라고 느끼고 이탈한다.

### 2.2 왜 SSE인가 (대안과 비교)

| 방식 | 장점 | 이 문제에서의 단점 | 채택 |
|---|---|---|---|
| 폴링(반복 GET) | 단순 | 진행 단위가 거칠고 N번 왕복, 지연 | X |
| WebSocket | 양방향 실시간 | 서버는 보내기만 하면 됨 → 양방향 불필요, 인프라 무거움 | X |
| **SSE(단방향 서버 푸시)** | HTTP 위에서 텍스트 줄 단위 푸시, 자동 재연결 규약, 구현 단순 | 단방향(서버→클라)뿐 | **O** |

면접 준비는 **서버가 진행 상황을 일방적으로 알려주기만** 하면 되는 전형적인 단방향 시나리오다. 클라이언트가 중간에 서버로 보낼 말은 없다(요청은 처음 한 번뿐). 그래서 양방향 WebSocket은 과한 선택이고, SSE가 정확히 들어맞는다.

### 2.3 같은 로직, 두 진입점

오케스트레이터는 `run`(동기, 한 번에 결과)과 `runStream`(SSE) **두 진입점이 같은 병렬 실행 로직을 공유**한다. 차이는 "진행 이벤트를 누가 듣느냐"뿐이다. 동기는 무시(`NOOP_LISTENER`), SSE는 전송(`PartListener` → `emitter.send`). 덕분에 스트리밍/논스트리밍이 갈라져 로직이 두 벌로 갈라지지 않는다.

## 3. 어떤 기술로 구현했나 (실제 클래스 · 엔드포인트)

근거 파일: `backend/.../ai/autoprep/AutoPrepController.java`, `AutoPrepOrchestrator.java`, 프론트 `frontend/.../features/autoprep/api/autoPrepApi.ts`.

| 구성 요소 | 실제 식별자 | 역할 |
|---|---|---|
| SSE 엔드포인트 | `POST /api/auto-prep/run/stream` (`AutoPrepController.runStream`) | `produces = TEXT_EVENT_STREAM_VALUE`, `SseEmitter` 반환 |
| 동기 엔드포인트 | `POST /api/auto-prep/run` (`AutoPrepController.run`) | `ApiResponse<AutoPrepResponse>` 한 방에 반환 |
| 스트림 본체 | `AutoPrepOrchestrator.runStream` | `SseEmitter` 생성 후 전용 스레드에서 실행 |
| 전용 스레드풀 | `sseExecutor = Executors.newCachedThreadPool(...)` (데몬 스레드 `autoprep-sse`) | 톰캣 요청 스레드를 막지 않음 |
| 병렬 실행 | `executeParallel` — `CompletableFuture.allOf(dep).thenRunAsync(runPart, sseExecutor)` | 의존 그래프(DAG) 병렬 |
| 이벤트 전송 | `private void send(emitter, event, data)` | `synchronized(emitter)`로 동시 전송 직렬화 |
| 면접 스텝 | `ai/autoprep/handler/InterviewPrepHandler` | 6파트 중 ⑤ "세션 생성 + 예상 질문 생성" |
| 프론트 소비 | `runStream(req, on, signal)` (`autoPrepApi.ts`) | `fetch` + `ReadableStream.getReader()` |
| 프론트 상태 | `useAutoPrepRun` reducer | `plan/part-start/substep/part-done/done/error` → UI 상태 |

핵심은 **세 가지 동시성 도구의 조합**이다. (1) `SseEmitter`로 응답 스트림을 열어 두고, (2) `CompletableFuture` + 전용 `ExecutorService`로 의존 그래프를 병렬 실행하며, (3) `synchronized(emitter)`로 여러 파트가 동시에 끝날 때의 전송 충돌을 막는다.

## 4. 동작 원리 (흐름 · 표 · 작은 코드)

### 4.1 서버: emitter를 열고 전용 스레드에 일을 던진다

`runStream`은 `SseEmitter`를 즉시 만들어 **반환**하고(=HTTP 응답 스트림이 열림), 실제 작업은 `sseExecutor`에 던진다. 톰캣 요청 스레드는 곧바로 풀려난다.

```java
public SseEmitter runStream(Long userId, AutoPrepRequest request) {
    SseEmitter emitter = new SseEmitter(SSE_TIMEOUT_MS); // 타임아웃 300초
    sseExecutor.execute(() -> {                          // 전용 데몬 스레드
        try {
            PrepPlan plan = planner.plan(userId, request);
            send(emitter, "plan", plan);                 // ① 계획 먼저 전송
            executeParallel(userId, request, plan, attachments, new PartListener() {
                public void onPartStart(String key)              { send(emitter, "part-start", Map.of("key", key)); }
                public void onSubstep(String k, String n, String d){ send(emitter, "substep", ...); }
                public void onPartDone(PrepStepResult result)    { send(emitter, "part-done", result); }
            });
            send(emitter, "done", Map.of("message", "완료"));
            emitter.complete();                           // 정상 종료
        } catch (RuntimeException ex) {
            emitter.completeWithError(ex);                // 실패 종료
        }
    });
    return emitter;
}
```

:::tip 왜 전용 스레드풀인가
`SseEmitter`를 반환해도 톰캣 요청 스레드가 자동으로 백그라운드로 가지는 않는다. 무거운 LLM 호출 루프를 요청 스레드에서 돌리면 그 스레드를 수십 초 점유한다. 그래서 `Executors.newCachedThreadPool`로 만든 **데몬 스레드**(`autoprep-sse`)에 작업을 넘겨, 요청 스레드는 즉시 반납하고 전송만 그 스레드가 맡는다. `@PreDestroy`에서 `shutdownNow()`로 정리한다.
:::

### 4.2 의존 그래프 병렬 — `CompletableFuture`로 DAG 표현

6파트는 전부 순차가 아니다. `FIT`·`INTERVIEW`는 `JOB`(공고 분석 결과가 DB에 커밋된 뒤)에만 의존하고, 나머지는 독립이라 동시에 출발한다. 이 의존을 `CompletableFuture.allOf(deps).thenRunAsync(...)`로 표현한다.

```java
private static final Map<String, List<String>> DEPS = Map.of(
        "FIT", List.of("JOB"),
        "INTERVIEW", List.of("JOB"));   // 면접 준비는 공고 분석 이후

for (String key : plan.steps()) {
    CompletableFuture<?>[] depFutures = DEPS.getOrDefault(key, List.of())
            .stream().map(futures::get).filter(Objects::nonNull)
            .toArray(CompletableFuture[]::new);
    CompletableFuture<Void> future = CompletableFuture.allOf(depFutures)
            .thenRunAsync(() -> runPart(...), sseExecutor);  // dep 끝난 뒤 시작
    futures.put(key, future);
}
CompletableFuture.allOf(futures.values()...).join();  // 전부 끝날 때까지 대기
```

각 파트는 `runPart`에서 `onPartStart` → (핸들러가 `onSubstep`으로 세부 단계 보고) → `onPartDone`을 호출한다. 핸들러가 없거나 비활성이면 `PrepStepResult.skipped(key, "준비중")`을 보내고(면접 스텝도 지원 건이 없으면 skip), 예외는 파트 단위로 잡아 `failed`로 바꿔 **한 파트가 죽어도 전체 스트림이 멈추지 않게** 한다.

### 4.3 동시 전송 충돌을 막는 `synchronized(emitter)`

여러 파트가 **동시에** 끝나면 여러 스레드가 같은 `emitter.send(...)`를 동시에 호출한다. `SseEmitter`는 그 자체로 스레드 세이프하지 않으므로 emitter 단위로 동기화한다.

```java
private void send(SseEmitter emitter, String event, Object data) {
    try {
        synchronized (emitter) {  // 병렬 파트가 동시에 호출 → 직렬화
            emitter.send(SseEmitter.event().name(event)
                    .data(data, MediaType.APPLICATION_JSON));
        }
    } catch (IOException ex) {
        throw new IllegalStateException("SSE 전송 중단(클라이언트 종료)", ex);
    }
}
```

클라이언트가 탭을 닫으면 `send`가 `IOException`을 던지고, 이를 런타임 예외로 바꿔 위로 전파해 `completeWithError`로 스트림을 닫는다.

### 4.4 클라이언트: `EventSource`가 아니라 `fetch` 스트림

표준 `EventSource` API는 **요청 헤더를 붙일 수 없다.** 이 프로젝트는 JWT를 `Authorization: Bearer ...` 헤더로 싣기 때문에 `EventSource`를 쓸 수 없다. 그래서 `fetch` + `ReadableStream`을 직접 읽어 SSE 프레임을 손으로 파싱한다.

```ts
const res = await fetch(`${BASE}/auto-prep/run/stream`, {
  method: "POST",
  headers: { Accept: "text/event-stream", Authorization: `Bearer ${token}` },
  body: JSON.stringify(req), signal,
});
const reader = res.body.getReader();
const decoder = new TextDecoder();
let buffer = "";
for (;;) {
  const { value, done } = await reader.read();
  if (done) break;
  buffer += decoder.decode(value, { stream: true });
  let sep;
  while ((sep = buffer.indexOf("\n\n")) >= 0) {  // 이벤트 경계 = 빈 줄
    const raw = buffer.slice(0, sep);
    buffer = buffer.slice(sep + 2);
    const evt = parseEvent(raw);   // event: / data: 라인 분해 → JSON.parse
    if (evt) on(evt);
  }
}
```

`parseEvent`는 한 프레임을 `event:`/`data:` 라인으로 쪼개 `data`를 `JSON.parse`한 뒤, `plan/part-start/substep/part-done/done/error` 타입별 객체로 바꿔 `useAutoPrepRun` reducer에 흘려보낸다. 이 SSE는 `ApiResponse<T>` envelope를 타지 않으므로(스트림이라 한 번에 감쌀 수 없다) `api()` 공통 래퍼를 우회하고 토큰을 수동으로 붙인다.

### 4.5 이벤트 흐름 한눈에

| 이벤트 | 시점 | 페이로드 | UI 반응 |
|---|---|---|---|
| `plan` | 두뇌(Planner)가 계획 수립 직후 | 실행할 파트 목록 | 진행 단계 골격 표시 |
| `part-start` | 각 파트 시작 | `{key}` | 해당 파트 "진행 중" |
| `substep` | 파트 내부 세부 단계 | `{key,name,desc}` | 세부 진행 라인 추가 |
| `part-done` | 파트 종료(DONE/SKIPPED/FAILED) | `PrepStepResult` | 체크/건너뜀/실패 표시 |
| `done` | 전부 종료 | `{message:"완료"}` | 완료 + 면접 화면 이동 |
| `error` | 치명 실패 | `{message}` | 오류 배너 |

## 5. 구현 상태 (됨 vs 계획) — 정직 구분

이 페이지에서 가장 중요한 정직 포인트다. "면접 실시간 진행"이라는 말 아래 **세 가지 서로 다른 메커니즘**이 있고, 그중 하나만 진짜 서버 푸시 SSE다.

| 메커니즘 | 무엇 | 진짜 SSE인가 | 위치 |
|---|---|---|---|
| **AutoPrep 스트리밍** | 면접 준비 포함 6파트 진행을 서버가 푸시 | ✅ 진짜 SSE | `ai/autoprep` (D 코어 소유) |
| 모범답안 백그라운드 생성 | 질문 INSERT 후 `afterCommit` 백그라운드 스레드 | ❌ SSE 아님 (서버 내부 비동기) | `InterviewBackgroundExecutor`(고정 풀 2) |
| 에이전트 타임라인 | 채점 단계(`interview_agent_step`)를 화면에 흘려 보여줌 | ❌ **클라이언트 순차 재생** | `AgentTimeline.tsx` |

**채점 타임라인은 SSE가 아니다(정직).** `AgentTimeline`은 `getAgentSteps`로 **이미 저장된** step 배열을 받아 와, 클라이언트에서 `setInterval(..., 550)`으로 한 줄씩 등장시켜 "에이전트가 지금 일하는" 체감만 준다. 코드 주석이 직접 명시한다(`AgentTimeline.tsx:22`): "현재는 저장된 단계를 클라이언트에서 순차 재생한다. 서버 푸시(SSE) 실시간 스트리밍은 후속(EventSource 의 인증 헤더 제약으로 fetch-stream 도입이 필요 — 로드맵 6-1)." 흥미롭게도 그 fetch-stream 패턴은 AutoPrep에 이미 존재하므로, 채점 스트리밍은 그 검증된 방식을 면접 채점 엔드포인트로 확장하면 되는 단계다.

**시간기반 가짜 진행바도 SSE가 아니다.** `InterviewProgressBar`는 LLM 응답이 올 때까지 실제 진행률을 모르므로 `90*(1-exp(-elapsed/(estMs*0.6)))` 점근 곡선으로 체감만 채운다. 거의 모든 생성·채점 화면이 이 폴백 진행바를 재사용한다.

정리하면 면접 도메인이 사용자에게 주는 "실시간감"은 ① 진짜 SSE(AutoPrep 경유 준비 단계), ② 서버 내부 비동기(모범답안), ③ 클라이언트 연출(타임라인·진행바)의 합성이다. 이를 한 덩어리로 뭉뚱그려 "면접이 SSE로 실시간 스트리밍된다"고 말하면 과장이다.

## 6. 면접 답변 3단계

1. **무엇** — "면접 준비는 공고 분석·적합도·예상 질문 생성 등 여러 LLM 호출이 묶인 긴 작업이라, AutoPrep 오케스트레이터에서 SSE(`POST /api/auto-prep/run/stream`)로 `plan→part-start→substep→part-done→done` 이벤트를 실시간으로 푸시합니다. 면접은 그중 한 스텝으로 참여합니다."
2. **왜** — "서버가 진행을 일방적으로 알리기만 하면 되는 단방향 시나리오라 WebSocket은 과하고 폴링은 거칠어, HTTP 위 단방향 푸시인 SSE를 골랐습니다. 동기 `run`과 스트리밍 `runStream`이 같은 병렬 로직을 공유하고 리스너만 다릅니다."
3. **어떻게** — "`SseEmitter`를 열어 두고 전용 데몬 스레드풀에 작업을 던져 톰캣 요청 스레드를 막지 않습니다. 파트는 `CompletableFuture.allOf(dep).thenRunAsync(..., sseExecutor)`로 의존 그래프 병렬 실행하고, 동시에 끝난 파트들이 같은 emitter에 쏘는 충돌은 `synchronized(emitter)`로 직렬화합니다. 클라이언트는 JWT 헤더가 필요해 `EventSource` 대신 `fetch` + `ReadableStream`으로 프레임을 직접 파싱합니다. 다만 면접 채점 타임라인 자체는 아직 SSE가 아니라 저장된 step의 클라이언트 순차 재생이고, 같은 fetch-stream 패턴으로 확장하는 게 로드맵입니다."

## 7. 꼬리질문 + 모범답안

:::details Q1. 왜 표준 `EventSource`를 안 쓰고 `fetch` 스트림으로 직접 SSE를 파싱했나?
`EventSource`는 요청 커스텀 헤더를 붙일 수 없는데, 인증을 `Authorization: Bearer` 헤더로 싣기 때문입니다. `fetch`는 헤더를 자유롭게 붙일 수 있어 토큰을 실은 뒤 `res.body.getReader()`로 청크를 읽고, `\n\n`(빈 줄)을 이벤트 경계로 버퍼를 잘라 `event:`/`data:` 라인을 손으로 파싱합니다. 대가는 자동 재연결 같은 `EventSource` 기본기를 직접 구현해야 한다는 점입니다. 같은 제약이 면접 채점 타임라인을 아직 SSE로 못 만든 이유로도 명시돼 있습니다(로드맵 6-1).
:::

:::details Q2. 동시에 여러 파트가 끝나면 어떤 동시성 문제가 생기고 어떻게 막았나?
`CompletableFuture`로 독립 파트를 병렬 실행하므로 두 스레드가 같은 순간에 `emitter.send(...)`를 호출할 수 있습니다. `SseEmitter`는 동시 전송에 안전하지 않아 프레임이 깨질 수 있습니다. 그래서 `send` 헬퍼 안에서 `synchronized(emitter)`로 emitter 단위 락을 걸어 전송을 직렬화했습니다. 전송 자체는 짧아 락 경합 비용이 작습니다.
:::

:::details Q3. SSE 작업을 왜 톰캣 요청 스레드가 아니라 전용 스레드풀에서 돌렸나?
`SseEmitter`를 반환해도 무거운 LLM 루프를 요청 스레드에서 실행하면 그 스레드가 수십 초 묶여 서블릿 스레드 풀이 고갈될 수 있습니다. `Executors.newCachedThreadPool`로 만든 데몬 스레드(`autoprep-sse`)에 작업을 넘겨 요청 스레드는 즉시 반납하고, 전송과 LLM 호출은 그 스레드가 담당합니다. `@PreDestroy`에서 `shutdownNow()`로 정리합니다. 면접 도메인의 모범답안 백그라운드 생성도 비슷하게 별도 풀(`InterviewBackgroundExecutor`, 고정 2개)을 쓰지만, 그쪽은 SSE 전송이 아니라 순수 내부 후처리입니다.
:::

:::details Q4. 한 파트(예: 면접 준비)가 실패하면 스트림 전체가 끊기나?
아닙니다. 파트 실행은 `runPart`/`executeOne`에서 예외를 잡아 `PrepStepResult.failed(...)` 또는 핸들러 비활성 시 `skipped("준비중")`로 바꿔 `part-done` 이벤트로 내보냅니다. 즉 파트 단위로 격리돼 한 파트가 죽어도 나머지는 계속 진행되고 스트림은 정상적으로 `done`까지 갑니다. `runStream` 최상위의 `try/catch`는 계획 수립 자체가 깨지는 치명 오류일 때만 `completeWithError`로 닫습니다. 면접 스텝은 지원 건이 없으면 그냥 skip 처리됩니다.
:::

:::details Q5. 동기 `run`과 스트리밍 `runStream`은 코드가 두 벌인가?
아닙니다. 둘 다 `executeParallel`이라는 같은 병렬 실행 메서드를 호출하고, 차이는 주입하는 리스너뿐입니다. `run`은 `NOOP_LISTENER`(이벤트 무시)를, `runStream`은 `emitter.send`를 호출하는 `PartListener`를 넘깁니다. 덕분에 병렬·의존 로직이 한 곳에만 있고 스트리밍 여부로 갈라지지 않습니다. `run`은 결과를 plan 순서로 정렬해 한 번에 반환하고, `runStream`은 끝나는 순서대로 흘려보냅니다.
:::

:::details Q6. 면접 채점 화면의 "에이전트 타임라인"은 SSE 실시간 스트리밍인가?
아닙니다(정직히 구분해야 하는 지점). `AgentTimeline`은 채점이 **끝난 뒤** 저장된 `interview_agent_step` 배열을 `getAgentSteps`로 받아, 클라이언트에서 `setInterval(550ms)`로 한 줄씩 등장시키는 **재생 애니메이션**입니다. 서버가 채점 도중에 단계를 푸시하는 진짜 SSE가 아닙니다. 코드 주석이 이를 명시하고, 후속으로 AutoPrep과 동일한 fetch-stream 방식으로 실시간화하는 게 로드맵(6-1)입니다.
:::

## 8. 직접 말해보기

다음을 막힘없이 90초 안에 설명할 수 있는지 점검하라.

- AutoPrep SSE 엔드포인트 한 줄(`POST /api/auto-prep/run/stream`, `produces=text/event-stream`, `SseEmitter` 반환)과 5종 이벤트(`plan/part-start/substep/part-done/done`).
- "전용 스레드풀에 던진다 → `CompletableFuture.allOf(dep).thenRunAsync` 의존 그래프 병렬 → `synchronized(emitter)` 전송 직렬화" 3단을 순서대로.
- `EventSource`를 못 쓴 이유(JWT 헤더)와 `fetch`+`getReader`로 `\n\n` 경계 파싱한다는 대체안.
- **무엇이 진짜 SSE이고(AutoPrep 준비), 무엇이 클라이언트 연출인지(채점 타임라인 550ms 재생, 시간기반 진행바)** 를 섞지 않고 구분.
- 동기 `run`과 스트리밍 `runStream`이 같은 `executeParallel`을 공유하고 리스너만 다르다는 점.

## 퀴즈

<QuizBox question="이 프로젝트에서 실제 동작하는 SSE 서버 푸시는 어디에 구현돼 있나?" :choices="['interview 도메인의 InterviewServiceImpl', 'ai/autoprep 의 AutoPrepOrchestrator.runStream', 'InterviewRealtimeService (OpenAI Realtime)', 'AgentTimeline 컴포넌트']" :answer="1" explanation="면접 도메인 코드에는 SseEmitter 가 없다. 실제 SSE 는 AutoPrep 오케스트레이터의 runStream 에 있고, 면접은 그 6파트 중 한 스텝(InterviewPrepHandler)으로 참여한다." />

<QuizBox question="프론트가 표준 EventSource 대신 fetch + ReadableStream 으로 SSE 를 직접 파싱한 가장 큰 이유는?" :choices="['EventSource 가 JSON 을 못 받아서', 'Authorization 헤더(JWT)를 붙여야 하는데 EventSource 는 커스텀 헤더를 못 붙여서', 'SSE 보다 WebSocket 이 빨라서', 'Vite 프록시가 EventSource 를 막아서']" :answer="1" explanation="EventSource API 는 요청 커스텀 헤더를 지원하지 않는다. 인증을 Bearer 헤더로 싣기 때문에 fetch 로 토큰을 붙이고 res.body.getReader() 로 스트림을 직접 읽는다." />

<QuizBox question="병렬로 끝난 여러 파트가 같은 SseEmitter 에 동시에 이벤트를 보낼 때의 충돌은 어떻게 막았나?" :choices="['파트를 전부 순차 실행으로 바꿈', 'send 헬퍼에서 synchronized(emitter) 로 전송을 직렬화', 'emitter 를 파트마다 새로 생성', 'WebSocket 으로 교체']" :answer="1" explanation="CompletableFuture 로 독립 파트를 병렬 실행하므로 동시 send 가 가능한데, SseEmitter 는 스레드 세이프하지 않다. send 안에서 synchronized(emitter) 로 전송을 직렬화해 프레임 깨짐을 막는다." />
