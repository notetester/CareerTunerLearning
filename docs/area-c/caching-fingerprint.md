# Read-through 캐시 — fingerprint로 비용 절감

> 같은 입력이면 같은 답이다. 그러면 AI를 다시 부를 이유가 없다. `input_fingerprint = SHA-256(canonical input)`을 캐시 키로 써서, 입력이 안 바뀌면 저장된 요약을 그대로 재사용하고 토큰 비용을 0으로 만든다.

## 1. 한 줄 정의와 이 페이지가 답하는 면접 질문

영역 C의 **장기 경향(#16)** 과 **대시보드 요약(#18)** 은 LLM이 만드는 요약 텍스트다. 사용자가 홈이나 대시보드, 분석 페이지를 열 때마다 이 요약을 매번 새로 생성하면 토큰 비용이 조회 횟수만큼 나간다. 그래서 C는 **read-through 캐시**를 둔다. AI에 넘긴 입력을 정규화(canonical)해서 SHA-256 지문을 만들고, 같은 지문의 최신 성공 실행이 있으면 저장된 결과를 재사용한다.

이 페이지가 답하는 면접 질문:

- "AI 비용을 어떻게 줄였나요?"
- "왜 적합도(fit)는 분석마다 새로 만들면서 경향/대시보드는 캐시했나요?"
- "캐시 키를 무엇으로 잡았고, 왜 입력 전체가 아니라 핵심 필드만 넣었나요?"
- "캐시가 잘못된 결과를 영구히 붙드는 건 어떻게 막았나요?"

핵심 코드: `CareerAnalysisRunService.findFreshRun()`(재사용 후보 조회), `record()`(실제 실행 기록), `fingerprint()`(SHA-256). 호출부는 `AnalysisServiceImpl.buildSummary()`와 `DashboardServiceImpl.buildSummary()`.

## 2. 왜 이렇게 설계했나 — 설계 의도와 트레이드오프

### 문제: 조회마다 AI 재실행

초기 구조는 GET 조회가 들어올 때마다 요약 AI를 호출했다. 사용자는 대시보드/홈/분석 페이지를 자주 열고, 같은 데이터를 반복해서 본다. 데이터가 안 바뀌었는데도 "본질적으로 같은 답"을 생성하느라 토큰을 태웠다. 패치 파일 주석에 그 의도가 그대로 남아 있다.

> 목적: 홈/대시보드/취업 분석 GET 조회마다 요약 AI를 재실행하던 동작을 제거하고, 입력이 동일하면(=데이터 미변경) 저장된 요약을 그대로 재사용하기 위함. — `20260609_c_career_run_fingerprint.sql`

### 선택지 비교

| 대안 | 캐시 키 | 평가 |
| --- | --- | --- |
| TTL 캐시(예: 1시간) | 시간 | 데이터가 바뀌어도 TTL 동안 옛 결과. 반대로 안 바뀌어도 만료되면 재실행. 입력 변화와 무관 → 부정확 |
| userId만 키로 | 사용자 | 데이터가 바뀌어도 무효화 안 됨. 무효화 시점 판단 불가 |
| **입력 지문(채택)** | `SHA-256(canonical input)` | 입력이 바뀌면 키가 바뀌어 자동 무효화, 안 바뀌면 영구 재사용. TTL 불필요 |

지문 방식은 **TTL이 필요 없다.** "무효화 시점"을 따로 관리하지 않아도, 입력이 바뀌면 키 자체가 달라져 자연스럽게 캐시 미스가 난다. 정확성과 비용 절감을 동시에 얻는다.

### 트레이드오프 — content-addressed의 비용

- 입력을 직렬화·해시하는 CPU 비용이 매 조회마다 든다. 하지만 SHA-256 한 번은 LLM 호출 한 번에 비하면 무시할 수준이다.
- 입력에 **불안정한 필드**(매번 미세하게 흔들리는 부가 집계, 타임스탬프 등)가 섞이면 지문이 매번 달라져 캐시가 무력화된다. 이 함정을 4절·5절에서 정면으로 다룬다.

:::tip 왜 "read-through"인가
호출부는 캐시 존재를 직접 신경 쓰지 않는다. `buildSummary()`는 "결과를 달라"고만 하고, 서비스가 내부에서 "캐시에 있으면 주고 없으면 AI 실행 후 채워준다." 캐시 적중/미스 분기가 한 곳(`findFreshRun` → `record`)에 모여 호출부가 단순해진다.
:::

## 3. 어떤 기술로 구현했나 — 실제 클래스·메서드·테이블

### 코디네이터: `CareerAnalysisRunService`

장기 경향과 대시보드가 **공유**하는 캐시 코디네이터다. 적합도(fit)는 분석 단위로 별도 테이블에 쌓지만, 경향/대시보드는 "입력이 같으면 재사용"이라는 동일한 규칙을 따르므로 한 서비스로 묶었다.

| 메서드 | 역할 |
| --- | --- |
| `fingerprint(String canonical)` | canonical 문자열 → SHA-256 hex. `static` 유틸 |
| `findFreshRun(userId, analysisType, fingerprint)` | 같은 입력의 최신 성공 실행을 재사용 후보로 반환(`Optional`) |
| `record(...)` | 실제 AI 실행 결과를 `career_analysis_run` + `ai_usage_log`에 기록 |
| `listByUserId(userId)` | 실행 이력 목록(히스토리 패널용) |

### 저장 테이블: `career_analysis_run`

```sql
analysis_type     VARCHAR(40)  -- CAREER_TREND / DASHBOARD_SUMMARY
status            VARCHAR(20)  -- SUCCESS / FALLBACK / FAILED
input_snapshot    JSON         -- AI에 넘긴 입력 원본(감사용)
input_fingerprint VARCHAR(64)  -- 캐시 키(SHA-256 hex 64자)
result            JSON         -- 요약 결과(재사용 대상)
model, prompt_version, token_usage, retryable, created_at ...
KEY idx_career_analysis_run_user_type (user_id, analysis_type, created_at)
```

`input_fingerprint`는 `VARCHAR(64)`다. SHA-256 hex가 정확히 64자이기 때문이다. 인덱스 `idx_career_analysis_run_user_type`는 `findLatest`가 쓰는 `WHERE user_id=? AND analysis_type=? ORDER BY created_at DESC`를 그대로 받쳐 준다.

### SHA-256 구현

```java
public static String fingerprint(String canonical) {
    if (canonical == null) canonical = "";
    MessageDigest digest = MessageDigest.getInstance("SHA-256");
    byte[] hash = digest.digest(canonical.getBytes(StandardCharsets.UTF_8));
    // byte[] → hex 문자열(64자)
    ...
    return hexString;
}
```

`java.security.MessageDigest` 표준 JDK API만 쓴다. SHA-256은 모든 JDK에 항상 존재하므로 `NoSuchAlgorithmException`은 사실상 도달하지 않지만, 방어적으로 `hashCode()` 폴백을 둔다.

## 4. 동작 원리 — 데이터 흐름과 단계

### 전체 흐름 (장기 경향 기준)

```text
GET /api/analysis (getSummary, forceRefresh=false)
  │
  ├─ 1. 결정적 집계(25종)를 항상 새로 계산  ← 토큰 비용 0
  │
  ├─ 2. AI 입력 6개만 추려 CareerTrendAiCommand 생성
  │       (stats / skillGaps / jobReadiness / scoreHistory / interviewTrend / bestStrategy)
  │
  ├─ 3. fingerprint = SHA-256(canonical(command))
  │
  ├─ 4. findFreshRun(userId, "CAREER_TREND", fingerprint)
  │       ├─ HIT  → 저장된 result 파싱해서 반환 (AI 미실행, 무료)
  │       └─ MISS → 5단계로
  │
  └─ 5. careerTrendAiService.generate(command)   ← 실제 AI(폴백 체인)
         record(...) 로 career_analysis_run + ai_usage_log 기록
         creditUsed = (forceRefresh && SUCCESS) ? 1 : 0
```

핵심은 **2단계의 입력 축약**이다. `AnalysisServiceImpl`은 25종이 넘는 결정적 집계를 계산하지만(`strengthTrends`, `jobDistribution`, `applicationPriorities`, `weeklyChange` 등), AI에 넘기고 지문에 넣는 것은 `CareerTrendAiCommand`의 **6개 핵심 필드뿐**이다.

```java
CareerTrendAiCommand command = new CareerTrendAiCommand(
        stats, skillGaps, jobReadiness, scoreHistory, interviewTrend, bestStrategy(analyzed));
String fingerprint = CareerAnalysisRunService.fingerprint(canonical(command));
```

소스 주석이 이유를 명시한다.

> 결정적 집계는 AI 입력/캐시 fingerprint에는 포함하지 않아 기존 저장 요약이 무효화되지 않는다. — `AnalysisServiceImpl.buildSummary()`

즉 부가 집계(주별 변화, 분포 등)가 미세하게 흔들려도 지문은 안 깨진다. **흔들리는 입력을 키에서 제외**한 것이 캐시 안정성의 핵심이다.

### `findFreshRun`의 3중 거름

```java
CareerAnalysisRun latest = mapper.findLatest(userId, analysisType);
if (latest == null
        || "FAILED".equals(latest.getStatus())       // 실패는 재사용 금지
        || !fingerprint.equals(latest.getInputFingerprint())) {  // 입력 다르면 미스
    return Optional.empty();
}
return Optional.of(latest);
```

세 가지를 거른다. (1) 실행 이력이 없으면 미스, (2) **FAILED는 캐시 대상이 아니다** — 실패한 답을 영구히 붙들지 않는다, (3) 지문이 다르면(데이터 변경) 미스. `findLatest`는 `created_at DESC, id DESC LIMIT 1`이라 항상 "가장 최근 실행 1건"만 후보로 본다.

### canonical 직렬화

| 분석 | canonical 만드는 법 |
| --- | --- |
| `CAREER_TREND` | `objectMapper.writeValueAsString(command)` — 6필드 커맨드 전체 JSON |
| `DASHBOARD_SUMMARY` | `stats`/`focus`/`skillGaps`를 `\|`로 join한 짧은 문자열 |

대시보드는 입력이 작아 직접 문자열 조립한다.

```java
// DashboardServiceImpl.canonical()
String gaps = skillGaps.stream().map(g -> g.skill() + ":" + g.count()).collect(joining(","));
return String.join("|",
        String.valueOf(stats.activeApplications()),
        String.valueOf(stats.averageFitScore()),
        String.valueOf(stats.interviewsThisWeek()),
        focus.headline(), gaps);
```

여기서도 같은 원칙이다. **요약 결과를 실제로 좌우하는 값만** 키에 넣는다.

### record 시점에만 기록 — 캐시 적중은 흔적을 안 남긴다

캐시가 적중하면 `record`를 부르지 않으므로 `ai_usage_log`에 아무것도 안 쌓이고 크레딧도 안 빠진다. 실제 AI를 돌린 `record` 시점에만 사용량과 차감이 남는다. `DASHBOARD_SUMMARY`일 때는 `record`가 `dashboard_insight`까지 함께 채운다(직접 조회용 캐시 테이블).

## 5. 구현 상태 — 됨 vs 향후

| 항목 | 상태 |
| --- | --- |
| `input_fingerprint` 컬럼·인덱스·패치 | 구현됨 (`20260609_c_career_run_fingerprint.sql`) |
| `fingerprint()` SHA-256 + canonical 직렬화 | 구현됨 (경향/대시보드 각각) |
| `findFreshRun` 재사용(FAILED 제외, 지문 비교) | 구현됨 |
| `record` 기록 + `ai_usage_log` + `dashboard_insight` 동기 기록 | 구현됨 |
| 초기 로드=무료 / 명시적 refresh만 크레딧 1 | 구현됨 (`EXPLICIT_REFRESH_CREDIT=1`) |
| 핵심 6필드만 지문에 포함(부가 집계 제외) | 구현됨 |
| 현재 동작 기반 | 규칙엔진/Mock 경로의 결정론적 요약. 캐시 계약·키 산정은 실 LLM과 동일 |
| 실 LLM 토큰 절감 효과 | 키 발급 후 OpenAI/OSS 경로 활성화 시 그대로 적용 (아키텍처 완성, 연동만 향후) |

:::warning 정직하게 구분
캐시 메커니즘 자체(지문 키, read-through, FAILED 미캐시, 크레딧 분리)는 **모두 구현됨**이고 현재 Mock/규칙엔진 경로에서도 동일하게 동작한다. 다만 "토큰을 실제로 아끼는" 효과는 실 LLM이 붙어 토큰을 쓰기 시작할 때 체감된다. 면접에서는 "캐시 아키텍처는 완성, 실 LLM 연동은 키 발급 후 활성화"로 정직하게 말한다.
:::

캐시를 **안 쓰는** 쪽도 명확히 알아 두자. **적합도(fit_analysis)** 는 read-through 캐시를 쓰지 않는다. 적합도는 "이 지원 건에 대한 분석"이라 재분석할 때마다 새 행을 INSERT하고 히스토리(diff)를 남기는 게 목적이다. 같은 입력이라고 재사용하면 히스토리·감사 추적이 깨진다. 반면 경향/대시보드는 "전체 사용자 데이터의 현재 요약"이라 같은 입력이면 같은 요약이 맞다. **분석 단위가 다르면 캐시 정책도 다르다**는 게 설계의 핵심 분기다.

| 기능 | 단위 | 정책 |
| --- | --- | --- |
| 적합도 #12 (`fit_analysis`) | 지원 건 | 재분석마다 INSERT, 캐시 없음(히스토리 보존) |
| 장기 경향 #16 (`CAREER_TREND`) | 사용자 전체 | 입력 지문 캐시 |
| 대시보드 #18 (`DASHBOARD_SUMMARY`) | 사용자 전체 | 입력 지문 캐시(+`dashboard_insight`) |

## 6. 면접 답변 3단계

**초간단(15초):** "장기 경향·대시보드 요약은 AI가 만드는데, 조회마다 재실행하면 비용이 큽니다. 그래서 AI 입력을 SHA-256으로 지문 떠서 캐시 키로 쓰고, 입력이 같으면 저장된 요약을 그대로 재사용합니다."

**기본(1분):** "초기엔 GET마다 요약 AI를 돌렸습니다. 데이터가 안 바뀌었는데도 같은 답을 또 생성하는 낭비라, `career_analysis_run.input_fingerprint`라는 캐시 키를 추가했습니다. AI에 넘기는 입력을 canonical하게 직렬화해 SHA-256을 떠서 키로 쓰고, `findFreshRun`이 같은 키의 최신 성공 실행을 찾으면 그걸 반환합니다. 입력이 바뀌면 키가 달라져 자동으로 캐시 미스가 나니 TTL 관리가 필요 없습니다. 실패(FAILED)는 캐시하지 않아 잘못된 답을 영구히 붙들지 않습니다. 초기 로드는 무료고, 사용자가 명시적으로 재생성할 때만 크레딧 1을 차감합니다."

**꼬리질문 대응(심화):** "지문에는 입력 전체가 아니라 핵심 6필드(stats/skillGaps/jobReadiness/scoreHistory/interviewTrend/bestStrategy)만 넣습니다. 25종이 넘는 부가 집계는 매번 새로 계산하되 키에서 제외해, 부가 집계가 미세하게 흔들려도 캐시가 깨지지 않게 했습니다. 적합도는 의도적으로 이 캐시를 안 씁니다 — 재분석마다 히스토리를 남기는 게 목적이라 분석 단위가 다르고, 정책도 달라야 합니다."

## 7. 자주 나오는 꼬리질문 + 모범답안

**Q1. TTL 캐시 대신 입력 지문을 쓴 이유는?**
TTL은 시간 기반이라 입력 변화와 무관합니다. 데이터가 바뀌어도 TTL 동안 옛 결과를 주고, 안 바뀌어도 만료되면 재실행합니다. 입력 지문은 입력이 바뀌면 키가 달라져 자동 무효화되고, 안 바뀌면 영구 재사용합니다. "무효화 시점"을 따로 관리할 필요가 없어 정확성과 비용 절감을 동시에 얻습니다.

**Q2. 입력 전체가 아니라 핵심 6필드만 해시한 이유는?**
요약 결과를 실제로 좌우하는 값만 키에 넣어야 캐시가 안정적입니다. 주별 변화나 분포 같은 부가 집계는 미세하게 흔들릴 수 있는데, 이게 키에 섞이면 지문이 매번 달라져 캐시가 무력화됩니다. AI 입력 자체를 6필드로 한정했기 때문에 그 입력만 해시하면 자연히 흔들리는 값이 빠집니다.

**Q3. FAILED를 캐시하지 않으면, 실패가 반복될 때 매번 AI를 또 부르지 않나?**
맞습니다. 그게 의도입니다. 실패한 답을 재사용하면 사용자는 영영 깨진 결과를 보게 됩니다. `findFreshRun`이 FAILED를 캐시 미스로 처리하므로, 다음 조회에서 다시 시도해 복구 기회를 줍니다. 다만 C는 3단 폴백 체인이 있어 최종 Mock(규칙엔진)이 항상 성공하므로, 실무에서 FAILED가 캐시 후보로 남는 경우는 드뭅니다.

**Q4. 같은 지문의 실행이 여러 건이면 어느 걸 쓰나?**
`findLatest`가 `ORDER BY created_at DESC, id DESC LIMIT 1`로 가장 최근 1건만 봅니다. 그 한 건의 status와 fingerprint를 검사해 재사용 여부를 정합니다. 과거 실행을 다 비교하지 않고 "최신 실행이 지금 입력과 같은가"만 보는 단순한 규칙입니다.

**Q5. 캐시 적중이면 사용량 로그나 크레딧은?**
적중하면 `record`를 호출하지 않습니다. `ai_usage_log`에 아무것도 안 쌓이고 크레딧도 안 빠집니다. 실제 AI를 실행한 `record` 시점에만 사용량과 차감을 남깁니다. 그리고 초기 로드(`forceRefresh=false`)는 크레딧 0, 사용자가 명시적으로 재생성한 경우에만 `EXPLICIT_REFRESH_CREDIT=1`을 차감합니다.

**Q6. 적합도는 왜 같은 캐시를 안 쓰나?**
분석 단위가 다릅니다. 적합도는 "이 지원 건에 대한 분석"이라 재분석마다 새 행을 INSERT하고 히스토리(점수 diff, 해소된/새 갭)를 남기는 게 목적입니다. 같은 입력이라고 재사용하면 그 히스토리·감사 추적이 깨집니다. 반대로 경향/대시보드는 "사용자 전체 데이터의 현재 요약"이라 같은 입력이면 같은 요약이 맞아 캐시가 자연스럽습니다.

## 8. 직접 말해보기

다음을 막힘없이 설명할 수 있으면 이 페이지는 충분히 소화한 것이다.

1. 입력 지문 캐시가 TTL 캐시보다 정확한 이유를 한 문장으로.
2. `CareerTrendAiCommand`의 6개 필드를 외워서 말하고, 왜 부가 집계는 지문에서 뺐는지.
3. `findFreshRun`이 캐시 미스를 내는 3가지 조건.
4. 캐시 적중과 명시적 재생성이 `ai_usage_log`·크레딧에 남기는 흔적의 차이.
5. 적합도(`fit_analysis`)가 이 캐시를 안 쓰는 이유를 "분석 단위" 관점으로.

연관 페이지: [폴백 체인](/area-c/fallback-chain) · [구조화 출력](/area-c/structured-output) · [데이터 모델](/area-c/data-model) · [대시보드 인사이트](/area-c/dashboard-insight) · [장기 경향](/area-c/career-trend)

## 퀴즈

<QuizBox question="career_analysis_run.input_fingerprint 캐시 키는 무엇으로 만드는가?" :choices="['현재 시각 기반 TTL 토큰', 'userId만 SHA-256 해시', 'AI에 넘긴 canonical 입력의 SHA-256 hex', '결정적 집계 25종 전체의 해시']" :answer="2" explanation="AI 입력(경향은 6필드 커맨드, 대시보드는 핵심 값 join)을 canonical하게 직렬화한 뒤 SHA-256 hex(64자)로 만든다. 부가 집계 25종은 지문에 포함하지 않아 흔들려도 캐시가 깨지지 않는다." />

<QuizBox question="findFreshRun이 캐시 미스(빈 Optional)를 반환하지 않는 경우는?" :choices="['최신 실행이 FAILED일 때', '입력 지문이 저장된 fingerprint와 다를 때', '같은 입력 지문의 최신 SUCCESS/FALLBACK 실행이 있을 때', '해당 사용자의 실행 이력이 아예 없을 때']" :answer="2" explanation="FAILED는 재사용하지 않고, 지문이 다르거나 이력이 없으면 미스다. 같은 지문의 최신 성공/폴백 실행이 있을 때만 그 결과를 재사용 후보로 반환한다." />

<QuizBox question="초기 로드(forceRefresh=false)와 명시적 재생성(refresh)의 크레딧 처리 차이는?" :choices="['둘 다 항상 크레딧 1 차감', '초기 로드는 캐시 적중 시 0, 명시적 재생성은 성공 시 EXPLICIT_REFRESH_CREDIT=1 차감', '초기 로드만 크레딧 차감, 재생성은 무료', '캐시 적중이어도 매번 1 차감']" :answer="1" explanation="캐시 적중이면 record를 부르지 않아 사용량 로그·크레딧이 남지 않는다. 명시적 재생성은 항상 AI를 실행하고, status가 SUCCESS면 EXPLICIT_REFRESH_CREDIT=1을 ai_usage_log에 차감으로 남긴다." />
