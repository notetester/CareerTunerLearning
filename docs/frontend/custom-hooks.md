# 커스텀 훅 (Custom Hooks)

> "커스텀 훅은 use로 시작하는 일반 함수인데, 내부에서 React 훅을 호출해 상태·이펙트 로직을 재사용 가능한 단위로 묶은 것입니다. 저는 적합도 분석 데이터 페칭과 로딩·에러 상태를 useApplicationFitAnalysis 하나로 캡슐화해서, 페이지 컴포넌트는 analyses·loading·generating만 받아 쓰도록 만들었습니다."

## 1. 한 줄 정의

커스텀 훅은 **`use`로 시작하는 함수**로, 내부에서 `useState`·`useEffect`·`useCallback` 같은 React 내장 훅을 호출해 **상태가 있는 로직을 여러 컴포넌트가 재사용할 수 있게 추출한 것**이다.

## 2. 단어 뜻

| 용어 | 풀이 |
| --- | --- |
| Hook(훅) | React 16.8에서 도입. 함수형 컴포넌트에서 상태·생명주기 같은 "React 기능에 갈고리를 걸어(hook into)" 쓰게 해주는 API |
| Custom(커스텀) | React가 제공하는 게 아니라 개발자가 직접 조합해 만든 |
| `use` 접두사 | 단순 관례가 아니라 **규칙**. 린터(eslint-plugin-react-hooks)가 `use`로 시작하는 함수만 훅 규칙을 검사한다 |

즉 커스텀 훅 = "내장 훅을 재료로 내가 조립한 재사용 가능한 상태 로직 함수".

## 3. 왜 필요한가 (없으면 무슨 문제가 생기나)

같은 데이터 페칭 로직(요청 → 로딩 표시 → 성공 시 데이터 저장 → 실패 시 에러)을 여러 컴포넌트에서 쓴다고 하자. 커스텀 훅이 없으면:

- **컴포넌트마다 `useState`·`useEffect`를 복붙** → 적합도 패널, 히스토리 패널, 대시보드가 똑같은 코드를 각자 들고 있게 된다.
- **로딩/에러 처리 누락** → 어떤 컴포넌트는 로딩 스피너를 빼먹고, 어떤 건 에러 처리를 안 한다.
- **race condition(경쟁 상태)** → 빠르게 다른 지원 건으로 이동하면 늦게 도착한 옛 응답이 새 화면을 덮어쓴다.

:::tip 핵심 가치
컴포넌트가 **"무엇을 보여줄지(뷰)"** 에만 집중하고, **"어떻게 데이터를 가져오고 상태를 관리할지(로직)"** 는 훅이 담당한다. 관심사 분리(separation of concerns) + 로직 재사용.
:::

## 4. CareerTuner에서 어디에 썼나 (영역 C, 프론트엔드)

지원 건 상세 화면(`features/applications/pages/ApplicationDetailPage.tsx`)이 여러 분석 패널을 보여주는데, 그 데이터 로직은 전부 `features/analysis/hooks/`의 커스텀 훅으로 빠져 있다.

| 훅 | 파일 | 역할 | 상태 |
| --- | --- | --- | --- |
| `useApplicationFitAnalysis` | `features/analysis/hooks/useApplicationFitAnalysis.ts` | 지원 건의 최신 적합도 분석 조회 + 생성/재생성 | 구현됨 |
| `useFitAnalysisHistory` | `features/analysis/hooks/useFitAnalysisHistory.ts` | 적합도 재분석 히스토리 조회 (`refreshKey`로 갱신) | 구현됨 |
| `useAutoPrepRun` | `features/autoprep/hooks/useAutoPrepRun.ts` | SSE 스트림 구독해 6파트 진행상태 누적 | 구현됨 |

페이지 쪽 소비 예시 — 한 줄로 5개 값을 꺼내 쓴다.

```ts
const {
  analyses: fitAnalyses,
  loading: fitAnalysisLoading,
  generating: fitGenerating,
  error: fitAnalysisError,
  generate: generateFit,
} = useApplicationFitAnalysis(id, needsFitAnalysis);
```

훅이 반환하는 `analyses`는 `FitAnalysisDetail[]` 배열이다. 백엔드는 단건을 주지만, 적합도/전략/학습 패널이 **배열을 받도록 설계**돼 있어 훅 내부에서 `detail ? [detail] : []`로 감싼다. 아직 분석이 없으면 빈 배열을 줘서 패널이 "분석 안내" 상태를 노출한다. (실제 데이터는 `api/fitAnalysisApi.ts`의 `getFitAnalysisByApplicationCase`·`generateFitAnalysis`를 거쳐 백엔드 `fit_analysis` 테이블 기반 `FitAnalysisAiService`에서 온다.)

## 5. 핵심 동작 원리

`useApplicationFitAnalysis`를 뜯어보면 커스텀 훅의 전형적 패턴 4가지가 다 들어 있다.

### (1) 상태 4종을 `useState`로 선언

```ts
const [analyses, setAnalyses] = useState<FitAnalysisDetail[]>([]);
const [loading, setLoading] = useState(false);    // 최초 조회 중
const [generating, setGenerating] = useState(false); // 사용자가 생성 버튼 눌렀을 때
const [error, setError] = useState<string | null>(null);
```

조회 로딩(`loading`)과 생성 로딩(`generating`)을 **분리**한 게 포인트다. "데이터 불러오는 중"과 "새로 만드는 중"은 UI에서 다르게 보여줘야 하기 때문.

### (2) `useEffect`로 마운트·의존성 변경 시 데이터 페칭

```ts
useEffect(() => {
  if (!enabled || !applicationCaseId) { setAnalyses([]); return; }

  let ignore = false;          // race condition 방지 플래그
  setLoading(true);
  getFitAnalysisByApplicationCase(applicationCaseId)
    .then((detail) => { if (!ignore) setAnalyses(detail ? [detail] : []); })
    .catch(() => { if (!ignore) setAnalyses([]); })
    .finally(() => { if (!ignore) setLoading(false); });

  return () => { ignore = true; }; // cleanup: 다음 effect 전에 옛 응답 무시
}, [applicationCaseId, applicationCaseId, enabled]);
```

`ignore` 플래그 + cleanup 함수가 **경쟁 상태(race condition)** 를 막는다. `applicationCaseId`가 바뀌면 이전 effect의 cleanup이 `ignore = true`로 만들어, 늦게 도착한 옛 요청 결과가 화면을 덮어쓰지 못한다.

### (3) `useCallback`으로 액션 함수 메모이즈

```ts
const generate = useCallback(async () => {
  if (!applicationCaseId) return;
  setGenerating(true);
  try {
    const detail = await generateFitAnalysis(applicationCaseId);
    setAnalyses(detail ? [detail] : []);
  } catch (err) {
    setError(err instanceof Error ? err.message : "적합도 분석 생성에 실패했습니다.");
  } finally {
    setGenerating(false);
  }
}, [applicationCaseId]);
```

`generate`를 `useCallback`으로 감싸 `applicationCaseId`가 바뀔 때만 새 함수를 만든다. 자식 컴포넌트에 prop으로 넘길 때 불필요한 리렌더를 막기 위함.

### (4) 객체로 묶어 반환

```ts
return { analyses, loading, generating, error, generate };
```

상태와 액션을 한 객체로 반환 → 소비처가 필요한 것만 구조분해해서 쓴다.

:::details 훅 규칙 (Rules of Hooks) — 면접 단골
1. **최상위에서만 호출** — 조건문·반복문·중첩 함수 안에서 훅을 호출하면 안 된다. React가 호출 순서로 상태를 식별하기 때문에, 순서가 흔들리면 상태가 엉킨다.
2. **React 함수에서만 호출** — 컴포넌트 또는 다른 커스텀 훅 안에서만. 일반 JS 함수에서 호출 금지.
3. **`use`로 시작** — 그래야 린터가 위 규칙을 검사한다.
:::

## 6. 면접 답변 3단계

- **초간단(1문장):** "커스텀 훅은 `use`로 시작하는 함수로, 컴포넌트의 상태·이펙트 로직을 재사용 가능하게 추출한 것입니다."
- **기본:** "저희 프로젝트에서 지원 건 적합도 분석은 조회·생성·로딩·에러 상태가 얽혀 있어서, 이걸 `useApplicationFitAnalysis` 훅으로 캡슐화했습니다. 페이지는 `analyses`, `loading`, `generating`, `error`, `generate`만 구조분해해서 받고, 데이터 페칭과 상태 관리는 훅이 책임집니다. 덕분에 패널 컴포넌트는 뷰에만 집중합니다."
- **꼬리질문 대응:** "특히 `useEffect` 안에 `ignore` 플래그와 cleanup을 둬서, 사용자가 빠르게 다른 지원 건으로 이동했을 때 늦게 도착한 옛 응답이 새 화면을 덮어쓰는 race condition을 막았습니다. 조회 로딩과 생성 로딩도 `loading`/`generating`으로 분리해 UI에서 다르게 처리합니다."

## 7. 자주 나오는 꼬리질문 + 모범답안

**Q1. 커스텀 훅과 일반 유틸 함수의 차이는?**
커스텀 훅은 **내부에서 React 훅(`useState` 등)을 호출**해 상태를 갖는다. 따라서 훅 규칙(최상위 호출)을 따라야 하고 `use`로 시작해야 한다. 순수 계산만 하는 유틸 함수는 React와 무관하므로 일반 함수로 둔다.

**Q2. 두 컴포넌트가 같은 커스텀 훅을 쓰면 상태를 공유하나?**
아니다. 훅은 **호출될 때마다 독립적인 상태**를 만든다. 코드(로직)만 재사용하고 상태는 각자 갖는다. 상태를 공유하려면 Context(`AuthContext`)나 Zustand 같은 전역 스토어를 써야 한다. CareerTuner도 전역 인증만 Context, 그 외는 Zustand, 화면 단위 데이터는 커스텀 훅으로 나눈다.

**Q3. `useEffect`의 cleanup(반환 함수)은 왜 필요한가?**
다음 effect 실행 전(또는 언마운트 시) 정리 작업을 한다. `useApplicationFitAnalysis`에서는 `ignore = true`로 옛 비동기 응답을 무시해 race condition을 막고, `useAutoPrepRun`에서는 `AbortController`로 진행 중인 SSE 스트림을 끊는다.

**Q4. 왜 `generate`를 `useCallback`으로 감쌌나?**
의존성(`applicationCaseId`)이 같으면 같은 함수 참조를 유지하기 위해서다. 자식에 prop으로 넘기거나 다른 훅의 의존성 배열에 넣을 때, 매 렌더마다 새 함수가 생기면 불필요한 리렌더·effect 재실행이 일어난다.

**Q5. 의존성 배열에 값을 빠뜨리면?**
stale closure(낡은 클로저) 문제가 생긴다. effect/콜백이 옛 값을 캡처해 최신 상태를 못 본다. 그래서 `[applicationCaseId, enabled]`처럼 effect가 참조하는 외부 값을 전부 넣어야 하고, `eslint-plugin-react-hooks`의 `exhaustive-deps`가 이를 검사한다.

## 8. 직접 말해보기

1. `useApplicationFitAnalysis`가 반환하는 5개 값을 하나씩 들고, 각각이 어떤 화면 상태를 책임지는지 30초 안에 설명해보라.
2. "데이터 페칭 로직을 왜 컴포넌트에 안 두고 커스텀 훅으로 뺐나요?"라는 질문에, race condition과 로딩/생성 분리를 근거로 답해보라.

## 퀴즈

<QuizBox question="커스텀 훅 이름이 반드시 use로 시작해야 하는 가장 직접적인 이유는?" :choices="['React가 컴파일 시 함수를 자동 변환하기 때문', '린터가 use로 시작하는 함수에만 훅 규칙을 검사하기 때문', '변수명 충돌을 피하기 위한 단순 관례일 뿐', 'use로 시작해야 상태가 전역으로 공유되기 때문']" :answer="1" explanation="use 접두사는 eslint-plugin-react-hooks가 훅 규칙(최상위 호출 등)을 검사하는 기준이다. React 자체가 이 이름 규칙으로 훅 여부를 식별한다." />

<QuizBox question="useApplicationFitAnalysis의 useEffect 안에서 ignore 플래그와 cleanup 함수를 둔 목적은?" :choices="['로딩 스피너를 더 빨리 끄려고', '늦게 도착한 옛 비동기 응답이 새 상태를 덮어쓰는 race condition을 막으려고', 'API 호출 횟수를 줄이려고', '에러 메시지를 한국어로 바꾸려고']" :answer="1" explanation="applicationCaseId가 바뀌면 이전 effect의 cleanup이 ignore를 true로 만들어, 늦게 온 이전 요청의 결과를 무시한다. 빠른 화면 전환 시 화면이 옛 데이터로 덮이는 것을 방지한다." />

<QuizBox question="두 개의 서로 다른 컴포넌트가 같은 커스텀 훅을 호출했을 때 상태는 어떻게 되는가? 그리고 진짜로 상태를 공유하려면 어떻게 해야 하는지 설명하라." explanation="커스텀 훅은 코드(로직)만 재사용하고 상태는 공유하지 않는다. 호출될 때마다 독립적인 useState 인스턴스가 만들어지므로 각 컴포넌트는 자기만의 상태를 갖는다. 상태를 실제로 공유하려면 React Context(예: AuthContext)나 Zustand 같은 전역 스토어에 상태를 올리고, 커스텀 훅은 그 스토어를 읽어오는 역할만 하도록 만들면 된다." />
