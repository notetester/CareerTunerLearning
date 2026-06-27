# 데이터 소유권 · 읽기전용 경계 맵

> 약 68개 테이블을 6개 영역(A~F)이 수직으로 나눠 소유한다. 핵심 규칙은 단 하나 — **각 영역은 자기 결과 테이블을 쓰고, 타 영역 원본은 읽기전용으로만 참조한다.** 정합성은 FK가 아니라 "분석 시점 입력을 소비자 쪽에 동결하는 스냅샷"으로 지킨다.

이 페이지는 6개 영역을 가로지르는 "데이터의 소유·참조·정합성" 그림을 다룬다. 각 영역 테이블의 내부 설계 상세는 해당 영역 페이지에 있으니, 여기서는 **경계가 어떻게 그어지고 왜 그렇게 그었는가**에 집중한다.

먼저 보면 좋은 페이지:

- 전체 그림: [전체 흐름](/flow/) · [아키텍처](/flow/architecture) · [사용자 여정](/flow/user-journey)
- 핵심 단위가 왜 지원 건인가: [지원 건 중심 모델](/flow/application-case)
- C가 스냅샷·캐시를 어떻게 동결하는지(가장 정교한 사례): [C 데이터 모델](/area-c/data-model)

## 1. 이 경계 맵이 답하는 면접 질문

- "테이블이 68개나 되는데, 누가 무엇을 소유하나요? 충돌은 어떻게 막나요?"
- "C가 A의 프로필과 B의 공고분석을 입력으로 쓰는데, 어떻게 침범 없이 분석하나요?"
- "원본이 나중에 바뀌면 과거 분석 결과는 어떻게 재현하나요?"
- "FK로 다 묶었나요? 영역 간 결합은 어떻게 설계했나요?"
- "AI 사용 로그처럼 모든 영역이 공유하는 데이터는 누가 소유하나요?"

## 2. 전체 그림 — 소유 테이블과 참조 방향

허브는 둘이다: `users`(A)와 `application_case`(B). 거의 모든 테이블이 이 둘 중 하나로 FK가 모인다.

| 영역 | 소유 결과 테이블(대표) | 타 영역에 제공(읽기전용) | 상세 |
| --- | --- | --- | --- |
| **A 회원/프로필** | `users`, `user_profile`(1:1), `user_consent`, 인증/세션 계열 | `user_profile` 원천 → B/C/D/E. **수정 책임은 A** | [/area-a/](/area-a/) |
| **B 지원건/공고** | `application_case`, `job_posting`, `job_analysis`, `company_analysis` | 공고 구조화 결과 → C/D/E 읽기전용 | [/area-b/](/area-b/) |
| **C 적합도/대시보드** | `fit_analysis`(불변), `fit_analysis_condition_match`, `career_analysis_run` | 적합도 결과 → D 참조. **원본 비수정** | [/area-c/](/area-c/) |
| **D 면접** | `interview_session/question/answer`, `interview_agent_step`, `interview_knowledge`, `file_asset` | 답변·평가 → C 장기경향·E 첨삭 입력 | [/area-d/](/area-d/) |
| **E 첨삭/결제** | `correction_request`, `payment`, `credit_transaction`, `benefit_transaction`, `ai_usage_log` | (원장 분리) 첨삭 원문/결과 별도 저장 | [/area-e/](/area-e/) |
| **F 커뮤니티/CS** | `community_*`, `support_ticket`, `notice`, `faq`, `notification`, `push_subscription` | 추출 면접질문 → D 참고 | [/area-f/](/area-f/) |

::: tip 테이블 수 표기
DB설계서 기준 **약 68개 테이블**, 영역별 카운트는 문서에 따라 ±1 차이가 있다(예: A 8~9, D 7~8 — `ai_usage_log`/`file_asset`를 어느 쪽으로 세느냐의 차이). 학습용으로는 "약 68개, 영역별 ±1" 정도로 이해하면 충분하다.
:::

영역 간 FK는 거의 전부 두 허브로 수렴한다. 화살표는 "참조(읽기) 방향"이다.

```text
                         ┌─────────────────────────────────────────────┐
                         │         users (A)  ── 허브 1 ──              │
                         │  소유: 계정·프로필·동의·인증/세션            │
                         └───────┬──────────────────────────┬──────────┘
            user_id FK           │                          │  user_id FK (전 영역)
        ┌────────────────────────┘                          └────────────────────┐
        ▼                                                                         ▼
┌──────────────────────┐                                              ┌────────────────────┐
│ application_case (B) │ ── 허브 2 ── 핵심 단위                       │  E 결제/사용 원장   │
│ 소유: 공고·분석 결과 │                                              │ payment·credit_tx  │
└──┬────────┬────────┬─┘                                              │ benefit_tx         │
   │        │        │  application_case_id FK                        │ ai_usage_log       │
   ▼        ▼        ▼                                                └────────────────────┘
┌──────┐ ┌──────┐ ┌──────────┐
│ C    │ │ D    │ │ E        │
│ fit_ │ │ inter│ │correction│      F 커뮤니티는 application_case에 안 묶임
│anal. │ │view_*│ │_request  │      (users에만 FK) → 여정 바깥 순환
└──────┘ └──────┘ └──────────┘
   읽기전용 입력: A user_profile + B job_analysis/company_analysis
```

핵심: **F(커뮤니티)는 `application_case`에 FK가 없다.** `users`에만 묶인다. 그래서 후기·실제질문은 특정 지원 건에 종속되지 않고, "F 후기 → D 면접 참고"처럼 여정 바깥에서 순환한다.

## 3. 소유·참조 경계의 단계별 동작

각 영역이 "무엇을 받아(읽기전용) → 무엇을 자기 테이블에 쓰는가(소유)"를 따라가면 경계가 또렷해진다.

### A — 스펙 원천 (수정 책임의 시작점)

- **소유**: `user_profile`(`user_id` UNIQUE, 1:1). `skills`/`career`/`projects`/`self_intro` 등이 JSON·MEDIUMTEXT로 들어있다.
- **제공**: B/C/D/E가 전부 이 한 행을 입력으로 읽는다. 단, **쓰기는 오직 A만** 한다. 다른 영역이 프로필을 고치는 일은 없다.
- 정합성 포인트: `user_profile`은 **단일 가변 행**이다(전용 버전 테이블 없음, `updated_at`만 갱신). 그래서 "과거 시점 프로필"을 보존할 책임은 A가 아니라 **그 입력을 쓴 소비자 영역**에 있다(아래 4장 스냅샷).

### B — 공고를 구조화해 모두에게 읽기전용으로 푼다

- **소유**: `application_case`(핵심 단위), `job_posting`(원문), `job_analysis`(필수/우대/담당업무), `company_analysis`(기업현황).
- **제공**: C 적합도·D 면접·E 첨삭이 `application_case_id`로 이 결과들을 읽는다. B가 한 번 구조화하면 하류 세 영역이 같은 사실을 공유한다(중복 분석 방지).

### C — 남의 데이터로 분석하되 원본을 건드리지 않는다

- **소유**: `fit_analysis`(점수·근거·전략, **불변/append-only**), `fit_analysis_condition_match`(조건 매트릭스 정규화), `career_analysis_run`(장기경향).
- **입력(읽기전용)**: A `user_profile` + B `job_analysis`/`job_posting`. 둘 다 C와 무관하게 계속 바뀐다.
- 정합성 포인트: C는 분석에 쓴 입력을 `fit_analysis.source_snapshot`(JSON)에 **복사해 동결**하고, `career_analysis_run.input_snapshot` + `input_fingerprint`로 캐시한다. 자세한 동작은 [C 적합도](/area-c/fit-analysis)·[C 데이터 모델](/area-c/data-model).

### D — 면접 산출물을 소유하고 C·E에 넘긴다

- **소유**: `interview_session/question/answer`, 멀티에이전트 트레이스 `interview_agent_step`, RAG 원본 `interview_knowledge`, 다형 첨부 `file_asset`.
- **제공**: `interview_answer`(답변·평가)가 C 장기경향(#16)과 E 첨삭(#24)의 입력이 된다. 오케스트레이터가 면접 파트를 어떻게 묶는지는 [D 오케스트레이터-면접](/area-d/orchestrator-interview).

### E — 원장 분리 + 원문 비수정

- **소유**: `correction_request`(첨삭), `payment`/`credit_transaction`/`benefit_transaction`(원장), `ai_usage_log`(공통 로그).
- 정합성 포인트: 첨삭은 **원본을 절대 덮어쓰지 않는다.** `correction_request`가 `original_text`와 `improved_text`를 **별도 컬럼**으로 들고 있다(`schema.sql` 첨삭 테이블 1085~1086행). 사용자는 원문과 개선안을 나란히 비교한다. 크레딧/사용권 차감 흐름은 [E 크레딧 시스템](/area-e/credit-system).

### F — 여정 바깥 순환

- **소유**: `community_post`·후기·태그·댓글, 고객센터(`support_ticket`/`faq`), 전영역 공통 `notification`/`push_subscription`.
- **제공**: 후기에서 추출한 실제 면접질문(#31)이 D의 참고 데이터가 된다. 인테이크 챗봇이 슬롯을 모아 D 실행으로 넘기는 계약은 [F 인테이크 챗봇](/area-f/intake-chatbot).

## 4. 설계 포인트 — 왜 이렇게 경계를 그었나

### 4-1. 정합성을 FK가 아니라 "스냅샷"으로 지킨다

소유권 맵에서 가장 중요한 결정. 분석 입력은 전부 **남의 가변 테이블**(A 프로필, B 공고)이다. 이걸 참조(FK)로만 두면 6개월 뒤 프로필이 바뀌었을 때 "그때 70점은 무슨 근거였나?"를 **재현할 수 없다**.

두 방식의 트레이드오프:

| 방식 | 동작 | 문제 |
| --- | --- | --- |
| 참조(FK only) | 입력 원본을 가리키는 FK만 보관 | 원본이 바뀌면 과거 분석 재현 불가, 감사 불가 |
| 스냅샷(copy) | 분석 시점 입력 핵심을 결과 행에 복사·동결 | 약간의 저장 중복, 단 불변이라 동기화 깨질 일 없음 |

CareerTuner는 **소비자 쪽 스냅샷**을 택했다. 핵심은 "스냅샷을 원본 소유자(A)가 아니라 소비자(C)가 들고 있다"는 점이다 — `fit_analysis.source_snapshot`, `career_analysis_run.input_snapshot`. 이렇게 하면 A는 프로필을 자유롭게 갱신하고, C는 "분석 시점의 사실(historical fact)"을 자기 테이블에 잠가둔다. 책임이 깔끔하게 분리된다.

::: warning 흔한 오해 — "user_profile_version 테이블이 있다"
런타임 `schema.sql`에 **별도 프로필 버전 테이블은 없다.** `user_profile`은 `user_id` UNIQUE의 단일 행이다. "스냅샷으로 정합성"은 A의 버전 테이블이 아니라 **각 소비자 영역이 분석 결과 행 안에 입력을 동결**하는 방식으로 구현된다. 면접에서 "버전 테이블"로 오기하지 말 것.
:::

### 4-2. 불변(append-only) 결과 = 성장 추적의 인프라

C `fit_analysis`는 재분석 때 UPDATE가 아니라 **INSERT**한다(최신 행이 현재). 제품 가치 자체가 "점수가 어떻게 올라가는지 보여주기"라, 과거 분석을 지우면 점수 변화 비교가 성립하지 않는다. 같은 사상이 E 원장(`credit_transaction`)에도 적용된다 — 잔액을 덮어쓰지 않고 거래를 한 줄씩 쌓아 `balance_after`로 시점 잔액을 보존한다.

### 4-3. 원본 비수정 — 같은 데이터의 "사실"과 "가공"을 분리

E 첨삭이 `original_text`/`improved_text`를 나눠 저장하는 건 단순 UX가 아니다. **원본은 사실, 개선안은 가공**이라는 경계를 데이터 레벨에서 못 박은 것이다. A의 자소서 원문(소유: A)을 E가 첨삭해도 A 테이블은 한 글자도 안 바뀐다. 영역 간 쓰기 침범이 구조적으로 불가능하다.

### 4-4. 공통 로그는 "스키마는 공통, 기록은 영역별"

`ai_usage_log`는 전 영역이 함께 append하지만, 단일 공통 서비스가 쓰는 게 아니다. 스키마(테이블 정의)는 공통 소유(E/팀장 관리)이고, **기록기는 영역별로 따로**다(`AiUsageLogService`/`InterviewAiUsageLogService`/`CorrectionAiUsageLogService` 등). `feature_type`·`status`·`model`·`credit_used`를 공통 규약으로 남기되, 누가 기록하느냐는 영역이 가진다. 이렇게 해야 "스키마 변경은 팀 합의"라는 공통영역 규칙과 "각 영역이 자기 AI를 소유"라는 수직 분담이 충돌하지 않는다.

### 4-5. 전역에서 반복되는 FK 정리 패턴

| 패턴 | 의미 | 예 |
| --- | --- | --- |
| `ON DELETE CASCADE` | 부모 삭제 시 자식 정리 | `users` 삭제 → 프로필·동의·로그 |
| `ON DELETE SET NULL` | 부모 삭제해도 자식 보존 | `application_case` 삭제 → `ai_usage_log.application_case_id`=NULL(사용 이력은 남김) |
| `UNIQUE` 멱등 키 | 중복 차감/소비 방지 | `benefit_transaction`의 `(benefit_code, transaction_type, ref_type, ref_id)` |

`ai_usage_log`가 `application_case_id`에 `SET NULL`을 쓰는 건 의도적이다 — 지원 건을 지워도 **과금·감사 기록은 남아야** 하기 때문이다.

## 5. 구현 상태 — 구현됨 vs 계획

| 항목 | 상태 |
| --- | --- |
| 영역별 소유 테이블·FK 경계(약 68개) | **구현됨** (`schema.sql` DDL) |
| C 스냅샷·핑거프린트 캐시(`source_snapshot`/`input_snapshot`/`input_fingerprint`) | **구현됨** |
| `fit_analysis` 불변(append-only) + `condition_match` 정규화 | **구현됨** |
| E 첨삭 원문/결과 분리(`original_text`/`improved_text`) | **구현됨** |
| `ai_usage_log` 영역별 기록 + 성공 시 차감·멱등 | **구현됨** |
| A 전용 프로필 버전 테이블 | **없음** (정합성은 소비자 스냅샷이 담당) |
| 영역 간 데이터 계약을 코드로 강제하는 권한 레이어 | 규칙·리뷰로 운영(스키마/FK가 1차 가드, 쓰기 침범 금지는 팀 규약) |

## 6. 면접 답변 — 데이터 소유권을 한 흐름으로

::: details 모범 답안(2분 분량)
"CareerTuner는 약 68개 테이블을 6개 영역이 **수직으로 소유**합니다. 허브는 둘이에요 — 회원의 `users`, 그리고 핵심 단위인 `application_case`. 거의 모든 테이블이 이 둘로 FK가 모입니다.

규칙은 단순합니다. **각 영역은 자기 결과 테이블만 쓰고, 남의 원본은 읽기전용으로만 봅니다.** 예를 들어 적합도 분석을 하는 C는 A의 프로필과 B의 공고분석을 입력으로 읽지만, 그 원본은 한 글자도 안 고치고 결과를 자기 `fit_analysis`에 INSERT합니다.

여기서 정합성이 문제가 됩니다. 입력이 전부 남의 가변 테이블이라, 나중에 프로필이 바뀌면 과거 점수를 재현할 수 없거든요. 그래서 FK로만 묶지 않고, **분석 시점의 입력을 소비자 쪽에 스냅샷으로 동결**합니다 — `fit_analysis.source_snapshot`처럼요. 원본 소유자는 자유롭게 갱신하고, 소비자는 '그때의 사실'을 자기 행에 잠가둡니다.

같은 사상이 곳곳에 있습니다. 적합도는 불변이라 재분석마다 INSERT해서 점수 성장을 추적하고, 첨삭은 원문과 개선안을 별도 컬럼으로 둬서 원본을 절대 안 덮어씁니다. 공통 로그인 `ai_usage_log`는 스키마만 공통이고 기록은 영역별 서비스가 따로 합니다. 덕분에 '각 영역이 자기 AI를 소유'한다는 수직 분담과 '공통 스키마는 팀 합의'라는 규칙이 충돌하지 않습니다."
:::

## 7. 꼬리질문 + 모범답안

::: details "스냅샷이 정규화 원칙(원본은 참조로) 위반 아닌가요?"
의도적 위반입니다. 스냅샷은 **갱신되어야 할 현재 상태가 아니라 분석 시점의 사실**이에요. 변하면 안 되는 값을 변하는 원본에 묶어두는 게 오히려 버그입니다. 게다가 결과 행이 불변이라 사본 동기화가 깨질 여지도 없습니다.
:::

::: details "F 커뮤니티는 왜 application_case에 안 묶나요?"
후기·실제질문은 특정 지원 건에 종속되지 않는 **공용 자산**이라서요. `users`에만 FK를 두고, 추출한 면접질문(#31)을 D가 참고 데이터로 끌어다 씁니다. 지원 건에 묶으면 다른 사용자가 그 후기를 못 보겠죠.
:::

::: details "지원 건을 삭제하면 과금 기록도 사라지나요?"
아니요. `ai_usage_log.application_case_id`는 `ON DELETE SET NULL`입니다. 지원 건은 사라져도 **누가 언제 무슨 AI를 썼고 얼마를 차감했는지**는 감사·정산을 위해 남습니다. 반대로 `users`에 묶인 FK는 대부분 CASCADE라 탈퇴 시 개인 데이터가 정리됩니다.
:::

::: details "AI가 실패했는데 크레딧이 차감되면요?"
안 됩니다. 차감은 **성공 기준(success-gated)** 이고 멱등이에요. `ai_usage_log.status`가 SUCCESS일 때만 `credit_used`가 잡히고, 같은 실행에 대한 중복 차감은 막힙니다. 자세한 차감 우선순위(사용권 → 크레딧 폴백)는 [E 크레딧 시스템](/area-e/credit-system)에 있습니다.
:::

## 8. 직접 말해보기

다음을 막힘 없이 설명할 수 있으면 이 페이지를 소화한 것이다.

1. 허브 테이블 두 개와, 거의 모든 FK가 그 둘로 모이는 이유.
2. "각 영역이 소유, 남의 원본은 읽기전용"이 구체적으로 C에서 어떻게 지켜지는지.
3. 왜 FK가 아니라 스냅샷으로 정합성을 지키는지 — 그리고 스냅샷을 **소비자**가 들고 있는 이유.
4. `ai_usage_log`가 "스키마는 공통, 기록은 영역별"인 게 왜 수직 분담과 안 부딪치는지.

## 퀴즈

<QuizBox question="CareerTuner에서 영역 간 FK가 가장 많이 모이는 두 허브 테이블은?" :choices="['users와 fit_analysis', 'users와 application_case', 'application_case와 ai_usage_log', 'user_profile과 interview_session']" :answer="1" explanation="허브는 users(A, 회원의 모든 것)와 application_case(B, 핵심 단위)다. 거의 모든 결과 테이블이 user_id 또는 application_case_id FK로 이 둘에 수렴한다." />

<QuizBox question="C 적합도 분석이 6개월 전 점수의 근거를 재현할 수 있는 이유는?" :choices="['A의 user_profile_version 테이블에서 과거 버전을 읽는다', '분석 시점 입력을 fit_analysis.source_snapshot에 복사해 동결한다', '원본 user_profile을 절대 수정하지 않기 때문이다', 'job_posting을 매번 새로 분석한다']" :answer="1" explanation="런타임 스키마에 프로필 버전 테이블은 없다. 정합성은 소비자(C)가 분석 시점 입력을 source_snapshot/input_snapshot에 복사·동결하는 방식으로 지킨다. 원본은 가변이고, 동결 책임은 입력을 쓴 쪽에 있다." />

<QuizBox question="공통 로그 ai_usage_log의 소유·기록 구조로 옳은 것은?" :choices="['단일 공통 서비스가 모든 영역의 로그를 기록한다', '스키마는 공통이지만 기록기는 영역별로 따로 둔다', 'C가 모든 AI 사용을 집계해 기록한다', '각 영역이 자기만의 별도 로그 테이블을 만든다']" :answer="1" explanation="테이블 스키마는 공통(E/팀장 관리)이지만, 실제 기록은 영역별 서비스가 한다. 이래야 '각 영역이 자기 AI를 소유'하는 수직 분담과 '공통 스키마는 팀 합의'가 충돌하지 않는다." />
