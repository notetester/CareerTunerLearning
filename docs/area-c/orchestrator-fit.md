# 오케스트레이터의 FIT 파트

> 한 줄 요청으로 시작되는 자동 준비 파이프라인에서, 내가 맡은 적합도 분석(FIT)을 어떻게 "공고 분석이 끝난 뒤" 끼워 넣고, 진행 과정을 SSE로 실시간 보여주며, 의존 그래프 병렬 속에서 안전하게 돌렸는지.

::: tip 이 페이지의 위치
영역 C 전체 철학(뉴로-심볼릭, 규칙엔진이 점수 확정)은 [영역 C 개요](/area-c/index)에서, FIT 단계 안에서 실제로 무슨 일이 일어나는지(채점·가드레일·폴백)는 [적합도 분석](/area-c/fit-analysis)·[가드레일](/area-c/guardrails)·[폴백 체인](/area-c/fallback-chain)에서 다룬다. 이 페이지는 **그 FIT을 더 큰 오케스트레이터에 어떻게 연결했는가**에 집중한다. 오케스트레이터 전반은 [AutoPrep 오케스트레이터](/ai/orchestrator-autoprep) 참고.
:::

## 1. 한 줄 정의 · 이 페이지가 답하는 면접 질문

AutoPrep 오케스트레이터는 **"OO회사 면접 준비 통째로 해줘" 같은 한 줄 요청을 프로필·공고·적합도·자소서·면접·커뮤니티 6개 AI 단계로 쪼개, 의존 관계대로 병렬 실행하고 진행을 SSE로 실시간 보고하는 백엔드 파이프라인**이다. 그 안에서 **FIT(적합도) 단계는 내가 소유한 영역 C의 진입점**이고, `FitPrepHandler`라는 한 부품으로 끼워져 있다.

이 페이지는 면접에서 다음 질문에 막힘없이 답하기 위한 것이다.

- "오케스트레이터에서 당신이 맡은 부분은 정확히 어디인가? 어떻게 끼웠나?"
- "왜 FIT은 다른 단계와 달리 JOB이 끝나야만 시작하나? 그 의존을 코드로 어떻게 표현했나?"
- "왜 진행 상황을 SSE로 보냈나? 폴링이나 WebSocket이 아니라?"
- "FIT의 substep(근거 검색/채점/검증)은 무엇을 뜻하나? 왜 사용자에게 그걸 보여주나?"

## 2. 왜 이렇게 설계했나 (설계 의도 · 대안과 트레이드오프)

### 2.1 왜 FIT을 오케스트레이터의 "한 부품"으로 만들었나

FIT 분석은 단독 API([적합도 분석](/area-c/fit-analysis))로도 호출되지만, 자동 준비 흐름에서는 6단계 중 하나로 묶여야 한다. 여기서 핵심 결정은 **오케스트레이터가 FIT의 내부 로직을 전혀 모르게** 만든 것이다.

오케스트레이터는 `PrepStepHandler`라는 인터페이스만 안다. `FitPrepHandler`는 그 인터페이스를 구현하고, `key()`로 `"FIT"`을 반환하며, 실제 분석은 `FitAnalysisService.generate(...)`에 위임한다. 즉 **오케는 "FIT이라는 칸이 있고 거기 부품이 꽂힌다"는 사실만 알고, 그 부품 안에서 규칙엔진이 점수를 매기든 LLM이 설명을 쓰든 신경 쓰지 않는다.**

이 분리가 주는 이점:

| 선택 | 트레이드오프 |
| --- | --- |
| **핸들러 인터페이스로 끼움** (채택) | 오케 코드를 한 줄도 안 건드리고 C 영역을 독립 발전시킬 수 있다(OCP). 단, 단계 간 데이터 전달은 `prior` 맵이라는 느슨한 계약(`Map<String, Object>`)에 의존 — 타입 안전성을 일부 포기 |
| 오케가 FIT 로직을 직접 호출 | 빠르게 짤 수 있지만 오케와 C 영역이 강하게 결합. 내 규칙엔진을 바꿀 때마다 공통 오케 코드(팀장 소유)를 건드려야 함 → 영역 침범 |
| FIT을 완전히 별도 서비스로 분리 | 의존 관리·진행 보고를 다시 짜야 함. 6단계가 한 화면 흐름인데 굳이 프로세스 분리는 과함 |

### 2.2 왜 FIT은 JOB에 의존하는가 (의존 그래프의 본질)

FIT의 입력은 **공고 분석 결과**다. "이 공고가 요구하는 필수/우대 역량"이 있어야 "내 스펙이 얼마나 충족하는가"를 채점할 수 있다. 공고 분석(JOB, 영역 B)이 아직 DB에 커밋되지 않은 상태에서 FIT을 돌리면 채점 기준 자체가 없다.

그래서 FIT은 **JOB이 끝난 뒤** 시작해야 한다. 동일하게 면접(INTERVIEW, 영역 D)도 JOB에 의존한다. 반대로 프로필(A)·공고(B)·자소서(E)·커뮤니티(F)는 서로 입력을 주고받지 않으므로 **동시에 출발**해도 된다.

이걸 "전부 순차 실행"으로 단순화할 수도 있었지만, 그러면 6단계 소요 시간이 다 더해진다. 독립 단계를 병렬로 묶으면 전체 체감 시간이 **가장 긴 경로(critical path)**로 줄어든다. 트레이드오프는 동시성 코드의 복잡도인데, 이건 `CompletableFuture.allOf`로 위상정렬 없이 깔끔하게 표현했다(아래 4절).

### 2.3 왜 진행을 SSE로 보여주나

FIT 한 단계만 해도 내부에서 **근거 검색 → 채점 → 검증**이라는 묵직한 작업이 돌고, 3단 폴백([폴백 체인](/area-c/fallback-chain)) 경로에 따라 수 초가 걸릴 수 있다. 6단계가 병렬로 도는 동안 화면에 스피너만 돌면 사용자는 "멈춘 건가?"를 의심한다.

SSE로 `part-start`, `substep`, `part-done`을 흘려보내면 사용자는 **"지금 적합도 채점 중", "근거 가드 검증 중"**을 실시간으로 본다. 이건 영역 C의 핵심 철학인 **설명가능성·신뢰**와 직결된다 — 점수가 어디서 나왔는지 투명하게 보여주는 제품에서, 그 점수를 만드는 과정도 투명해야 한다.

::: warning 대안을 왜 안 썼나
- **폴링**: 클라이언트가 1초마다 "끝났어요?"를 묻는 방식. 지연이 생기고 요청이 낭비된다. 병렬로 도는 6단계의 미세한 진행을 잡아내기 어렵다.
- **WebSocket**: 양방향 통신. 진행 보고는 서버→클라이언트 단방향이라 양방향은 과한 설비다. 인증·프록시 설정도 더 무겁다.
- **SSE**(채택): 표준 HTTP 위 단방향 스트림. JWT 인증을 헤더로 그대로 실어 보낼 수 있고(아래 5절), 구현이 가볍다.
:::

## 3. 어떤 기술로 구현했나 (실제 클래스 · 메서드 · 계약)

패키지: `backend/src/main/java/com/careertuner/ai/autoprep` (공통 AI 영역, 팀장 소유). 내가 추가한 부품은 `handler/FitPrepHandler` 한 클래스다.

| 역할 | 클래스 / 메서드 | 설명 |
| --- | --- | --- |
| 진입 API | `AutoPrepController#runStream` | `POST /api/auto-prep/run/stream`, `produces=text/event-stream` |
| 두뇌(계획) | `AutoPrepPlanner#plan` | 한 줄 요청 → 슬롯(회사·직무·모드) + 실행 파트 결정, FIT 선택 시 JOB을 의존 클로저로 자동 포함 |
| 지휘자(실행) | `AutoPrepOrchestrator#runStream` / `#executeParallel` | 의존 그래프 병렬 실행 + SSE 진행 보고 |
| 단계 계약 | `PrepStepHandler` (인터페이스) | `key()` / `enabled()` / `handle(context, progress)` |
| **C 부품** | **`handler/FitPrepHandler`** | `key()="FIT"`, `handle()` 안에서 substep 3개 보고 후 `FitAnalysisService.generate()` 위임 |
| 진행 채널 | `PrepProgress` (함수형 인터페이스) | `substep(name, desc)` → 오케가 SSE로 변환 |
| 단계 결과 | `PrepStepResult` | `done/skipped/failed` 팩토리, status + 소요 ms |
| 실행 컨텍스트 | `PrepStepContext` | userId, applicationCaseId, slots, attachments, prior(앞 단계 결과 누적) |

`FitPrepHandler`의 실제 골격(학습용 축약):

```java
@Component
@RequiredArgsConstructor
public class FitPrepHandler implements PrepStepHandler {

    private final FitAnalysisService fitAnalysisService;

    @Override public String key() { return "FIT"; }   // 오케가 이 key로 찾는다

    @Override
    public PrepStepResult handle(PrepStepContext ctx, PrepProgress progress) {
        if (ctx.applicationCaseId() == null) {                 // 지원 건 없으면
            return PrepStepResult.skipped("FIT", "지원 건이 없어 건너뜀");
        }
        progress.substep("근거 검색", "지식베이스 근거 주입");   // ← SSE substep 1
        progress.substep("채점",     "요건 매칭 점수화");       // ← SSE substep 2
        progress.substep("검증",     "근거 가드 적용");         // ← SSE substep 3
        var result = fitAnalysisService.generate(ctx.userId(), ctx.applicationCaseId());
        return PrepStepResult.done("FIT", "적합도 분석 완료", result, elapsedMs);
    }
}
```

::: tip substep 3개가 곧 영역 C의 뉴로-심볼릭 파이프라인이다
"근거 검색 → 채점 → 검증"은 단순 라벨이 아니라 FIT 내부 실제 단계의 거울이다.
- **근거 검색** = OSS 경로에서 grounding(지식베이스 근거 주입) 단계
- **채점** = 규칙엔진(`MockFitAnalysisAiService`)이 `10 + 필수충족비율*70 + 우대충족비율*20`으로 점수를 **확정**하는 단계 ([점수 엔진](/area-c/score-engine))
- **검증** = `guardApplyDecision`·grounding guard가 결과를 재검증하는 단계 ([가드레일](/area-c/guardrails))

즉 사용자에게 보이는 진행 라벨이 곧 "이 점수는 LLM이 지어낸 게 아니라 규칙으로 채점하고 근거로 검증했다"는 신뢰 메시지가 된다.
:::

## 4. 동작 원리 (데이터 흐름 · 단계 · 표)

### 4.1 한 줄 요청에서 FIT 실행까지

```text
한 줄 요청  ──POST /api/auto-prep/run/stream──▶  AutoPrepController#runStream
                                                      │
                                                      ▼
                       AutoPrepPlanner#plan : LLM으로 요청 파싱 → 슬롯 + 실행 파트
                       (FIT을 고르면 JOB을 의존 클로저로 자동 포함)
                                                      │  PrepPlan(steps=[PROFILE,JOB,FIT,WRITE,INTERVIEW,COMMUNITY])
                                                      ▼
                       AutoPrepOrchestrator#executeParallel
                          │
                          ├─ PROFILE ─┐
                          ├─ JOB ─────┤  (의존 없음 → 동시 출발)
                          ├─ WRITE ───┤
                          ├─ COMMUNITY┘
                          │
                          └─ JOB 완료 ──▶ FIT(C) · INTERVIEW(D)   (JOB 의존 → 그 다음 병렬)
                                           │
                                           ▼
                              FitPrepHandler#handle
                                  substep×3 → FitAnalysisService.generate()
                                  → fit_analysis 테이블 INSERT
```

### 4.2 의존 그래프를 코드로 — 위상정렬 없이 future를 future에 엮는다

오케스트레이터는 의존을 작은 Map으로 선언한다. **FIT과 INTERVIEW만 JOB을 기다린다.**

```java
private static final Map<String, List<String>> DEPS = Map.of(
        "FIT",       List.of("JOB"),
        "INTERVIEW", List.of("JOB"));
```

실행 루프는 각 단계의 future를 만들 때 **자기 의존 단계들의 future가 모두 끝난 뒤(`allOf`) 실행**하도록 묶는다.

```java
for (String key : plan.steps()) {
    CompletableFuture<?>[] deps = DEPS.getOrDefault(key, List.of()).stream()
            .map(futures::get).filter(Objects::nonNull)
            .toArray(CompletableFuture[]::new);
    CompletableFuture<Void> future = CompletableFuture
            .allOf(deps)                                  // 의존 끝날 때까지 대기
            .thenRunAsync(() -> runPart(key, ...), sseExecutor);
    futures.put(key, future);
}
CompletableFuture.allOf(futures.values()...).join();      // 전부 끝날 때까지
```

핵심: **의존이 없는 단계는 `allOf()`(빈 배열)가 즉시 완료**라서 바로 출발하고, FIT처럼 의존이 있는 단계는 JOB future가 끝날 때까지 자연스럽게 뒤로 밀린다. 별도 스케줄러·위상정렬 코드 없이 "future를 future에 엮는" 방식으로 그래프가 표현된다. FIT 입장에서 보면 "내가 직접 JOB을 기다리는 게 아니라, 오케가 JOB future 뒤에 나를 붙여줬다."

### 4.3 SSE 이벤트 시퀀스 (FIT 단계 기준)

| 이벤트 | 시점 | 페이로드 | FIT일 때 구체값 |
| --- | --- | --- | --- |
| `plan` | 계획 확정 직후 | PrepPlan(슬롯·steps) | steps에 FIT 포함 여부 |
| `part-start` | FIT 시작 | key | `{"key":"FIT"}` |
| `substep` | 핸들러 내부 진행(여러 번) | key, name, desc | `근거 검색 / 채점 / 검증` 3회 |
| `part-done` | FIT 종료 | PrepStepResult | status=DONE/SKIPPED/FAILED + ms |
| `done` | 전체 종료 | 완료 메시지 | `완료 N · 건너뜀 M · 실패 K` |

병렬 단계(FIT·INTERVIEW 등)가 **동시에** 같은 emitter에 쓰므로, 전송은 `synchronized(emitter)`로 직렬화한다. 클라이언트가 끊으면 `IOException` → 스트림 중단. `SseEmitter` 타임아웃은 5분(`SSE_TIMEOUT_MS = 300_000L`).

### 4.4 부분 실패 / 건너뜀 — FIT은 fail-soft

| 상황 | FIT 동작 | 전체 영향 |
| --- | --- | --- |
| 지원 건 없음(`applicationCaseId == null`) | 핸들러가 스스로 `skipped("지원 건이 없어 건너뜀")` 반환 | 다음 단계 그대로 진행 |
| FIT 내부에서 예외(`BusinessException`/`RuntimeException`) | 오케가 잡아 `PrepStepResult.failed(...)` 기록 | **전체 안 멈춤**, 나머지 완주 |
| FIT 성공(DONE) | 결과(detail)가 `prior` 맵의 `"FIT"` 키에 누적 | 뒤 단계가 참조 가능 |
| JOB이 실패 | JOB 결과가 prior에 안 쌓임 → FIT이 데이터 없음 감지 가능 | FIT은 SKIP/FAIL로 흡수 |

즉 FIT 단계가 죽어도 자소서·면접 준비는 그대로 나온다. 화면이 깨지지 않는 것이 영역 C의 가용성(reliability) 원칙이고, 이건 오케 레벨의 fail-soft와 [3단 폴백](/area-c/fallback-chain)이 함께 보장한다.

## 5. 구현 상태 (됨 vs 향후) 정직 구분

| 항목 | 상태 |
| --- | --- |
| `FitPrepHandler`로 FIT 단계 오케에 등록 (`key()="FIT"`) | **구현됨** |
| JOB→FIT 의존(`DEPS` Map) + `CompletableFuture.allOf` 병렬 실행 | **구현됨** |
| substep 3개(근거 검색/채점/검증) SSE 보고 | **구현됨** |
| 지원 건 없으면 SKIPPED, 내부 예외 시 FAILED 후 완주 | **구현됨** |
| `SseEmitter`(5분) + `synchronized(emitter)` 동시 전송 직렬화 | **구현됨** |
| 프론트 `useAutoPrepRun` 훅이 SSE 이벤트를 파트 상태로 reduce | **구현됨** |
| FIT 내부 규칙엔진 채점·신뢰도·가드레일·캐시·4테이블 저장 | **구현됨** (현재 mock 규칙엔진 기준 결정론적 동작, 계약은 실 LLM과 동일) |
| 자체 OSS 모델(`careertuner-c-career-strategy`) 통합 코드·grounding guard | **구현됨** (배선 완료) |
| 실제 파인튜닝 모델 학습·서빙, OpenAI 키 연동 활성화 | **향후 과제** (키 발급 시 활성화) |
| 오케 레벨 자동 재시도 | **없음**(의도) — 재시도는 하위 게이트웨이 폴백 + 사용자 재실행이 담당 |

::: tip 면접에서의 정직한 한 줄
"오케스트레이터 배선, 의존 그래프, SSE 진행 보고, FIT 핸들러 연결, 규칙엔진 채점·가드·캐시는 모두 구현돼 결정론적으로 돕니다. 화면·계약은 실제 LLM과 동일하고, 실 LLM 연동만 API 키 발급 후 활성화하는 단계입니다."
:::

## 6. 면접 답변 3단계

**초간단 (1문장)**: "자동 준비 파이프라인에서 제가 맡은 적합도(FIT)를, 공고 분석이 끝난 뒤 시작하는 핸들러로 끼우고 진행을 SSE로 실시간 보여줬습니다."

**기본 (30초)**: "AutoPrep 오케스트레이터는 한 줄 요청을 6개 AI 단계로 쪼개 의존 그래프대로 병렬 실행합니다. 저는 그중 FIT 단계를 `PrepStepHandler`를 구현한 `FitPrepHandler`로 추가했어요. `key()`로 'FIT'을 반환하고, `handle()` 안에서 근거 검색·채점·검증 세 substep을 SSE로 보고한 뒤 `FitAnalysisService.generate()`에 위임합니다. FIT은 공고 분석(JOB) 결과가 채점 입력이라 JOB에 의존하고, 그 의존은 오케가 `CompletableFuture.allOf`로 묶어 JOB future 뒤에 제 단계를 붙여줍니다. 지원 건이 없으면 SKIPPED, 내부에서 실패해도 FAILED로 기록하고 전체는 완주합니다."

**꼬리질문 대응 (깊이)**: "의존은 `DEPS` 맵에 FIT→JOB 한 줄로 선언하고, 단계 future를 만들 때 자기 의존 future들의 `allOf` 뒤에 `thenRunAsync`로 엮어 위상정렬 없이 그래프를 표현합니다. SSE를 고른 건 진행 보고가 서버→클라이언트 단방향이고 HTTP 위에서 끝나기 때문 — WebSocket은 과하고 폴링은 지연·낭비가 큽니다. 병렬 단계가 동시에 emitter에 쓰므로 `synchronized(emitter)`로 전송을 직렬화했고요. substep 3개는 단순 라벨이 아니라 영역 C 뉴로-심볼릭 파이프라인(근거 주입·규칙엔진 채점·가드 검증)의 거울이라, 사용자에게 보이는 진행이 곧 신뢰 메시지가 됩니다."

## 7. 자주 나오는 꼬리질문 + 모범답안

::: details Q1. FIT은 왜 JOB이 끝나야만 시작하나? 다른 단계는 왜 안 그런가?
FIT의 채점 기준이 공고가 요구하는 필수·우대 역량인데, 그건 공고 분석(JOB)이 DB에 커밋돼야 존재한다. 기준 없이 채점하면 점수가 무의미하다. 면접(INTERVIEW)도 같은 이유로 JOB에 의존한다. 반면 프로필·공고·자소서·커뮤니티는 서로 입력을 주고받지 않아 동시에 출발해도 된다. 이 차이를 `DEPS` 맵에 FIT→JOB, INTERVIEW→JOB 두 줄로만 선언했다.
:::

::: details Q2. 의존을 어떻게 코드로 표현했나? 위상정렬을 직접 짰나?
아니다. `CompletableFuture`로 표현했다. 각 단계 future를 만들 때 자기 의존 단계들의 future를 `allOf()`로 모아 그 뒤에 `thenRunAsync`로 실제 작업을 붙인다. 의존 없는 단계는 빈 `allOf`가 즉시 완료라 바로 시작하고, FIT은 JOB future가 끝날 때까지 자동으로 대기한다. 위상정렬 알고리즘을 직접 구현하지 않고도 그래프 실행이 된다. DAG가 더 복잡해지면 한계가 있지만, 현재 6단계·단순 의존에는 이 방식이 가장 읽기 쉽다.
:::

::: details Q3. substep의 "근거 검색 / 채점 / 검증"은 그냥 보여주기용 라벨인가?
실제 단계의 거울이다. 근거 검색은 OSS 경로의 grounding(지식베이스 근거 주입), 채점은 규칙엔진이 `10 + 필수충족비율*70 + 우대충족비율*20`으로 점수를 확정하는 단계, 검증은 `guardApplyDecision`과 grounding guard가 결과를 재검증하는 단계다. 영역 C는 점수를 LLM이 아니라 규칙으로 확정하고 근거로 검증하는 게 핵심이라, 그 과정을 사용자에게 그대로 보여주는 것이 곧 신뢰·설명가능성이다.
:::

::: details Q4. FIT 단계가 실패하면 사용자 화면은 어떻게 되나?
fail-soft다. 핸들러가 던진 예외를 오케가 잡아 `PrepStepResult.failed`로 기록하고 다음 단계는 계속 진행한다. 화면에는 FIT만 실패 상태로 표시되고 나머지 단계 결과는 정상적으로 나온다. 지원 건이 없으면 아예 SKIPPED를 반환해 "건너뜀"으로 표시된다. 전체가 멈추지 않고 "완료 N · 건너뜀 M · 실패 K"로 요약된다. 가용성을 화면 단까지 보장하는 게 목표다.
:::

::: details Q5. SSE는 인증을 어떻게 통과시키나? 일반 API와 다른 점은?
SSE는 `ApiResponse` envelope를 안 타므로 공통 `api()` 래퍼를 못 쓴다. 프론트에서 `fetch`로 직접 `Accept: text/event-stream` 헤더와 `Authorization: Bearer` 토큰을 수동으로 실어 보내고, 응답 바디를 `ReadableStream`으로 읽어 `event:`/`data:` 라인을 파싱한다(`autoPrepApi.ts`의 `runStream`). 표준 HTTP 위 스트림이라 JWT 헤더가 그대로 먹는 게 SSE를 고른 실용적 이유 중 하나다.
:::

::: details Q6. 새 AI 단계를 추가하려면 오케 코드를 고쳐야 하나?
거의 안 고친다. `PrepStepHandler`를 구현한 `@Component`를 하나 추가하면 스프링이 핸들러 리스트에 주입하고, 오케가 `key()`로 매핑한다(OCP). 의존이 있으면 `DEPS` 맵에 한 줄, 표준 순서에 넣으려면 `defaultSteps()`에 한 줄 추가하면 된다. 내가 FIT을 추가할 때도 공통 오케 코드 본체는 건드리지 않고 `FitPrepHandler` 한 클래스만 더했다. 공통 영역은 팀장 소유라, 영역 침범 없이 부품만 꽂는 이 설계가 협업 규칙과도 맞는다.
:::

## 8. 직접 말해보기

1. 화이트보드에 PROFILE·JOB·FIT·WRITE·INTERVIEW·COMMUNITY 6개 노드를 그리고, **어느 화살표가 있고 어디가 동시에 출발하는지** 30초 안에 설명하라. (정답: FIT·INTERVIEW만 JOB에 화살표, 나머지 4개 동시 출발)
2. "FIT의 substep 3개가 단순 라벨이 아니라 무엇의 거울인지"를 한 문장으로 말하라. (근거 주입 → 규칙엔진 채점 → 가드 검증)
3. "FIT 단계가 죽어도 화면이 안 깨지는 이유"를 fail-soft와 폴백 두 단어로 설명하라.

## 퀴즈

<QuizBox question="AutoPrep에서 FIT 단계가 JOB 단계에 의존하는 근본 이유는?" :choices="['FIT이 JOB보다 항상 느려서', '적합도 채점의 기준(공고 요구 역량)이 공고 분석 결과에서 나오기 때문', 'JOB이 사용자 인증을 담당해서', '오케스트레이터가 알파벳 순서로 실행해서']" :answer="1" explanation="FIT은 '공고가 요구하는 필수·우대 역량 대비 내 스펙 충족도'를 채점한다. 그 기준이 곧 공고 분석(JOB) 결과이므로 JOB이 DB에 커밋된 뒤 시작해야 한다. DEPS 맵에 FIT->JOB으로 선언돼 있다." />

<QuizBox question="FitPrepHandler가 SSE로 보고하는 substep 3개와 그 의미가 옳게 짝지어진 것은?" :choices="['로그인 / 결제 / 로그아웃', '근거 검색(근거 주입) / 채점(규칙엔진 점수 확정) / 검증(가드 적용)', '다운로드 / 압축 / 업로드', '프로필 / 공고 / 면접']" :answer="1" explanation="substep은 단순 라벨이 아니라 영역 C 뉴로-심볼릭 파이프라인의 거울이다. 근거 검색=grounding 주입, 채점=규칙엔진이 점수 확정, 검증=guardApplyDecision/grounding guard 재검증." />

<QuizBox question="오케스트레이터가 의존(FIT은 JOB을 기다린다)을 위상정렬 알고리즘 없이 표현하는 방식을 한 문장으로 설명하라." explanation="각 단계의 CompletableFuture를 만들 때 자기 의존 단계들의 future를 allOf()로 모아 그 뒤에 thenRunAsync로 실제 작업을 붙인다. 의존 없는 단계는 빈 allOf가 즉시 완료라 바로 출발하고, FIT은 JOB future가 끝날 때까지 자동으로 대기한다." />
