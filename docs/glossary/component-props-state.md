# 컴포넌트 / Props / State

> "React UI는 컴포넌트(화면 조각)로 쪼개고, 부모가 자식에게 내려주는 입력값이 props, 컴포넌트가 스스로 들고 바뀌는 값이 state입니다. props는 읽기 전용, state는 setter로 바꿔야 다시 렌더링됩니다."

## 1. 한 줄 정의

- **컴포넌트(Component)**: 화면 한 조각을 그리는 재사용 가능한 함수. 입력(props)을 받아 JSX(화면)를 반환한다.
- **Props(properties)**: 부모 컴포넌트가 자식에게 내려주는 **읽기 전용 입력값**.
- **State(상태)**: 컴포넌트가 **내부에 들고 있는, 시간에 따라 변하는 값**. 바뀌면 화면이 다시 그려진다.

한 문장: **props는 밖에서 받는 값, state는 안에서 관리하는 값.**

## 2. 단어 뜻 (약자/어원 풀이)

| 용어 | 어원 / 풀이 |
| --- | --- |
| Component | "구성 요소". UI를 레고 블록처럼 조립하는 단위 |
| Props | **prop**erties의 줄임말. HTML 속성(`<img src=...>`)처럼 컴포넌트에 넘기는 속성 |
| State | "상태". 게임 캐릭터의 HP처럼 변하는 내부 값 |
| 함수형 컴포넌트 | `function Foo() { return <div/> }` — 함수가 곧 컴포넌트. (옛날엔 class 컴포넌트였음) |
| Hook | `use`로 시작하는 함수(`useState`, `useEffect`). 함수형 컴포넌트에 상태·생명주기를 "걸어주는(hook)" 장치 |

## 3. 왜 필요한가 (없으면 무슨 문제가 생기나)

- **컴포넌트가 없으면**: 화면 전체가 하나의 거대한 함수가 되어 재사용·테스트·수정이 불가능하다. 같은 카드 UI를 10번 복붙하게 된다.
- **props가 없으면**: 부모-자식 사이에 데이터를 넘길 표준 통로가 없다. 자식 컴포넌트가 매번 자기가 데이터를 가져와야 해서 재사용성이 깨진다.
- **state가 없으면**: 사용자 입력·로딩 여부·서버 응답 같은 "변하는 값"을 화면에 반영할 수 없다. 버튼을 눌러도 아무 반응 없는 정적 페이지가 된다.

:::tip 핵심 직관
**"props는 함수의 인자, state는 함수가 기억하는 변수"** 라고 생각하면 거의 맞다. props는 부모가 정하고 자식은 못 바꾼다. state는 자식이 직접 `setState`로 바꾸고, 바꾸면 React가 자동으로 다시 그린다.
:::

## 4. CareerTuner에서 어디에 썼나 (실제 클래스/파일/테이블, 영역 표시)

프런트는 `frontend/src/features/<기능>/{api,components,hooks,pages,types}` 구조로 기능을 수직 분할한다. 컴포넌트·props·state가 한 세트로 어떻게 쓰이는지 **영역 C(적합도 분석)** 의 실제 코드로 본다.

| 역할 | 파일 | 설명 |
| --- | --- | --- |
| 컴포넌트(자식) | `features/applications/components/FitAnalysisPanel.tsx` | 적합도 분석 결과를 카드로 그리는 화면 조각 |
| Props 인터페이스 | `FitAnalysisPanelProps` (같은 파일) | 부모가 내려주는 입력 4종 |
| State + 데이터 로딩 | `features/analysis/hooks/useApplicationFitAnalysis.ts` | `useState`로 상태 4개 관리하는 커스텀 훅 |
| 부모(조립 지점) | `features/applications/pages/ApplicationDetailPage.tsx` | 훅의 state를 패널의 props로 연결 |

실제 props 정의 (영역 C, 그대로 발췌):

```tsx
interface FitAnalysisPanelProps {
  analyses: FitAnalysisDetail[];   // 적합도 분석 결과 목록
  loading: boolean;                // 불러오는 중인가
  generating?: boolean;            // 생성/재생성 진행 중인가 (선택, 기본 false)
  error: string | null;            // 에러 메시지 (없으면 null)
}

export function FitAnalysisPanel({ analyses, loading, generating = false, error }: FitAnalysisPanelProps) {
  // props를 구조분해(destructuring)로 받고, 그대로 화면 분기에 사용
}
```

state는 컴포넌트에 직접 두지 않고 **커스텀 훅** `useApplicationFitAnalysis`에 모았다(영역 C):

```ts
const [analyses, setAnalyses] = useState<FitAnalysisDetail[]>([]);
const [loading, setLoading] = useState(false);
const [generating, setGenerating] = useState(false);
const [error, setError] = useState<string | null>(null);
// ...서버 호출 후 setAnalyses(detail ? [detail] : []) 로 상태 갱신
return { analyses, loading, generating, error, generate };
```

부모(`ApplicationDetailPage`)가 훅의 반환 state를 패널의 props로 그대로 흘려준다. 즉 **"훅의 state -> 부모가 받음 -> props로 자식에 전달"** 이라는 단방향 흐름이 한눈에 보인다.

:::details 다른 영역에서도 같은 패턴
- 영역 D/E 가상면접: `features/interview/components/*Tab.tsx` 가 props로 세션 데이터를 받고, `useInterviewSessions` 훅이 state를 관리한다.
- 영역 C 대시보드: `features/dashboard/components/ReadinessGaugeCard.tsx` 등도 같은 "props in, state in hook" 구조.

state를 훅으로 빼는 이유는, 같은 상태 로직을 여러 컴포넌트가 재사용하고 컴포넌트는 "그리기"에만 집중하게 하기 위해서다.
:::

## 5. 핵심 동작 원리 (표/작은 코드/단계)

**props vs state 비교**

| 구분 | props | state |
| --- | --- | --- |
| 누가 정하나 | 부모 컴포넌트 | 컴포넌트 자신 |
| 바꿀 수 있나 | 자식은 **읽기 전용**(불변) | `setState`로만 변경 |
| 바뀌면? | 부모가 새 값 내려주면 재렌더 | setter 호출 시 재렌더 |
| 비유 | 함수의 인자 | 함수가 기억하는 변수 |

**렌더링 흐름(단계)**

1. 컴포넌트 함수가 실행되어 JSX를 반환 -> 화면 그림
2. 사용자가 버튼 클릭 -> 이벤트 핸들러가 `setError("...")` 호출
3. React가 state 변경을 감지 -> **해당 컴포넌트 함수를 다시 실행**
4. 새 state 기준으로 JSX를 다시 만들고, 바뀐 부분만 DOM에 반영

```tsx
function Counter() {
  const [count, setCount] = useState(0);   // [현재값, 바꾸는 함수]
  return <button onClick={() => setCount(count + 1)}>{count}</button>;
}
```

:::warning state는 직접 바꾸면 안 된다
`count = count + 1` 처럼 변수를 직접 수정하면 화면이 안 바뀐다. 반드시 `setCount(...)` setter를 써야 React가 재렌더한다. 배열·객체도 마찬가지로 `setAnalyses([...])` 처럼 **새 값**을 넣는다(불변성). CareerTuner의 훅이 `setAnalyses(detail ? [detail] : [])` 로 새 배열을 만드는 이유다.
:::

## 6. 면접 답변 3단계 (초간단 1문장 / 기본 / 꼬리질문 대응)

- **초간단(1문장)**: "props는 부모가 자식에게 내려주는 읽기 전용 입력, state는 컴포넌트가 직접 관리하며 바뀌면 화면을 다시 그리는 내부 값입니다."
- **기본**: "React UI는 함수형 컴포넌트로 쪼갭니다. 컴포넌트는 props를 인자로 받아 JSX를 반환하고, 변하는 값은 `useState`로 만든 state로 관리합니다. 저희 프로젝트에선 `FitAnalysisPanel`이 `analyses·loading·generating·error`를 props로 받고, 그 state는 `useApplicationFitAnalysis` 훅에서 `useState`로 관리해 부모가 props로 연결합니다."
- **꼬리질문 대응**: "state를 컴포넌트에 직접 두지 않고 커스텀 훅으로 뺀 이유는, 서버 호출·로딩·에러 상태 로직을 여러 패널이 재사용하고 컴포넌트는 렌더링에만 집중하게 하려는 관심사 분리 때문입니다. props는 불변이라 자식이 못 바꾸므로 데이터 흐름이 위->아래 단방향으로 예측 가능해집니다."

## 7. 자주 나오는 꼬리질문 + 모범답안

**Q1. props와 state의 차이를 한 문장으로?**
props는 밖(부모)에서 주는 읽기 전용 입력, state는 안에서 관리하는 변하는 값. props는 자식이 못 바꾸고, state는 setter로만 바꾼다.

**Q2. 왜 state를 직접 수정하면 안 되나?**
React는 setter 호출을 트리거로 재렌더링을 결정한다. 변수를 직접 바꾸면 React가 변경을 모르고 화면이 갱신되지 않는다. 또 불변성을 지켜야 이전/이후 값 비교(얕은 비교)가 정확해져 불필요한 재렌더를 피할 수 있다.

**Q3. 부모가 자식의 state를 바꾸고 싶으면?**
직접 못 바꾼다. 부모가 자식에게 **콜백 함수를 props로 내려주고**, 자식이 그 콜백을 호출해 부모의 state를 바꾸게 한다(상태 끌어올리기, lifting state up). CareerTuner에선 `useApplicationFitAnalysis`가 `generate` 함수까지 반환해 부모가 버튼에 연결한다.

**Q4. 커스텀 훅은 왜 쓰나?**
`useState`/`useEffect` 묶음을 재사용 가능한 함수로 뽑은 것. 상태 로직(서버 호출, 로딩·에러 관리)을 컴포넌트에서 분리해 여러 곳에서 재사용하고 테스트하기 쉽게 만든다. `use`로 시작하는 이름이 규칙이다.

**Q5. props 타입은 어떻게 보장하나?**
TypeScript `interface`로 props 모양을 정의한다(`FitAnalysisPanelProps`). `?`를 붙이면 선택 prop(`generating?`), 기본값은 구조분해에서 `generating = false`로 준다. 잘못된 타입을 넘기면 `npm run typecheck`(tsc --noEmit) 단계에서 컴파일 에러로 잡힌다.

## 8. 직접 말해보기 (말하기 훈련용 질문)

1. (타이머 30초) "CareerTuner의 `FitAnalysisPanel`을 예로, props와 state가 어떻게 연결되는지 데이터 흐름을 말로 설명해보세요. '훅 -> 부모 -> props -> 자식' 순서가 들어가야 합니다."
2. 동료에게 설명하듯이: "왜 적합도 분석의 로딩·에러 상태를 컴포넌트 안이 아니라 `useApplicationFitAnalysis` 훅에 뒀나요?" 라는 질문에 30초 안에 답해보세요.

연관 개념도 같이 정리하면 좋다: [DTO](/glossary/dto), [JWT 인증](/backend/jwt-security).

## 퀴즈

<QuizBox question="props에 대한 설명으로 옳은 것은?" :choices="['컴포넌트가 직접 setter로 바꾼다', '부모가 자식에게 내려주는 읽기 전용 입력값이다', '바뀌어도 화면은 다시 그려지지 않는다', '서버 DB 테이블 컬럼과 1:1로 매핑된다']" :answer="1" explanation="props는 부모가 자식에게 내려주는 읽기 전용 입력값입니다. 자식은 props를 직접 바꿀 수 없고, 바꿔야 하는 변하는 값은 state로 관리합니다." />

<QuizBox question="CareerTuner에서 FitAnalysisPanel의 로딩·에러 같은 state를 컴포넌트에 직접 두지 않고 useApplicationFitAnalysis 훅으로 분리한 이유는?" :choices="['훅이 아니면 useState를 쓸 수 없어서', '상태 로직을 재사용·분리하고 컴포넌트는 렌더링에 집중시키기 위해', 'props를 없애기 위해', 'TypeScript 타입체크를 건너뛰기 위해']" :answer="1" explanation="서버 호출·로딩·에러 같은 상태 로직을 커스텀 훅으로 빼면 여러 패널이 재사용할 수 있고, 컴포넌트는 받은 데이터를 그리는 일에만 집중하게 됩니다. 관심사 분리가 핵심 이유입니다." />

<QuizBox question="React에서 state를 직접 변수 수정으로 바꾸면 안 되고 setter(예: setAnalyses)를 써야 하는 이유를 설명하세요." explanation="React는 setter 호출을 재렌더링 트리거로 사용합니다. 변수를 직접 수정하면 React가 변경을 감지하지 못해 화면이 갱신되지 않습니다. 또한 불변성을 지켜 새 값(새 배열·객체)을 넣어야 이전 값과의 얕은 비교가 정확해져 올바른 재렌더 판단이 가능합니다. 그래서 CareerTuner의 훅도 setAnalyses(detail ? [detail] : []) 처럼 새 배열을 만들어 넣습니다." />
