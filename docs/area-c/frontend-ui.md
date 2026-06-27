# C 프론트엔드 UI/UX 구현

> 결정적 규칙엔진이 만든 점수·판단을 "믿을 수 있게 보여주는" 화면 계층. 핵심은 `useApplicationFitAnalysis` 훅의 상태 분리(`loading` vs `generating`), 결과를 항상 배열로 감싸는 계약, DB JSON 문자열을 안전하게 역직렬화하는 파서, 그리고 점수를 숫자+구간으로 함께 표기하는 하이브리드 UX다.

## 1. 한 줄 정의 · 이 페이지가 답하는 면접 질문

영역 C의 프론트엔드는 **홈(`/`) → 대시보드(`/dashboard`) → 취업분석(`/analysis`, 5탭) → 지원건 상세 적합도 탭(`/applications/{id}` fit)** 으로 이어지는 "이 공고에 지원해도 되나 / 무엇을 보완하나 / 다음 어디로"의 화면 흐름이다.

이 페이지가 답하는 면접 질문:

- "백엔드 규칙엔진이 점수를 확정하는데, 프론트는 무엇을 책임지나요?"
- "분석을 불러오는 것과 새로 생성하는 것을 왜 다른 상태로 나눴나요?"
- "단건 분석을 왜 굳이 배열로 감싸 패널에 넘기나요?"
- "DB의 JSON 컬럼을 화면에서 어떻게 안전하게 다루나요? `JSON.parse`가 깨지면요?"
- "스펙 보완 시뮬레이터는 실제 점수인가요? 아니면 추정인가요? 왜 만들었나요?"

:::tip 한 문장 요약
**프론트는 점수를 만들지 않는다.** 백엔드(`MockFitAnalysisAiService` 규칙엔진)가 확정한 점수·판단·신뢰도·조건매트릭스를 받아, 사용자가 "왜 이 점수인지 / 무엇을 보완하면 되는지"를 막힘없이 이해하도록 *번역*하고 *다음 행동으로 연결*하는 계층이다.
:::

## 2. 왜 이렇게 설계했나 (설계 의도 · 대안과 트레이드오프)

### 2.1 점수는 백엔드, 설명·전환은 프론트 — 책임 분리

뉴로-심볼릭 철학(점수는 결정적 규칙엔진이 소유)이 프론트에도 그대로 내려온다. 프론트가 점수를 *재계산*하면 백엔드와 어긋나 신뢰가 깨진다. 그래서 화면은 받은 값을 **표시·강조·전환**만 한다.

| 프론트가 하는 일 | 프론트가 하지 않는 일 |
| --- | --- |
| 점수를 구간(높음/보완/부족)으로 번역 | 점수 계산·재계산 |
| 조건매트릭스를 표로 시각화 | 조건 충족 여부 판정 |
| 부족역량을 학습과제/포트폴리오 과제로 전환 | "합격 보장" 같은 단정 생성 |
| 신뢰도 낮음이면 입력 보강을 먼저 안내 | 신뢰도 점수 산정 |

예외가 딱 하나 있다 — **스펙 보완 시뮬레이터**(§4.5)는 프론트에서 *추정치*를 계산한다. 단, 이것은 "참고용 추정"임을 UI에서 명시하고, 실제 점수는 재분석으로만 확정된다고 못 박는다.

### 2.2 `loading`과 `generating`을 왜 분리했나

분석을 **불러오는 것**(GET, 무료·빠름)과 **새로 생성하는 것**(POST, AI 호출·크레딧·느림)은 사용자에게 완전히 다른 경험이다. 하나의 `loading` 불리언으로 합치면:

- GET 로딩과 POST 생성 중에 같은 스피너가 떠서, 사용자는 "지금 기다리는 게 그냥 조회인지 비싼 AI 생성인지" 모른다.
- 생성 중에는 단계별 진행(`FitAnalysisProgress`: 근거검색→채점→검증)을 보여줘야 하는데, 조회 로딩에는 그게 과하다.

그래서 훅이 두 상태를 분리해 노출한다.

```ts
return { analyses, loading, generating, error, generate };
//                 ↑GET     ↑POST
```

패널은 `generating`이면 단계별 진행 UI(`FitAnalysisProgress`)를, 단순 `loading`이면 가벼운 안내 카드(`StateCard`)를 띄운다.

### 2.3 단건 결과를 왜 배열로 감싸나

`FitAnalysisPanel` / `StrategyPanel` / `LearningRecommendationPanel`은 원래 **여러 지원 건을 한 번에** 보여줄 수 있는 패널이다(`analyses.map(...)`). 지원건 상세에서는 단 한 건만 보여주면 되지만, 패널 계약을 그 화면 때문에 바꾸면 컴포넌트가 두 갈래로 갈라진다.

대신 훅이 단건을 `[detail]`로 감싸고, 분석이 없으면 `[]`로 둔다.

```ts
.then((detail) => { if (!ignore) setAnalyses(detail ? [detail] : []); })
```

트레이드오프: 빈 배열이라는 "미실행" 신호와 "오류"를 구분해야 한다. 그래서 GET 실패는 일부러 빈 배열로 흡수하고(아직 분석이 없는 게 정상 케이스라서), POST 실패만 `error`로 띄운다. 덕분에 패널은 `analyses.length === 0`이면 *안내 상태*, `error`면 *오류 상태*를 깔끔히 분기한다.

## 3. 어떤 기술로 구현했나 (실제 클래스 · 메서드 · 타입 근거)

| 레이어 | 파일 | 책임 |
| --- | --- | --- |
| 훅 | `features/analysis/hooks/useApplicationFitAnalysis.ts` | GET/POST·상태 분리·race 방지 |
| API | `features/analysis/api/fitAnalysisApi.ts` | `getFitAnalysisByApplicationCase` / `generateFitAnalysis` / `updateFitAnalysisLearningTask` |
| 타입·파서 | `features/analysis/types/fitAnalysis.ts` | `FitAnalysisDetail`, `parseJsonValue`, `parseJsonList`, `scoreTone`, `scoreBandDescription` |
| 적합도 패널 | `features/applications/components/FitAnalysisPanel.tsx` | 점수·조건매트릭스·신뢰도·시뮬레이터·근거 스냅샷 |
| 전략 패널 | `features/applications/components/StrategyPanel.tsx` | 3단계 액션플랜·액션보드·톤 전략 |
| 학습 패널 | `features/applications/components/LearningRecommendationPanel.tsx` | 학습과제 체크리스트·주간계획·자격증 |
| 페이지 | `features/{home,dashboard,analysis,applications}/pages/*.tsx` | 4개 사용자 화면 |
| fetch 래퍼 | `app/lib/api.ts` | envelope 언랩·401 자동 리프레시·mock 토글 |

핵심 데이터 타입은 `FitAnalysisDetail`이다. 주목할 점은 **DB의 JSON 컬럼이 프론트에서 `string | null`로 들어온다**는 것:

```ts
interface FitAnalysisDetail {
  fitScore: number | null;
  matchedSkills: string | null;     // JSON 문자열
  conditionMatrix: string | null;   // JSON 문자열 (FitConditionMatch[])
  analysisConfidence: string | null;// JSON 문자열 (FitAnalysisConfidence)
  applyDecision: string | null;     // JSON 문자열 (FitApplyDecision)
  scoreBreakdown?: FitScoreBreakdown[]; // 이건 이미 객체
  // ...
}
```

문자열 컬럼과 이미 파싱된 객체가 섞여 있는 이유는 백엔드 매퍼가 일부 컬럼은 JSON 문자열 그대로, 일부는 DTO로 직렬화해 내려주기 때문이다. 프론트는 이 차이를 파서로 흡수한다(§4.4).

## 4. 동작 원리 (데이터 흐름 · 단계 · 표 · 작은 코드)

### 4.1 전체 데이터 흐름

```text
[ApplicationDetailPage] needsFitAnalysis?
        │
        ▼
useApplicationFitAnalysis(id, enabled)
  ├─ enabled && id 있음 → GET /fit-analyses/application-cases/{id}   (loading)
  │     └─ 성공: setAnalyses([detail])   실패: setAnalyses([])  (정상 미실행)
  └─ generate() 호출 → POST 같은 경로                              (generating)
        └─ 성공: setAnalyses([detail])   실패: setError(...)
        │
        ▼
<FitAnalysisPanel analyses loading generating error />
<StrategyPanel  analyses loading error />
<LearningRecommendationPanel analyses loading error onReanalyze />
        │
        ▼ (각 패널 내부)
parseJsonList / parseJsonValue 로 DB JSON → 객체
        │
        ▼
scoreTone / scoreBandDescription 로 점수 → 구간·문구
```

### 4.2 race condition 방지 — `ignore` 플래그

`useEffect`가 `applicationCaseId`/`enabled`에 의존하므로, 사용자가 빠르게 지원건을 전환하면 **이전 요청의 응답이 나중에 도착**할 수 있다(out-of-order). 그대로 두면 방금 떠난 지원건의 분석이 새 화면에 박힌다.

해결은 클로저 플래그 + cleanup:

```ts
useEffect(() => {
  if (!enabled || !applicationCaseId) { setAnalyses([]); return; }
  let ignore = false;
  setLoading(true);
  getFitAnalysisByApplicationCase(applicationCaseId)
    .then((detail) => { if (!ignore) setAnalyses(detail ? [detail] : []); })
    .catch(() => { if (!ignore) setAnalyses([]); })
    .finally(() => { if (!ignore) setLoading(false); });
  return () => { ignore = true; };  // ← 다음 effect 실행 전 옛 요청 무효화
}, [applicationCaseId, enabled]);
```

cleanup에서 `ignore = true`로 바꾸면, 늦게 도착한 옛 응답의 `.then`은 모두 no-op이 된다. `AbortController`를 안 쓰고 플래그를 쓴 이유는 fetch 래퍼가 envelope 언랩·401 리프레시를 감싸고 있어 abort 전파가 복잡하고, 화면 정합성만 보장하면 충분하기 때문이다(요청 자체는 끝나도 *상태 반영*만 막으면 된다).

### 4.3 명시적 재생성 = 크레딧 UX

초기 진입의 GET은 **저장된 결과(또는 캐시) 재사용**이라 비용이 없다. 비용·시간이 드는 것은 `generate()`(POST)뿐이다. 그래서:

- 초기 로드(`loading`)는 조용히, 자동으로.
- 재생성은 **사용자가 명시적으로 버튼을 눌러야** 일어난다. 장기경향 페이지의 재분석 버튼은 아예 `재분석 (크레딧 1)`이라고 라벨에 비용을 적고, `title`에 "크레딧 1이 차감됩니다"를 명시한다.

학습 패널에서는 한 발 더 나간다 — 학습 과제 **완료율이 80% 이상**이면 "점수가 얼마나 올랐는지 확인해보세요" 배너와 함께 재분석 버튼(`onReanalyze`)을 노출해, *보완 → 재분석 → 점수 변화 확인*의 루프를 만든다.

```tsx
{learningTasks.length > 0 && completionRate >= 80 && (
  <Button disabled={reanalyzing} onClick={onReanalyze}>
    {reanalyzing ? "재분석 중..." : "적합도 재분석"}
  </Button>
)}
```

### 4.4 DB JSON 역직렬화 — `parseJsonValue` / `parseJsonList`

DB JSON 문자열은 신뢰할 수 없다(과거 데이터·부분 실패·형식 불일치). `JSON.parse`가 throw하면 화면 전체가 흰 화면으로 죽는다. 그래서 **fallback을 강제하는 파서**를 쓴다.

```ts
export function parseJsonValue<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try { return JSON.parse(value) as T; } catch { return fallback; }
}

export function parseJsonList(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) return parsed.map((item) => String(item));
  } catch {
    // JSON이 아니면 콤마 구분 문자열로 관용 처리(레거시 데이터 호환)
    return value.split(",").map((s) => s.trim()).filter(Boolean);
  }
  return [];
}
```

설계 포인트 두 가지:

1. **항상 fallback 반환** — 어떤 입력이 와도 패널은 빈 배열/기본값으로 렌더된다. "분석 결과가 깨졌다고 화면이 깨지지 않는다."
2. **`parseJsonList`의 관용 분기** — 정식 JSON 배열이 아니면 콤마 구분 문자열로도 받아준다. 옛 데이터나 단순 입력과의 호환 보험이다.

패널은 이 파서로 모든 JSON 컬럼을 객체로 되살린다:

```tsx
const matchedSkills  = parseJsonList(analysis.matchedSkills);
const gaps           = parseJsonValue<FitGapRecommendation[]>(analysis.gapRecommendations, []);
const conditionMatrix= parseJsonValue<FitConditionMatch[]>(analysis.conditionMatrix, []);
const confidence     = parseJsonValue<FitAnalysisConfidence | null>(analysis.analysisConfidence, null);
const decision       = parseJsonValue<FitApplyDecision | null>(analysis.applyDecision, null);
```

### 4.5 점수 하이브리드 표기 — `scoreTone` + `scoreBandDescription`

숫자만 보여주면 "82점이 좋은 건가?"를 사용자가 모른다. 구간 라벨만 보여주면 정밀도가 사라진다. 그래서 **둘을 함께** 표기한다(하이브리드).

| 점수 | `scoreTone` 라벨 | 색 | `scoreBandDescription` 안내 |
| --- | --- | --- | --- |
| 85+ | 높음 | 초록 | 강한 적합. 바로 지원·면접 준비 집중 |
| 70~84 | 높음 | 초록 | 지원 가능. 부족역량 1~2개 보완 |
| 50~69 | 보완 필요 | 황 | 핵심 부족역량 해결 후 재분석 권장 |
| ~49 | 준비 부족 | 빨강 | 다른 공고 우선 / 기본 요구역량부터 |

```ts
export function scoreTone(score) {
  const v = score ?? 0;
  if (v >= 70) return { text: "text-green-600", bg: "bg-green-100", label: "높음" };
  if (v >= 50) return { text: "text-amber-600", bg: "bg-amber-100", label: "보완 필요" };
  return { text: "text-red-500", bg: "bg-red-100", label: "준비 부족" };
}
```

카드 헤더에는 `{tone.label}` 배지를, 본문에는 `{fitScore}점` 숫자와 `{scoreBandDescription(...)}` 문장을 함께 둔다. "82점 / 높음 / 부족역량 1~2개만 보완하면 됩니다"가 한 화면에 보인다.

### 4.6 스펙 보완 시뮬레이터 (`FitImpactSimulator`)

부족역량을 보면 "이걸 채우면 점수가 얼마나 오르지?"가 궁금해진다. 매번 AI 재분석을 돌리면 비싸고 느리다. 그래서 **저장된 조건매트릭스만으로 결정적 추정치**를 즉석에서 계산한다.

```tsx
const candidates = rows.filter((row) => row.matchStatus !== "MET").slice(0, 6);
const estimatedBoost = selectedRows.reduce((sum, row) => {
  const w = row.conditionType === "REQUIRED" ? 8 : 4;      // 필수 가중 ↑
  return sum + (row.matchStatus === "PARTIAL" ? Math.ceil(w / 2) : w);
}, 0);
const estimatedScore = Math.min(100, currentScore + estimatedBoost);
```

사용자가 보완할 조건 칩을 토글하면 예상 점수가 실시간으로 바뀐다. **반드시** 하단에 "조건 유형별 가중치로 계산한 참고 추정치이며, 실제 점수는 프로필에 근거를 등록하고 적합도 재분석을 실행해 확인하세요"라고 적는다 — 추정과 확정을 흐리지 않기 위해서다. UX 목표는 *재분석으로의 자연스러운 유도*다.

### 4.7 Progressive disclosure — `StateCard`와 `<details>`

화면은 상태별로 점진 공개한다. 세 패널 모두 동일한 `StateCard` 패턴으로 상태를 렌더한다:

```tsx
{generating && <FitAnalysisProgress />}              // 생성 중: 단계별 진행
{!generating && loading && <StateCard title="불러오는 중..." />}
{error && <StateCard title={error} tone="error" />}
{!generating && !loading && !error && analyses.length === 0 &&
   <StateCard title="아직 적합도 분석 결과가 없습니다." description="..." />}
```

상세 근거(source_snapshot)는 기본 접힘이다. `<details>`로 감싸 "이 분석은 어떤 데이터를 기준으로 만들어졌나요?"를 펼쳐야 보이게 해, 메인 흐름을 어지럽히지 않으면서도 설명가능성(공고 revision·프로필 시점 동결)을 보장한다.

### 4.8 차트 시각화

대시보드·장기경향의 막대그래프(점수 변화·월별 추이)는 **CSS만으로 그린 경량 막대**다(`flex items-end` + 인라인 `height`). 외부 차트 라이브러리에 의존하지 않아 가볍고, 마지막 막대를 진한 색으로 강조해 "지금 어디"를 보여준다. 홈·일부 대시보드 카드는 공통 `chart` 컴포넌트(Recharts 기반)를 쓰는 곳도 있으나, 분석 페이지의 핵심 막대는 의도적으로 가벼운 CSS 구현이다.

### 4.9 홈은 대시보드의 재투영

홈(`HomePage`)은 별도 매퍼를 호출하지 않고 `getDashboardSummary`를 **재사용**해 경량 가공만 한다. 같은 데이터를 다른 정보 구조로 보여주므로, 백엔드 한 곳(대시보드 요약)만 정확하면 홈도 함께 정확해진다. 향후 홈 전용 표현이 필요해지면 `getHomeSummary("/home/summary")`로 전환할 자리만 비워뒀다.

## 5. 구현 상태 (됨 vs 향후) 정직 구분

| 항목 | 상태 |
| --- | --- |
| 4개 사용자 화면(홈·대시보드·분석 5탭·적합도 탭) | 구현됨 |
| `useApplicationFitAnalysis`(상태분리·race방지·generate) | 구현됨 |
| 3개 패널(적합도·전략·학습) + 모든 하위 카드 | 구현됨 |
| `parseJsonValue`/`parseJsonList` 안전 파싱 | 구현됨 |
| 하이브리드 점수 표기·신뢰도 배지·조건매트릭스 표 | 구현됨 |
| 스펙 보완 시뮬레이터(결정적 추정) | 구현됨 |
| 학습과제 체크리스트(단건 PATCH)·80% 재분석 유도 | 구현됨 |
| 명시적 재생성 크레딧 UX | 구현됨 |
| source_snapshot 근거 뷰어(`<details>`) | 구현됨 |
| 401 자동 리프레시 fetch 래퍼·mock 토글 | 구현됨 |
| 화면이 받는 점수·판단의 **실제 LLM** 생성 | 향후(현재 규칙엔진/mock 기준, 계약 동일) |

:::warning 정직하게 말할 것
화면·계약·상태 머신은 모두 완성이고, 현재는 `VITE_USE_MOCK` 또는 백엔드 규칙엔진 기준으로 **결정론적으로** 동작한다. 프론트가 받는 응답 형태는 실제 LLM 연동 후와 **동일**하므로, OpenAI 키 발급 시 백엔드만 전환하면 화면은 그대로 작동한다. 면접에선 "프론트 계약·UX는 완성, 실 LLM 연동은 키 발급 후 백엔드 스위치"로 답한다.
:::

## 6. 면접 답변 3단계 (초간단 / 기본 / 꼬리질문 대응)

**초간단(15초):** "C 프론트는 점수를 만들지 않고, 백엔드 규칙엔진이 확정한 점수·판단·신뢰도를 사용자가 이해하고 다음 행동으로 옮기도록 번역하는 계층입니다. 핵심은 조회/생성 상태 분리, 단건의 배열 래핑, DB JSON 안전 파싱, 점수 하이브리드 표기입니다."

**기본(60초):** 위에 더해 — `useApplicationFitAnalysis` 훅이 GET(`loading`, 무료)과 POST 생성(`generating`, 크레딧)을 분리하고, `useEffect`의 `ignore` 플래그로 지원건 빠른 전환 시 옛 응답이 새 화면에 박히는 race를 막습니다. 결과는 항상 배열로 감싸 세 패널이 단건/다건을 같은 계약으로 처리합니다. DB의 JSON 컬럼은 `parseJsonValue`/`parseJsonList`가 throw 없이 fallback으로 흡수해 분석이 깨져도 화면이 죽지 않습니다.

**꼬리질문 대응:** 시뮬레이터의 "추정 vs 확정", `loading`/`generating` 분리 근거, `ignore` 대 `AbortController` 선택 이유를 §7에서 바로 꺼낼 수 있게 둡니다.

## 7. 자주 나오는 꼬리질문 + 모범답안

**Q1. 단건만 보여줄 화면인데 왜 배열로 감싸나요? 오버엔지니어링 아닌가요?**
세 패널(`FitAnalysisPanel`·`StrategyPanel`·`LearningRecommendationPanel`)은 원래 여러 지원 건을 종합해 보여줄 수 있는 컴포넌트입니다. 상세 화면 하나 때문에 패널 계약을 단건용으로 갈라치면 컴포넌트가 두 벌이 됩니다. 훅이 `[detail]`로 감싸고 미실행은 `[]`로 두면, 패널은 `map` 하나로 단건/다건/미실행을 모두 처리합니다. 재사용 비용이 래핑 비용보다 큽니다.

**Q2. `loading` 하나로 충분하지 않나요? 왜 `generating`을 또 만들었나요?**
GET 조회는 무료·즉시지만 POST 생성은 AI 호출·크레딧·수초가 듭니다. 같은 스피너를 쓰면 사용자가 "지금 비싼 작업이 도는지"를 모릅니다. `generating`이면 단계별 진행(`FitAnalysisProgress`: 근거검색→채점→검증)을 보여 신뢰를 주고, 단순 `loading`이면 가벼운 안내만 띄웁니다. 비용·시간 인지가 다른 두 경험을 한 불리언으로 뭉개면 안 됩니다.

**Q3. race를 왜 `AbortController` 대신 `ignore` 플래그로 막았나요?**
화면 정합성만 보장하면 충분했고, fetch 래퍼(`api()`)가 envelope 언랩과 401 자동 리프레시를 감싸고 있어 abort 신호 전파가 복잡합니다. `useEffect` cleanup에서 `ignore = true`로 바꾸면 늦게 온 옛 응답의 `setState`가 전부 no-op이 됩니다. 요청 자체는 끝나도 *상태 반영*만 막으면 옛 지원건 데이터가 새 화면에 박히지 않습니다.

**Q4. DB JSON을 `JSON.parse`로 바로 쓰면 안 되나요?**
과거 데이터·부분 실패·형식 불일치로 `JSON.parse`가 throw하면 React 트리 전체가 흰 화면으로 죽습니다. `parseJsonValue`는 throw를 catch해 항상 fallback을 반환하고, `parseJsonList`는 JSON 배열이 아니면 콤마 구분 문자열로도 관용 처리해 레거시와 호환합니다. "분석 데이터가 한 조각 깨졌다고 화면이 깨지지 않는다"가 원칙입니다.

**Q5. 시뮬레이터 점수는 진짜 점수인가요?**
아니요, 결정적 *추정치*입니다. 저장된 조건매트릭스에서 미충족 조건을 골라, 필수=8·우대=4(PARTIAL이면 절반) 가중치로 더해 100에 클램핑합니다. 매번 AI 재분석을 돌리는 비용을 피하면서 "보완 효과"를 즉시 체감시키는 장치입니다. UI에 "참고 추정치, 실제 점수는 재분석으로 확인"을 명시해 추정과 확정을 절대 흐리지 않고, 오히려 재분석으로 유도합니다.

**Q6. 신뢰도 배지가 점수와 별개로 또 있는 이유는요?**
점수는 "이 공고에 얼마나 맞나", 신뢰도(`FitAnalysisConfidence`)는 "그 점수를 얼마나 믿어도 되나"입니다. 공고 역량이나 프로필 기술이 비어 있으면 점수 자체가 흔들리므로, 신뢰도가 `HIGH`가 아니면 패널은 점수 위로 "신뢰도 낮음 + 입력 보강 사유"를 먼저 띄워, 사용자가 점수에 휘둘리기 전에 입력을 채우도록 안내합니다.

## 8. 직접 말해보기

아래를 소리 내어 막힘없이 설명할 수 있으면 이 페이지를 통과한 것이다.

1. 사용자가 지원건 A에서 B로 빠르게 넘길 때, A의 분석이 B 화면에 박히지 않는 이유를 코드 흐름으로 설명하라.
2. `loading`과 `generating`이 각각 어떤 UI를 띄우고, 왜 분리했는지 비용 관점에서 말하라.
3. DB의 `conditionMatrix` 문자열이 깨진 JSON이어도 화면이 죽지 않는 과정을 `parseJsonValue` 동작으로 설명하라.
4. "82점"이 화면에서 어떤 세 요소(숫자·구간 라벨·구간 설명)로 표현되는지, 왜 셋 다 필요한지 말하라.
5. 시뮬레이터가 추정인데 왜 두는지, 그리고 어떻게 재분석 UX로 연결되는지 설명하라.

## 관련 문서

- [영역 C 개요](/area-c/index)
- [적합도 분석 파이프라인](/area-c/fit-analysis)
- [구조화 출력](/ai/openai-structured-output)
- [JWT 보안](/backend/jwt-security)

## 퀴즈

<QuizBox question="useApplicationFitAnalysis 훅에서 loading과 generating을 분리한 핵심 이유는?" :choices="['코드 라인 수를 줄이기 위해', 'GET 조회(무료·즉시)와 POST 생성(AI 호출·크레딧·수초)은 사용자 경험이 달라 다른 UI를 띄워야 하기 때문', 'React가 불리언 두 개를 요구해서', 'TypeScript 타입 오류를 피하기 위해']" :answer="1" explanation="GET 조회는 무료·즉시지만 POST 생성은 비용·시간이 든다. generating이면 단계별 진행(FitAnalysisProgress)을, loading이면 가벼운 안내(StateCard)를 띄워 사용자가 비싼 작업이 도는지 인지하게 한다." />

<QuizBox question="useEffect의 ignore 플래그가 막는 문제는?" :choices="['메모리 누수', '지원건을 빠르게 전환할 때 늦게 도착한 이전 요청의 응답이 새 화면 상태에 반영되는 out-of-order race', '중복 로그인', 'JSON 파싱 오류']" :answer="1" explanation="cleanup에서 ignore=true로 바꾸면 늦게 온 옛 응답의 setState가 모두 no-op이 되어, 방금 떠난 지원건의 분석이 새 화면에 박히는 것을 막는다." />

<QuizBox question="parseJsonValue/parseJsonList를 일반 JSON.parse 대신 쓰는 이유로 가장 정확한 것은?" :choices="['속도가 더 빨라서', '깨진/비표준 JSON이 와도 throw 없이 fallback을 반환해 화면이 죽지 않게 하기 위해(parseJsonList는 콤마 문자열도 관용 처리)', '백엔드가 강제해서', '타입스크립트 제네릭을 쓰기 위해']" :answer="1" explanation="DB JSON은 과거 데이터·부분 실패로 깨질 수 있다. 두 파서는 항상 fallback(빈 배열/기본값)을 반환하고, parseJsonList는 JSON이 아니면 콤마 구분 문자열로도 받아 레거시와 호환한다." />
