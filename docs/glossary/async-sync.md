# 동기 / 비동기 (Sync / Async)

> 동기는 "끝날 때까지 줄 서서 기다리는 것", 비동기는 "주문만 넣고 자리에 가서 다른 일 하는 것"이다. 핵심은 호출자가 결과를 기다리며 멈추느냐(블로킹), 멈추지 않고 계속 진행하느냐(논블로킹)다.

## 1. 한 줄 정의

- **동기(Synchronous)**: 어떤 작업을 호출하면 그 작업이 끝날 때까지 호출한 쪽이 멈춰서 기다린 뒤 다음 줄로 넘어간다.
- **비동기(Asynchronous)**: 작업을 시작시키고 결과를 기다리지 않고 바로 다음 줄로 넘어간다. 결과는 나중에 콜백·이벤트·스트림 등으로 받는다.

## 2. 단어 뜻 (약자·어원)

| 용어 | 어원 | 뜻 |
| --- | --- | --- |
| Synchronous | sync(함께) + chronos(시간) | "시간을 함께 맞춘다" → 호출과 완료가 한 흐름에 묶임 |
| Asynchronous | a(없음) + sync | "시간을 함께 맞추지 않는다" → 호출과 완료가 분리됨 |
| Blocking | block(막다) | 결과가 올 때까지 그 스레드가 막혀 아무것도 못 함 |
| Non-blocking | 막지 않음 | 결과를 기다리지 않고 스레드를 즉시 돌려줌 |

:::tip 동기/비동기 vs 블로킹/논블로킹
둘은 비슷하지만 보는 관점이 다르다. **동기/비동기**는 "결과를 호출 시점에 받느냐 나중에 받느냐"(완료 통지 관점), **블로킹/논블로킹**은 "기다리는 동안 스레드를 점유하느냐"(제어권 관점)다. 면접에선 "동기는 보통 블로킹과 함께 다닌다" 정도로 묶어 말하고, 엄밀히는 다른 축이라고 덧붙이면 좋다.
:::

## 3. 왜 필요한가 (없으면 무슨 문제)

웹 서버의 요청 스레드는 한정된 자원이다. 사용자의 한 요청을 처리하는 스레드가 **느린 외부 작업**(메일 SMTP 발송, AI 모델 호출, 무거운 텍스트 추출)을 동기로 기다리면 다음 두 문제가 생긴다.

1. **응답성 저하**: 사용자는 클릭 후 그 느린 작업이 끝날 때까지 화면이 멈춘 채로 기다린다. "글 등록"을 눌렀는데 AI 검열이 끝나야 응답이 온다면, 검열이 3초 걸리면 등록도 3초 걸린다.
2. **처리량(throughput) 저하**: 스레드 풀이 느린 작업에 묶여 있으면, 그 시간 동안 다른 사용자 요청을 받을 스레드가 없어 서버 전체가 막힌다. 최악엔 타임아웃·장애로 번진다.

비동기는 "느린 작업은 다른 일꾼(스레드/프로세스)에게 던지고, 요청 스레드는 즉시 사용자에게 응답을 돌려준다"로 이 둘을 동시에 푼다.

## 4. CareerTuner에서 어디에 썼나 (실제 근거)

CareerTuner는 동기/비동기를 의도적으로 나눠 썼다. 같은 코드베이스 안에 "동기로 둔 것"과 "비동기로 뺀 것"이 공존한다.

### (a) 동기로 둔 것 — 인증 메일 발송

`auth/service/EmailService.java`의 `send(...)`은 `JavaMailSender.send(message)`를 **동기 호출**한다. 즉 SMTP 응답이 올 때까지 요청 스레드가 기다린다. 개발 환경에선 SMTP가 없으므로 `props.getMail().isDevMode()` 또는 `smtpUsername`이 비어 있으면 실제 발송을 건너뛰고 인증 링크를 `log.info("[DEV-MAIL] ...")`로 출력하는 **dev mode 폴백**을 둔다.

:::warning 여기가 개선 포인트
지금은 회원가입 요청 스레드가 SMTP 발송 결과를 동기로 기다린다. 메일 서버가 느리면 회원가입 응답도 같이 느려진다. 면접에서 "동기로 둔 부분의 한계"를 물으면 바로 이걸 말하면 된다 → 개선 방향은 `@Async`로 발송을 분리하거나, 메시지 큐(예: 발송 작업을 큐에 넣고 별도 컨슈머가 처리)로 빼는 것.
:::

### (b) 비동기로 뺀 것 — 커뮤니티 AI 검열 (이미 구현됨)

게시글·댓글 저장 후 AI 검열은 **이미 비동기**다. 동작 흐름:

| 단계 | 클래스 | 역할 |
| --- | --- | --- |
| 1. 글 저장 | `community/service/CommunityPostServiceImpl` | 저장 후 `ApplicationEventPublisher`로 이벤트 발행 |
| 2. 커밋 후 수신 | `moderation/event/PostModerationListener` | `@TransactionalEventListener(AFTER_COMMIT)` + `@Async("moderationExecutor")` |
| 3. 전용 풀 실행 | `moderation/config/ModerationAsyncConfig` | `@EnableAsync` + `moderationExecutor` 스레드 풀 |
| 4. 누락 회수 | `moderation/schedule/ModerationRetryScheduler` | 폐기·실패 건을 배치로 재시도 |

`PostModerationListener`의 핵심은 두 어노테이션의 조합이다.

```java
@Async("moderationExecutor")                              // 전용 스레드 풀에서 실행 (요청 스레드 X)
@TransactionalEventListener(phase = AFTER_COMMIT)         // 트랜잭션 커밋 후에만 실행
public void on(PostModerationRequiredEvent event) {
    moderationService.moderate(event.postId());          // 검열은 여기서, 응답과 분리되어 진행
}
```

`ModerationAsyncConfig`는 단순히 `@Async`만 켠 게 아니라 운영 안전장치까지 넣었다.

```java
executor.setCorePoolSize(2); executor.setMaxPoolSize(2); // 동시 검열 2건
executor.setQueueCapacity(100);                          // 바쁘면 100건 대기
executor.setRejectedExecutionHandler((task, exec) ->     // 큐 포화 시: 예외 전파 X, 로그 후 폐기
        log.warn("검열 큐 포화 — 재시도 배치에서 회수"));
executor.setWaitForTasksToCompleteOnShutdown(true);      // 재배포 시 진행 중 작업 마무리
```

→ "글은 저장됐는데 검열 큐가 막혀 사용자에게 500이 가는 사고"를 막으려고 **거부 정책을 폐기+로그**로 두고, 폐기된 건은 `ModerationRetryScheduler`가 회수한다. 즉 비동기를 "그냥 던지고 끝"이 아니라 **유실 복구까지 설계**했다.

### (c) 진행 상황을 흘려보내기 — AutoPrep의 SSE

AI 오케스트레이터(`ai/autoprep/AutoPrepController`)의 `/api/auto-prep/run/stream`은 `SseEmitter`를 반환한다(`produces = TEXT_EVENT_STREAM_VALUE`). 6개 파트를 순차 실행하는 긴 작업이라, 끝날 때까지 동기로 기다리게 하지 않고 `plan / part-start / substep / part-done / done` 이벤트를 **실시간으로 흘려보낸다.** 사용자는 "공고 분석 중 → 적합도 계산 중"을 단계별로 본다.

### (d) 프런트 — async/await + fetch

`frontend/src/app/lib/api.ts`의 제네릭 `api<T>()`는 `await fetch(...)` 기반이다. 더 중요한 건 **단일 비행(single-flight) 리프레시**다. 401이 오면 여러 요청이 동시에 `/auth/refresh`를 호출하지 않도록, 진행 중인 리프레시 Promise(`refreshPromise`) 하나를 모두가 `await`로 공유한 뒤 원요청을 재시도한다 — 비동기 흐름을 어떻게 "동시성 제어"까지 끌고 가는지 보여주는 부분이다.

### (e) ML 공고추출 — 별도 프로세스 분리 (설계)

무거운 공고 텍스트 추출/임베딩은 Python ML 워커라는 **별도 프로세스**로 분리하는 구조다. 같은 JVM 안 비동기를 넘어, 아예 다른 실행 단위로 떼어 백엔드 응답성과 ML 부하를 분리한다.

## 5. 핵심 동작 원리 (표·작은 코드)

같은 "글 저장 + AI 검열"을 동기/비동기로 비교하면 차이가 명확하다.

```text
[동기]   요청스레드 ──저장──▶ ──검열(3s 대기)──▶ 응답   ← 사용자 3초 대기
[비동기] 요청스레드 ──저장──▶ 응답(즉시)               ← 사용자 즉시 응답
                         └─(이벤트)─▶ moderation풀 ──검열──▶ DB 갱신
```

| 관점 | 동기 | 비동기 |
| --- | --- | --- |
| 응답 시점 | 작업 완료 후 | 작업 시작 직후 |
| 스레드 점유 | 끝날 때까지 점유(블로킹) | 즉시 반납(논블로킹) |
| 코드 단순함 | 높음(위에서 아래로) | 낮음(콜백/이벤트/예외 추적 어려움) |
| 실패 처리 | 호출자가 즉시 인지 | 별도 통지 필요(여기선 retry 배치) |
| CareerTuner 예 | 메일 발송 | 커뮤니티 검열, AutoPrep SSE |

:::details Spring의 @Async가 "마법"이 아닌 이유 — 자기호출(self-invocation) 함정
`@Async`는 스프링이 만든 **프록시**를 통해 호출돼야 작동한다. 같은 클래스 안에서 `this.someAsyncMethod()`로 직접 부르면 프록시를 거치지 않아 그냥 동기 실행돼 버린다(`ModerationRetryScheduler` 주석에도 이 이슈가 언급돼 있다). 그래서 CareerTuner는 검열을 **별도 리스너(`PostModerationListener`)**로 분리해 프록시 경계를 확실히 넘긴다. "왜 메서드를 굳이 다른 빈으로 뺐나?"의 답이 이것이다.
:::

## 6. 면접 답변 3단계

- **초간단(한 문장)**: "동기는 끝날 때까지 기다리는 것, 비동기는 안 기다리고 다음 일을 하는 것입니다. 느린 작업을 비동기로 빼면 응답이 빨라지고 서버 처리량이 늘어요."
- **기본(맥락 추가)**: "CareerTuner에서 글 저장 후 AI 검열은 응답 시간에 영향을 주면 안 돼서 `@Async` 전용 스레드 풀로 분리하고, 트랜잭션 커밋 후에만 실행되게 `@TransactionalEventListener(AFTER_COMMIT)`를 붙였습니다. 반대로 인증 메일은 아직 동기라 SMTP가 느리면 회원가입도 느려지는 한계가 있어, 이건 `@Async`나 메시지 큐로 뺄 개선 대상입니다."
- **꼬리질문 대비(트레이드오프)**: "비동기는 공짜가 아닙니다. 작업이 유실될 수 있어서 큐 포화 시 폐기 정책과 `ModerationRetryScheduler` 재시도 배치로 복구를 설계했고, 종료 시 진행 중 작업을 마치도록 `waitForTasksToCompleteOnShutdown`도 켰습니다."

## 7. 꼬리질문 + 모범답안

:::details Q1. 메일 발송을 왜 비동기로 안 했나? 동기로 둔 이유와 위험은?
현재는 단순함과 즉시 실패 인지(메일 실패 시 바로 `BusinessException`)를 위해 동기로 뒀습니다. 위험은 SMTP가 느리거나 죽으면 회원가입/비번재설정 응답이 같이 느려지고 요청 스레드가 묶이는 것입니다. 개선은 `@Async`로 발송 분리(검열에서 쓴 패턴 재사용) 또는 메시지 큐로 빼고, 실패는 재시도/DLQ로 처리하는 방향입니다.
:::

:::details Q2. `@TransactionalEventListener(AFTER_COMMIT)`를 굳이 쓴 이유는?
검열은 "실제로 저장 확정된 글"에만 돌아야 합니다. 만약 트랜잭션이 롤백되면 글은 없는데 검열이 도는 모순이 생깁니다. AFTER_COMMIT은 커밋이 끝난 뒤에만 리스너를 실행해 이 문제를 막습니다. 추가로 `@Async`까지 붙여서 커밋 후 검열이 요청 스레드를 다시 잡지 않게 했습니다.
:::

:::details Q3. 비동기로 던진 작업이 유실되면? 정합성은 어떻게 보장하나?
스레드 풀 큐가 포화되면 예외를 웹 스레드로 전파하지 않고(전파하면 "저장은 됐는데 500" 사고) 로그만 남기고 폐기합니다. 대신 폐기·실패 건은 `ModerationRetryScheduler` 배치가 미검열 상태를 조회해 재시도합니다. 즉 "정확히 한 번"이 아니라 "결국엔 처리됨(eventual)"을 재시도로 보장합니다.
:::

:::details Q4. 동기/비동기와 블로킹/논블로킹의 차이는?
동기/비동기는 결과를 호출 시점에 받느냐 나중에 받느냐(완료 통지)의 축, 블로킹/논블로킹은 기다리는 동안 스레드를 점유하느냐의 축입니다. 보통 같이 다니지만 다른 개념이라, 예컨대 동기-논블로킹(폴링)처럼 조합도 가능합니다. CareerTuner의 검열은 비동기-논블로킹(요청 스레드는 즉시 반납), 메일은 동기-블로킹입니다.
:::

:::details Q5. 긴 AI 작업의 진행 상황은 어떻게 사용자에게 보여주나?
AutoPrep는 `SSE(Server-Sent Events)`로 `plan/part-start/substep/part-done/done` 이벤트를 실시간 전송합니다. 한 번의 요청으로 끝까지 동기 대기시키는 대신, 서버가 단계마다 이벤트를 흘려보내 사용자가 진행률을 봅니다. 폴링 대비 서버 부하가 적고 단방향 스트림이라 구현이 단순합니다.
:::

## 8. 직접 말해보기

1. "동기와 비동기를 식당 비유로 30초 안에 설명해 보라."
2. "CareerTuner에서 비동기로 뺀 작업 하나와, 일부러 동기로 둔 작업 하나를 들고 각각 왜 그렇게 했는지 말해보라."
3. "비동기로 던진 작업이 유실될 수 있다는 점을 어떻게 방어했는가? (큐 거부 정책 + 재시도 배치 + 종료 시 대기 3가지로)"
4. "`@Async` 메서드를 같은 클래스에서 직접 호출하면 왜 동기로 돌아버리는가?"

관련 페이지: [트랜잭션](/glossary/transaction) · [AutoPrep 오케스트레이터](/ai/orchestrator-autoprep) · [API 레이어와 JWT 리프레시](/frontend/api-layer-jwt-refresh) · [예외 처리](/backend/exception-handling)

## 퀴즈

<QuizBox question="비동기 처리의 가장 큰 장점 두 가지로 옳은 것은?" :choices="['코드가 항상 더 단순해진다', '응답성과 처리량(throughput) 향상', '데이터 정합성이 자동으로 보장된다', '메모리 사용량이 항상 줄어든다']" :answer="1" explanation="비동기는 느린 작업을 다른 일꾼에게 넘겨 요청 스레드를 즉시 반납하므로 응답이 빨라지고(응답성), 스레드가 묶이지 않아 동시 처리량이 늘어난다. 대신 코드 복잡도와 유실 가능성은 오히려 늘어난다." />

<QuizBox question="CareerTuner에서 커뮤니티 글 검열 리스너에 @TransactionalEventListener(AFTER_COMMIT)를 붙인 이유는?" :choices="['검열을 더 빠르게 하려고', '롤백된 글은 검열하지 않고 커밋 확정된 글만 검열하려고', 'SMTP 발송을 막으려고', 'JWT 토큰을 갱신하려고']" :answer="1" explanation="AFTER_COMMIT은 트랜잭션 커밋 후에만 리스너를 실행한다. 글 저장이 롤백되면 검열이 돌면 안 되므로, 실제 저장 확정된 글에만 검열이 돌도록 보장한다." />

<QuizBox question="@Async 메서드를 같은 클래스 내부에서 this로 직접 호출하면 어떻게 되며, CareerTuner는 이를 어떻게 회피했는지 설명하라." explanation="자기호출(self-invocation)은 스프링 프록시를 거치지 않으므로 @Async가 무시되고 그냥 동기로 실행된다. CareerTuner는 검열 로직을 PostModerationListener라는 별도 빈으로 분리해, 이벤트를 통해 프록시 경계를 넘겨 비동기 실행을 보장했다." />
