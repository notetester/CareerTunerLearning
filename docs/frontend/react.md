# React

> React는 UI를 상태(state)의 함수로 보고, 상태가 바뀌면 화면을 자동으로 다시 그려주는 선언형 컴포넌트 라이브러리입니다. CareerTuner 프론트엔드 전체가 React 19.2.7 함수형 컴포넌트 + Hooks로 작성돼 있습니다.

## 1. 한 줄 정의

상태와 props를 입력으로 받아 "지금 화면이 어떻게 생겨야 하는가"를 선언하면, React가 가상 DOM 비교(diffing)를 통해 실제 DOM을 최소한으로 갱신해주는 UI 라이브러리.

## 2. 단어 뜻 (약자/어원 풀이)

| 용어 | 뜻 |
| --- | --- |
| React | "데이터 변화에 반응(react)해 UI가 바뀐다"에서 온 이름. 프레임워크가 아니라 UI 라이브러리. |
| 컴포넌트(Component) | 화면을 이루는 재사용 가능한 조각. CareerTuner에서는 props를 받아 JSX를 반환하는 함수. |
| JSX | JavaScript XML. JS 안에서 HTML 비슷한 문법으로 UI를 기술. Vite가 빌드 시 `React.createElement` 호출로 변환. |
| 선언형(Declarative) | "어떻게 그릴지(절차)" 대신 "무엇을 그릴지(결과)"를 기술하는 방식. |
| 가상 DOM(Virtual DOM) | 실제 DOM의 가벼운 JS 객체 사본. 바뀐 부분만 골라 실제 DOM에 반영하기 위한 중간 표현. |
| Hook | 함수형 컴포넌트에서 상태·생명주기 같은 기능을 "걸어(hook into)" 쓰는 함수. 이름이 `use`로 시작. |

## 3. 왜 필요한가 (없으면 무슨 문제가 생기나)

순수 DOM API(`document.getElementById`, `innerHTML`)로 복잡한 화면을 만들면:

- **상태와 화면이 따로 논다.** 적합도 점수가 바뀔 때마다 점수 텍스트, 프로그레스 바, 색상 톤, 경고 배지를 개발자가 일일이 찾아 수동 갱신해야 한다. 한 군데라도 빠뜨리면 화면과 데이터가 어긋난다.
- **DOM 조작 코드가 흩어진다.** "무엇을 보여줄지"와 "어떻게 바꿀지"가 뒤섞여 유지보수가 어렵다.
- **재사용이 어렵다.** 같은 카드 UI를 여러 곳에서 쓰려면 복붙해야 한다.

React는 "상태 → UI"를 함수로 못박는다. 상태가 바뀌면 컴포넌트 함수를 다시 호출해 새 가상 DOM을 만들고, 이전 것과 비교해 **달라진 부분만** 실제 DOM에 반영한다. 개발자는 "현재 상태에서 화면이 어떻게 생겨야 하는가"만 쓰면 된다.

## 4. CareerTuner에서 어디에 썼나 (실제 클래스/파일/테이블, 영역 표시)

CareerTuner 프론트엔드는 `frontend/src/features/<기능>/{api,components,hooks,pages,types}` 구조로 기능별 수직 분리돼 있고, React 19.2.7 함수형 컴포넌트와 Hooks를 사용한다.

| 영역 | 파일 | React 쓰임새 |
| --- | --- | --- |
| C | `features/applications/components/FitAnalysisPanel.tsx` | 선언형 렌더링·조건부 렌더링·리스트 렌더링(key)의 교과서. props로 분석 결과를 받아 점수/매칭역량/부족역량/판정 카드를 그림 |
| C | `features/analysis/hooks/useApplicationFitAnalysis.ts` | 커스텀 Hook. `useState`/`useEffect`/`useCallback`로 적합도 분석 로드·생성 로직을 캡슐화 |
| 공통 | `app/auth/AuthContext.tsx` | `createContext`/`useContext`로 전역 인증 상태(user, isAuthenticated, login/logout) 공유 |
| C | `features/analysis/pages/AnalysisPage.tsx` | 페이지 컴포넌트(라우트 진입점), Hook을 호출해 패널 컴포넌트에 props 주입 |
| 다수 | `features/*/components/*.tsx` (약 90개) | 모든 UI가 함수형 컴포넌트로 분해됨 |

:::tip 면접에서 강조할 포인트
"FitAnalysisPanel은 부모가 내려준 `analyses`, `loading`, `generating`, `error` props만으로 화면 전체를 선언합니다. 데이터 fetching은 useApplicationFitAnalysis Hook이, 표시는 패널이 담당하도록 관심사를 분리했습니다."
:::

## 5. 핵심 동작 원리 (표/작은 코드/단계)

### (1) 선언형 + 단방향 데이터 흐름

데이터는 항상 **부모 → 자식(props)** 한 방향으로 흐른다. CareerTuner의 적합도 화면이 정확히 이 구조다.

```text
useApplicationFitAnalysis (Hook: 상태 보유)
        │  analyses, loading, generating, error
        ▼
AnalysisPage (호출 + props 전달)
        │  props
        ▼
FitAnalysisPanel (props 받아 화면만 선언)
```

자식이 부모 상태를 바꾸려면 부모가 내려준 콜백(예: `generate`)을 호출한다. 자식이 부모 데이터를 직접 수정하지 못하게 막아 데이터 흐름을 예측 가능하게 만든다.

### (2) 조건부 렌더링 / 리스트 렌더링

`FitAnalysisPanel`의 실제 패턴(축약):

```tsx
{generating && <FitAnalysisProgress />}
{!generating && loading && <StateCard title="적합도 분석을 불러오는 중입니다." />}
{error && <StateCard title={error} tone="error" />}
{!generating && !loading && !error && analyses.length === 0 && (
  <StateCard title="아직 적합도 분석 결과가 없습니다." />
)}

{analyses.map((analysis) => (
  <Card key={analysis.id}>...</Card>
))}
```

- `조건 && <JSX>` : 조건이 참일 때만 렌더링.
- `배열.map(...)` : 데이터 배열을 컴포넌트 배열로 변환. 각 요소에 **고유 `key`**(여기서는 `analysis.id`)를 줘야 React가 diff 시 어떤 항목이 추가·삭제·이동됐는지 추적한다.

### (3) Hooks — 함수형 컴포넌트의 상태와 부수효과

CareerTuner가 실제로 쓰는 핵심 Hook:

| Hook | 역할 | CareerTuner 예시 |
| --- | --- | --- |
| `useState` | 컴포넌트 지역 상태 | `const [analyses, setAnalyses] = useState<FitAnalysisDetail[]>([])` |
| `useEffect` | 렌더 후 부수효과(데이터 fetch, 구독). 의존성 배열 변할 때 재실행 | `applicationCaseId` 바뀌면 적합도 자동 재조회 |
| `useCallback` | 함수 참조를 메모이즈해 불필요한 재생성·재렌더 방지 | `generate` 콜백 |
| `useContext` | 상위 Context 값 구독 | `useAuth()` 내부에서 AuthContext 구독 |

`useApplicationFitAnalysis` Hook의 핵심(축약):

```ts
useEffect(() => {
  if (!enabled || !applicationCaseId) { setAnalyses([]); return; }
  let ignore = false;                 // race condition 방지 플래그
  setLoading(true);
  getFitAnalysisByApplicationCase(applicationCaseId)
    .then((detail) => { if (!ignore) setAnalyses(detail ? [detail] : []); })
    .finally(() => { if (!ignore) setLoading(false); });
  return () => { ignore = true; };     // cleanup: 이전 요청 결과 무시
}, [applicationCaseId, enabled]);      // 의존성 배열
```

:::warning 이 cleanup이 왜 중요한가
사용자가 지원 건을 빠르게 전환하면 이전 요청 응답이 늦게 도착해 새 화면 위에 덮어쓸 수 있다(stale response). `ignore` 플래그 + cleanup 함수로 "더 이상 유효하지 않은 응답은 버린다"를 구현했다. 이게 useEffect cleanup의 대표적 실전 용례다.
:::

### (4) 가상 DOM 갱신 흐름

```text
setState 호출 → 컴포넌트 함수 재실행 → 새 가상 DOM 트리 생성
   → 이전 트리와 diff(reconciliation) → 달라진 노드만 실제 DOM에 commit
```

전체 DOM을 다시 그리지 않고 **차이만** 반영하므로 빠르다. 적합도 점수만 바뀌면 점수 텍스트와 프로그레스 바만 갱신되고 나머지 카드 구조는 그대로 유지된다.

### (5) Context — props drilling 없는 전역 상태

`AuthContext.tsx`는 `createContext`로 컨텍스트를 만들고, `AuthProvider`가 `value`로 user/login/logout을 내려준다. 어느 깊이의 컴포넌트든 `useContext`(래핑한 `useAuth()`)로 꺼내 쓴다. 인증 같은 진짜 전역 상태에만 쓰고, 그 외 상태는 Zustand를 사용한다.

## 6. 면접 답변 3단계 (초간단 1문장 / 기본 / 꼬리질문 대응)

- **초간단(1문장):** "React는 상태를 선언하면 UI를 알아서 그려주는 컴포넌트 기반 선언형 UI 라이브러리입니다."
- **기본:** "함수형 컴포넌트가 props와 state를 입력받아 JSX를 반환하고, 상태가 바뀌면 React가 가상 DOM을 비교해 달라진 부분만 실제 DOM에 반영합니다. CareerTuner에서는 데이터 로딩을 커스텀 Hook(useApplicationFitAnalysis)에, 화면 표시를 패널 컴포넌트(FitAnalysisPanel)에 분리해 단방향 데이터 흐름으로 구성했습니다."
- **꼬리질문 대응:** "전역 인증 상태는 Context API(AuthContext)로, 그 외 상태는 Zustand로 나눴고, useEffect cleanup으로 지원 건 전환 시 stale 응답을 무시하는 등 실전 함정도 처리했습니다."

## 7. 자주 나오는 꼬리질문 + 모범답안 (3~5개)

:::details Q1. 가상 DOM이 빠른 이유는? 실제 DOM보다 항상 빠른가?
실제 DOM 조작(특히 reflow/repaint)은 비싸다. 가상 DOM은 JS 객체라 비교가 싸고, diff 결과 **바뀐 노드만** 한 번에 실제 DOM에 반영해 비싼 조작 횟수를 줄인다. 단 "항상 빠르다"는 오해다. diff 자체에도 비용이 있어서, 단순 정적 페이지라면 순수 DOM이 더 빠를 수 있다. 가상 DOM의 진짜 가치는 속도보다 "상태→UI를 선언형으로 안전하게 관리"하는 데 있다.
:::

:::details Q2. 리스트 렌더링에서 key에 index를 쓰면 안 되는 이유?
key는 React가 재조정 시 항목의 동일성을 추적하는 식별자다. index를 key로 쓰면 항목이 추가·삭제·정렬될 때 같은 index가 다른 데이터를 가리켜, 입력값이 엉뚱한 행에 남거나 불필요한 재생성이 일어난다. CareerTuner는 `analysis.id` 같은 데이터 고유 식별자를 key로 쓴다.
:::

:::details Q3. useEffect 의존성 배열을 비우면([]) / 안 넣으면 각각 어떻게 되나?
`[]`이면 마운트 시 1회만 실행, 언마운트 시 cleanup 1회. 의존성 배열을 아예 생략하면 매 렌더마다 실행돼 무한 루프나 과도한 요청을 부른다. 값을 넣으면(`[applicationCaseId]`) 그 값이 바뀔 때마다 재실행된다. CareerTuner는 `[applicationCaseId, enabled]`로 지원 건이 바뀔 때만 재조회한다.
:::

:::details Q4. 클래스 컴포넌트 대신 함수형 + Hooks를 쓰는 이유?
`this` 바인딩 문제가 없고, 로직을 커스텀 Hook으로 추출해 재사용하기 쉽다. 생명주기 메서드(componentDidMount/Update/Unmount)에 흩어지던 관련 로직을 하나의 useEffect에 응집할 수 있다. CareerTuner는 모든 컴포넌트가 함수형이고, 적합도 로딩 로직을 useApplicationFitAnalysis Hook으로 떼어 페이지 간 재사용 가능하게 했다.
:::

:::details Q5. 단방향 데이터 흐름이 주는 이점은?
데이터가 부모→자식 한 방향으로만 흐르므로 "이 값이 어디서 바뀌었나"를 추적하기 쉽고 디버깅이 단순하다. 자식이 부모 상태를 직접 바꾸지 못하고 콜백으로만 요청하므로 상태 변경 지점이 한곳에 모인다. CareerTuner에서 FitAnalysisPanel은 화면만 선언하고, 상태 변경은 부모/Hook이 책임진다.
:::

## 8. 직접 말해보기 (말하기 훈련용 질문 1~2개)

1. "CareerTuner의 적합도 분석 화면을 예로, 사용자가 지원 건을 클릭했을 때 데이터가 어떻게 흘러 화면이 갱신되는지 Hook과 props 흐름으로 30초 안에 설명해보세요."
2. "useEffect의 cleanup 함수를 CareerTuner에서 왜 썼는지, 안 썼다면 어떤 버그가 났을지 한 문장으로 말해보세요."

관련 학습: [DTO](/glossary/dto) · [JWT 보안](/backend/jwt-security)

## 퀴즈

<QuizBox question="React에서 배열을 map으로 렌더링할 때 각 요소에 고유 key를 주는 주된 이유는?" :choices="['CSS 스타일을 적용하기 위해', '재조정(diff) 시 어떤 항목이 추가·삭제·이동됐는지 추적하기 위해', 'key가 없으면 컴파일 에러가 나서', '서버에 데이터를 저장하기 위해']" :answer="1" explanation="key는 React가 가상 DOM diff에서 항목의 동일성을 추적하는 식별자입니다. CareerTuner의 FitAnalysisPanel은 analysis.id를 key로 써서 카드가 추가·삭제될 때 올바르게 갱신되도록 합니다." />

<QuizBox question="useApplicationFitAnalysis Hook의 useEffect가 cleanup에서 ignore 플래그를 true로 만드는 이유를 설명하세요." explanation="사용자가 지원 건을 빠르게 전환하면 이전 요청의 응답이 늦게 도착해 새 화면 데이터를 덮어쓸 수 있습니다(stale response, race condition). cleanup 함수에서 ignore를 true로 만들고, 응답 처리 시 if(!ignore) 조건으로 막아 더 이상 유효하지 않은 이전 요청의 결과를 무시합니다. 의존성 배열(applicationCaseId, enabled)이 바뀌어 effect가 재실행되기 직전 React가 이전 cleanup을 호출하므로 동작합니다." />

<QuizBox question="CareerTuner에서 전역 인증 상태(로그인 사용자, login/logout)를 컴포넌트 트리 전체에 공유하기 위해 사용한 React 기능은?" :choices="['useState만으로 최상위에서 관리', 'Context API(createContext/useContext)', 'localStorage 직접 읽기', 'props로 모든 컴포넌트에 일일이 전달']" :answer="1" explanation="app/auth/AuthContext.tsx에서 createContext로 컨텍스트를 만들고 AuthProvider가 value로 user·login·logout을 내려주며, 하위 컴포넌트는 useContext(useAuth)로 구독합니다. props drilling 없이 전역 상태를 공유하는 표준 패턴입니다." />
