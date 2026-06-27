# Hook (훅)

> "Hook은 클래스 없이 함수형 컴포넌트에서 상태(state)와 생명주기(lifecycle), 로직 재사용을 가능하게 해주는 React 함수입니다. CareerTuner에서는 `useApplicationFitAnalysis` 같은 커스텀 훅으로 API 호출과 loading/generating/error 상태를 한 곳에 모아 재사용했습니다."

## 1. 한 줄 정의

Hook은 `use`로 시작하는 React 함수로, 함수형 컴포넌트에 상태·부수효과·로직 재사용 능력을 "걸어주는(hook into)" 장치다.

## 2. 단어 뜻 (약자/어원 풀이)

- **Hook = 갈고리**. 함수형 컴포넌트가 원래 갖지 못한 React 내부 기능(상태 저장소, 렌더 생명주기)에 "갈고리를 걸어" 접근한다는 의미.
- 이름 규칙: 반드시 `use`로 시작한다(`useState`, `useEffect`, `useCallback`). 이 접두사는 단순 관례가 아니라, ESLint(`eslint-plugin-react-hooks`)와 React가 "이건 훅이다, 규칙을 검사해야 한다"고 인식하는 신호다.
- React 16.8(2019)에서 도입. 그 전에는 상태/생명주기를 쓰려면 클래스 컴포넌트가 필수였다.

## 3. 왜 필요한가 (없으면 무슨 문제가 생기나)

훅 이전(클래스 시대)의 통증을 알면 "왜"가 명확해진다.

| 문제 | 훅 없는 세계 | 훅으로 해결 |
| --- | --- | --- |
| 상태 관리 | `this.state`, `this.setState`, 생성자 바인딩 필요 | `useState` 한 줄 |
| 생명주기 분산 | 구독/해제 로직이 `componentDidMount`와 `componentWillUnmount`로 찢어짐 | `useEffect` 하나에 설정+정리(cleanup) 묶음 |
| 로직 재사용 | HOC, render props로 컴포넌트 트리가 중첩 지옥 | 커스텀 훅으로 평평하게 추출 |
| `this` 혼란 | 콜백마다 `this` 바인딩 실수 | 함수라서 `this` 자체가 없음 |

CareerTuner처럼 "API 호출 + loading/error 상태 + 정리"가 화면마다 반복되는 앱에서는, 이 패턴을 **커스텀 훅 한 개로 추출**하지 않으면 모든 페이지에 같은 코드를 복붙하게 된다.

## 4. CareerTuner에서 어디에 썼나 (실제 클래스/파일/테이블, 영역 표시)

프론트엔드 전역에서 사용하지만, 영역 C(적합도·분석)에서 직접 작성한 커스텀 훅이 대표 사례다.

| 파일 | 영역 | 역할 |
| --- | --- | --- |
| `features/analysis/hooks/useApplicationFitAnalysis.ts` | C | 적합도 분석 조회 + 생성/재생성, `loading`/`generating`/`error` 상태 노출 |
| `features/analysis/hooks/useFitAnalysisHistory.ts` | C | 적합도 분석 이력 조회 |
| `features/autoprep/hooks/useAutoPrepRun.ts` | C/공통 | SSE 스트림을 구독해 AutoPrep 6파트 진행 상태 누적 |
| `features/applications/hooks/useJobAnalysis.ts` 등 | B | 공고/회사 분석 조회 훅 |
| `app/context/AuthContext` (Context + 훅 소비) | 공통 | 전역 인증 상태 |

:::tip 영역 표시
훅 자체는 React 기본 기능(공통)이지만, 위 표의 `features/analysis/hooks/*`는 **영역 C 본인이 작성·소유**한 커스텀 훅이다. 면접에서 "내가 직접 만든 것"으로 자신 있게 말할 수 있는 부분.
:::

## 5. 핵심 동작 원리 (표/작은 코드/단계)

### 기본 3종 세트

| 훅 | 한 줄 역할 | CareerTuner 쓰임 |
| --- | --- | --- |
| `useState` | 렌더 사이에 보존되는 상태 + 변경 함수 | `loading`, `generating`, `error`, `analyses` |
| `useEffect` | 렌더 후 부수효과(데이터 패칭, 구독) + cleanup | 지원 건 변경 시 적합도 자동 로딩 |
| `useCallback` | 함수를 메모이즈해 동일 참조 유지 | `generate` 함수가 매 렌더 새로 생기지 않게 |

### 실제 코드(축약) — `useApplicationFitAnalysis`

```ts
export function useApplicationFitAnalysis(applicationCaseId: number | null, enabled: boolean) {
  const [analyses, setAnalyses] = useState<FitAnalysisDetail[]>([]);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 1) 의존성(id/enabled) 바뀌면 최신 적합도 자동 로딩
  useEffect(() => {
    if (!enabled || !applicationCaseId) { setAnalyses([]); return; }
    let ignore = false;          // 경쟁 조건 방지 플래그
    setLoading(true);
    getFitAnalysisByApplicationCase(applicationCaseId)
      .then((d) => { if (!ignore) setAnalyses(d ? [d] : []); })
      .finally(() => { if (!ignore) setLoading(false); });
    return () => { ignore = true; };   // cleanup: 이전 요청 결과 무시
  }, [applicationCaseId, enabled]);

  // 2) 생성/재생성은 별도 generating 상태로 구분
  const generate = useCallback(async () => {
    if (!applicationCaseId) return;
    setGenerating(true);
    try {
      const d = await generateFitAnalysis(applicationCaseId);
      setAnalyses(d ? [d] : []);
    } finally { setGenerating(false); }
  }, [applicationCaseId]);

  return { analyses, loading, generating, error, generate };
}
```

### 여기서 배울 3가지 설계 포인트

1. **상태 분리**: 단순 조회(`loading`)와 생성 작업(`generating`)을 다른 상태로 둬서, UI가 "불러오는 중"과 "생성 중"을 따로 표시할 수 있다.
2. **cleanup으로 경쟁 조건 방지**: `let ignore = false` + cleanup에서 `ignore = true`. 지원 건을 빠르게 바꾸면 늦게 도착한 이전 요청이 화면을 덮어쓰는 버그를 막는다.
3. **반환은 객체**: `{ analyses, loading, generating, error, generate }`를 돌려줘, 컴포넌트는 필요한 것만 구조분해로 꺼내 쓴다.

### 훅의 2대 규칙 (어기면 버그/경고)

```text
규칙 1) 최상위에서만 호출한다.
  - 조건문/반복문/중첩 함수 안에서 호출 금지.
  - React는 "호출 순서"로 어떤 state가 어떤 useState인지 식별하기 때문.
규칙 2) React 함수 안에서만 호출한다.
  - 함수형 컴포넌트 또는 다른 커스텀 훅 안에서만. 일반 JS 함수에서 호출 금지.
```

:::warning 흔한 사고
`if (something) { const [x] = useState() }` 처럼 조건부로 호출하면, 조건이 바뀌는 순간 훅 호출 순서가 달라져 state가 뒤섞인다. 그래서 위 코드도 `if (!enabled) return;`를 `useEffect` **밖이 아니라 안**에서 처리한다.
:::

## 6. 면접 답변 3단계 (초간단 1문장 / 기본 / 꼬리질문 대응)

- **초간단(1문장)**: "Hook은 함수형 컴포넌트에서 상태와 생명주기를 쓰게 해주는 React 함수입니다."
- **기본**: "클래스 없이도 `useState`로 상태, `useEffect`로 부수효과를 다루고, 반복되는 로직은 커스텀 훅으로 추출해 재사용합니다. 저는 적합도 분석 화면에서 `useApplicationFitAnalysis` 훅을 만들어 조회·생성 로직과 loading/generating/error 상태를 한 곳에 캡슐화했습니다."
- **꼬리질문 대응**: "훅에는 두 규칙이 있는데, 최상위에서만·React 함수 안에서만 호출해야 합니다. React가 호출 순서로 상태를 매칭하기 때문입니다. 그래서 조건 분기는 훅 밖이 아니라 `useEffect` 안에서 처리하고, 비동기 응답 경쟁은 cleanup의 `ignore` 플래그로 막았습니다."

## 7. 자주 나오는 꼬리질문 + 모범답안 (3~5개)

:::details Q1. 왜 훅은 조건문 안에서 호출하면 안 되나요?
React는 컴포넌트가 렌더될 때마다 훅을 **호출된 순서대로** 내부 배열에 매칭합니다. 조건문 때문에 어떤 렌더에서는 `useState`가 호출되고 다른 렌더에서는 건너뛰면, 순서가 어긋나 상태가 엉뚱한 변수에 들어갑니다. 그래서 항상 최상위에서 같은 순서로 호출해야 합니다.
:::

:::details Q2. `useEffect`의 cleanup 함수는 언제 실행되나요?
의존성 배열이 바뀌어 effect가 다시 실행되기 직전, 그리고 컴포넌트가 언마운트될 때 실행됩니다. CareerTuner 적합도 훅에서는 지원 건 id가 바뀔 때마다 cleanup이 `ignore = true`로 이전 요청 결과를 무효화해, 늦게 온 응답이 새 화면을 덮어쓰는 경쟁 조건을 막습니다.
:::

:::details Q3. `useCallback`은 왜 쓰나요? 없으면 안 되나요?
함수는 매 렌더마다 새로 생성되므로 참조가 바뀝니다. 이 함수를 자식 컴포넌트 prop이나 다른 훅의 의존성 배열에 넘기면, 매번 "바뀐 것"으로 인식돼 불필요한 재실행·재렌더가 생깁니다. `useCallback`은 의존성이 같으면 같은 함수 참조를 유지해 이를 막습니다. 필수는 아니지만, `generate`를 버튼이나 자식에 안정적으로 넘기려고 사용했습니다.
:::

:::details Q4. 커스텀 훅과 일반 유틸 함수의 차이는?
커스텀 훅은 내부에서 다른 훅(`useState` 등)을 호출할 수 있고 React 렌더 생명주기에 묶입니다. 그래서 이름이 `use`로 시작해야 하고 훅 규칙을 따릅니다. 일반 유틸 함수는 상태가 없는 순수 계산만 합니다. `useApplicationFitAnalysis`는 상태와 effect를 가지므로 훅, 단순 포맷팅 함수는 유틸로 둡니다.
:::

:::details Q5. 전역 상태는 훅으로 안 다루나요? Zustand/Context와의 관계는?
훅과 충돌하지 않고 함께 씁니다. CareerTuner는 전역 인증을 React Context(`AuthContext`)로, 그 외 전역 상태를 [Zustand](/frontend/state-management)로 관리합니다. 이들도 결국 `useContext`나 Zustand의 `useStore` 같은 **훅으로 소비**합니다. 화면-로컬 비동기 상태는 `useApplicationFitAnalysis` 같은 자체 커스텀 훅으로 분리했습니다.
:::

## 8. 직접 말해보기 (말하기 훈련용 질문 1~2개)

1. "`useApplicationFitAnalysis` 훅이 `loading`과 `generating`을 따로 둔 이유를, 사용자가 보는 화면 동작과 연결해서 30초로 설명해보세요."
2. "훅의 두 규칙을 말하고, 왜 그 규칙이 필요한지 'React가 호출 순서로 상태를 식별한다'는 점을 근거로 설명해보세요."

## 퀴즈

<QuizBox question="React 훅의 이름은 반드시 무엇으로 시작해야 하며, 그 이유는?" :choices="['get으로 시작 - 데이터를 가져오므로','use로 시작 - React와 린트 도구가 훅 규칙을 검사할 수 있도록','on으로 시작 - 이벤트 핸들러라서','do로 시작 - 동작을 수행하므로']" :answer="1" explanation="훅은 use 접두사로 시작해야 합니다. 이 규칙 덕분에 React와 eslint-plugin-react-hooks가 해당 함수를 훅으로 인식하고 호출 규칙(최상위 호출 등)을 검사할 수 있습니다." />

<QuizBox question="다음 중 훅 호출 규칙을 위반한 것은?" :choices="['컴포넌트 최상위에서 useState 호출','커스텀 훅 안에서 useEffect 호출','if 조건문 안에서 useState 호출','컴포넌트 함수 본문 첫 줄에서 useCallback 호출']" :answer="2" explanation="훅은 조건문, 반복문, 중첩 함수 안에서 호출하면 안 됩니다. React가 호출 순서로 상태를 매칭하기 때문에, 조건부 호출은 렌더마다 순서를 바꿔 상태를 뒤섞습니다." />

<QuizBox question="useApplicationFitAnalysis 훅의 useEffect가 cleanup에서 ignore 플래그를 true로 만드는 이유를 설명해보세요." explanation="지원 건 id를 빠르게 바꾸면 이전 비동기 요청이 늦게 도착해 새 화면을 덮어쓰는 경쟁 조건(race condition)이 발생할 수 있습니다. cleanup에서 ignore를 true로 만들면, 이전 effect에서 시작한 요청의 then/finally 콜백이 setState를 건너뛰므로, 항상 가장 최근 요청 결과만 화면에 반영됩니다." />
