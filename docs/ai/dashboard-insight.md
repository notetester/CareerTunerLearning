# 대시보드 AI 요약 [영역 C·구현됨]

> 적합도·지원 현황·부족 역량 같은 결정적 집계를 LLM에 넘겨 홈 화면 상단에 보여줄 "한 문단 요약"을 만들고, 입력이 안 바뀌면 캐시를 재사용해 토큰 비용을 0으로 만드는 기능입니다.

## 1. 한 줄 정의

흩어진 대시보드 지표(진행 중 지원 건 수, 평균 적합도, 우선 보완 역량, 다음 할 일)를 하나로 묶어 LLM에 보내고, 사람이 바로 읽는 자연어 요약 한 문단을 돌려받는 AI 기능입니다. 입력이 동일하면 LLM을 다시 호출하지 않고 저장된 요약을 그대로 씁니다.

## 2. 단어 뜻

| 용어 | 풀이 |
| --- | --- |
| Insight | "통찰". 여러 숫자를 보고 "그래서 지금 뭘 해야 하나"를 한 줄로 정리한 것 |
| Summary | LLM이 생성하는 최종 산출물. 2~3문장 한국어 한 문단 |
| Command | 입력 묶음(`DashboardInsightAiCommand`). LLM에 넣을 집계 데이터의 컨테이너 |
| Fingerprint | 입력 집계를 정규화(canonical)해 만든 지문 해시. 캐시 키 역할 |
| Structured Output | LLM 응답을 자유 텍스트가 아니라 정해진 JSON 스키마로 강제하는 방식 |
| Fallback | LLM 실패·미설정 시 대신 동작하는 안전망(여기선 Mock 규칙엔진) |

## 3. 왜 필요한가 (없으면 무슨 문제가 생기나)

대시보드에는 적합도, 지원 상태, 부족 역량, 모의면접 횟수가 따로따로 카드로 흩어져 있습니다. 사용자는 이 숫자들을 스스로 해석해야 하죠. AI 요약이 없으면:

- **인지 부하**: 카드 6~7개를 눈으로 종합해 "오늘 뭘 해야 하지"를 사용자가 직접 판단해야 함
- **방향 상실**: 데이터가 거의 없는 신규 사용자는 "다음에 뭘 할지" 안내가 없으면 이탈
- **비용 폭탄**: 반대로 요약을 "단순히 매번 LLM 호출"로 만들면, 대시보드를 열 때마다 토큰을 태움. 같은 데이터인데도 화면 새로고침마다 돈이 나감

이 기능은 두 가지를 동시에 해결합니다 — 흩어진 지표를 한 문단으로 정리(UX)하면서, **입력이 바뀌었을 때만** LLM을 부르는 캐싱(비용)을 적용합니다.

## 4. CareerTuner에서 어디에 썼나 (영역 C)

전부 `backend/src/main/java/com/careertuner/dashboard/ai` 아래에 있고, C가 소유합니다.

| 구성요소 | 클래스/파일 | 역할 |
| --- | --- | --- |
| 입력 묶음 | `DashboardInsightAiCommand` (record) | `DashboardStatsResponse` + `DashboardFocusResponse` + `List<DashboardSkillGapResponse>` 를 한 묶음으로 |
| 결과 | `DashboardInsightAiResult` (record) | summary, usage, status, errorMessage, retryable |
| 인터페이스 | `DashboardInsightAiService` | 진입점. 호출부는 구현체가 아니라 이 인터페이스에만 의존 |
| 실 구현 | `OpenAiDashboardInsightAiService` (`@Primary`) | OpenAI 우선, 실패 시 Mock 폴백 |
| 폴백 구현 | `MockDashboardInsightAiService` | 집계만으로 결정적 요약 생성(키 미발급 단계 기본) |
| 프롬프트 | `ai/prompt/DashboardInsightPromptCatalog` | `SYSTEM_PROMPT` + `userPrompt()`, `VERSION = v0.2` |
| 호출/캐싱 | `service/DashboardServiceImpl#buildSummary` | fingerprint로 캐시 조회 → 없으면 1회 생성 |
| 노출 API | `DashboardController` `GET /api/dashboard/summary`, `POST /api/dashboard/summary/refresh` | 조회 vs 강제 재생성 |

저장은 `career_analysis_run` 테이블을 공용으로 씁니다(C의 장기 경향 분석과 같은 저장소). `CareerAnalysisRunService.findFreshRun(...)` 로 같은 fingerprint의 신선한 run을 찾고, 없으면 `record(...)` 로 새 run을 적재합니다.

:::tip 영역 경계
요약에 들어가는 적합도 점수(`averageFitScore`)는 같은 C 영역의 적합도 분석(`fit_analysis`, [적합도 분석](/ai/fit-analysis) 참고)에서 나온 결과를 집계한 값입니다. 대시보드 AI는 이 집계를 "해석"만 할 뿐, 점수를 직접 만들지 않습니다.
:::

## 5. 핵심 동작 원리

### 흐름 한눈에

```text
GET /api/dashboard/summary
  └─ buildSummary(userId, forceRefresh=false)
       1. 결정적 집계 계산 (stats/focus/skillGaps)  ← 토큰 비용 0, 항상 새로
       2. command = DashboardInsightAiCommand(...)
       3. fingerprint = fingerprint(canonical(...))
       4. cache = findFreshRun(userId, type, fingerprint)
          ├─ 있으면  → 저장된 summary 재사용 (LLM 미실행)
          └─ 없으면  → dashboardInsightAiService.summarize(command)
                        → record(...)  로 career_analysis_run 적재
```

### 캐싱 규칙 (비용의 핵심)

`DashboardServiceImpl` 주석에 그대로 적혀 있습니다 — **결정적 집계는 항상 새로 계산(공짜)하고, 비용이 드는 AI 요약만 캐시**합니다.

| 진입점 | forceRefresh | 동작 | 크레딧 |
| --- | --- | --- | --- |
| `GET /summary` | false | 같은 fingerprint면 캐시 재사용, 입력 바뀌면 1회 자동 재생성 | 0 |
| `POST /summary/refresh` | true | 캐시 무시, 무조건 LLM 재실행 | `EXPLICIT_REFRESH_CREDIT` (SUCCESS일 때만) |

즉 사용자가 대시보드를 100번 새로고침해도 입력 지표가 같으면 LLM은 0번 호출됩니다. 명시적 "다시 분석" 버튼을 눌렀을 때만 크레딧을 차감합니다.

### 폴백 사슬 (안정성의 핵심)

`OpenAiDashboardInsightAiService.summarize()` 는 두 단계 방어선을 둡니다:

```java
if (!openAiClient.configured()) {
    return mockService.summarize(command);   // ① 키 미설정 → Mock
}
try {
    StructuredResponse response = openAiClient.request(
        "dashboard_insight", schema(),
        DashboardInsightPromptCatalog.SYSTEM_PROMPT,
        DashboardInsightPromptCatalog.userPrompt(json(command)));
    return new DashboardInsightAiResult(text(...), usage, "SUCCESS", null, false);
} catch (RuntimeException e) {
    DashboardInsightAiResult fallback = mockService.summarize(command); // ② 호출 실패 → Mock
    return new DashboardInsightAiResult(fallback.summary(),
        new CareerAnalysisAiUsage("mock-fallback", 0, 0, 0, true),
        "FALLBACK", e.getMessage(), true);  // retryable=true
}
```

`status` 필드로 결과 출처를 구분합니다: `SUCCESS`(실 LLM), `FALLBACK`(LLM 실패→Mock). FALLBACK은 `retryable=true` 로 표시해, 사용자가 다시 시도할 수 있음을 알립니다.

### Structured Output 스키마

자유 텍스트가 아니라 `{"type":"object", "properties":{"summary":{"type":"string"}}, "required":["summary"], "additionalProperties":false}` 스키마를 OpenAI에 강제로 넘깁니다. 덕분에 응답 파싱이 깨지지 않고 `payload.path("summary")` 로 안전하게 꺼냅니다.

### Mock 구현이 하는 일

`MockDashboardInsightAiService` 는 LLM 없이 if/StringBuilder로 같은 모양의 요약을 만듭니다. 지원 건이 0이면 "첫 지원 건을 등록하세요" 온보딩 문구, 있으면 "진행 중 N개, 평균 적합도 M점, 우선 보완 X, 이번 주 모의면접..." 식으로 조립합니다. **결정적**이라 테스트와 화면 검증에 그대로 쓰입니다.

## 6. 면접 답변 3단계

**초간단 (1문장):** 대시보드의 흩어진 지표를 LLM이 한 문단으로 요약해주고, 입력이 안 바뀌면 캐시를 써서 토큰 비용을 0으로 만드는 기능입니다.

**기본 (3~4문장):** 적합도·지원 현황·부족 역량 집계를 `DashboardInsightAiCommand` 로 묶어 OpenAI에 Structured Output으로 보내고, JSON 스키마로 강제된 한 문단 요약을 받습니다. 비용을 막으려고 입력 집계를 정규화한 fingerprint를 캐시 키로 써서, 같은 입력이면 `career_analysis_run` 에 저장된 요약을 재사용하고 LLM을 부르지 않습니다. 키 미설정이나 호출 실패에 대비해 Mock 규칙엔진으로 폴백하고, 결과의 status로 SUCCESS/FALLBACK을 구분합니다.

**꼬리질문 대응:** 결정적 집계(점수 계산)와 비결정적 요약(LLM)을 분리한 게 설계 포인트입니다. 집계는 매번 공짜로 새로 계산하지만 LLM 요약만 캐시하므로, 대시보드를 아무리 새로고침해도 데이터가 같으면 비용이 0이고, "다시 분석" 버튼을 눌렀을 때만 크레딧을 차감합니다.

## 7. 자주 나오는 꼬리질문 + 모범답안

:::details Q1. 매번 LLM을 부르지 않는다고 했는데, 입력이 같은지는 어떻게 판단하나요?
집계 결과(stats/focus/skillGaps)를 `canonical(...)` 로 정규화한 뒤 `CareerAnalysisRunService.fingerprint(...)` 로 지문 해시를 만듭니다. 이 fingerprint를 키로 `findFreshRun(userId, type, fingerprint)` 을 조회해, 같은 지문의 신선한 run이 있으면 저장된 요약을 그대로 반환합니다. 즉 "입력 동일성"을 해시 비교로 판단합니다.
:::

:::details Q2. 결정적 집계도 캐시하면 더 빠르지 않나요?
집계는 DB 쿼리·산술이라 토큰 비용이 없고 항상 최신이어야 합니다. 그래서 일부러 캐시하지 않고 매번 새로 계산합니다. 캐시는 비용이 큰 LLM 요약에만 적용하는 게 의도된 분리입니다. 만약 집계까지 캐시하면 지원 상태가 바뀌었는데 옛 숫자가 보이는 부작용이 생깁니다.
:::

:::details Q3. OpenAI가 죽거나 키가 없으면 화면이 깨지나요?
아니요. 두 단계 폴백이 있습니다. 키가 없으면 처음부터 `MockDashboardInsightAiService` 로, 호출 중 예외가 나면 catch에서 Mock으로 떨어집니다. Mock은 LLM 없이 집계만으로 같은 모양의 요약을 결정적으로 만들기 때문에 화면은 항상 채워집니다. 결과 status가 FALLBACK으로 표시되고 retryable=true라 재시도를 유도합니다.
:::

:::details Q4. 응답이 형식이 안 맞아서 파싱이 깨질 위험은요?
Structured Output을 씁니다. summary 하나만 가진 JSON 스키마(`additionalProperties:false`, `required:["summary"]`)를 OpenAI에 강제로 넘기므로, 응답이 항상 그 모양으로 옵니다. 그래서 `payload.path("summary")` 로 꺼낼 때 키 누락이나 형식 깨짐 걱정이 없습니다. 자유 텍스트 파싱보다 훨씬 견고합니다.
:::

:::details Q5. 크레딧(비용)은 정확히 언제 차감되나요?
`POST /summary/refresh` (forceRefresh=true)이고 결과 status가 SUCCESS일 때만 `EXPLICIT_REFRESH_CREDIT` 만큼 차감합니다. 일반 조회(`GET /summary`)나 캐시 히트, FALLBACK일 때는 0입니다. "실제로 새 LLM 결과를 받았고, 사용자가 명시적으로 요청했을 때만 과금"이라는 원칙입니다.
:::

## 8. 직접 말해보기

1. "대시보드 AI 요약에서 비용을 어떻게 통제했나요?"를 30초 안에, fingerprint 캐시와 "집계는 매번·요약만 캐시" 분리를 반드시 넣어서 말해보세요.
2. 면접관이 "OpenAI 장애가 나면요?"라고 물었다고 가정하고, 2단계 폴백과 status(SUCCESS/FALLBACK)·retryable 플래그까지 설명해보세요.

## 퀴즈

<QuizBox question="대시보드 AI 요약에서 fingerprint(지문 해시)의 역할은?" :choices="['LLM 응답을 암호화한다', '입력 집계가 같은지 비교해 캐시 재사용 여부를 판단한다', '사용자를 인증한다', 'JSON 스키마를 검증한다']" :answer="1" explanation="canonical 정규화한 집계로 만든 fingerprint를 캐시 키로 써서, 같은 입력이면 career_analysis_run의 저장 요약을 재사용하고 LLM을 호출하지 않습니다." />

<QuizBox question="OpenAI 호출이 예외로 실패했을 때 OpenAiDashboardInsightAiService가 하는 동작은?" :choices="['예외를 그대로 던져 500을 반환한다', '빈 문자열을 반환한다', 'MockDashboardInsightAiService로 폴백하고 status를 FALLBACK, retryable=true로 표시한다', '3번 재시도 후 포기한다']" :answer="2" explanation="catch 블록에서 Mock 요약으로 폴백하며, status=FALLBACK, retryable=true, usage는 mock-fallback으로 채워 결과 출처와 재시도 가능 여부를 명확히 합니다." />

<QuizBox question="결정적 집계(stats/focus/skillGaps)는 캐시하지 않고 LLM 요약만 캐시하도록 분리한 이유를 한 문단으로 설명하세요." explanation="집계는 DB 쿼리와 산술이라 토큰 비용이 없고 항상 최신이어야 하므로 매번 새로 계산합니다. 반면 LLM 요약은 호출마다 토큰 비용이 발생하므로, 입력 집계의 fingerprint가 같을 때 career_analysis_run의 저장 결과를 재사용해 비용을 0으로 만듭니다. 이렇게 비용 특성이 다른 두 작업을 분리하면 대시보드를 아무리 새로고침해도 데이터가 같으면 과금되지 않고, 집계가 바뀌면 옛 숫자가 노출되는 부작용도 막을 수 있습니다." />
