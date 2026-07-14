# 지원 건(Application Case) 중심 흐름

> CareerTuner의 핵심 단위는 공고가 아니라 **지원 건**이다. 하나의 지원 건이 A 프로필·B 공고분석·C 적합도·D 면접·E 첨삭 데이터로 점점 채워지고, `DRAFT→ANALYZING→READY→APPLIED→CLOSED` 상태를 거치며, 6개 영역이 같은 `application_case.id` 하나를 공유한다. 이 한 줄이 전체 아키텍처의 중심축이다.

---

## 1. 이 흐름이 답하는 면접 질문

- "이 서비스의 핵심 데이터 모델이 뭐예요? 왜 그렇게 잡았어요?"
- "공고 하나당 분석이 아니라고 했는데, 그럼 무엇 기준으로 묶었어요?"
- "여러 명이 나눠 개발했다는데, 화면들이 어떻게 한 흐름으로 이어져요?"
- "지원 건 상태는 어떻게 관리해요? 삭제는요?"

이 질문들의 공통 답이 **지원 건**이다. 6개 영역을 따로 설명하면 "기능 나열"이 되지만, 지원 건 하나가 채워지는 과정으로 설명하면 "시스템 설계"가 된다. 영역별 디테일은 각 영역 페이지([A](/area-a/)·[B](/area-b/)·[C](/area-c/)·[D](/area-d/)·[E](/area-e/)·[F](/area-f/))에 있으니, 이 페이지는 **연결**에만 집중한다.

:::tip 한 문장으로
"우리 서비스의 작업 단위는 공고가 아니라 '이 회사·이 직무에 지원하는 한 건'입니다. ChatGPT의 대화 하나처럼, 그 안에 공고 분석·적합도·면접·첨삭이 전부 모입니다."
:::

---

## 2. 왜 핵심 단위가 "공고"가 아니라 "지원 건"인가

같은 공고라도 지원자마다, 또 같은 지원자라도 시점·전략마다 분석이 달라진다. 단위를 공고로 잡으면 "내 스펙·내 면접·내 첨삭"을 걸 곳이 없다. 그래서 **기업·직무·공고 조합 하나 = 지원 건 하나**를 독립 작업 공간(ChatGPT 세션과 유사)으로 두고, 그 안에 모든 산출물을 모은다.

| 만약 단위가 "공고"였다면 | 단위가 "지원 건"이라서 가능한 것 |
| --- | --- |
| 내 적합도를 어디에 저장? | `application_case.id`에 `fit_analysis`를 1:N으로 건다 |
| 같은 공고 재지원/수정 이력 | 같은 공고의 revision은 `job_posting`을 1:N으로 누적 |
| 면접·첨삭은 누구 것? | 전부 같은 지원 건에 매달려 한 사람의 한 도전이 된다 |
| 진행 상태(지원함/마감) | `application_case.status`가 그 한 건의 진행을 표현 |

::: details "1:N인데 공고 여러 개 묶는 거 아니에요?" — 자주 나오는 오해
스키마상 `application_case ─1:N─ job_posting`이지만, 이 1:N은 **서로 다른 공고를 묶는 게 아니라 같은 공고의 수정 이력(revision)** 이다. 하나의 지원 건은 특정 기업·직무·공고 조합 하나다. ([ARCHITECTURE.md 5장 근거](/flow/architecture))
:::

---

## 3. 전체 그림 — 지원 건이 채워지는 과정

지원 건은 빈 껍데기(`DRAFT`)로 태어나 영역별 데이터가 붙으면서 "준비 완료(`READY`)"가 된다. 화살표는 데이터 의존(앞 결과를 입력으로 받음)을 뜻한다.

```text
                      ┌──────────────────── application_case (id=42, status) ───────────────────┐
                      │                          6개 영역이 같은 id 하나를 공유                    │
 [A 프로필]           │                                                                          │
 user_profile ───────┼──▶ B 공고분석 ──▶ C 적합도 ──▶ D 면접 ──▶ E 첨삭                          │
 (전 영역 공통입력)    │   job_analysis    fit_analysis  interview_*  correction_request          │
                      │   company_analysis     │            │            ▲                        │
                      │                         │            └─ answer ───┘ (D답변 → E입력)        │
                      │                         └────────────────────────────▶ C 장기경향(순환)    │
                      └──────────────────────────────────────────────────────────────────────────┘
                                         F 커뮤니티: 여정 바깥에서 후기·실제질문을 B/D에 참고로 순환
```

핵심은 **테이블 단위로 보면 전부 `application_case_id` FK로 한 점에 모인다**는 것이다.

```text
users ─1:N─ application_case ─┬─1:N─ job_posting        (B: 같은 공고 revision)
                              ├─1:N─ job_analysis        (B)
                              ├─1:N─ company_analysis    (B)
                              ├─1:N─ fit_analysis        (C)
                              ├─1:N─ interview_session ─1:N─ interview_question ─1:N─ interview_answer  (D)
                              └─1:N─ correction_request  (E)
user_profile (A)  ← 지원 건에 안 매달림. users에 1:1, 모든 영역이 읽기전용 참조
ai_usage_log (공통) ─N:1─ application_case(nullable)   ← 어느 건에서 쓴 AI인지 집계용
```

---

## 4. 단계별 상세 — 각 단계가 무엇을 받아 무엇을 넘기나

표는 "이 단계가 어느 영역·어느 테이블에 무엇을 남기고, 다음 단계에 무엇을 넘기는가"를 정리한 것이다. 기준 커밋의 정본 DDL은 172개 테이블이지만 여기서는 지원 건 줄기에 직접 매달리는 것만 추렸다.

| # | 단계 | 영역 | 입력(어디서) | 산출(어느 테이블) | 다음에 넘기는 것 |
| --- | --- | --- | --- | --- | --- |
| 1 | 프로필 정리 | A | 이력서·경력·자소서 | `user_profile`(+`user_profile_version`) | A 스냅샷 → 전 영역 공통 입력 |
| 2 | 공고 분석 | B | 공고 원문·OCR | `job_posting`→`job_analysis`·`company_analysis` | 필수/우대/면접포인트 → C·D |
| 3 | 적합도 분석 | C | A 스냅샷 + B 필수/우대 | `fit_analysis` | 점수·근거·갭 → D 질문, 다음액션 |
| 4 | 예상 질문 + 면접 | D | B 공고/면접포인트 + C 적합도 | `interview_session`/`_question`/`_answer` | 답변·평가 → E·C |
| 5 | 첨삭 | E | D 답변 + A 원문 | `correction_request`(원문/개선안 분리) | 개선안(원문 비수정), 크레딧 소모 |
| ↺ | 장기 경향 | C | 여러 지원건 + D 답변평가 + E 결과 | 경향분석 류 | 반복 부족·다음 지원방향 |
| ⤴ | 커뮤니티 | F | 후기·태그 | `community_*` | 실제 면접질문 → D 참고데이터 |

연결의 정확한 코드 근거(오케스트레이터가 이 줄기를 자동으로 돌릴 때):
- `FitPrepHandler`·`InterviewPrepHandler`는 `prior` 맵으로 **JOB(공고 분석) 결과를 입력으로 받는다.** 즉 C·D는 B 결과 없이 시작하지 않는다.
- D의 `interview_answer` → E 첨삭(`CORRECTION_INTERVIEW_ANSWER`) 입력, → C 장기경향 입력으로 다시 흘러간다. 여기서 흐름이 **순환**한다.

각 단계 깊이 보기: [공고 텍스트 추출·OCR](/area-b/text-extraction-ocr) · [적합도 분석](/area-c/fit-analysis) · [면접 오케스트레이션](/area-d/orchestrator-interview) · [크레딧 시스템](/area-e/credit-system) · [인테이크 챗봇](/area-f/intake-chatbot)

---

## 5. 상태 머신 — DRAFT → ANALYZING → READY → APPLIED → CLOSED

지원 건의 `status`(`application_case` 테이블, `VARCHAR(20) DEFAULT 'DRAFT'`)는 **진행 상태만** 표현한다. 보관·삭제는 상태값이 아니라 별도 시각 컬럼(`archived_at`/`deleted_at`)으로 관리한다 — 상태와 수명주기를 섞지 않는 설계다.

```text
 DRAFT ───▶ ANALYZING ───▶ READY ───▶ APPLIED ───▶ CLOSED
 (생성)     (분석 진행중)    (준비완료)   (지원함)      (마감/종료)

 직교(상태와 무관):  archived_at  보관 시점 ┐ 둘 다 별도 시각 컬럼
                    deleted_at   삭제 시점 ┘ (소프트 삭제)
```

| 상태 | 의미 | 무엇이 채워졌나 |
| --- | --- | --- |
| `DRAFT` | 빈 지원 건 생성 | 회사명·직무만, 분석 전 |
| `ANALYZING` | 공고/적합도 분석 진행 | B·C 산출물 생성 중 |
| `READY` | 준비 완료 | 적합도·면접·전략까지 준비됨 |
| `APPLIED` | 실제 지원함 | 사용자가 지원 사실 표시 |
| `CLOSED` | 종료/마감 | 결과 반영·보관 대상 |

:::warning 삭제는 row 삭제가 아니다
지원 건 삭제 API는 물리 삭제가 아니라 `deleted_at`을 기록하는 **소프트 삭제**다. 목록 조회는 `archived_at IS NULL AND deleted_at IS NULL`, 보관함은 `archived_at IS NOT NULL`, 삭제건은 `deleted_at IS NOT NULL`로 거른다. 분석 재현성과 원본 보관 정책 때문에 row를 지우지 않는다.
:::

---

## 6. 설계 포인트 — 왜 이렇게 연결했나 (경계·정합성)

지원 건을 중심에 두면 "여러 명이 같은 테이블을 동시에 건드리는 충돌"을 막을 수 있다. 핵심은 **각 영역이 자기 결과 테이블만 소유하고, 타 영역 원본은 읽기전용으로 참조**한다는 원칙이다.

| 영역 | 소유(쓰기) | 참조(읽기전용) | 정합성 장치 |
| --- | --- | --- | --- |
| A | `users`·`user_profile` | — | 원본 수정 책임은 A에만 |
| B | `job_posting`·`job_analysis`·`company_analysis` | A 프로필 | 같은 공고 revision은 UNIQUE 키로 멱등 |
| C | `fit_analysis`·경향분석 류 | A 스냅샷·B 결과 | **원본 비수정**, `input_fingerprint`로 캐싱·재현 |
| D | `interview_*`·`interview_knowledge`(RAG) | B·C·A | 멀티에이전트 트레이스 별도 보관 |
| E | `correction_request`·`payment`·`credit_*` | A 원문·D 답변 | **원문/개선안 분리 저장**(덮어쓰기 금지) |
| F | `community_*`·`notification`·`support_*` | — | 추출 질문은 D에 "참고"로만 제공 |

이 경계가 지켜지는 이유 셋:
1. **원본 동결**: C는 분석 시점의 A·B 입력을 `source_snapshot`/`input_snapshot`으로 동결해, 나중에 원본이 바뀌어도 그 분석의 재현이 가능하다. ([캐싱·지문](/area-c/fit-analysis))
2. **점수는 코드가 확정**: 적합도 점수·신뢰도는 LLM이 아니라 서버 규칙엔진이 결정한다(뉴로-심볼릭). 그래서 같은 입력이면 항상 같은 결과다.
3. **사용량은 공통 규약으로만 append**: 모든 영역이 `ai_usage_log`에 같은 형식으로 기록하되 스키마는 팀장 소유 공통 영역이라 함부로 못 바꾼다.

자세히: [데이터 소유권 경계 맵](/flow/data-ownership) · [팀 협업·시스템 경계](/flow/team-collaboration) · [크레딧·사용량 흐름](/flow/credit-usage)

---

## 7. 오케스트레이터가 이 줄기를 자동으로 돈다 (구현 상태)

"한 줄 요청"을 받아 위 단계를 의존 그래프대로 병렬 실행하는 게 **AI 오케스트레이터(AutoPrep)** 다. 여기서도 모든 게 **하나의 `applicationCaseId`** 를 공유한다.

```text
의존 그래프는 단 두 줄 (AutoPrepOrchestrator.DEPS):
   FIT       ← JOB
   INTERVIEW ← JOB

→ PROFILE·JOB·WRITE·COMMUNITY 는 의존 없음 → 동시 출발
→ FIT(C)·INTERVIEW(D) 만 JOB(B) DB 커밋 후 시작
```

| 항목 | 구현됨 / 계획 | 근거 |
| --- | --- | --- |
| 지원 건 단위 데이터 모델·상태머신 | **구현됨** | `application_case` 테이블 `status` enum, 소프트 삭제 |
| 오케스트레이터 병렬 실행 + SSE | **구현됨** | `AutoPrepOrchestrator`(DEPS 2줄·`CompletableFuture`·SSE 5분) |
| 6파트 핸들러 = 6영역 도메인 래퍼 | **구현됨** | `PrepStepHandler` + `*PrepHandler` (새 AI 안 만듦) |
| 인테이크 챗봇(F) → AutoPrep 연결 | **구현됨** | 프런트 칩·파일 handoff, `chatbot_intake_slot` DB 복원 |
| 지원 건 단위 "세션 자동저장"(ChatGPT식) | **계획** | autoprep 전용 세션 테이블 없음 |

오케스트레이터는 **새 AI를 만들지 않고** A~F 기존 도메인 서비스를 래핑할 뿐이다. 공통 영역에 손댄 건 SSE 401 방지를 위한 `SecurityConfig`의 `ASYNC/ERROR permitAll` 하나뿐이다. 전체 그림은 [AI 오케스트레이터 전체](/flow/ai-orchestrator)에서 깊게 다룬다.

---

## 8. 면접 답변 — 전체를 "지원 건"으로 설명하기

> "CareerTuner의 핵심 단위는 공고가 아니라 **지원 건**입니다. '이 회사 이 직무에 지원하는 한 건'을 ChatGPT의 대화 하나처럼 독립 작업 공간으로 두고, 그 안에 모든 산출물을 모았습니다.
>
> 지원 건은 `DRAFT`로 생성돼서, B가 공고를 분석하고(`job_analysis`), C가 제 프로필 스냅샷과 공고 요구조건을 비교해 적합도를 내고(`fit_analysis`), 그 점수를 받아 D가 예상 질문과 모의면접을 돌리고(`interview_*`), 그 답변을 E가 첨삭합니다(`correction_request`). 이 산출물이 다 `application_case.id` 하나에 FK로 매달려서, 6명이 나눠 개발해도 한 흐름으로 이어집니다.
>
> 상태는 `DRAFT→ANALYZING→READY→APPLIED→CLOSED`로 진행만 표현하고, 보관·삭제는 `archived_at`/`deleted_at` 별도 컬럼으로 분리했습니다. 삭제는 분석 재현성 때문에 소프트 삭제예요.
>
> 영역 간 충돌을 막으려고 **각자 자기 결과 테이블만 쓰고 남의 원본은 읽기전용**으로만 봅니다. 예를 들어 첨삭은 원문을 덮어쓰지 않고 개선안을 별도로 저장합니다. 그리고 이 전체 줄기를 한 줄 요청으로 자동 실행하는 게 AI 오케스트레이터인데, 의존은 'FIT·INTERVIEW는 JOB 다음'이라는 두 줄뿐이고 나머지는 병렬로 돕니다."

이 한 단락이면 "프로젝트 전체를 설명해보세요"에 막힘없이 답할 수 있다. 영역 디테일을 물으면 해당 영역 페이지로 내려가면 된다.

---

## 9. 꼬리질문 + 모범답안

::: details Q1. "왜 공고 단위가 아니라 지원 건 단위로 잡았어요?"
공고는 모두에게 같지만, 분석 산출물은 지원자·시점마다 다릅니다. 단위를 공고로 두면 내 적합도·면접·첨삭을 매달 곳이 없습니다. 지원 건을 작업 공간으로 두면 그 한 도전의 모든 산출물을 한 점(`application_case.id`)에 모을 수 있고, 같은 공고의 수정 이력은 `job_posting` revision으로, 진행 상태는 `status`로 따로 관리됩니다.
:::

::: details Q2. "여러 명이 같은 지원 건 테이블을 건드리면 충돌 안 나요?"
지원 건 메인 테이블은 쓰기 주체를 한정하고, 각 영역은 **자기 결과 테이블만 INSERT**합니다(`fit_analysis`는 C, `interview_*`는 D, `correction_request`는 E). 타 영역 원본은 읽기전용 참조라 덮어쓰기가 없습니다. C는 입력을 스냅샷으로 동결해 원본이 바뀌어도 재현되고, E는 원문/개선안을 분리 저장합니다.
:::

::: details Q3. "상태값에 보관·삭제를 안 넣은 이유는?"
진행 상태(`DRAFT~CLOSED`)와 수명주기(보관/삭제)는 직교하는 축입니다. 보관된 지원 건도 상태는 `APPLIED`일 수 있죠. 둘을 한 enum에 섞으면 "보관된 APPLIED"를 표현 못 합니다. 그래서 `archived_at`·`deleted_at` 시각 컬럼으로 분리하고, 삭제는 재현성 보존을 위해 소프트 삭제로 했습니다.
:::

::: details Q4. "적합도(C)와 면접(D)이 공고분석(B)에 의존한다고 했는데, 코드로 어떻게 보장해요?"
오케스트레이터의 의존 그래프가 `FIT←JOB`, `INTERVIEW←JOB` 두 줄입니다. `CompletableFuture.allOf(depFutures).thenRunAsync(...)`로 JOB future가 끝난 뒤에야 FIT·INTERVIEW가 출발하고, JOB 결과는 `prior` 맵을 통해 입력으로 전달됩니다. 나머지 PROFILE·WRITE·COMMUNITY는 의존이 없어 동시에 출발합니다.
:::

---

## 10. 직접 말해보기

아래를 막힘없이 소리 내어 답해 보자. 멈칫하면 해당 영역 페이지로 돌아가 채운다.

1. "이 서비스의 작업 단위 하나가 무엇이고, 그 안에 무엇이 모이는지" 30초로 설명하기
2. 지원 건 하나가 `DRAFT`에서 `CLOSED`까지 가는 동안 어떤 테이블이 차례로 채워지는지 말하기
3. "왜 6명이 나눠 개발했는데 한 흐름으로 이어지나"를 FK 한 점으로 설명하기
4. 첨삭(E)이 원문을 덮어쓰지 않는 이유와, C가 입력을 동결하는 이유를 한 묶음으로 말하기
5. 오케스트레이터의 의존이 왜 "두 줄"뿐인지 말하기 (힌트: FIT·INTERVIEW만 JOB을 기다린다)

---

## 퀴즈

<QuizBox question="CareerTuner의 핵심 작업 단위로 옳은 것은?" :choices="['채용 공고 하나', '지원 건(application_case) 하나 — 기업·직무·공고 조합', '사용자 프로필 하나', 'AI 호출 한 번']" :answer="1" explanation="핵심 단위는 공고가 아니라 지원 건이다. 기업·직무·공고 조합 하나를 ChatGPT 세션처럼 독립 작업 공간으로 두고, 그 안에 공고분석·적합도·면접·첨삭이 모두 application_case.id 하나에 FK로 매달린다." />

<QuizBox question="application_case 테이블에서 진행 상태(status)와 보관·삭제를 분리한 방식으로 옳은 것은?" :choices="['status enum에 ARCHIVED·DELETED 값을 추가했다', 'status는 DRAFT~CLOSED 진행만 표현하고, 보관·삭제는 archived_at·deleted_at 시각 컬럼으로 분리했다', '삭제 시 DB row를 물리적으로 제거한다', '보관과 삭제를 별도 테이블로 옮긴다']" :answer="1" explanation="진행 상태와 수명주기는 직교하는 축이라 한 enum에 섞지 않는다. status는 DRAFT→ANALYZING→READY→APPLIED→CLOSED 진행만, 보관·삭제는 archived_at/deleted_at 시각 컬럼으로 관리하며 삭제는 재현성 보존을 위한 소프트 삭제다." />

<QuizBox question="오케스트레이터(AutoPrep)에서 FIT(적합도)·INTERVIEW(면접)만 다른 파트를 기다리는 이유는?" :choices="['LLM 비용이 비싸서 순차 실행이 강제된다', '두 파트가 JOB(공고 분석) 결과를 입력으로 받기 때문 — 의존 그래프 DEPS가 FIT←JOB, INTERVIEW←JOB 두 줄이다', '사용자가 수동으로 순서를 지정한다', '세 파트가 같은 테이블에 동시에 쓰면 데드락이 나서']" :answer="1" explanation="의존 그래프는 FIT←JOB, INTERVIEW←JOB 단 두 줄이다. C·D는 B의 공고 분석 결과(prior 맵)를 입력으로 받아야 의미가 있어 JOB 커밋 후 시작하고, PROFILE·JOB·WRITE·COMMUNITY는 의존이 없어 동시에 출발한다." />
