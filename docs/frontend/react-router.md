# React Router

> "SPA에서 페이지 전환을 서버 왕복 없이 클라이언트가 직접 처리하는 라우팅 라이브러리예요. CareerTuner는 React Router 7의 `createBrowserRouter`로 단일 라우트 트리를 만들고, 사용자/관리자 라우트를 파일로 분리해 합쳤습니다."

## 1. 한 줄 정의

URL과 화면(React 컴포넌트)을 **매핑**해 주는 라이브러리. 사용자가 주소를 바꾸거나 링크를 누르면 **서버에 새 HTML을 요청하지 않고** 자바스크립트가 해당 컴포넌트만 갈아끼운다. 이게 SPA(Single Page Application)의 "한 페이지처럼 동작하지만 여러 화면" 을 가능하게 한다.

## 2. 단어 뜻 (약자/어원 풀이)

| 용어 | 뜻 |
| --- | --- |
| Router | "경로를 정해주는 것". URL이라는 경로를 보고 어느 화면으로 보낼지 결정 |
| SPA (Single Page Application) | HTML 문서는 한 장(index.html)만 받고, 이후 화면 전환은 JS가 담당 |
| Route | URL 패턴 하나와 그에 대응하는 컴포넌트의 짝 |
| Browser Router | 브라우저의 History API(주소창 `/dashboard` 같은 깨끗한 경로)를 쓰는 라우터. Hash(`#/`) 방식의 반대 |
| Nested Route | 라우트 안에 라우트. 공통 레이아웃 + 갈아끼우는 본문 구조 |
| Outlet | 부모 레이아웃에서 "자식 라우트가 그려질 구멍" |
| basename | 앱이 도메인 루트가 아닌 하위 경로(`/app/`)에 배포될 때 붙는 공통 접두사 |

## 3. 왜 필요한가 (없으면 무슨 문제가 생기나)

라우터 없이 React만 쓰면:

- **URL이 화면을 반영하지 못한다.** `/applications/12` 같은 주소로 특정 지원 건 상세에 바로 들어가거나, 새로고침/북마크/뒤로가기가 깨진다.
- 화면 분기를 `useState` + 조건부 렌더링으로 직접 짜야 한다 → 화면이 늘수록 거대한 if 덩어리.
- 전통 방식(서버가 매 페이지 HTML 렌더)은 클릭마다 흰 화면 깜빡임과 서버 왕복이 생긴다.

React Router는 이걸 **선언적 라우트 테이블** 하나로 정리한다. "이 URL이면 이 컴포넌트" 를 표로 적어두면, 전환·파라미터 추출·중첩 레이아웃·뒤로가기를 라이브러리가 처리한다.

## 4. CareerTuner에서 어디에 썼나 (실제 클래스/파일/테이블, 영역 표시)

영역: **프론트엔드 공통(라우팅은 팀장 Owner 영역)**. 핵심 파일은 두 개로 분리되어 있다.

| 파일 | 역할 |
| --- | --- |
| `frontend/src/app/routes.ts` | 사용자 라우트 트리 + `createBrowserRouter` 생성, `basename` 계산 |
| `frontend/src/admin/routes.ts` | 관리자 라우트 배열 `adminRoutes` (export). 사용자 트리에 스프레드로 합쳐짐 |
| `frontend/src/app/components/layout/Root.tsx` | 최상위 레이아웃 컴포넌트. `<Outlet/>`, `<ScrollRestoration/>` 보유 |

`routes.ts`에서 한 그루의 라우트 트리를 만든다. 최상위 `/` 가 `Root` 레이아웃이고, 그 `children`으로 모든 페이지가 중첩된다.

```ts
import { createBrowserRouter } from "react-router";
import { adminRoutes } from "../admin/routes";

const basename = import.meta.env.BASE_URL === "/"
  ? "/"
  : import.meta.env.BASE_URL.replace(/\/$/, "");

export const router = createBrowserRouter([
  {
    path: "/",
    Component: Root,          // 공통 레이아웃(헤더/푸터/하단탭)
    children: [
      { index: true, Component: HomePage },
      { path: "dashboard", Component: DashboardPage },
      { path: "applications/:id/:section/:mode", Component: ApplicationDetailPage },
      { path: "community/posts/:postId", Component: CommunityPage },
      ...adminRoutes,          // 관리자 라우트를 같은 트리에 합침
    ],
  },
], { basename });
```

:::tip 관찰 포인트 (면접에서 "근거" 로 쓸 디테일)
- **`Component:` 프롭 스타일** — React Router 7의 데이터 라우터 문법. `element: <HomePage />` 대신 컴포넌트 자체를 넘긴다.
- **동적 세그먼트 다중** — `applications/:id/:section/:mode` 처럼 콜론 파라미터를 3개까지 쓴다. 같은 `ApplicationDetailPage`가 파라미터 개수만 다른 3개 라우트로 등록돼, URL만으로 "어느 지원 건의 어느 섹션을 보기/편집 모드로" 까지 표현한다.
- **사용자/관리자 분리** — 관리자 라우트는 별도 파일에서 배열로 export하고 `...adminRoutes`로 합친다. 담당자(영역)별 충돌을 줄이는 구조.
- **딥링크 라우트** — `community/posts/:postId`는 알림 클릭 시 글 상세로 바로 진입하기 위한 경로(주석에 팀장 승인 기록).
:::

`Root.tsx`가 모든 화면의 공통 골격을 그린다. 핵심은 `<Outlet/>`(자식 라우트가 들어가는 자리)과 `<ScrollRestoration/>`(라우트 이동 시 스크롤 맨 위 복원), 그리고 `useLocation()`으로 현재 경로를 보고 관리자/로그인 화면에서 하단 탭을 숨기는 분기다.

```tsx
import { Outlet, ScrollRestoration, useLocation } from "react-router";

export function Root() {
  const location = useLocation();
  const isAdmin = location.pathname.startsWith("/admin");
  return (
    <div className="min-h-screen flex flex-col">
      <ScrollRestoration />
      <Header />
      <main><Outlet /></main>   {/* 자식 라우트가 여기 렌더됨 */}
      <Footer />
    </div>
  );
}
```

## 5. 핵심 동작 원리 (표/작은 코드/단계)

**전환 흐름 (사용자가 `/dashboard` 링크 클릭 시)**

1. 링크 클릭 → React Router가 기본 브라우저 이동을 가로챔(서버 요청 X)
2. History API로 주소창만 `/dashboard`로 변경
3. 라우트 테이블에서 `path: "dashboard"` 매칭 → `Root`의 `<Outlet/>`에 `DashboardPage` 렌더
4. `<ScrollRestoration/>`이 스크롤을 맨 위로 복원

**자주 쓰는 훅/요소** (CareerTuner 코드 전반에서 `react-router`에서 import)

| API | 용도 | 예 |
| --- | --- | --- |
| `useParams()` | URL의 `:id` 등 동적 값 읽기 | `const { id } = useParams()` → 지원 건 상세 |
| `useNavigate()` | 코드로 페이지 이동 | `navigate("/login")` (401 후 리다이렉트 등) |
| `useLocation()` | 현재 경로/쿼리 확인 | `Root.tsx`에서 관리자 화면 판별 |
| `useSearchParams()` | `?key=value` 쿼리 읽기/쓰기 | 콜백·필터 |
| `<Outlet/>` | 중첩 라우트 렌더 자리 | 레이아웃 |
| `index: true` | 부모 경로(`/`) 자체에 매칭되는 기본 자식 | 홈 |

**SPA 라우팅의 함정 — 서버/PWA 설정과 짝이다.** 브라우저 라우터는 `/dashboard`를 클라이언트가 처리하지만, 그 주소로 **새로고침** 하면 브라우저는 서버에 `/dashboard`를 요청한다. 그래서 SPA는 "모든 경로를 index.html로 떨어뜨리는" 폴백이 필요하다. CareerTuner는 PWA(`vite-plugin-pwa`)에서 `navigateFallbackDenylist`로 `/api` 경로만 폴백에서 제외(=캐시/리다이렉트 안 함)해 라우팅과 API를 분리한다.

:::details basename은 왜 필요한가
앱이 항상 도메인 루트(`https://site.com/`)에 배포된다는 보장이 없다. GitHub Pages 같은 곳은 `https://user.github.io/repo/` 하위에 올라간다. 이때 라우터가 모든 경로 앞에 공통 접두사를 붙여야 링크가 깨지지 않는다. CareerTuner는 Vite가 주입하는 `import.meta.env.BASE_URL`을 읽어 `basename`을 계산한다. 루트면 `/`, 하위 경로면 끝 슬래시를 떼서 넘긴다.
:::

## 6. 면접 답변 3단계 (초간단 1문장 / 기본 / 꼬리질문 대응)

- **1문장:** "React Router로 URL과 컴포넌트를 매핑해 서버 왕복 없이 화면을 전환하는 SPA 라우팅을 구현했습니다."
- **기본:** "React Router 7의 `createBrowserRouter`로 단일 라우트 트리를 만들고, 최상위 `Root` 레이아웃 아래 자식 라우트를 중첩했습니다. `<Outlet/>`에 본문이 들어가고 헤더/푸터/하단탭은 공통으로 유지됩니다. 사용자 라우트(`app/routes.ts`)와 관리자 라우트(`admin/routes.ts`)를 파일로 분리해 스프레드로 합쳐, 담당 영역 충돌을 줄였습니다."
- **꼬리질문 대응:** "동적 세그먼트는 `applications/:id/:section/:mode`처럼 다단계로 써서 URL만으로 지원 건의 섹션·모드까지 표현하고, 컴포넌트에서 `useParams`로 읽습니다. 새로고침 시 404를 막으려면 서버/PWA에 index.html 폴백이 필요한데, PWA에서는 `navigateFallbackDenylist`로 `/api`만 제외해 라우팅과 API 캐시를 분리했습니다."

## 7. 자주 나오는 꼬리질문 + 모범답안

:::details Q1. SPA 라우팅과 서버 사이드 라우팅(MPA)의 차이는?
서버 라우팅(MPA)은 클릭마다 서버가 새 HTML을 통째로 내려준다 — 매번 흰 화면 깜빡임과 왕복 비용이 있지만 SEO/초기 로딩에 유리. SPA 라우팅은 index.html 한 장만 받고 이후 전환을 JS가 처리 — 빠르고 앱 같은 UX지만, 새로고침 폴백·초기 번들 크기·SEO를 따로 챙겨야 한다. CareerTuner는 React SPA라서 React Router로 클라이언트 라우팅을 한다.
:::

:::details Q2. `createBrowserRouter` 와 `BrowserRouter`(JSX) 의 차이는?
`BrowserRouter` + `<Routes>`/`<Route>` JSX 방식은 라우트를 컴포넌트 트리 안에서 선언한다. `createBrowserRouter`는 라우트를 **객체 배열(데이터)** 로 정의하는 데이터 라우터 API로, React Router 6.4+ / 7의 권장 방식이다. loader/action 같은 데이터 기능과 잘 맞고, CareerTuner도 이 방식을 쓴다. 우리는 데이터 로더 대신 컴포넌트 안에서 직접 fetch(`api.ts`)하지만, 라우트 정의는 객체 배열로 통일했다.
:::

:::details Q3. 중첩 라우트(Nested Route)와 Outlet은 어떤 문제를 푸나?
헤더/푸터/하단탭처럼 모든 화면에 공통인 골격을 매 페이지마다 반복하지 않기 위해서다. 부모 라우트(`Root`)가 공통 레이아웃을 그리고 `<Outlet/>` 자리에만 자식 화면이 갈아끼워진다. 덕분에 페이지 전환 시 레이아웃은 그대로 두고 본문만 바뀌어 성능·일관성이 좋다. `Root.tsx`에서 `useLocation`으로 현재 경로를 보고 관리자 화면이면 하단 탭을 숨기는 식의 레이아웃 분기도 한 곳에서 처리한다.
:::

:::details Q4. URL 파라미터(:id)와 쿼리스트링(?key=)은 언제 어떻게 쓰나?
`:id` 같은 경로 파라미터는 "리소스 식별"에 쓴다 — 어느 지원 건인지(`applications/:id`)처럼 자원의 일부일 때. `useParams()`로 읽는다. 쿼리스트링은 "그 화면의 옵션·상태"에 쓴다 — 필터, 탭, 콜백 파라미터 등. `useSearchParams()`로 읽는다. CareerTuner는 상세 식별엔 경로 파라미터(`:id/:section/:mode`), 보조 상태엔 쿼리(예: 홈 미리보기 `?home`)를 쓴다.
:::

:::details Q5. 사용자/관리자 라우트를 왜 파일로 나눴나?
6명이 영역별로 수직 분담하는 구조라, 라우트 테이블 한 파일에 모두 몰면 머지 충돌이 잦다. 관리자 라우트를 `admin/routes.ts`에서 `adminRoutes` 배열로 export하고 사용자 트리에서 `...adminRoutes`로 합치면, 관리자 화면 추가는 그 파일만 건드린다. 또 `Root.tsx`가 `pathname.startsWith("/admin")`으로 관리자 영역을 구분해 레이아웃(하단탭 숨김 등)을 다르게 준다. 라우팅 자체는 공통 영역이라 변경 시 팀장 승인이 필요하다.
:::

## 8. 직접 말해보기 (말하기 훈련용 질문)

1. 화이트보드 없이 30초 안에: "CareerTuner에서 `/applications/12/fit/edit` 주소를 입력하면 화면이 뜨기까지 React Router가 무슨 일을 하는지" 를 매칭 → Root 레이아웃 → Outlet → useParams 순서로 말해보라.
2. "SPA에서 깊은 경로로 새로고침했더니 404가 났다. 왜 그런지와 어떻게 막는지" 를 서버 폴백 + PWA `navigateFallbackDenylist` 관점으로 설명해보라.

## 퀴즈

<QuizBox question="CareerTuner의 routes.ts에서 라우트 트리를 만드는 데 쓰는 React Router 7 API는?" :choices="['BrowserRouter 컴포넌트', 'createBrowserRouter', 'useRoutes 훅', 'createHashRouter']" :answer="1" explanation="app/routes.ts는 createBrowserRouter에 라우트 객체 배열을 넘겨 router를 만든다. 깨끗한 경로(History API)를 쓰는 데이터 라우터 방식이다." />

<QuizBox question="부모 레이아웃(Root)에서 자식 라우트 컴포넌트가 실제로 렌더되는 위치를 지정하는 요소는?" :choices="['<Slot/>', '&lt;Children/>', '&lt;Outlet/>', '&lt;RouterView/>']" :answer="2" explanation="중첩 라우트에서 자식 화면은 부모의 &lt;Outlet/> 자리에 그려진다. Root.tsx는 헤더/푸터 사이의 main 안에 &lt;Outlet/>을 둔다." />

<QuizBox question="SPA에서 /dashboard 같은 깊은 경로로 새로고침하면 404가 날 수 있는 이유와, CareerTuner가 라우팅과 API를 분리하기 위해 쓴 PWA 설정을 설명하라." explanation="브라우저 라우터는 클라이언트에서 경로를 처리하지만, 새로고침하면 브라우저가 그 경로를 그대로 서버에 요청한다. 서버에 해당 정적 파일이 없으면 404가 나므로, 모든 경로를 index.html로 떨어뜨리는 폴백이 필요하다. CareerTuner는 vite-plugin-pwa의 navigateFallbackDenylist로 /api 경로만 폴백 대상에서 제외해, 화면 라우팅은 index.html 폴백으로 처리하되 API 요청은 캐시/리다이렉트하지 않도록 분리했다." />
