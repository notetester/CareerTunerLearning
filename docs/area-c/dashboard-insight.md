# 대시보드 AI 요약 & 홈

> 흩어진 분석 결과를 "지금 무엇을 할지" 한 문단 + "이번 주 할 일" 한 묶음으로 압축한다. 비용 드는 요약은 캐시하고, 홈은 대시보드를 그대로 재투영한다.

## 1. 한 줄 정의 · 이 페이지가 답하는 면접 질문

대시보드 요약(AI #18)은 **여러 지원 건에 흩어진 적합도·부족 역량·진행 현황을 하나의 한국어 문단과 "오늘의 할 일" 목록으로 압축**하는 기능이다. 적합도(#12)·장기경향(#16)이 "개별 판단"이라면, 대시보드는 그 결과들을 **사용자가 다음에 손가락 하나 까딱할 행동으로 번역**하는 마지막 단계다.

이 페이지가 답하는 면접 질문:

- "매번 화면 들어올 때마다 AI를 다시 호출하면 비용이 폭발하지 않나요? 어떻게 막았나요?"
- "AI가 만든 요약과 사용자가 직접 추가한 할 일을 어떻게 한 목록에서 충돌 없이 합치나요?"
- "홈이랑 대시보드가 거의 똑같던데, 두 번 만든 건가요? 왜 그렇게 했나요?"
- "AI 요약 캐시 키는 무엇으로 만드나요? 입력의 어떤 부분이 바뀌어야 다시 생성되나요?"

:::tip 핵심 한 문장
"긴 취업 여정을, 매번 돈 들이지 않고, **이번 주에 손댈 4~6개 행동**으로 줄여 보여주는 것"이 대시보드의 존재 이유다.
:::

## 2. 왜 이렇게 설계했나 (설계 의도 · 대안과 트레이드오프)

### 문제: 분석은 많은데 "그래서 뭐 하지?"가 없다

영역 C는 적합도·부족역량·학습로드맵·장기경향까지 풍부한 결과를 만든다. 하지만 사용자는 그걸 한 번에 다 읽지 않는다. 홈/대시보드에서 필요한 건 **"오늘 한 문단 + 이번 주 몇 개"** 다. 그래서 대시보드는 새 분석을 만드는 게 아니라, **이미 있는 결정적 집계를 재료로 요약·할 일을 파생**한다.

### 결정 1: 비용 드는 것만 AI, 나머지는 매번 결정적 집계

| 구성 요소 | 생성 방식 | 비용 | 캐시? |
| --- | --- | --- | --- |
| 통계/준비도/상태별 건수/스킬갭/최근변화 | 결정적 집계 (`stats()`, `readiness()`, `skillGaps()` …) | 0 토큰 | 안 함, 매 조회 재계산 |
| 한 문단 요약 (`summary`) | AI #18 (`DashboardInsightAiService`) | 토큰 | **함** (`career_analysis_run`) |
| 오늘의 할 일 | 결정적 파생 (`todos()`) + 사용자 추가 | 0 토큰 | 사용자 오버라이드만 DB |

> 핵심: `DashboardServiceImpl.buildSummary()` 주석 그대로 — "결정적 집계는 항상 새로 계산하고(토큰 비용 없음), 비용이 드는 대시보드 AI 요약(18)만 캐시한다."

**대안과 트레이드오프**: 전부 AI로 한 문단에 우겨넣을 수도 있었다. 그러면 숫자(평균 적합도 등)까지 LLM이 만들어 환각·불일치 위험이 생긴다. 우리는 숫자는 결정적으로 확정하고 LLM에는 **"이미 확정된 숫자를 자연스러운 문장으로 엮는 일"만** 시킨다. 이게 영역 C의 뉴로-심볼릭 철학([뉴로-심볼릭 설계](/area-c/neuro-symbolic))과 동일하다.

### 결정 2: 초기 로드는 무료, 명시적 재생성만 과금

`getSummary()`(GET)는 캐시 히트 시 AI를 안 돌린다 → 사용자가 화면을 여닫아도 크레딧이 닳지 않는다. `refreshSummary()`(POST `/summary/refresh`)는 사용자가 "재생성" 버튼을 눌렀을 때만 AI 강제 실행 + 크레딧 1 차감. **"읽기는 공짜, 새로고침만 유료"** 라는 직관적 과금 UX다.

### 결정 3: 자동 파생 할 일 + 사용자 추가 할 일 = 혼합 모델

할 일을 100% 자동 파생으로만 두면 사용자가 "내 메모"를 못 남기고, 100% 수동이면 시스템이 다음 행동을 제안하지 못한다. 그래서 **두 종류를 한 목록에 합쳐** 자동 제안의 가치와 개인화를 둘 다 얻는다. 충돌은 `derived_key`로 해결한다(아래 4절).

### 결정 4: 홈 = 대시보드의 재투영

홈(`/`)과 대시보드(`/dashboard`)는 거의 같은 데이터를 본다. **별도 매퍼·별도 AI를 만들지 않고** 홈은 `getSummary()` 결과를 그대로 재사용한다. 유지보수 지점이 하나로 줄고, "홈 따로 / 대시보드 따로" 식의 데이터 불일치가 원천 차단된다.

## 3. 어떤 기술로 구현했나 (실제 클래스 · 메서드 · 테이블 근거)

```text
DashboardController                      // /api/dashboard/** REST 진입점
  └─ DashboardService (impl)
       ├─ DashboardMapper               // 결정적 집계 SQL (MyBatis XML)
       ├─ DashboardInsightAiService     // AI #18 한 문단 요약 (인터페이스)
       │    ├─ MockDashboardInsightAiService     // 집계 기반 결정적 요약 (현재 활성)
       │    └─ OpenAiDashboardInsightAiService    // @Primary, 키 있으면 실 LLM, 없으면 mock 위임
       └─ CareerAnalysisRunService      // read-through 캐시 코디네이터 (장기경향과 공유)
```

| 책임 | 클래스 / 메서드 |
| --- | --- |
| AI 입력 묶음 | `DashboardInsightAiCommand(stats, focus, skillGaps)` (record) |
| AI 출력 | `DashboardInsightAiResult(summary, usage, status, errorMessage, retryable)` |
| 요약 진입점 | `DashboardInsightAiService.summarize(command)` |
| 캐시 조회/기록 | `CareerAnalysisRunService.findFreshRun()` / `record()` |
| 핑거프린트 | `CareerAnalysisRunService.fingerprint(canonical)` = SHA-256 hex |
| 캐시 키 재료 | `DashboardServiceImpl.canonical(stats, focus, skillGaps)` |
| 할 일 파생 | `DashboardServiceImpl.todos()` / 합치기 `mergedTodos()` |
| 프롬프트 카탈로그 | `DashboardInsightPromptCatalog` (VERSION `v0.2`) |

**소유 테이블** (전부 C 소유):

| 테이블 | 역할 | 핵심 컬럼 |
| --- | --- | --- |
| `career_analysis_run` | 요약 AI 실행 이력 + 캐시 | `analysis_type='DASHBOARD_SUMMARY'`, `input_fingerprint`, `result(JSON)`, `status`, `model`, `prompt_version` |
| `dashboard_insight` | 요약 직접 조회용 (감사/관리자) | `summary(MEDIUMTEXT)`, `status`, `model`, `token_usage`, FK `career_analysis_run_id` |
| `dashboard_todo` | 할 일 (혼합) | `derived_key(NULL이면 사용자 추가)`, `task`, `time_label`, `done`, **UNIQUE(user_id, derived_key)** |

:::tip 왜 테이블이 두 개(`career_analysis_run` + `dashboard_insight`)인가
`career_analysis_run`은 장기경향(#16)과 **공유하는 범용 실행 로그**라 컬럼이 일반적이다(JSON `result` 안에 `summary` 묻힘). 대시보드 화면/관리자가 요약 텍스트를 빠르게 읽으려고 매번 JSON을 파싱하는 건 비효율이라, 요약만 평탄화해 **직접 조회용** `dashboard_insight`에 한 번 더 기록한다(`record()` 안에서 `analysisType == DASHBOARD_SUMMARY`일 때만).
:::

## 4. 동작 원리 (데이터 흐름 · 단계 · 표/작은 코드)

### 4-1. `getSummary` 전체 흐름

```text
GET /api/dashboard/summary
  │
  ├─ 1. 결정적 집계 (항상 실행, 토큰 0)
  │      stats / focus / skillGaps / readiness / statusCounts / recentChange ...
  │
  ├─ 2. AI 입력 묶기  DashboardInsightAiCommand(stats, focus, skillGaps)
  │
  ├─ 3. 캐시 키 만들기  fingerprint = SHA-256( canonical(stats, focus, skillGaps) )
  │
  ├─ 4. findFreshRun(userId, "DASHBOARD_SUMMARY", fingerprint)
  │       ├─ 히트(같은 fingerprint & status != FAILED) → 저장 result.summary 재사용 (AI 미실행)
  │       └─ 미스 → summarize() 1회 실행 → record()로 run + dashboard_insight + ai_usage_log 기록
  │
  └─ 5. mergedTodos() 로 할 일 합쳐서 DashboardSummaryResponse 반환
```

### 4-2. 캐시 키(핑거프린트)에 **무엇을 넣고 무엇을 뺐나**

요약 문구를 실제로 좌우하는 안정 필드만 넣는다. 흔들리는 부가 값은 일부러 뺀다:

```java
// DashboardServiceImpl.canonical() (요지)
String.join("|",
    stats.activeApplications(),     // 진행 중 지원 건 수
    stats.averageFitScore(),        // 평균 적합도
    stats.interviewsThisWeek(),     // 이번 주 면접 수
    focus.headline(),               // 가장 점수 높은 지원 건 헤드라인
    gaps);                          // "스킬:횟수,스킬:횟수,..."
```

:::warning 왜 크레딧 잔액·이번 달 사용량을 캐시 키에서 뺐나
크레딧 잔액은 결제하면 계속 변한다. 만약 그걸 핑거프린트에 넣으면 **요약 내용이 똑같은데도** 키가 달라져 매번 AI가 재실행된다 → 불필요한 토큰 낭비. 그래서 "요약 문장을 실제로 바꾸는 값"만 키에 넣고, `stats`에 같이 담긴 크레딧 관련 값은 제외했다. 이게 핑거프린트 설계에서 가장 자주 받는 꼬리질문이다.
:::

### 4-3. 캐시 판정 규칙 (`findFreshRun`)

| 최신 run 상태 | 핑거프린트 | 결과 |
| --- | --- | --- |
| 없음 | — | 미스 → 새로 생성 |
| `FAILED` | 같음 | **미스** (실패는 재사용 안 함) |
| `SUCCESS`/`FALLBACK` | 다름(입력 변함) | 미스 → 1회 자동 재생성 |
| `SUCCESS`/`FALLBACK` | 같음 | **히트** → AI 미실행, 저장 요약 재사용 |

### 4-4. 할 일 혼합 (`derived_key` 충돌 해결)

자동 파생 할 일은 매 조회마다 새로 계산되므로 **DB에 "완료했다"를 어떻게 기억하느냐**가 핵심이다. 답: 안정 키 `derived_key`.

```text
파생 할 일 예시 derived_key:
  register-application / review-fit-analysis
  gap-learning:<스킬명>            (가장 부족한 역량 1개)
  interview-practice:<caseId>
  final-review:<caseId> / high-fit-target ...

merge 규칙 (mergedTodos):
  자동 파생 항목 done = (계산값 done) OR (dashboard_todo 오버라이드 done)
  사용자 추가 항목(derived_key = NULL)은 그대로 뒤에 붙임
```

- 사용자가 파생 할 일을 체크하면 → `PATCH /todos/derived` → `upsertDerivedTodo`가 **UNIQUE(user_id, derived_key)** 기준 `ON DUPLICATE KEY UPDATE`로 완료 오버라이드를 1행만 유지.
- 문구를 나중에 바꿔도(`"%s 보완 학습 시작"`) **키는 그대로**라 이전 완료 표시가 끊기지 않는다. → 이게 "문구는 표시용, 키는 매칭용" 분리의 이유.
- 사용자가 직접 추가/삭제하는 SQL에는 `AND derived_key IS NULL` 조건이 붙어 **파생 항목을 사용자가 지우는 사고를 차단**한다.

### 4-5. 홈 = 대시보드 재투영

`HomePage`의 로그인 사용자 화면(`MemberHome`)은 `getDashboardSummary()`를 그대로 호출한다. 준비도·스킬갭·할 일·AI 요약 모두 같은 `DashboardSummary`에서 뽑아 쓴다. "재생성" 버튼도 동일하게 `refreshDashboardSummary()`를 호출한다. 홈 전용 엔드포인트(`/home/summary`)는 **자리만 잡아둔 미래 전환점**이고, 현재 홈은 별도 매퍼 없이 대시보드를 경량 가공한다.

## 5. 구현 상태 (됨 vs 향후) 정직 구분

| 항목 | 상태 |
| --- | --- |
| 결정적 집계(통계·준비도·스킬갭·상태별·최근변화) | **구현됨**, 매 조회 재계산 |
| 한 문단 요약 — `MockDashboardInsightAiService`(집계 기반 결정적) | **구현됨**, 현재 활성 동작 |
| read-through 캐시(`findFreshRun`/`record`) + SHA-256 핑거프린트 | **구현됨** |
| `career_analysis_run` + `dashboard_insight` 이중 기록 + `ai_usage_log` | **구현됨** |
| 명시적 재생성(POST) 시 크레딧 1 차감 | **구현됨** |
| 할 일 혼합(파생 + 사용자) · `upsert` 오버라이드 · UNIQUE 키 | **구현됨** |
| 홈 = 대시보드 재투영, `TodoChecklist`, AI 결과 배지 | **구현됨** |
| `OpenAiDashboardInsightAiService`(`@Primary`) + `DashboardInsightPromptCatalog` json_schema strict | **배선·코드 구현됨** |
| 실제 OpenAI 키 연동(`openAiClient.configured()==true` 경로) | **향후 과제** (키 발급 시 자동 활성) |

:::tip 면접에서의 정직한 한 줄
"아키텍처는 완성됐고, 지금은 결정적 mock 요약으로 화면·계약·캐시를 검증 중입니다. 키만 발급되면 `@Primary` 구현체가 실 LLM 경로를 타고, 실패 시 mock으로 폴백하도록 이미 배선돼 있습니다."
:::

`OpenAiDashboardInsightAiService.summarize()`는 키가 없으면 `mockService.summarize()`로 위임하고, 실 호출 중 예외가 나면 mock 결과를 `status=FALLBACK`으로 감싸 반환한다 → **어느 경로든 홈/대시보드가 깨지지 않는다.**

## 6. 면접 답변 3단계 (초간단 / 기본 / 꼬리질문 대응)

**초간단(15초)**
"대시보드 요약은 흩어진 분석을 한 문단과 '이번 주 할 일'로 압축합니다. 숫자는 결정적으로 확정하고 AI는 문장만 만들며, 그 요약만 핑거프린트로 캐시해 매 조회마다 재실행하지 않습니다."

**기본(45초)**
"`getSummary`는 통계·준비도·스킬갭 같은 결정적 집계를 항상 새로 계산하지만, 비용이 드는 한 문단 요약(AI #18)만 캐시합니다. 입력 핵심 6개를 정규화해 SHA-256 핑거프린트를 만들고, 같은 핑거프린트의 성공 실행이 있으면 저장 요약을 재사용합니다. 입력이 바뀌면 1회 자동 재생성, 사용자가 명시적으로 재생성 버튼을 누르면 크레딧 1을 차감합니다. 할 일은 자동 파생 항목과 사용자 추가 항목을 `derived_key`로 합쳐 충돌 없이 한 목록으로 보여줍니다."

**꼬리질문 대응 포인트**
- 비용 → "초기 로드는 캐시라 무료, 명시적 새로고침만 과금."
- 일관성 → "숫자는 LLM이 안 만든다. 결정적 집계가 확정, LLM은 문장만."
- 안정성 → "키 없거나 호출 실패해도 mock 폴백 + FALLBACK 상태로 화면 유지."

## 7. 자주 나오는 꼬리질문 + 모범답안

**Q1. 핑거프린트에 입력 6개만 넣었다는데, 왜 전부 안 넣었나요?**
요약 문장을 실제로 좌우하는 안정 필드만 넣었습니다. 크레딧 잔액·이번 달 사용량은 결제로 계속 바뀌지만 요약 내용과 무관합니다. 그것까지 키에 넣으면 같은 요약인데도 키가 달라져 매번 AI가 재실행돼 토큰을 낭비합니다. 그래서 `activeApplications`, `averageFitScore`, `interviewsThisWeek`, `focus.headline`, 스킬갭만 정규화해 키를 만듭니다.

**Q2. `career_analysis_run`에 이미 요약이 있는데 `dashboard_insight`를 또 만든 이유는?**
`career_analysis_run`은 장기경향과 공유하는 범용 실행 로그라 요약이 JSON `result` 안에 묻혀 있습니다. 대시보드 화면·관리자가 요약 텍스트만 빠르게 읽으려고 매번 JSON을 파싱하는 건 비효율이라, 요약·상태·모델·토큰만 평탄화한 직접 조회용 테이블을 하나 더 둡니다. FK는 `ON DELETE SET NULL`이라 원본 run이 지워져도 요약 행은 남습니다.

**Q3. 파생 할 일 문구를 바꾸면 사용자가 전에 체크한 게 풀리지 않나요?**
안 풀립니다. 매칭은 문구가 아니라 `derived_key`로 합니다(`gap-learning:React` 같은 안정 키). 표시 문구는 화면용, 키는 매칭용으로 분리했고, 완료 오버라이드는 `UNIQUE(user_id, derived_key)` + `ON DUPLICATE KEY UPDATE`로 1행만 유지합니다.

**Q4. AI 요약 생성이 실패하면 대시보드가 통째로 깨지나요?**
아니요. 키가 없으면 mock 요약으로 위임하고, 실 호출 중 예외가 나면 mock 결과를 `status=FALLBACK`으로 감싸 반환합니다. 그리고 `findFreshRun`은 `FAILED` 실행을 캐시 히트로 인정하지 않아 실패가 굳지 않습니다. 알림(F 소유) 같은 외부 조회도 실패 시 빈 목록으로 강등해 C 대시보드 전체가 살아남습니다.

**Q5. 홈과 대시보드를 따로 안 만든 게 기술 부채 아닌가요?**
오히려 의도된 단일 출처(single source) 설계입니다. 홈은 `getDashboardSummary()`를 재투영해 매퍼·AI를 중복하지 않습니다. 데이터 불일치가 원천 차단되고, 나중에 홈 전용 표현이 필요하면 자리만 잡아둔 `/home/summary`로 전환할 수 있게 인터페이스를 열어뒀습니다.

**Q6. 명시적 재생성과 자동 재생성은 어떻게 다르나요?**
입력(핑거프린트)이 바뀌면 GET 중에도 1회 자동 재생성하지만 이때 `creditUsed=0`입니다. 사용자가 재생성 버튼을 눌러 POST `/summary/refresh`를 호출하면 캐시를 건너뛰고 강제 실행하며, 성공 시에만 `creditUsed=1`로 `ai_usage_log`에 차감을 남깁니다. "데이터가 바뀌어 자동 갱신"과 "사용자가 돈 내고 새로고침"을 분리했습니다.

## 8. 직접 말해보기

다음을 보지 않고 소리 내어 설명해 보라.

1. `getSummary` 한 번에서 토큰이 드는 부분과 안 드는 부분을 나눠 말하기.
2. 핑거프린트에 넣은 6개와 일부러 뺀 값, 그리고 뺀 이유.
3. `findFreshRun`의 캐시 히트/미스 판정 3가지 조건.
4. 파생 할 일이 "완료됨"을 기억하는 메커니즘(`derived_key` + UNIQUE + upsert).
5. 키 발급 후 실 LLM이 어떻게 켜지고, 실패하면 무엇으로 폴백하는지.

연관 읽기: [뉴로-심볼릭 설계](/area-c/neuro-symbolic) · [캐싱·핑거프린트](/area-c/caching-fingerprint) · [장기 취업경향](/area-c/career-trend) · [폴백 체인](/area-c/fallback-chain) · [구조화 출력](/ai/openai-structured-output)

## 퀴즈

<QuizBox question="대시보드 요약에서 '결정적 집계'와 'AI 요약' 중, 캐시(career_analysis_run) 대상은 무엇인가?" :choices="['평균 적합도 같은 결정적 집계만', '한 문단 AI 요약만', '둘 다 캐시한다', '둘 다 캐시하지 않는다']" :answer="1" explanation="비용(토큰)이 드는 한 문단 AI 요약만 캐시한다. 통계·준비도·스킬갭 같은 결정적 집계는 비용이 0이라 매 조회마다 새로 계산한다." />

<QuizBox question="핑거프린트(캐시 키)에서 '크레딧 잔액·이번 달 사용량'을 일부러 제외한 이유로 가장 적절한 것은?" :choices="['보안상 민감 정보라서', '요약 내용과 무관한데 자주 바뀌어, 넣으면 동일 요약도 매번 AI 재실행되기 때문', 'JSON 직렬화가 안 되기 때문', 'SHA-256 입력 길이 제한 때문']" :answer="1" explanation="크레딧 값은 요약 문장을 바꾸지 않으면서 결제로 계속 변한다. 키에 넣으면 같은 요약인데도 키가 달라져 불필요한 토큰 재실행을 유발하므로 제외한다." />

<QuizBox question="자동 파생 할 일의 완료 상태를 DB에 안정적으로 기억시키는 핵심 컬럼/제약은?" :choices="['task 문구를 PK로 사용', 'derived_key + UNIQUE(user_id, derived_key) 기준 upsert', 'created_at 타임스탬프 비교', 'id 자동 증가값']" :answer="1" explanation="파생 할 일은 매 조회마다 새로 계산되므로, 문구가 아니라 안정 키 derived_key로 매칭한다. UNIQUE(user_id, derived_key) + ON DUPLICATE KEY UPDATE로 완료 오버라이드를 1행만 유지한다." />
