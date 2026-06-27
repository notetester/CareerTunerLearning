# 데이터 시각화 (Recharts)

> Recharts는 React 컴포넌트로 차트를 조립하는 선언형 차트 라이브러리다. `<BarChart>` 안에 `<Bar>` `<XAxis>` `<Tooltip>`을 자식으로 넣으면 SVG 차트가 그려지고, `<ResponsiveContainer>`로 감싸면 부모 크기에 맞춰 반응형으로 리사이즈된다.

## 1. 한 줄 정의

Recharts는 D3를 내부에서 쓰되 그걸 **React 컴포넌트 트리로 추상화한 선언형 차트 라이브러리**다. "어떻게 그릴지"(명령형)가 아니라 "무엇을 그릴지"(데이터 + 차트 구성요소)를 JSX로 선언하면 라이브러리가 SVG를 그려준다.

CareerTuner는 `recharts` 2.15.2를 쓴다. 면접 답변 점수 막대 차트(영역 D)에서 직접 사용 중이고, 영역 C 분석 화면의 점수 변화·직무 분포는 현재 CSS 막대로 그려진 상태다(아래 4번에서 정직하게 구분).

## 2. 단어 뜻 (약자/어원 풀이)

| 용어 | 풀이 |
| --- | --- |
| Recharts | "Re(act) + charts". React 친화 차트 라이브러리라는 작명 |
| 선언형 (declarative) | 그리는 절차가 아니라 결과 구조를 기술하는 방식. JSX 자식으로 축·막대·툴팁을 나열 |
| D3 | Recharts가 내부적으로 의존하는 저수준 데이터 시각화 엔진(d3-scale, d3-shape 등) |
| SVG | Recharts가 출력하는 벡터 그래픽. 확대해도 안 깨지고 DOM 요소라 CSS로 스타일 가능 |
| `ResponsiveContainer` | 부모 박스 크기를 측정해 차트를 그 크기에 맞춰 다시 그리는 래퍼 |
| `dataKey` | 데이터 객체에서 어떤 필드를 축/막대 값으로 쓸지 지정하는 키 |
| `Cell` | 막대/조각 하나하나를 개별 색으로 칠할 때 쓰는 자식 요소 |

## 3. 왜 필요한가 (없으면 무슨 문제가 생기나)

차트를 직접 그리려면 두 갈래 고생이 있다.

- **순수 D3로 직접 그리기**: `select`, `append`, `attr`로 SVG를 명령형으로 조작한다. React의 가상 DOM과 D3의 직접 DOM 조작이 충돌해 "누가 DOM의 주인이냐" 문제가 생기고, 컴포넌트 재사용·상태 연동이 까다롭다.
- **CSS/`<div>`로 직접 그리기**: 단순 막대는 가능하지만(아래 C 영역 사례), 축 눈금·툴팁 호버·반응형 리사이즈·여러 시리즈 겹치기로 가면 금방 재발명 지옥이 된다.

Recharts는 이 둘 사이를 메운다. **차트 구성요소를 React 컴포넌트로 제공**해서 데이터를 props로 흘리면 끝이고, 툴팁·축·반응형 같은 귀찮은 부분을 기본 제공한다.

:::tip
"왜 그냥 div 막대로 안 하고 라이브러리를 썼냐"는 꼬리질문이 나온다. 답: 단일 막대 한 줄은 div가 더 가볍지만, **축 눈금 + 호버 툴팁 + 부모 크기 반응형 + 값 구간별 색칠**이 동시에 필요한 순간 라이브러리가 이긴다. CareerTuner도 그래서 면접 점수 차트는 Recharts, 단순 진행률 막대는 `Progress`로 갈랐다.
:::

## 4. CareerTuner에서 어디에 썼나 (실제 클래스/파일/영역)

| 위치 | 영역 | 무엇을 | 상태 |
| --- | --- | --- | --- |
| `features/interview/components/ModeSelectTab.tsx` | D (면접) | 질문별 답변 점수 `BarChart` (값 구간별 색칠) | Recharts 실사용 |
| `app/components/ui/chart.tsx` | 공통 | shadcn 차트 래퍼(`ChartContainer`/`ChartTooltipContent`/`ChartLegendContent`) | 공통 인프라 |
| `features/analysis/pages/AnalysisPage.tsx` | C (분석) | 적합도 점수 변화, 직무 분포, 기술스택별 적합도 | **현재 CSS 막대 + `Progress`** |

:::warning 정직한 구분
집중 포인트는 "적합도 점수·취업경향·대시보드 시각화(영역 C)"지만, **영역 C의 `AnalysisPage`는 지금 Recharts를 직접 쓰지 않는다.** 점수 변화는 `flex` + 높이 `style`로 그린 CSS 막대이고, 직무 분포·직무별 준비도는 shadcn `Progress` 컴포넌트로 비율 막대를 그린다. Recharts를 실제로 import해서 쓰는 화면은 영역 D의 `ModeSelectTab`이다. 면접에서는 "프로젝트에 Recharts가 도입돼 있고 면접 점수 차트에 쓰며, 내 C 분석 화면은 단순 막대라 CSS/`Progress`로 처리했다 — 시리즈가 늘면 Recharts로 옮길 계획"이라고 말하면 사실 그대로다.
:::

영역 C에서 CSS 막대를 택한 이유를 말로 설명할 수 있어야 한다: 점수 변화 막대는 **단일 시리즈 + 마지막 값만 강조색**이라 축 눈금·툴팁이 불필요했고, 직무 분포는 사실상 가로 비율 바라 `Progress`가 더 가볍다. 즉 "필요 복잡도에 맞춰 도구를 골랐다"가 핵심 메시지다.

## 5. 핵심 동작 원리 (선언형 조립 + 반응형)

ModeSelectTab의 실제 패턴을 학습용으로 축약하면 이렇다.

```tsx
import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

<ResponsiveContainer width="100%" height={180}>
  <BarChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
    <XAxis dataKey="name" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
    <YAxis domain={[0, 100]} width={32} axisLine={false} tickLine={false} />
    <Tooltip formatter={(v) => [`${v}점`, "점수"]} />
    <Bar dataKey="score" radius={[4, 4, 0, 0]}>
      {chartData.map((d, i) => (
        <Cell key={i} fill={d.score >= 75 ? "#16a34a" : d.score >= 60 ? "#d97706" : "#ef4444"} />
      ))}
    </Bar>
  </BarChart>
</ResponsiveContainer>
```

읽는 순서:

1. **데이터 in props**: `chartData`는 `[{ name, score }, ...]` 배열. 차트에 명령으로 그리는 게 아니라 데이터를 넘기면 컴포넌트가 알아서 그린다.
2. **축은 `dataKey`로 연결**: `XAxis dataKey="name"`은 각 막대의 x 라벨을, `Bar dataKey="score"`는 막대 높이를 결정한다. `YAxis domain={[0, 100]}`로 0~100점 고정 스케일.
3. **`Cell`로 막대별 색칠**: `<Bar>` 자식으로 `<Cell>`을 데이터 수만큼 펼치면 막대 하나하나에 다른 `fill`을 줄 수 있다. 여기선 75/60점 기준으로 초록·주황·빨강.
4. **`ResponsiveContainer`가 반응형**: 부모 박스 너비를 측정(ResizeObserver)해 `width="100%"`로 다시 그린다. 모바일·PC 모두 부모만 맞으면 차트가 따라온다.
5. **`Tooltip`은 공짜 인터랙션**: 호버 시 값 표시. `formatter`로 "85점" 형태 가공.

shadcn `chart.tsx` 래퍼는 여기에 한 겹 더 얹는다.

| 래퍼 요소 | 역할 |
| --- | --- |
| `ChartContainer` | `ResponsiveContainer`를 감싸고 `config`로 색을 CSS 변수(`--color-키`)로 주입 |
| `ChartStyle` | `config`의 light/dark 색을 `.dark` 셀렉터까지 자동 생성 → 다크모드 차트 |
| `ChartTooltipContent` | Tailwind 스타일이 입혀진 커스텀 툴팁(기본 툴팁 대신) |

즉 래퍼의 핵심 가치는 **다크모드 색 토큰 연동 + 디자인 통일**이다. CareerTuner는 `next-themes` 기반 `.dark` 클래스 다크모드를 쓰므로, 차트 색도 CSS 변수로 빼야 일관된다.

## 6. 면접 답변 3단계

- **초간단(1문장)**: "Recharts는 차트를 JSX 컴포넌트로 선언해서 그리는 React 차트 라이브러리고, `ResponsiveContainer`로 반응형까지 됩니다."
- **기본**: "내부적으로 D3를 쓰지만 그걸 React 컴포넌트로 추상화해서, 데이터를 props로 넘기고 `<XAxis>` `<Bar>` `<Tooltip>`을 자식으로 조립하면 SVG 차트가 나옵니다. CareerTuner에선 면접 답변 점수를 `BarChart`로 그리고, 점수 구간별로 `Cell` 색을 바꿔 합·보통·미흡을 색으로 구분합니다."
- **꼬리질문 대응**: "단순 진행률 막대까지 다 Recharts로 안 그립니다. 단일 시리즈에 축·툴팁이 필요 없으면 `Progress`나 CSS 막대가 더 가볍고, 축 눈금·호버·여러 시리즈가 필요해지는 순간 Recharts로 올립니다. 다크모드는 색을 CSS 변수로 빼서 shadcn `ChartContainer` `config`로 주입해 `.dark`까지 한 번에 맞춥니다."

## 7. 자주 나오는 꼬리질문 + 모범답안

:::details Recharts와 Chart.js의 차이는?
Chart.js는 `<canvas>`에 명령형으로 그리는 라이브러리고 React 밖 세상이라 ref·플러그인으로 React와 붙인다. Recharts는 출력이 **SVG + React 컴포넌트**라, 막대 하나를 `<Cell>`로 직접 다루고 CSS로 스타일하며 React 상태와 자연스럽게 묶인다. SVG라 DOM 요소가 많아 데이터 포인트 수천 개급에선 canvas가 유리하지만, 우리 점수 차트처럼 항목 수십 개면 Recharts의 선언형·React 친화성이 이긴다.
:::

:::details `ResponsiveContainer`가 하는 일을 정확히 설명하라.
부모 컨테이너의 실제 픽셀 크기를 측정(ResizeObserver)해서 자식 차트의 `width`/`height`를 그 값으로 채워 다시 렌더한다. 그래서 차트에 고정 px 대신 `width="100%"`를 주고 부모 박스로 크기를 통제한다. 주의점: 부모 높이가 0이면(예: `height` 없는 flex 부모) 차트가 안 보인다 — 그래서 보통 `<ResponsiveContainer height={180}>`처럼 높이를 명시하거나 부모에 높이를 준다.
:::

:::details 막대마다 색을 다르게 주려면? 그리고 왜 함수가 아니라 `Cell`인가?
`<Bar>` 자식으로 데이터 개수만큼 `<Cell fill={...}>`을 펼친다. Recharts는 선언형이라 "막대 i의 색은 score로 계산"을 props 콜백 하나로 받기보다, 각 막대를 별도 React 요소(`Cell`)로 표현하게 설계됐다. CareerTuner는 `score >= 75 ? 초록 : score >= 60 ? 주황 : 빨강`을 `Cell` `fill`로 매핑해 합격선/주의선/미달을 색으로 읽게 했다.
:::

:::details 차트 다크모드는 어떻게 처리했나?
색을 컴포넌트에 하드코딩하지 않고 CSS 변수로 뺀다. shadcn `chart.tsx`의 `ChartContainer`에 `config`를 넘기면 `ChartStyle`이 `--color-키` 변수를 light용·`.dark`용으로 둘 다 생성한다. 차트 요소는 `var(--color-키)`를 참조하므로, `next-themes`가 `<html>`에 `.dark`를 붙이면 차트 색도 자동으로 다크 팔레트로 바뀐다. 색 매핑을 한 곳(`config`)에 모은다는 게 핵심.
:::

:::details 영역 C 분석 화면은 왜 Recharts가 아니라 CSS 막대인가? (실제 코드 기반)
`AnalysisPage`의 점수 변화는 단일 시리즈에 마지막 값만 강조색이라 축 눈금·툴팁이 불필요했고, `flex` + 높이 `style`로 충분했다. 직무 분포·직무별 준비도는 가로 비율 바라 shadcn `Progress`가 더 가볍고 디자인 토큰도 이미 맞는다. "도구를 복잡도에 맞춰 골랐다"가 답이고, 시리즈가 늘거나 시간축 호버가 필요해지면 Recharts `LineChart`/`BarChart`로 옮기는 게 다음 단계라고 정직하게 말하면 된다.
:::

## 8. 직접 말해보기 (말하기 훈련용)

1. "선언형 차트가 무슨 뜻이냐"는 질문에, 순수 D3의 명령형 DOM 조작과 대비해 Recharts의 JSX 조립 방식을 1분 안에 설명해 보라. (`data` props → `dataKey` 연결 → `ResponsiveContainer` 반응형 순서로)
2. 면접관이 "차트가 다 똑같은 라이브러리 아니냐, 굳이 골라 쓴 이유"를 물으면, CareerTuner에서 **면접 점수는 Recharts / 직무 분포는 `Progress` / 점수 변화는 CSS 막대**로 갈라 쓴 기준(축·툴팁·시리즈 수 필요 여부)을 근거로 답해 보라.

## 관련 페이지

- [컴포넌트 아키텍처](/frontend/component-architecture) — 차트도 결국 props로 데이터를 받는 컴포넌트
- [Tailwind & 다크모드](/frontend/tailwind-darkmode) — 차트 색을 CSS 변수로 빼 `.dark`와 연동
- [커스텀 훅](/frontend/custom-hooks) — `useApplicationFitAnalysis` 등으로 차트 데이터 로딩 분리
- [상태 관리](/frontend/state-management) — 차트가 구독하는 분석 결과 상태의 출처

## 퀴즈

<QuizBox question="Recharts가 '선언형 차트 라이브러리'라고 불리는 이유로 가장 정확한 것은?" :choices="['canvas에 픽셀을 직접 찍어 성능이 빠르기 때문', '그리는 절차 대신 data props와 축·막대 컴포넌트를 JSX로 조립하면 라이브러리가 SVG를 그려주기 때문', '서버에서 차트 이미지를 미리 렌더해 내려주기 때문', 'CSS만으로 막대를 그리기 때문']" :answer="1" explanation="Recharts는 내부적으로 D3를 쓰되 차트 구성요소를 React 컴포넌트로 추상화한다. 데이터를 props로 넘기고 XAxis/Bar/Tooltip을 자식으로 선언하면 SVG가 그려지는 선언형 방식이다." />

<QuizBox question="ResponsiveContainer로 감쌌는데 차트가 화면에 안 보인다. 가장 흔한 원인은?" :choices="['Tooltip을 빼먹어서', 'dataKey 철자가 틀려서', '부모 컨테이너의 높이가 0이라 차트 높이를 채울 공간이 없어서', 'recharts 버전이 2.x라서']" :answer="2" explanation="ResponsiveContainer는 부모 크기를 측정해 차트를 채운다. 부모 높이가 0이면(height 없는 flex 부모 등) 차트도 높이 0이라 안 보인다. height를 명시하거나 부모에 높이를 줘야 한다." />

<QuizBox question="CareerTuner에서 면접 점수 막대를 점수 구간별로 초록/주황/빨강으로 칠한 방식과, 영역 C 분석 화면이 Recharts 대신 무엇을 썼는지 함께 설명해 보라." explanation="면접 점수 차트(ModeSelectTab)는 Recharts BarChart의 Bar 자식으로 데이터 수만큼 Cell을 펼치고 각 Cell의 fill을 score 기준(75/60점)으로 분기해 합격선·주의선·미달을 색으로 구분한다. 반면 영역 C의 AnalysisPage는 단일 시리즈에 축·툴팁이 불필요해 점수 변화는 flex와 높이 style의 CSS 막대로, 직무 분포·준비도는 shadcn Progress 비율 바로 그린다. 복잡도에 맞춰 도구를 고른 사례다." />
