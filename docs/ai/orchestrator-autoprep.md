# AI 오케스트레이터 (AutoPrep)

> "한 줄 요청을 받아 여러 AI 단계를 의존 그래프대로 병렬 실행하고, 진행 상황을 SSE로 실시간 보고하는 백엔드 파이프라인입니다. 제가 맡은 C 영역에서는 그 중 적합도 분석(FIT) 단계를 핸들러로 끼웠습니다."

## 1. 한 줄 정의

AutoPrep은 **"OO회사 면접 준비 통째로 해줘" 같은 한 줄 요청을 받아, 프로필·공고분석·적합도·자소서·면접질문·커뮤니티 6개 AI 단계를 의존 관계에 맞춰 병렬로 묶어 실행하는 오케스트레이터**다. 각 단계는 독립 핸들러로 분리돼 있고, 오케스트레이터는 "어떤 순서로, 무엇을 동시에 돌릴지"만 관장한다.

## 2. 단어 뜻 (약자/어원 풀이)

| 단어 | 뜻 |
| --- | --- |
| Orchestrator(오케스트레이터) | 지휘자. 개별 연주자(AI 단계)를 직접 연주하지 않고 **언제 들어오고 멈출지** 조율한다 |
| AutoPrep | Auto(자동) + Prep(preparation, 취업 준비). 자동 취업준비 파이프라인 |
| 의존 그래프(dependency graph) | "B가 끝나야 C를 시작할 수 있다"는 선후 관계를 그래프로 표현한 것 |
| SSE | Server-Sent Events. 서버 → 클라이언트 단방향 실시간 푸시 (HTTP 위의 스트림) |
| 핸들러(handler) | 한 단계의 실제 작업을 담당하는 교체 가능한 부품. `PrepStepHandler` 인터페이스 구현체 |
| 두뇌(planner) | 요청을 해석해 "무엇을 실행할지" 계획(`PrepPlan`)을 세우는 부분 |

핵심 비유: **오케스트레이터는 지휘자, 핸들러는 연주자, 플래너는 악보를 고르는 사람.** 지휘자는 바이올린을 직접 켜지 않는다.

## 3. 왜 필요한가 (없으면 무슨 문제가 생기나)

오케스트레이터가 없으면 프론트엔드가 6개 API를 **직접 순서 맞춰 호출**해야 한다. 그러면 이런 문제가 생긴다.

- **순서·의존을 프론트가 떠안는다**: "공고분석이 끝나야 적합도를 부를 수 있다"는 규칙을 클라이언트 코드에 박아야 한다. 규칙이 바뀌면 프론트도 같이 고쳐야 한다.
- **병렬 최적화가 안 된다**: 독립 단계까지 순차로 await하면 6단계 시간이 다 더해진다. 서버에서 묶으면 독립 단계는 동시에 돌릴 수 있다.
- **부분 실패 처리가 제각각**: 3번째 단계가 실패하면 나머지를 어떻게 할지 화면마다 다르게 구현된다.
- **진행 표시가 빈약**: "로딩중..." 스피너만 돌고, 지금 무슨 단계인지 사용자가 모른다.

AutoPrep은 이 네 가지를 **서버 한 곳**으로 모은다. 프론트는 "한 줄 요청 보내고 SSE 이벤트만 그리면" 된다.

## 4. CareerTuner에서 어디에 썼나 (실제 클래스/파일/테이블)

패키지: `backend/src/main/java/com/careertuner/ai/autoprep` (공통 AI 영역)

| 역할 | 클래스 | 설명 |
| --- | --- | --- |
| 진입 API | `AutoPrepController` | `/api/auto-prep/intake`(미리보기), `/run`(동기), `/run/stream`(SSE) |
| 두뇌(계획) | `AutoPrepPlanner` | 한 줄 요청 → 슬롯(회사·직무·모드) + 실행할 파트 결정 |
| 지휘자(실행) | `AutoPrepOrchestrator` | 의존 그래프 병렬 실행 + 진행 보고 |
| 계획 모델 | `PrepPlan` / `PrepSlots` | `defaultSteps()` = PROFILE·JOB·FIT·WRITE·INTERVIEW·COMMUNITY |
| 단계 계약 | `PrepStepHandler` (인터페이스) | `key()` / `enabled()` / `handle()` |
| 단계 결과 | `PrepStepResult` | status = DONE / SKIPPED / FAILED + 소요 ms |
| 핸들러 6종 | `handler/*PrepHandler` | Profile / Job / Fit / Write / Interview / Community |

내가 맡은 **C 영역 = FIT 단계**다.

:::tip C 영역이 끼운 부분 — `FitPrepHandler`
`handler/FitPrepHandler` 가 `PrepStepHandler` 를 구현해서 `key()`로 `"FIT"`을 반환한다. `handle()` 안에서 `progress.substep(...)`으로 "근거 검색 → 채점 → 검증" 3개 서브스텝을 SSE로 보고한 뒤, 실제 분석은 `FitAnalysisService.generate(userId, applicationCaseId)`에 위임한다. 결과는 `fit_analysis` 테이블(점수·매칭기술·부족기술·추천학습 등)에 저장되고, 분석 점수/판정은 LLM이 아니라 **서버 규칙·검증 로직(근거 가드)**으로 확정한다.
:::

:::warning 구현 vs 계획 구분
- **구현됨**: 오케스트레이터 골격, 의존 그래프 병렬 실행, SSE 진행 보고, FIT/JOB 등 핸들러 연결, 부분 실패 시 FAILED 기록 후 완주.
- **실행 제어**: `POST /api/auto-prep/run/cancel`은 사용자 범위 `runId`를 취소한다. 실행보다 취소가 먼저 도착해도 tombstone으로 기억해 다음 단계가 시작되지 않게 한다.
- **공고 첨부**: `POST /api/auto-prep/job-posting-case/upload`는 이 사용자의 공고 파일을 지원 건으로 만든다. `(user_id, file_id)` 멱등 키로 재시도가 중복 지원 건을 만들지 않는다.
- **첨부 생명주기**: 교체·재시도·취소·컴포넌트 종료 시 연결되지 않은 pending 파일을 정리하고, 정상 SSE `done/error`와 네트워크 EOF·abort·watchdog를 구분한다.
- **설정 활성 경로**: C 영역 자체 모델은 학습·연결 검증을 마쳤고 `provider=oss`와 endpoint 설정으로 사용할 수 있다. 저장소 기본 FIT provider는 OpenAI다.
:::

## 5. 핵심 동작 원리 (단계 + 코드)

### 5.1 흐름 한눈에

```text
한 줄 요청
   │  POST /api/auto-prep/run/stream
   ▼
AutoPrepPlanner.plan()      ← 두뇌: LLM으로 요청 파싱 → 슬롯 + 실행 파트 결정
   │  PrepPlan(steps=[PROFILE, JOB, FIT, WRITE, INTERVIEW, COMMUNITY])
   ▼
AutoPrepOrchestrator.executeParallel()
   │
   ├─ PROFILE  ─┐  (독립 → 즉시 출발)
   ├─ JOB ──────┤
   ├─ WRITE ────┤  ←── 이 4개는 서로 의존 없음, 동시 실행
   ├─ COMMUNITY─┘
   │
   └─ JOB 완료 후 ──▶ FIT(C) · INTERVIEW(D)  (JOB에 의존 → 그 다음 병렬)
```

### 5.2 의존 그래프를 코드로 표현

오케스트레이터는 의존을 단순 Map으로 선언한다. **FIT과 INTERVIEW만 JOB을 기다린다.**

```java
private static final Map<String, List<String>> DEPS = Map.of(
        "FIT",       List.of("JOB"),
        "INTERVIEW", List.of("JOB"));
```

실행은 `CompletableFuture`로 한다. 각 단계의 future를 만들 때 **자기 의존 단계들의 future가 모두 끝난 뒤(allOf) 실행**하도록 묶는다.

```java
for (String key : plan.steps()) {
    CompletableFuture<?>[] deps = DEPS.getOrDefault(key, List.of()).stream()
            .map(futures::get).filter(Objects::nonNull)
            .toArray(CompletableFuture[]::new);
    CompletableFuture<Void> future = CompletableFuture
            .allOf(deps)                      // 의존이 끝날 때까지 대기
            .thenRunAsync(() -> runPart(...), sseExecutor);
    futures.put(key, future);
}
CompletableFuture.allOf(futures.values()...).join();  // 전부 끝날 때까지 대기
```

의존이 없는 단계는 `allOf()`(빈 배열)가 즉시 완료라서 **바로 출발**한다. 의존이 있는 단계는 자연스럽게 뒤로 밀린다. 별도 스케줄러나 위상정렬 코드 없이 "future를 future에 엮는" 방식으로 그래프가 표현된다.

### 5.3 부분 실패 / 재시도 / 건너뜀

- **실패해도 완주**: 한 핸들러가 `BusinessException`이나 `RuntimeException`을 던지면 오케가 잡아서 `PrepStepResult.failed(...)`로 기록하고 **다음 단계는 계속 진행**한다. 단계 하나가 죽어도 전체가 멈추지 않는다.
- **건너뜀(SKIPPED)**: 핸들러가 없거나 `enabled()=false`(서빙/데이터 미준비)면 `skipped("준비중")`로 처리. FIT은 지원 건(applicationCaseId)이 없으면 스스로 SKIPPED를 반환한다.
- **재시도**: 현재 오케 레벨에서 자동 재시도는 없다(실패는 FAILED로 남긴다). 재시도는 **사용자가 해당 단계를 다시 트리거**하거나, 하위 LLM 게이트웨이의 **provider 폴백(자체→Claude→OpenAI)** 으로 흡수한다. 이건 면접에서 정직하게 "오케는 fail-fast가 아니라 fail-soft, 재시도는 게이트웨이 폴백과 사용자 재실행으로 분담"이라고 말하면 된다.
- **결과 누적**: 성공(DONE)한 단계의 결과는 `prior` 맵에 key별로 쌓여 다음 단계가 참조할 수 있다(예: FIT이 JOB 결과를 읽음).

### 5.4 SSE 실시간 진행 보고

`run`(동기)과 `runStream`(SSE)은 **같은 병렬 로직**을 쓰고, 다른 건 `PartListener`뿐이다. 동기는 NOOP, 스트림은 SSE 전송.

| 이벤트 | 시점 | 페이로드 |
| --- | --- | --- |
| `plan` | 계획 확정 직후 | PrepPlan(슬롯·steps) |
| `part-start` | 단계 시작 | key |
| `substep` | 핸들러 내부 진행 | key, name, desc (예: "채점 / 요건 매칭 점수화") |
| `part-done` | 단계 종료 | PrepStepResult(status·소요ms) |
| `done` | 전체 종료 | 완료 메시지 |

병렬 단계가 **동시에** emitter에 쓰므로, 전송은 `synchronized(emitter)`로 직렬화한다. 클라이언트가 끊으면 `IOException` → 스트림 중단으로 처리한다. SseEmitter 타임아웃은 5분.

## 6. 면접 답변 3단계

**초간단 (1문장)**: "여러 AI 단계를 의존 관계대로 병렬 실행하고 진행을 SSE로 실시간 보고하는 백엔드 오케스트레이터입니다."

**기본 (30초)**: "사용자가 'OO회사 준비 통째로 해줘'처럼 한 줄을 보내면, 플래너가 LLM으로 요청을 파싱해 실행할 단계를 정하고, 오케스트레이터가 CompletableFuture로 의존 그래프를 따라 병렬 실행합니다. 프로필·공고·자소서·커뮤니티는 독립이라 동시에 출발하고, 적합도(FIT)와 면접(INTERVIEW)은 공고분석(JOB)이 끝난 뒤 시작합니다. 각 단계는 PrepStepHandler 구현체라 새 단계는 컴포넌트만 추가하면 자동 등록됩니다. 저는 그 중 FIT 핸들러를 맡았습니다."

**꼬리질문 대응 (깊이)**: "의존은 DEPS 맵으로 선언하고, 단계 future를 만들 때 자기 의존 future들의 allOf 뒤에 thenRunAsync로 엮어서 위상정렬 없이 그래프를 표현합니다. 부분 실패는 fail-soft입니다 — 한 단계가 예외를 던져도 FAILED로 기록하고 나머지는 완주하며, SKIPPED/DONE/FAILED를 결과에 모아 summary로 냅니다. 동기 실행과 SSE 실행은 같은 병렬 코어를 공유하고 PartListener만 다릅니다."

## 7. 자주 나오는 꼬리질문 + 모범답안

:::details Q1. 왜 단순히 프론트에서 API를 순서대로 호출하지 않고 오케스트레이터를 뒀나?
의존·순서·병렬·부분실패·진행표시 다섯 가지가 모두 클라이언트로 새어나가기 때문이다. 의존 규칙이 바뀌면 프론트를 고쳐야 하고, 독립 단계까지 순차 await하면 응답이 느려진다. 서버에 모으면 프론트는 "요청 보내고 SSE 이벤트만 그리는" 단순한 역할로 줄고, 규칙 변경이 서버 한 곳에 갇힌다.
:::

:::details Q2. 병렬 실행을 어떻게 구현했나? 스레드 풀은?
`CompletableFuture` + 데몬 스레드의 cached thread pool(`autoprep-sse`)을 쓴다. 각 단계 future를 만들 때 의존 future들의 `allOf()` 뒤에 `thenRunAsync(..., executor)`로 붙인다. 의존 없는 단계는 빈 allOf가 즉시 완료라 바로 시작하고, 의존 있는 단계는 자동으로 대기한다. 마지막에 전체 future의 allOf().join()으로 모두 끝날 때까지 기다린다.
:::

:::details Q3. SSE를 쓴 이유? WebSocket이나 폴링은?
진행 보고는 **서버 → 클라이언트 단방향**이고 HTTP 위에서 끝나면 충분하다. WebSocket은 양방향이라 여기선 과하고, 폴링은 지연·요청 낭비가 크다. SSE는 표준 HTTP 스트림이라 프록시·인증과도 잘 맞고 구현이 가볍다. 양방향 입력이 필요했다면 WebSocket을 고려했을 것이다.
:::

:::details Q4. 한 단계가 실패하면 전체가 어떻게 되나?
fail-soft다. 핸들러가 던진 예외를 오케가 잡아 `PrepStepResult.failed`로 기록하고 다음 단계는 그대로 진행한다. 의존 단계가 실패하면 그 결과는 prior에 안 쌓이므로 하위 단계가 데이터 없음을 감지해 SKIPPED를 반환할 수 있다. 전체가 멈추지 않고 "완료 N · 건너뜀 M · 실패 K" 형태로 요약된다.
:::

:::details Q5. 새 AI 단계를 추가하려면?
`PrepStepHandler`를 구현한 `@Component`를 하나 추가하면 끝이다. 오케스트레이터는 스프링이 주입한 핸들러 리스트를 `key()`로 매핑하므로 오케 코드를 건드릴 필요가 없다(OCP). 의존이 있으면 DEPS 맵에 한 줄, 표준 순서에 넣으려면 `defaultSteps()`에 한 줄 추가하면 된다.
:::

## 8. 직접 말해보기 (말하기 훈련)

1. 화이트보드에 PROFILE·JOB·FIT·WRITE·INTERVIEW·COMMUNITY 6개 노드를 그리고, **어느 화살표(의존)가 있고 어디가 동시에 출발하는지** 30초 안에 설명해보라. (정답: FIT·INTERVIEW만 JOB에 화살표, 나머지 4개는 동시 출발)
2. "오케스트레이터가 없으면 프론트엔드가 떠안게 되는 책임 4가지"를 손가락으로 꼽으며 말해보라. (순서/의존, 병렬, 부분실패, 진행표시)

## 퀴즈

<QuizBox question="AutoPrep에서 다른 단계가 끝나기를 기다리는(의존이 있는) 단계는?" :choices="['PROFILE과 JOB', 'FIT과 INTERVIEW (둘 다 JOB에 의존)', 'WRITE과 COMMUNITY', '모든 단계가 순차 의존']" :answer="1" explanation="DEPS 맵에 FIT->JOB, INTERVIEW->JOB만 선언돼 있다. 나머지 4개(PROFILE·JOB·WRITE·COMMUNITY)는 의존이 없어 동시에 출발한다." />

<QuizBox question="한 단계 핸들러가 실행 중 예외를 던지면 AutoPrep 오케스트레이터의 동작은?" :choices="['전체 실행을 즉시 중단하고 에러 반환', '해당 단계를 FAILED로 기록하고 나머지 단계는 계속 진행', '실패한 단계를 3회 자동 재시도', '플랜 전체를 처음부터 다시 실행']" :answer="1" explanation="fail-soft 설계다. 오케가 예외를 잡아 PrepStepResult.failed로 기록하고 다음 단계는 계속 진행해 완주한다. 오케 레벨 자동 재시도는 없고, 재시도는 하위 게이트웨이 폴백과 사용자 재실행이 담당한다." />

<QuizBox question="동기 실행(run)과 SSE 실행(runStream)은 진행 보고 방식 외에 병렬 실행 로직을 공유한다. SSE 진행 이벤트가 보내는 순서를 한 문장으로 설명하라." explanation="계획이 확정되면 먼저 plan 이벤트로 슬롯과 steps를 보내고, 각 단계마다 part-start(시작) → substep(핸들러 내부 세부 진행, 여러 번) → part-done(상태·소요ms) 순으로 보내며, 모든 단계가 끝나면 done 이벤트로 마무리한다. 병렬 단계가 동시에 emitter에 쓰므로 전송은 emitter 단위로 synchronized 처리한다." />
