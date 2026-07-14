# 오케스트레이터의 INTERVIEW 파트

> 한 줄 요청("이 회사 면접 준비해줘")이 들어오면, 오케스트레이터 두뇌가 면접을 준비 파이프라인의 ⑤단계로 끼워 넣는다. 이 파트는 `InterviewPrepHandler`라는 얇은 어댑터 하나로, "세션 생성 → 예상 질문 생성" 두 서브스텝을 실행하고, JOB(B)이 끝난 뒤에 출발한다.

## 1. 한 줄 정의 · 이 페이지가 답하는 면접 질문

AutoPrep(자동 준비) 오케스트레이터는 사용자의 자연어 한 줄을 받아 여러 도메인(프로필·공고분석·적합도·자소서·**면접**·커뮤니티)을 한 번에 돌리는 멀티스텝 파이프라인이다. 그중 **INTERVIEW 파트**는 면접 도메인(영역 D)이 이 파이프라인에 끼워 넣은 단계 핸들러다.

이 페이지가 답하는 면접 질문:

- "오케스트레이터에서 면접은 어떻게 한 단계로 표현되나요?"
- "면접 파트는 왜 공고분석(JOB) 다음에 실행되나요? 적합도(FIT)와는 어떤 관계인가요?"
- "두뇌(Planner)가 면접 모드를 어떻게 정하고, 핸들러는 그 결정을 어떻게 받아쓰나요?"
- "자동으로 만든 세션은 어떻게 저장되고, 일반 면접 화면과 같은 데이터가 되나요?"

핵심 한 줄: **INTERVIEW 파트는 면접 도메인 로직을 새로 짜지 않는다. 이미 있는 `InterviewService.createSession` + `generateQuestions`를 그대로 호출하는 50줄짜리 어댑터다.** 오케스트레이터의 가치는 "면접 기능"이 아니라 "여러 도메인을 의존 순서대로 자동 엮어주는 것"에 있다.

:::tip 영역 경계
오케스트레이터 코어(`ai/autoprep`)는 공통 영역이고, INTERVIEW 핸들러는 D가 소유한다. 같은 SSE 파이프라인의 FIT 핸들러는 C, JOB 핸들러는 B가 소유한다. 이 페이지는 "D가 오케스트레이터에 어떻게 연결되는가"를 본다.
:::

## 2. 왜 이렇게 설계했나 (의도 · 트레이드오프)

### 2.1 핸들러를 얇게 — 면접 로직 중복 금지

면접 세션 생성·질문 생성 로직은 이미 `InterviewServiceImpl`에 있다. 오케스트레이터가 이걸 다시 구현하면 두 진입점(REST 화면 vs 자동 파이프라인)이 서로 다르게 동작할 위험이 생긴다. 그래서 `InterviewPrepHandler`는 **`InterviewService`만 주입받아 그대로 위임**한다. 자동 생성한 세션이 곧바로 면접 화면의 세션과 100% 동일한 이유가 이것이다.

```java
// InterviewPrepHandler — 실제 핵심 (축약)
private final InterviewService interviewService;   // 면접 도메인 서비스를 그대로 주입

public String key() { return "INTERVIEW"; }        // 오케가 이 key로 찾아 호출

public PrepStepResult handle(PrepStepContext context, PrepProgress progress) {
    if (context.applicationCaseId() == null)
        return PrepStepResult.skipped("INTERVIEW", "지원 건이 없어 건너뜀 ...");
    // 1) 세션 생성  2) 질문 생성 — 둘 다 기존 서비스 호출
    ...
}
```

### 2.2 플러그인형 핸들러 — 오케스트레이터 무변경 확장

`PrepStepHandler` 인터페이스 주석이 설계 의도를 그대로 말한다: "새 파트는 이 인터페이스를 구현한 `@Component`를 추가하기만 하면 자동 등록된다(오케 무변경)." 오케스트레이터는 `List<PrepStepHandler>`를 스프링에서 주입받아 `key()`로 맵을 만든다. 즉 **각 도메인이 자기 핸들러를 들고 오면 끝**이고, 코어는 새 도메인 이름을 모른다. 영역 D는 이 계약을 구현하는 6개 핸들러 중 하나(`InterviewPrepHandler`)를 책임진다.

### 2.3 의존은 코드로 강제 — LLM 판단에 안 맡김

면접 질문은 공고 원문(B의 산출물)을 입력으로 쓴다. 그래서 INTERVIEW는 JOB이 끝난 뒤 실행돼야 한다. 이 순서를 LLM이 매번 옳게 정하리라 기대하지 않고, **코드 상수로 못 박는다**:

```java
// AutoPrepPlanner / AutoPrepOrchestrator 양쪽에 동일하게 선언
private static final Map<String, List<String>> DEPS = Map.of(
        "FIT",       List.of("JOB"),
        "INTERVIEW", List.of("JOB"));
```

LLM 두뇌는 "어떤 파트가 필요한가"만 고르고(`parts`), "어떤 순서로 실행하나"는 이 `DEPS`가 결정한다. 트레이드오프: 의존이 하드코딩이라 유연성은 떨어지지만, 6파트 고정 파이프라인에서는 예측 가능성·디버깅 용이성이 더 중요하다.

## 3. 어떤 기술로 구현했나 (실제 클래스 근거)

| 책임 | 클래스 / 위치 | 역할 |
| --- | --- | --- |
| 단계 계약 | `PrepStepHandler` (interface) | `key()` + `enabled()` + `handle(ctx, progress)` |
| 면접 단계 | `InterviewPrepHandler` (`ai/autoprep/handler`) | INTERVIEW 파트 어댑터(D 소유) |
| 두뇌 | `AutoPrepPlanner` | 한 줄 요청 → 슬롯(회사·직무·모드) + 실행할 파트 결정 |
| 실행 엔진 | `AutoPrepOrchestrator` | 의존 그래프 기반 **병렬** 실행, 동기/SSE 두 모드 |
| 실행 계획 | `PrepPlan` | `intent` + `PrepSlots` + `steps` 목록 |
| 입력 컨텍스트 | `PrepStepContext` | userId, caseId, slots, 첨부, `prior`(앞 단계 결과) |
| 진행 보고 | `PrepProgress` (FunctionalInterface) | `substep(name, desc)` → SSE 전송 |
| 결과 | `PrepStepResult` | `DONE / SKIPPED / FAILED` + summary + detail + elapsedMs |
| 면접 도메인 | `InterviewService.createSession` / `generateQuestions` | 실제 세션·질문 생성(영역 D 코어) |

핸들러가 호출하는 면접 도메인 메서드:

- `interviewService.createSession(userId, new CreateInterviewSessionRequest(caseId, mode))` → `interview_session` INSERT
- `interviewService.generateQuestions(userId, sessionId, new GenerateQuestionsRequest(null, null))` → `interview_question` INSERT (모범답안은 백그라운드 일괄 생성)

질문 생성의 내부 폴백/저장 동작은 [예상 질문 생성](/area-d/question-generation), 모드 의미는 [세션 모델](/area-d/session-model)에서 자세히 다룬다. 여기서는 "오케스트레이터가 그걸 어떻게 호출하는가"만 본다.

## 4. 동작 원리 (흐름 · 표 · 작은 코드)

### 4.1 전체 흐름 (요청 → 면접 세션)

```text
사용자 한 줄: "○○회사 면접 압박으로 준비해줘"
        │
        ▼
AutoPrepPlanner.plan()
  ├─ LLM 의도분석 → company, jobTitle, mode=PRESSURE, parts=[INTERVIEW]
  ├─ 지원 건 매칭 → caseId 확정(회사명 contains)
  └─ resolveSteps: INTERVIEW 선택 → DEPS로 JOB 끌어옴 → ["JOB","INTERVIEW"]
        │
        ▼
AutoPrepOrchestrator.executeParallel()
  ├─ JOB future 시작 (독립)
  └─ INTERVIEW future = JOB.future 끝나면 thenRunAsync(...)
        │
        ▼
InterviewPrepHandler.handle()
  ├─ caseId 없으면 → SKIPPED
  ├─ substep("세션 준비")  → createSession(caseId, mode)
  └─ substep("질문 생성")  → generateQuestions(sessionId)
        │
        ▼
PrepStepResult.done("INTERVIEW", "세션 + 질문 N개", {session, questions}, ms)
```

### 4.2 의존 그래프 병렬 실행 (★핵심 — 순차가 아니다)

흔한 오해: "6파트를 순서대로 하나씩 실행한다." 실제는 **`CompletableFuture` 의존 그래프 기반 병렬**이다. 오케스트레이터 클래스 주석 그대로: "독립 파트(A·B·E·F)는 동시에 출발하고, FIT·INTERVIEW는 JOB이 DB에 커밋된 뒤 시작한다."

```java
for (String key : plan.steps()) {
    CompletableFuture<?>[] depFutures = DEPS.getOrDefault(key, List.of()).stream()
            .map(futures::get).filter(Objects::nonNull)
            .toArray(CompletableFuture[]::new);
    CompletableFuture<Void> future = CompletableFuture.allOf(depFutures)
            .thenRunAsync(() -> runPart(...), sseExecutor);   // dep 끝난 뒤 실행
    futures.put(key, future);
}
CompletableFuture.allOf(futures.values()...).join();          // 전부 끝날 때까지 대기
```

이 구조의 귀결:

| 파트 | 의존 | 실행 타이밍 |
| --- | --- | --- |
| PROFILE(A), JOB(B), WRITE(E), COMMUNITY(F) | 없음 | 즉시 동시 출발 |
| FIT(C) | JOB | JOB future 완료 후 출발 |
| **INTERVIEW(D)** | JOB | JOB future 완료 후 출발 |

→ **FIT(C)와 INTERVIEW(D)는 둘 다 JOB만 기다리므로, JOB이 끝나면 서로 병렬로 같이 돈다.** 면접이 적합도가 끝나기를 기다리지 않는다. 집중 포인트의 "C의 FIT과 병렬"이 정확히 이 지점이다.

:::warning "INTERVIEW ← FIT" 파이프라인 의존은 아니다
면접과 적합도는 둘 다 JOB(B)에만 의존해 형제로 병렬 실행한다. 다만 면접 서비스 자체는 질문 생성 순간 A 프로필·B 공고/기업·C 최신 성공 적합도를 DB에서 읽어 프롬프트와 세션 snapshot에 넣는다. 따라서 같은 AutoPrep 실행에서 지금 막 생성 중인 FIT 결과를 기다리지는 않으며, 이미 존재하는 최신 C 결과가 없으면 A/B만으로 계속한다.
:::

### 4.3 플래너의 모드 결정 → 핸들러의 모드 사용

두뇌(`AutoPrepPlanner`)는 면접 모드를 LLM 분류로 정한다. 시스템 프롬프트가 매핑 규칙을 명시한다(코드 직접 확인): "압박/꼬리/반박 → PRESSURE, 인성/가치관/협업 → PERSONALITY, 자소서 → RESUME, 기업/컬처 → COMPANY, 기술/직무/개발 → JOB, 그 외 → BASIC". 모드 enum은 6종(`BASIC/JOB/PERSONALITY/PRESSURE/RESUME/COMPANY`)으로, 면접 화면의 실사용 모드와 일치한다.

핸들러는 이 결정을 슬롯에서 꺼내 쓰되, **비어 있으면 `BASIC`으로 방어**한다:

```java
String mode = (context.slots().mode() == null || context.slots().mode().isBlank())
        ? "BASIC" : context.slots().mode();
```

플래너 자체도 `firstNonBlank(request.mode(), parsed.mode(), "BASIC")`로 한 번 방어하므로, 모드는 사실상 항상 유효한 값으로 핸들러에 도달한다(이중 방어).

### 4.4 세션 자동저장 = 일반 면접과 동일 경로

"자동저장"이라고 별도 저장 로직이 있는 게 아니다. 핸들러가 `createSession`을 호출하면 그 안에서 `interview_session`에 INSERT되고, `generateQuestions`가 트랜잭션 커밋 후 `interview_question`을 INSERT한다. 즉 **자동 파이프라인으로 만든 세션과 사용자가 화면에서 직접 만든 세션은 DB상 구분 불가** — 둘 다 같은 서비스, 같은 테이블, 같은 후처리(모범답안 백그라운드 생성)를 탄다.

핸들러는 끝에 `session`과 `questions`를 `PrepStepResult.detail`로 담아 돌려준다. 이 detail은 두 곳에서 쓰인다:

1. 오케스트레이터가 `prior` 맵에 누적 → 뒤 파트가 참조 가능(`PrepStepContext.prior`).
2. SSE `part-done` 이벤트로 프론트에 전송 → 자동 준비 모달이 "예상 질문 N개" 카드로 표시.

### 4.5 서브스텝 = 진짜 2단계

대부분의 면접 화면 진행바는 시간기반 가짜 진행이지만, 이 핸들러의 서브스텝은 **실제로 분리된 2단계**다. 핸들러 주석: "세션 생성 → 질문 생성이 실제 2단계라 서브스텝도 진짜로 나뉜다."

```java
progress.substep("세션 준비", "면접 모드 " + mode + " 세션 생성");   // 1
InterviewSessionResponse session = interviewService.createSession(...);

progress.substep("질문 생성", "지식베이스 근거 + 예상 질문 생성");      // 2
List<InterviewQuestionResponse> questions = interviewService.generateQuestions(...);
```

`PrepProgress.substep` 호출은 SSE `substep` 이벤트로 변환돼 프론트에 실시간 전달된다(동기 `run`에서는 `NOOP`). 그래서 자동 준비 모달에서 "세션 준비 → 질문 생성" 두 단계가 진짜로 순서대로 뜬다.

## 5. 구현 상태 (됨 vs 계획) 정직 구분

**구현되어 동작하는 것:**

- INTERVIEW 핸들러가 6파트 파이프라인의 ⑤단계로 등록·실행됨.
- JOB → INTERVIEW 의존이 코드 상수로 강제되고, FIT과 병렬 실행됨(`CompletableFuture` 그래프).
- 플래너 LLM 의도분석으로 모드·지원 건 자동 결정, 핸들러 이중 모드 방어.
- 세션·질문이 일반 면접과 동일 경로로 저장됨(자동저장).
- 서브스텝 2단계 SSE 실시간 전송(`runStream`).
- 지원 건 없으면 깔끔하게 SKIPPED(파이프라인 안 끊김), 핸들러 예외는 FAILED로 기록 후 완주.

**계획 / 미연결 (정직히):**

1. **같은 실행의 FIT 직접 handoff 없음** — INTERVIEW는 `prior`의 FIT 결과를 읽지 않고 caseId로 DB 최신 정본을 조회한다. 병렬 실행이므로 같은 run의 새 FIT 완료를 기다리지 않는다.
2. **자체 LLM 생성 미가동** — 질문 생성은 사실상 Claude → OpenAI 폴백. 오케스트레이터가 호출해도 마찬가지(생성 task 화이트리스트가 빈 집합).

## 6. 면접 답변 3단계

**1단계 (한 문장 정의):**
"INTERVIEW 파트는 자동 준비 오케스트레이터의 ⑤단계로, 면접 도메인 로직을 새로 짜지 않고 기존 `InterviewService`의 세션 생성·질문 생성을 그대로 호출하는 얇은 핸들러입니다."

**2단계 (왜·어떻게):**
"오케스트레이터는 `PrepStepHandler` 인터페이스로 각 도메인을 플러그인처럼 받습니다. 면접은 공고 원문이 입력이라 JOB(공고분석)에 의존하는데, 이 순서를 LLM에 맡기지 않고 `DEPS` 상수로 강제합니다. 실행은 순차가 아니라 `CompletableFuture` 의존 그래프 병렬이라, JOB이 커밋되면 면접과 적합도가 형제로 동시에 돕니다."

**3단계 (트레이드오프·정직):**
"두뇌가 LLM으로 모드·지원 건을 정하고 핸들러는 모드를 이중 방어합니다. 면접 서비스는 질문 생성 순간 A/B/C 최신 정본을 읽고 snapshot을 고정하지만, 파이프라인에서는 FIT과 형제로 병렬이므로 같은 run의 새 FIT을 기다리지는 않습니다. 즉 정본 조회와 실행 그래프 의존을 구분했습니다."

## 7. 꼬리질문 + 모범답안

:::details Q1. INTERVIEW 파트는 순차 실행인가요, 병렬인가요?
**병렬입니다.** `AutoPrepOrchestrator.executeParallel`이 각 파트를 `CompletableFuture`로 만들고, `DEPS`에 정의된 의존 파트의 future가 끝나면 `thenRunAsync`로 실행합니다. INTERVIEW는 JOB에만 의존하므로 JOB이 끝나면 출발하고, 같은 JOB을 기다리는 FIT과 함께 병렬로 돕니다. 마지막에 `allOf(...).join()`으로 전부 끝날 때까지 기다립니다. "순서대로 하나씩"이 아니라 "의존만 지키는 동시 실행"이 정확합니다.
:::

:::details Q2. 왜 INTERVIEW가 JOB에 의존하나요? FIT에는 의존하지 않나요?
면접 질문 생성은 공고 원문(JOB=B의 입력)을 써야 의미가 있어서 JOB에 의존합니다. **FIT(C)에는 의존하지 않습니다** — `DEPS` 맵에 `INTERVIEW → [JOB]`만 있고 FIT은 없습니다. FIT도 JOB에만 의존하므로, 면접과 적합도는 서로를 기다리지 않는 형제 관계로 병렬 실행됩니다.
:::

:::details Q3. 의존 순서를 왜 LLM이 안 정하고 코드 상수로 박나요?
LLM 두뇌는 "어떤 파트가 필요한가"(`parts`)만 정하고, "어떤 순서로 실행하나"는 `DEPS` 상수가 정합니다. 실행 순서·데이터 의존성은 결정론적이어야 디버깅·재현이 쉽고, 매 호출 LLM 판단에 맡기면 같은 요청에도 순서가 흔들릴 수 있습니다. 6파트 고정 파이프라인에서는 유연성보다 예측 가능성이 중요하다는 트레이드오프입니다. 플래너는 선택 파트에 의존을 클로저로 보강(`addWithDeps`)하고, 실행은 `defaultSteps` 순서로 정렬합니다.
:::

:::details Q4. 자동으로 만든 면접 세션은 일반 면접 세션과 다른가요?
아니요, 동일합니다. 핸들러가 `InterviewService.createSession`·`generateQuestions`를 그대로 호출하므로 같은 서비스·같은 테이블(`interview_session`, `interview_question`)·같은 후처리(모범답안 백그라운드 일괄 생성)를 탑니다. DB상 자동 생성 세션과 화면 직접 생성 세션은 구분되지 않습니다. 이것이 핸들러를 얇게 둔 이유입니다 — 로직 중복을 막아 두 진입점의 동작을 항상 일치시킵니다.
:::

:::details Q5. 지원 건이 없으면 어떻게 되나요? 면접 단계가 실패하면 파이프라인이 멈추나요?
지원 건(`applicationCaseId`)이 없으면 핸들러가 `PrepStepResult.skipped`를 반환해 **SKIPPED**로 처리되고, 파이프라인은 멈추지 않습니다. 핸들러가 예외를 던지면 오케스트레이터가 `BusinessException`/`RuntimeException`을 잡아 **FAILED**로 기록하고 다른 파트는 계속 진행해 완주합니다. 한 파트의 실패가 전체를 무너뜨리지 않는 best-effort 설계입니다.
:::

:::details Q6. 새 도메인을 파이프라인에 추가하려면 오케스트레이터를 고쳐야 하나요?
아니요. `PrepStepHandler`를 구현한 `@Component`를 추가하면 끝입니다. 오케스트레이터는 `List<PrepStepHandler>`를 스프링에서 주입받아 `key()`로 맵을 만들기 때문에, 코어는 새 도메인 이름을 몰라도 자동 등록·호출합니다. 단, 새 파트가 `defaultSteps` 목록과 (필요하면) `DEPS`에 들어가야 플랜/순서에 반영됩니다.
:::

## 8. 직접 말해보기

아래를 막힘없이 설명할 수 있으면 이 주제를 이해한 것이다.

1. "한 줄 요청에서 면접 세션이 만들어지기까지" 전체 흐름을 플래너 → 오케스트레이터 → 핸들러 순으로 60초 안에 설명해보라.
2. INTERVIEW가 JOB에 의존하고 FIT과 병렬이라는 사실을, `DEPS` 맵과 `CompletableFuture` 코드를 근거로 설명해보라.
3. "핸들러를 왜 50줄로 얇게 뒀는가"를 로직 중복·두 진입점 일치 관점에서 설명해보라.
4. 솔직한 한계 두 가지(질문 프롬프트에 C·A 미주입, `prior` 미활용)를 면접관에게 정직하게 말해보라.

## 퀴즈

<QuizBox question="AutoPrep 오케스트레이터에서 INTERVIEW 파트가 의존하는 파트는?" :choices="['FIT(적합도, C)', 'JOB(공고분석, B)', 'PROFILE(프로필, A)', '의존 없음 — 항상 첫 번째로 실행']" :answer="1" explanation="DEPS 맵에 INTERVIEW → [JOB]만 정의돼 있다. 면접 질문은 공고 원문(B)을 입력으로 쓰므로 JOB에 의존한다. FIT(C)에는 의존하지 않으며, 둘 다 JOB만 기다리므로 서로 병렬로 실행된다." />

<QuizBox question="오케스트레이터의 파트 실행 방식으로 옳은 것은?" :choices="['6파트를 항상 순서대로 하나씩 동기 실행한다', 'CompletableFuture 의존 그래프로, 의존 없는 파트는 동시에 출발하고 INTERVIEW·FIT은 JOB 완료 후 병렬 실행된다', '모든 파트를 무조건 동시에 출발시키고 충돌은 LLM이 조정한다', 'INTERVIEW가 끝나야 FIT이 시작된다']" :answer="1" explanation="executeParallel은 각 파트를 CompletableFuture로 만들고 DEPS의 의존 future가 끝나면 thenRunAsync로 실행한다. 독립 파트는 동시 출발, INTERVIEW와 FIT은 둘 다 JOB만 기다려 서로 병렬로 돈다." />

<QuizBox question="InterviewPrepHandler를 '얇게'(50줄, InterviewService에 위임만) 설계한 가장 큰 이유는?" :choices="['오케스트레이터가 면접 도메인 코드를 직접 참조하지 못하게 막으려고', '자동 생성 세션과 화면에서 직접 만든 세션의 동작을 항상 일치시키고 로직 중복을 막으려고', '면접 모드를 핸들러에서 무시하기 위해', 'SSE 전송을 핸들러가 직접 하기 위해']" :answer="1" explanation="핸들러가 기존 createSession/generateQuestions를 그대로 호출하므로 두 진입점(자동 파이프라인 vs 화면)이 같은 서비스·테이블·후처리를 타고, DB상 구분되지 않는다. 로직을 새로 짜면 두 경로가 어긋날 위험이 생긴다." />
