# AI 오케스트레이터(AutoPrep) 전체

> 한 줄 요청을 받아 6개 영역의 기존 AI를 **의존 그래프대로 병렬 실행**하고, SSE로 진행 상황을 실시간 보고하는 "원클릭 취업 준비" 엔진. 새 AI를 만들지 않고 A~F 도메인 서비스를 래핑한다.

AutoPrep은 이 프로젝트의 6개 영역(A~F)을 가로지르는 **유일한 통합 진입점**이다. 사용자가 "○○ 회사 면접 준비 통째로 해줘" 한 줄을 던지면, 두뇌(플래너)가 무엇을 할지 정하고, 오케스트레이터가 영역 간 의존을 지키며 병렬로 돌린 뒤, 진행 과정을 화면에 스트리밍한다. 영역별 상세(C 적합도·D 면접·F 챗봇 등)는 각 영역 페이지에 있으니, 이 페이지는 **"이 조각들이 어떻게 한 번의 호출로 엮이는가"**에 집중한다.

코드 위치: `backend/src/main/java/com/careertuner/ai/autoprep/`.

---

## 1. 이 흐름이 답하는 면접 질문

:::tip 이 페이지 하나로 답할 수 있는 질문
- "프로젝트에 AI 오케스트레이터가 있다던데, 그게 정확히 뭘 하나요?"
- "여러 AI 기능을 한 번에 실행할 때 순서·의존은 어떻게 보장했나요?"
- "병렬 실행 중 일부가 실패하면 전체가 죽나요? 어떻게 막았나요?"
- "진행 상황을 실시간으로 어떻게 화면에 뿌렸나요?(SSE)"
- "왜 오케스트레이터를 따로 만들었나요? 그냥 화면별로 버튼 누르면 되잖아요."
:::

이 질문들은 "기능 하나"가 아니라 **시스템을 조율하는 설계 감각**을 본다. 그래서 면접에서 가장 점수가 잘 나오는 주제다. 핵심 메시지는 하나로 압축된다: **"기존 도메인 AI를 새로 만들지 않고, 의존 그래프로 묶어 병렬 실행하고, 부분 실패해도 완주하게 했다."**

---

## 2. 전체 그림

AutoPrep은 4개 단계로 구성된다. 입력은 사용자의 한 줄 요청 + (선택)지원 건/모드/첨부, 출력은 6파트 각각의 `DONE/SKIPPED/FAILED` 결과다.

```text
[F 인테이크 챗봇]        [두뇌 = 플래너]           [오케스트레이터]            [SSE]
 슬롯 수집·되묻기   →   한 줄 → 의도 분류    →    의존 그래프 병렬 실행   →   실시간 진행 보고
 (CASE? MODE?)          parts 동적 결정           CompletableFuture           plan→part→done
        │                      │                         │                        │
   ready=true           PrepPlan(slots,steps)      6 PrepStepHandler         프런트 reduce()
        └──────────────────────┴─────────────────────────┴────────────────────────┘
                          전부 ai/autoprep 패키지 (+ F는 ai/intake)
```

병렬 실행의 핵심은 **의존 그래프가 단 두 줄**이라는 점이다. 6파트 중 FIT(C 적합도)·INTERVIEW(D 면접)만 JOB(B 공고분석)이 DB에 커밋된 뒤 시작하고, 나머지는 전부 독립이라 동시에 출발한다.

```text
시간 →

PROFILE(A) ━━━━━━━━━━▶ done            ┐
JOB(B)     ━━━━━━▶ done                 │ 독립 4파트는
WRITE(E)   ━━━━━━━━━━━━━━▶ done         │ 동시 출발
COMMUNITY(F) ━━━▶ done                  ┘
                  └──┐ (JOB 완료 후)
FIT(C)               ━━━━━━━▶ done      ┐ JOB에 의존하는
INTERVIEW(D)         ━━━━━━━━━━━▶ done  ┘ 2파트는 대기 후 병렬
```

| 단계 | 클래스 | 한 줄 책임 | 영역 |
| --- | --- | --- | --- |
| 진입 API | `AutoPrepController` | `/intake`·`/run`·`/run/stream` 3엔드포인트 | 공통(ai) |
| ① 인테이크 | `AutoPrepIntakeService` + `IntakeChatAgent`(ai/intake) | 슬롯 수집·되묻기 판정 | F |
| ② 두뇌 | `AutoPrepPlanner` | 한 줄 → 슬롯+실행 파트 결정 | 공통(ai) |
| ③ 오케스트레이터 | `AutoPrepOrchestrator` | 의존 그래프 병렬 실행 | 공통(ai) |
| ④ 6파트 핸들러 | `*PrepHandler` 6개 | A~F 도메인 서비스 래핑 | A~F |
| SSE/프런트 | `runStream` + `useAutoPrepRun.ts` | 이벤트 직렬화·상태 변환 | 프런트 |

---

## 3. 단계별 상세 — 무엇을 받아 무엇을 넘기나

### ① 인테이크 — 슬롯 수집·되묻기 판정기 (영역 F → D)

사용자는 한 줄을 던지지만, 실행에는 **지원 건(case)**과 **면접 모드(mode)**가 더 필요할 수 있다. `AutoPrepIntakeService.intake()`가 이 부족분을 한 번에 하나씩 되묻는다. 상태를 서버가 안 들고 있는 **stateless** 방식이라, 클라이언트가 슬롯을 누적해 매 턴 다시 보낸다.

```text
needsCase = plan.steps 에 JOB·FIT·INTERVIEW 중 하나라도 있음
  └ caseId 없음 → nextAsk="CASE" + 지원 건 후보 목록
needsMode = plan.steps 에 INTERVIEW 있음
  └ mode 없음 → nextAsk="MODE" + 6종 모드(BASIC/JOB/PERSONALITY/PRESSURE/RESUME/COMPANY)
둘 다 충족 → ready=true → 클라이언트가 같은 요청으로 /run/stream 호출
```

- 입력: `AutoPrepRequest`(query, applicationCaseId?, mode?, attachmentFileIds?)
- 출력: `AutoPrepIntakeResponse`(ready, message, nextAsk, 후보 목록)
- 더 풍부한 멀티턴 챗봇 버전(LangChain4j `@AiService` `IntakeChatAgent`, `@Tool` 3종)은 [영역 F 인테이크 챗봇](/area-f/intake-chatbot)을 보라. 핵심 계약은 **F는 슬롯 수집까지, 실행 스트림은 D/오케스트레이터가 맡는다.**

:::tip 현재 연결 상태
멀티턴 인테이크는 공통 챗봇 프런트의 칩·파일 handoff와 연결돼 있다. 확정 슬롯은 `chatbot_intake_slot`에 저장하고 `PENDING`만 재시작 후 복원하며, READY/DONE은 stale 재진입을 막기 위해 복원하지 않는다.
:::

### ② 두뇌(플래너) — 한 줄을 계획으로 (`AutoPrepPlanner`)

`plan()`이 한 줄 요청을 받아 **무엇을 실행할지** 동적으로 정한다.

1. **의도 분류**: `parseIntent()`가 LLM(`gpt-5.4-mini`)에게 회사명·직무·모드·parts를 JSON으로 뽑게 한다. 시스템 프롬프트가 "통째로/전체/다/싹/전부" 또는 모호하면 빈 배열 → 전체로, "면접만/자소서만"이면 그 파트만 넣게 지시한다.
2. **의존 클로저 보강**: `addWithDeps()`가 `DEPS = {FIT→[JOB], INTERVIEW→[JOB]}`를 재귀로 따라가, FIT나 INTERVIEW를 골랐으면 **JOB을 자동으로 끌어온다.** 사용자가 "적합도만"이라 해도 JOB이 함께 실행된다.
3. **지원 건 결정**: `resolveCase()`가 명시 caseId → 회사명 contains 매칭 → 회사 모호 시 최근 건 순으로 정한다. 단, **회사를 콕 집었는데 매칭 실패하면 엉뚱한 폴백 대신 null**(인테이크가 되묻도록 유도).

- 출력: `PrepPlan(intent, slots, steps)`. intent는 전체면 `FULL_PREP`, 일부면 `CUSTOM_PREP`.
- 흥미로운 설계: 두뇌는 **자기 LLM 게이트웨이를 안 만들고 면접 도메인의 `InterviewLlmGateway`를 빌려 쓴다.** 즉 두뇌의 의도 파싱도 자체→Claude→OpenAI 폴백 체인을 탄다. 자세한 폴백은 [AI 공급자·폴백 전략](/flow/ai-providers-fallback) 참고.
- 파싱이 실패해도 빈 슬롯·전체 파트로 진행한다(절대 죽지 않음).

### ③ 오케스트레이터 — 의존 그래프 병렬 실행 (`AutoPrepOrchestrator`)

여기가 심장이다. `executeParallel()`이 plan의 steps를 돌며 각 파트를 `CompletableFuture`로 묶는다.

```java
// 핵심만 추상화 (AutoPrepOrchestrator)
for (String key : plan.steps()) {
    CompletableFuture<?>[] deps = DEPS.getOrDefault(key, List.of()).stream()
            .map(futures::get).filter(Objects::nonNull)
            .toArray(CompletableFuture[]::new);
    // dep 파트의 future 가 전부 끝난 뒤에야 runPart 실행
    var f = CompletableFuture.allOf(deps)
            .thenRunAsync(() -> runPart(key, ...), sseExecutor);
    futures.put(key, f);
}
CompletableFuture.allOf(futures.values()...).join();  // 전부 끝날 때까지 대기
```

- **의존 그래프**: `DEPS = Map.of("FIT", List.of("JOB"), "INTERVIEW", List.of("JOB"))` — 딱 두 줄. PROFILE·JOB·WRITE·COMMUNITY는 의존이 없어 즉시 출발, FIT·INTERVIEW는 JOB의 future 완료 후 시작한다.
- **스레드풀**: 전용 데몬 풀 `sseExecutor = Executors.newCachedThreadPool`, `@PreDestroy`로 정리.
- **결과 전달**: `prior = ConcurrentHashMap`에 DONE 결과의 detail을 누적해, FIT/INTERVIEW가 JOB 결과를 입력으로 받는다(B 공고분석 → C·D로 데이터가 흐름).
- **완주 보장(아주 중요)**: 핸들러가 없거나 `!enabled()`면 `SKIPPED`("준비중"), 실행 중 예외가 나면 try-catch로 `FAILED`로 변환한다. **한 파트의 실패가 다른 파트로 번지지 않는다.** 끝에 "완료 N · 건너뜀 N · 실패 N" 요약을 만든다.

### ④ SSE — 실시간 진행 보고 (`runStream`)

`runStream`은 같은 병렬 로직을 돌리되 `PartListener`로 이벤트를 흘려보낸다.

```text
event: plan        → 두뇌가 세운 계획(어떤 파트를 돌릴지)
event: part-start  → "JOB 시작"
event: substep     → "공고 구조화 중…" 같은 세부 진행
event: part-done   → 파트별 PrepStepResult(DONE/SKIPPED/FAILED)
event: done        → "완료"
```

- 병렬 파트가 **같은 emitter에 동시에** 쓰므로, `send()`를 `synchronized(emitter)`로 보호한다. 타임아웃은 5분(`SSE_TIMEOUT_MS=300_000L`).
- 프런트(`frontend/src/features/autoprep/`)는 SSE가 `ApiResponse` 엔벨로프를 안 타므로 공통 `api()` 래퍼 대신 `fetch`+수동 토큰으로 받고 `\n\n` 단위로 파싱한다. `useAutoPrepRun.ts`의 `reduce()`가 이벤트를 `pending→running→done/skipped/failed`로 변환하고, `AbortController`로 취소를 지원한다.

### ④-b 6파트 핸들러 = 6영역 도메인 서비스 래퍼

오케스트레이터는 **새 AI를 만들지 않는다.** `PrepStepHandler`(`key()`/`enabled()`/`handle()`) 인터페이스 6구현이 각 영역의 기존 서비스를 호출할 뿐이다. 표준 순서는 `PrepPlan.defaultSteps() = [PROFILE, JOB, FIT, WRITE, INTERVIEW, COMMUNITY]`.

| key | 핸들러 | 호출 서비스(영역) | SKIPPED 조건 |
| --- | --- | --- | --- |
| PROFILE | `ProfilePrepHandler` | `profileAiService.evaluate(...)` (A) | 프로필 없음 |
| JOB | `JobPrepHandler` | `jobAnalysisService.createJobAnalysis()` (B) | caseId 없음 |
| FIT | `FitPrepHandler` | `fitAnalysisService.generate()` (C) | caseId 없음 |
| WRITE | `WritePrepHandler` | `correctionService.create("SELF_INTRO",...)` (E) | 원문 없음 |
| INTERVIEW | `InterviewPrepHandler` | `interviewService.createSession()` + `generateQuestions()` (D) | caseId 없음 |
| COMMUNITY | `CommunityPrepHandler` | `communityPostService.getHotPosts()` (F, 읽기전용) | 없음(독립) |

각 영역의 내부 동작은 해당 페이지로: [C 적합도 분석](/area-c/fit-analysis), [D 면접 오케스트레이터](/area-d/orchestrator-interview).

:::details 첨부 게이팅 (AutoPrepAttachmentLoader)
요금제별 첨부 한도가 있다: FREE/BASIC 1개, PRO/PREMIUM 5개. `text/*` MIME만 본문을 추출하고 12,000자에서 자른다. 한도 초과·로드 실패는 로그만 남기고 **완주를 막지 않는다**(부분 실패에 관대한 일관된 철학).
:::

---

## 4. 설계 포인트 — 왜 이렇게 연결했나

**1) 왜 오케스트레이터인가 — 원클릭의 가치.** 원래 사용자는 프로필 → 공고분석 → 적합도 → 면접 → 첨삭을 화면마다 버튼을 눌러야 한다([사용자 여정](/flow/user-journey) 8단계). AutoPrep은 이걸 "한 줄 요청 → 자동 준비"로 압축한다. 신규 사용자의 진입 장벽을 없애는 게 제품적 목적이다.

**2) 의존 그래프를 두 줄로 — 정합성 vs 속도.** 모든 파트를 순차 실행하면 느리고, 전부 병렬로 하면 FIT/INTERVIEW가 아직 없는 JOB 결과를 읽어 깨진다. 그래서 **데이터 의존이 실재하는 곳(B→C, B→D)만** 동기화하고 나머지는 풀어줬다. 의존이 단 두 줄인 건 영역 경계 자체가 깔끔하게 설계됐다는 방증이다([지원 건 중심 흐름](/flow/application-case) 참고).

**3) 부분 실패에 관대하게.** AI 호출은 외부 의존이 많아 한 파트가 실패하기 쉽다. 한 파트 실패가 전체를 죽이면 사용자 경험이 최악이 된다. 그래서 `SKIPPED`/`FAILED`를 일급 상태로 두고 **무조건 완주**한 뒤 요약을 준다. 실패한 파트만 나중에 재시도하면 된다.

**4) 새 AI를 안 만든다 — 영역 소유권 보존.** 핸들러는 얇은 래퍼라, 적합도 로직은 여전히 C가, 면접 로직은 D가 소유한다. 오케스트레이터가 도메인 규칙을 복제하면 정합성이 깨지고 소유권이 흐려진다. [데이터 소유권 경계](/flow/data-ownership)의 "각 영역이 자기 결과 테이블 소유" 원칙과 일치한다.

**5) 공통 영역은 거의 안 건드린다.** 오케스트레이터가 손댄 공통 변경은 **단 하나**: SSE 비동기 재디스패치 시 401을 막기 위한 `SecurityConfig`의 `dispatcherTypeMatchers(ASYNC, ERROR).permitAll()`. 그 외에는 기존 도메인 서비스만 호출한다([팀 협업·경계](/flow/team-collaboration)).

---

## 5. 구현 상태 (정직하게)

| 항목 | 상태 |
| --- | --- |
| 두뇌(플래너) 의도 파싱·의존 클로저·지원 건 매칭 | 구현됨 (`AutoPrepPlanner`) |
| 의존 그래프 병렬 실행·부분 실패 완주 | 구현됨 (`AutoPrepOrchestrator`) |
| SSE 스트리밍(plan/part-start/substep/part-done/done) | 구현됨 (`runStream` + `useAutoPrepRun.ts`) |
| 6파트 핸들러(A~F 래퍼) | 구현됨 (`*PrepHandler` 6개) |
| 첨부 게이팅(요금제별 한도·12000자 컷) | 구현됨 (`AutoPrepAttachmentLoader`) |
| 인테이크 챗봇 멀티턴·프런트 handoff | 구현됨 |
| 챗봇 슬롯 영속화·PENDING 복원 | 구현됨 (`chatbot_intake_slot`) |
| 두뇌·핸들러의 자체 OSS 생성 경로 | 게이트웨이는 폴백 지원하나 생성 화이트리스트는 현재 빈 집합 → 사실상 Claude/OpenAI |

:::warning 흔한 오해 두 가지
- **"파트 알파벳과 실행 순서가 같다"** → 아니다. 표준 순서는 PROFILE·JOB·FIT·**WRITE(E)**·**INTERVIEW(D)**·COMMUNITY인데, WRITE는 E 담당이지만 4번째에 온다. 프런트 메타(`types/autoPrep.ts`)에서도 WRITE=E, INTERVIEW=D로 알파벳과 순서가 어긋난다.
- **"오케스트레이터가 자체 AI를 새로 만든다"** → 아니다. A~F 기존 도메인 서비스를 래핑할 뿐이다.
:::

---

## 6. 면접 답변 — 전체를 흐름으로 설명

:::tip 60초 버전
"AutoPrep은 한 줄 요청으로 6개 영역의 취업 준비를 한 번에 돌리는 오케스트레이터입니다. 흐름은 네 단계예요. **첫째 인테이크**가 지원 건과 면접 모드 같은 부족한 정보를 한 번에 하나씩 되묻고, **둘째 두뇌(플래너)**가 LLM으로 요청을 분류해 어떤 파트를 돌릴지 동적으로 정합니다. 이때 적합도나 면접을 고르면 공고분석을 자동으로 끌어와요. **셋째 오케스트레이터**가 `CompletableFuture`로 파트를 병렬 실행하는데, 의존 그래프가 딱 두 줄이라 적합도·면접만 공고분석 뒤에 시작하고 나머지는 동시에 출발합니다. 한 파트가 실패해도 `FAILED`로 기록하고 나머지는 완주시켜요. **넷째**, 진행 상황을 SSE로 plan·part-start·part-done 이벤트로 실시간 스트리밍합니다. 핵심 설계는 **새 AI를 안 만들고 각 영역의 기존 서비스를 래핑**해서 소유권을 보존했다는 점입니다."
:::

핵심 키워드: 한 줄 → 두뇌 → 의존 그래프 병렬 → SSE → 부분 실패 완주 → 도메인 래핑.

---

## 7. 꼬리 질문 + 모범 답안

:::details "병렬인데 적합도가 공고분석 결과를 어떻게 받나요?"
오케스트레이터가 `prior`라는 `ConcurrentHashMap`에 DONE 파트의 detail을 누적합니다. FIT/INTERVIEW는 JOB의 future가 끝난 뒤에야 시작하므로, 그 시점엔 `prior`에 JOB 결과가 이미 들어있어 입력으로 읽을 수 있어요. 즉 **의존 그래프가 데이터 흐름과 실행 순서를 동시에 보장**합니다.
:::

:::details "한 파트가 30초 걸리고 멈추면 전체가 멈추지 않나요?"
SSE에 5분 타임아웃(`SSE_TIMEOUT_MS`)이 있고, 각 파트는 독립 스레드라 한 파트가 느려도 의존이 없는 파트는 먼저 끝나 `part-done`이 나갑니다. 실패는 try-catch로 `FAILED` 변환되고 `allOf().join()`이 모든 future를 기다리므로, 느린 파트 하나가 나머지 결과 보고를 막지는 않습니다.
:::

:::details "왜 SSE인가요? WebSocket이나 폴링은요?"
진행 보고는 **서버 → 클라 단방향**이고 짧게 끝나는 작업이라 양방향 WebSocket은 과합니다. 폴링은 지연·부하가 크고요. SSE는 HTTP 위에서 단방향 스트림을 표준으로 제공해 가장 단순합니다. 다만 SSE는 `ApiResponse` 엔벨로프를 안 타서 프런트가 `fetch`로 직접 파싱하는 예외 처리가 필요했습니다.
:::

:::details "사용자가 '적합도만'이라고 했는데 공고분석이 왜 실행됐죠?"
의도적입니다. 적합도(FIT)는 공고의 필수/우대 조건(B의 `job_analysis`)을 입력으로 받아야 의미가 있어요. 그래서 플래너의 `addWithDeps()`가 `DEPS`를 재귀로 따라가 JOB을 자동으로 끌어옵니다. 사용자가 의존을 몰라도 결과가 깨지지 않게 하는 안전장치입니다.
:::

---

## 8. 직접 말해보기

다음을 보지 않고 소리 내어 설명해보라. 막히면 해당 절로 돌아간다.

1. AutoPrep의 4단계를 순서대로, 각 단계의 입력·출력과 함께.
2. 의존 그래프가 왜 두 줄뿐인지, 어떤 파트가 동시 출발하고 어떤 파트가 대기하는지.
3. 부분 실패를 어떻게 다루는지(`SKIPPED`/`FAILED`/완주).
4. SSE 이벤트 5종과, 프런트가 왜 `api()` 래퍼를 못 쓰고 `fetch`로 직접 받는지.
5. "오케스트레이터가 새 AI를 만들지 않는다"는 말의 의미와 그 설계적 이점.

더 깊이: [AI 기능 #1-34 맵](/flow/ai-function-map) · [크레딧·사용량 흐름](/flow/credit-usage) · [전체 아키텍처](/flow/architecture)

---

## 퀴즈

<QuizBox question="AutoPrep 오케스트레이터의 의존 그래프(DEPS)에서, JOB 완료 후에 시작하는 파트는?" :choices="['PROFILE 과 COMMUNITY', 'FIT 과 INTERVIEW', 'WRITE 와 PROFILE', '모든 파트가 JOB 에 의존한다']" :answer="1" explanation="DEPS 는 단 두 줄로 FIT→[JOB], INTERVIEW→[JOB] 만 정의한다. 적합도(C)와 면접(D)은 공고분석(B) 결과가 DB에 커밋된 뒤 시작하고, PROFILE·JOB·WRITE·COMMUNITY 는 독립이라 동시에 출발한다." />

<QuizBox question="병렬 실행 중 한 파트에서 예외가 발생하면 어떻게 되나?" :choices="['전체 실행이 중단되고 에러를 던진다', '해당 파트만 FAILED 로 기록하고 나머지는 완주한다', '자동으로 무한 재시도한다', '롤백되어 아무 결과도 남지 않는다']" :answer="1" explanation="executeOne 의 try-catch 가 예외를 PrepStepResult.failed 로 변환한다. 한 파트 실패가 다른 파트로 번지지 않고, allOf().join() 이 모든 future 를 기다려 '완료 N · 건너뜀 N · 실패 N' 요약을 만든다. 부분 실패 완주가 핵심 설계다." />

<QuizBox question="오케스트레이터가 SSE 의 send() 를 synchronized(emitter) 로 감싼 이유는?" :choices="['JWT 토큰을 검증하려고', '여러 병렬 파트가 같은 emitter 에 동시에 이벤트를 쓰기 때문에', 'ApiResponse 엔벨로프를 적용하려고', 'DB 트랜잭션을 잠그려고']" :answer="1" explanation="독립 파트들이 서로 다른 스레드에서 동시에 끝나며 같은 SseEmitter 에 part-done 등을 전송한다. emitter 단위 동기화로 이벤트가 섞이지 않게 보호한다." />
