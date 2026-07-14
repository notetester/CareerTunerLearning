# SPA (Single Page Application)

> 한 장의 HTML을 처음 한 번만 받아오고, 그 뒤 화면 전환과 데이터 갱신은 자바스크립트가 브라우저 안에서 처리하는 웹앱 방식입니다.

## 1. 한 줄 정의

SPA는 **단일 HTML 문서 하나를 로드한 뒤, 페이지를 새로 받지 않고 클라이언트(브라우저)에서 화면을 바꿔 그리는** 웹 애플리케이션 구조입니다. 화면 전환은 클라이언트 라우터가, 데이터는 API 호출이 담당합니다.

CareerTuner 프론트엔드가 정확히 이 구조입니다. React 19.2.7 + Vite 8.1.4 + React Router 8.2.0으로 만든 단일 페이지 앱이, 별도의 Spring Boot REST 백엔드와 `/api/**`로만 통신합니다.

## 2. 단어 뜻 (약자/어원 풀이)

| 단어 | 뜻 |
| --- | --- |
| **Single** | 단일 — 서버가 보내주는 HTML 문서가 (사실상) `index.html` 하나뿐 |
| **Page** | 페이지 — 브라우저가 받는 문서 단위 |
| **Application** | 애플리케이션 — 정적 문서가 아니라 상태를 가진 "앱"처럼 동작 |

대비되는 개념이 **MPA(Multi Page Application)**입니다. MPA는 링크를 누를 때마다 서버가 새 HTML 페이지를 통째로 만들어 보냅니다(전통적 PHP/JSP, 서버사이드 렌더링 페이지 이동). SPA는 첫 1장만 받고 이후는 JS가 갈아끼웁니다.

:::tip
"SPA = HTML이 한 장"이 핵심 직관입니다. URL은 여러 개로 보여도(`/dashboard`, `/applications/3`) 실제로 서버에서 받아온 문서는 `index.html` 하나입니다.
:::

## 3. 왜 필요한가 (없으면 무슨 문제가 생기나)

MPA 방식만 쓰면 생기는 문제:

- **매 클릭마다 전체 새로고침** → 화면이 깜빡이고, 헤더·사이드바·로그인 상태까지 매번 다시 그려짐. 앱같은 부드러운 경험이 안 나옴.
- **서버가 화면(HTML)까지 책임** → 백엔드가 프레젠테이션 로직에 묶임. 프론트/백엔드 분업·병렬 개발이 어려움.
- **모바일 앱과 코드 공유 불가** → 웹용 HTML과 모바일용 UI를 따로 만들어야 함.

SPA로 풀리는 점:

- 화면 전환이 **JS 메모리 안에서** 일어나 즉각적이고 깜빡임이 없음.
- 백엔드는 **데이터(JSON)만** 제공하면 됨 → 프론트는 화면, 백엔드는 데이터로 책임 분리.
- **같은 빌드를 웹·PWA·모바일 앱이 재사용**. CareerTuner는 동일한 SPA 번들을 Capacitor WebView로 감싸 안드로이드/iOS 앱으로도 출시합니다.

## 4. CareerTuner에서 어디에 썼나 (실제 클래스/파일/테이블)

영역 표시: 아래 라우팅·API 레이어는 **공통 프론트 인프라**(팀장/공통 소유)이고, 영역 C는 그 위에서 분석 기능 화면(`features/`)을 올립니다.

| 요소 | 파일 | 역할 |
| --- | --- | --- |
| 진입 HTML | `frontend/index.html` | 서버가 주는 유일한 문서. 여기 빈 `div`에 React가 앱을 마운트 |
| 클라이언트 라우터 | `frontend/src/app/routes.ts` | `createBrowserRouter([...])`로 모든 URL→컴포넌트 매핑 정의 |
| 관리자 라우트 | `frontend/src/admin/routes.ts` | `adminRoutes`를 사용자 라우트에 spread로 합침 |
| API 레이어 | `frontend/src/app/lib/api.ts` | 제네릭 `api()`로 백엔드 호출, `ApiEnvelope` 파싱 |
| 토큰 보관 | `frontend/src/app/lib/tokenStore.ts` | `localStorage` 키 `careertuner.auth`에 access/refresh 저장 |
| 개발 프록시 | `frontend/vite.config.ts` | `/api` → `http://localhost:8080` 프록시 |
| SPA 폴백 | `frontend/vite.config.ts` (PWA `navigateFallback`) | 새로고침 시 `index.html` 반환, 단 `/api`는 제외 |

실제 라우트 정의(축약):

```ts
export const router = createBrowserRouter([
  { path: "/", Component: Root, children: [
    { index: true, Component: HomePage },
    { path: "dashboard", Component: DashboardPage },
    { path: "applications/:id", Component: ApplicationDetailPage },
    { path: "analysis", Component: AnalysisPage },
    ...adminRoutes,
  ]},
], { basename });
```

`:id` 같은 동적 세그먼트, 중첩 children, 관리자 라우트 합치기까지 전부 **브라우저 안에서** 처리됩니다. 백엔드는 이 경로들을 전혀 모릅니다 — 백엔드가 아는 건 `/api/**`뿐입니다.

## 5. 핵심 동작 원리 (단계)

```text
1. 브라우저가 GET / → 서버가 index.html + JS 번들 1회 전달
2. JS 실행 → React가 #root에 앱 마운트, React Router가 현재 URL 읽음
3. 사용자가 <Link to="/dashboard"> 클릭
   → 라우터가 history.pushState로 URL만 바꿈 (서버 요청 X)
   → 매칭된 컴포넌트(DashboardPage)만 다시 렌더
4. 화면에 데이터가 필요하면 api("/dashboard/...") 호출
   → fetch로 백엔드 REST 호출 → JSON(ApiEnvelope) 수신 → 렌더
```

데이터 흐름의 핵심은 `api.ts`의 제네릭 함수입니다:

```ts
const BASE = import.meta.env.VITE_API_BASE_URL || "/api";

export async function api<T>(path, options, config) {
  let res = await fetch(`${BASE}${path}`, { headers: buildHeaders(...) });
  // 401이면 한 번만 refresh 후 재시도 (단일-플라이트)
  const env = await res.json();          // ApiEnvelope<T>
  if (!res.ok || env.success === false) throw new ApiError(...);
  return env.data as T;                   // 화면은 data만 받음
}
```

두 가지 SPA 특유의 함정을 CareerTuner가 어떻게 처리하는지가 면접 포인트입니다:

- **새로고침 404 문제**: `/applications/3`에서 F5를 누르면 브라우저가 서버에 그 경로를 GET합니다. 서버엔 그런 페이지가 없으므로, 어떤 경로든 `index.html`을 돌려주도록 폴백을 둡니다(개발은 Vite, PWA는 `navigateFallback: 'index.html'`). 단 `navigateFallbackDenylist: [/^\/api/]`로 **API 경로는 폴백/캐시에서 제외** — 데이터 요청이 HTML로 오염되지 않게 합니다.
- **동일 출처/프록시**: 개발 중엔 프론트(`:5173`)와 백엔드(`:8080`)가 출처가 달라 CORS가 걸립니다. Vite 프록시가 `/api`를 8080으로 넘겨 같은 출처처럼 만듭니다. 모바일 앱은 `VITE_API_BASE_URL`로 절대 URL을 지정합니다.

## 6. 면접 답변 3단계

- **초간단(1문장)**: "SPA는 HTML을 한 번만 받고, 이후 화면 전환과 데이터는 브라우저의 자바스크립트가 처리하는 방식입니다."
- **기본**: "CareerTuner 프론트는 React Router 8로 만든 SPA입니다. `routes.ts`의 `createBrowserRouter`가 URL을 컴포넌트로 매핑하고, 화면 전환은 서버 요청 없이 브라우저에서 일어납니다. 데이터는 `api.ts`의 제네릭 함수로 Spring Boot REST 백엔드를 `/api`로 호출해 JSON으로만 받습니다. 즉 프론트는 화면, 백엔드는 데이터로 책임이 완전히 분리됩니다."
- **꼬리질문 대응**: "이 구조라서 같은 SPA 번들을 PWA와 Capacitor 모바일 앱이 그대로 재사용합니다. SPA의 대표 함정인 새로고침 404는 모든 경로를 `index.html`로 폴백시켜 해결하되, `/api`는 denylist로 제외했고, 인증은 `localStorage` 토큰 + 401 시 단일-플라이트 자동 리프레시로 처리합니다."

## 7. 자주 나오는 꼬리질문 + 모범답안

:::details SPA와 SSR/MPA의 차이는?
MPA는 클릭마다 서버가 새 HTML 페이지를 만들어 보냅니다(전체 새로고침). SPA는 첫 HTML 한 장만 받고 이후 JS가 화면을 갈아끼웁니다. SSR(서버사이드 렌더링)은 첫 화면을 서버에서 미리 그려 보내고 이후 SPA처럼 동작하는 절충안입니다. CareerTuner는 순수 클라이언트 렌더링 SPA로, 첫 응답은 빈 셸(`index.html`)이고 React가 마운트하며 채웁니다.
:::

:::details SPA에서 새로고침하면 404가 나는 이유와 해결은?
URL은 클라이언트 라우터가 만든 가상 경로일 뿐, 서버엔 실제 파일이 없습니다. `/applications/3`에서 F5를 누르면 서버가 그 경로를 못 찾아 404를 냅니다. 해결은 "어떤 경로 요청이든 `index.html`을 반환"하는 폴백입니다. CareerTuner는 Vite 개발 서버와 PWA의 `navigateFallback`으로 처리하고, 데이터 요청까지 폴백되지 않도록 `navigateFallbackDenylist: [/^\/api/]`로 API를 제외합니다.
:::

:::details SPA의 SEO·초기 로딩 단점은?
SPA는 첫 응답이 비어 있어(JS 실행 후 내용이 채워짐) 검색 엔진 크롤링과 초기 표시(FCP)에 불리할 수 있습니다. 대응책은 SSR/SSG, 코드 스플리팅, 프리렌더입니다. CareerTuner는 로그인 기반 앱 서비스(검색 노출이 핵심이 아님)라 클라이언트 렌더링을 택했고, 공개 데모는 GitHub Pages에 정적 배포 + 코드 스플리팅으로 로딩을 줄입니다.
:::

:::details SPA에서 인증 상태는 어떻게 유지하나?
서버 세션 쿠키 대신 토큰 기반입니다. 로그인 시 받은 access/refresh JWT를 `tokenStore.ts`가 `localStorage`의 `careertuner.auth` 키에 저장하고, `api()`가 매 요청에 `Authorization: Bearer` 헤더를 붙입니다. access가 만료돼 401이 오면 `tryRefresh()`로 `/auth/refresh`를 호출해 토큰을 갱신하고 원요청을 재시도합니다. 이때 동시 401이 여러 개여도 리프레시가 한 번만 일어나도록 단일 프라미스(single-flight)로 공유합니다.
:::

:::details 프론트와 백엔드가 포트가 다른데 어떻게 통신하나(CORS)?
개발에선 브라우저가 `:5173/api/*`를 치고 Vite 프록시가 `:8080`으로 넘겨 같은 출처처럼 만들어 CORS를 피합니다. 배포에선 동일 출처로 묶거나, 모바일처럼 출처가 다르면 백엔드 `SecurityConfig`의 CORS 허용 오리진(`localhost:5173`, `capacitor://localhost`)으로 명시 허용합니다. 클라이언트는 `VITE_API_BASE_URL`로 백엔드 주소를 주입받습니다.
:::

## 8. 직접 말해보기

1. "CareerTuner가 MPA가 아니라 SPA인 이유를, 실제 파일(`routes.ts`, `api.ts`)을 들어 1분 안에 설명해보세요."
2. "SPA에서 `/applications/3`을 새로고침하면 왜 404 위험이 있고, CareerTuner는 어떤 설정으로 막았는지 말해보세요. `/api`를 폴백에서 제외한 이유까지 포함해서."

## 퀴즈

<QuizBox question="SPA(Single Page Application)의 'Single'이 의미하는 것으로 가장 정확한 것은?" :choices="['화면이 한 개뿐이다', '서버에서 받아오는 HTML 문서가 사실상 하나다', '라우트가 하나만 존재한다', '컴포넌트가 하나뿐이다']" :answer="1" explanation="SPA는 index.html 한 장을 처음 한 번 받고, 이후 화면 전환은 클라이언트 라우터가 JS로 처리합니다. URL과 화면은 여러 개지만 서버가 주는 문서는 하나입니다." />

<QuizBox question="CareerTuner의 vite.config.ts에서 navigateFallbackDenylist에 /^\/api/ 를 넣은 이유는?" :choices="['API를 캐시해서 속도를 높이려고', 'API 경로 요청이 index.html로 폴백·캐시되지 않게 하려고', 'API를 SPA 라우터에 등록하려고', 'CORS를 우회하려고']" :answer="1" explanation="SPA 새로고침 대응으로 모든 경로를 index.html로 폴백시키되, 데이터 요청(/api)까지 HTML로 덮이면 안 되므로 denylist로 제외합니다." />

<QuizBox question="SPA에서 화면 전환(라우팅)과 인증 토큰 처리가 CareerTuner 프론트에서 각각 어떻게 이뤄지는지 한 문단으로 설명하세요." explanation="화면 전환은 routes.ts의 createBrowserRouter가 URL을 컴포넌트로 매핑하고, 링크 클릭 시 history.pushState로 URL만 바꿔 서버 요청 없이 해당 컴포넌트만 다시 렌더합니다. 인증은 tokenStore.ts가 access/refresh JWT를 localStorage의 careertuner.auth 키에 저장하고, api()가 요청마다 Bearer 헤더를 붙이며, 401이 오면 tryRefresh()로 /auth/refresh를 호출해 토큰을 갱신하고 원요청을 재시도합니다(동시 401은 단일-플라이트로 한 번만 갱신). 데이터는 ApiEnvelope를 풀어 data만 화면에 전달합니다." />
