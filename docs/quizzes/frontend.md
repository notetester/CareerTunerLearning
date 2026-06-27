# 프론트엔드 퀴즈

> CareerTuner 프론트엔드(React 18 + Vite 6 + TS + Tailwind v4)의 실제 구현 패턴을 면접에서 자기 입으로 설명할 수 있는지 점검하는 10문항 이상의 자가진단 퀴즈.

## 1. 이 퀴즈의 목적

이 페이지는 개념 설명서가 아니라 **자가진단 도구**다. CareerTuner에서 직접 쓴 프론트엔드 패턴을 보기 없이 떠올릴 수 있는지, 보기를 보면 헷갈리는지를 가른다. 각 문항은 실제 파일 1개와 1:1로 대응하므로, 틀린 문항이 있으면 해당 파일을 다시 읽고 와라.

## 2. 다루는 범위

| 주제 | 근거 파일/패턴 | 관련 학습 페이지 |
| --- | --- | --- |
| API 레이어 + 응답 엔벨로프 | `app/lib/api.ts` (`api<T>()`, `ApiEnvelope`) | [API 레이어](/frontend/api-layer-jwt-refresh) |
| JWT 토큰 보관·자동 리프레시 | `app/lib/api.ts` `tryRefresh()`, `app/lib/tokenStore.ts` | [JWT](/backend/jwt-security) |
| 전역 인증 상태 | `app/auth/AuthContext.tsx` (Context + Provider) | [React Context](/frontend/state-management) |
| 커스텀 훅 / 상태 관리 | `useApplicationFitAnalysis.ts`, Zustand | [커스텀 훅](/frontend/custom-hooks) |
| 다크모드 테마 | `next-themes`, `styles/theme.css` `@custom-variant` | [Tailwind 다크모드](/frontend/tailwind-darkmode) |
| PWA / 캐시 정책 | `vite.config.ts` `VitePWA` | [PWA](/frontend/pwa) |
| 모바일 패키징 | `capacitor.config.ts` | [Capacitor](/frontend/capacitor-mobile) |
| 라우팅 | `app/routes.ts` (React Router 7) | [라우팅](/frontend/react-router) |

:::tip 푸는 법
보기를 보기 전에 먼저 머릿속으로 답을 말하고, 그다음 보기를 골라라. 보기를 보고 고르는 건 진짜 실력이 아니다.
:::

## 3. 핵심 사실 빠른 복습

문항을 풀기 전 30초 워밍업. 아래는 전부 실제 코드 기준이다.

- **응답 엔벨로프**: 모든 API 응답은 `{ success, code, message, data }` 구조(`ApiEnvelope<T>`). `api<T>()`가 이걸 풀어 `data`만 반환하고, 실패면 `ApiError`를 던진다.
- **API BASE**: `VITE_API_BASE_URL` 있으면 그 절대 URL, 없으면 상대경로 `/api`. 웹에선 Vite 프록시가 `/api`를 `localhost:8080`으로 넘긴다.
- **목 모드**: `VITE_USE_MOCK === "true"`면 네트워크 대신 mock 레지스트리로 응답(데모 APK·GitHub Pages용).
- **토큰 저장**: `localStorage`의 단일 키 `careertuner.auth`에 access+refresh를 한 JSON으로 보관(`tokenStore.ts`).
- **자동 리프레시**: 401이고 refresh 토큰이 있으면 `tryRefresh()`로 한 번 갱신 후 원요청 재시도. 동시 401은 `refreshPromise` 하나로 묶어 **단일 플라이트**.
- **다크모드**: `next-themes`의 `ThemeProvider attribute="class" defaultTheme="dark"`. CSS는 `@custom-variant dark`로 `.dark` 클래스 하위에서 변수 값만 바꾼다.
- **PWA 캐시**: `/api`는 `navigateFallbackDenylist`로 SPA 폴백·캐시에서 제외 — 민감 데이터는 절대 캐시 안 함.

## 4. 출제 의도와 함정

각 문항이 노리는 흔한 오답을 미리 알려둔다.

| 함정 | 정답 포인트 |
| --- | --- |
| "응답 data를 바로 쓰면 된다" | 백엔드는 `ApiResponse` 엔벨로프로 감싸므로 `data`만 꺼내야 함 |
| "401 나면 그냥 로그아웃" | refresh 토큰 있으면 먼저 자동 갱신 후 재시도 |
| "리프레시가 매 요청마다 따로 일어난다" | 동시 401은 단일 프라미스로 공유(중복 갱신 방지) |
| "다크모드는 미디어쿼리 prefers-color-scheme" | class 전략(`attribute="class"`), `enableSystem={false}` |
| "PWA가 API 응답도 캐싱한다" | `/api`는 denylist로 캐시 제외 |
| "토큰을 쿠키에 둔다" | localStorage 단일 키에 access+refresh 보관 |

## 5. 면접 답변 골격(공통)

프론트 구조를 한 문장으로 묻는 꼬리질문에 대비한 30초 답변.

> "React 18 + Vite + TypeScript SPA고, API는 `app/lib/api.ts`의 제네릭 `api<T>()` 하나로 통일했습니다. 백엔드 `ApiResponse` 엔벨로프를 풀어 `data`만 반환하고, 401이면 단일 플라이트로 토큰을 자동 리프레시합니다. 전역 인증만 Context, 나머지 화면 상태는 Zustand·커스텀 훅으로 나눴습니다."

## 6. 직접 말해보기

퀴즈 전에 입으로 연습하라.

1. "왜 `fetch`를 그냥 쓰지 않고 `api<T>()` 래퍼를 만들었나요?" — 엔벨로프 해제, 인증 헤더 주입, 401 자동 리프레시, 목 모드 분기를 한곳에 모으려고.
2. "토큰을 localStorage에 두면 XSS 위험이 있는데 왜 그렇게 했나요?" — 트레이드오프를 정직하게 말하기(SPA+모바일 WebView 공용, refresh는 서버 DB 저장·만료, access는 30분 단명).

## 퀴즈

<QuizBox question="api.ts의 제네릭 api 함수가 성공 응답에서 호출자에게 최종 반환하는 값은?" :choices="['fetch가 돌려준 Response 객체 그대로', 'ApiEnvelope 전체 객체', '엔벨로프에서 꺼낸 data 필드', 'success 불리언 값']" :answer="2" explanation="api 함수는 ApiEnvelope를 파싱한 뒤 env.data를 반환하고, res.ok가 아니거나 success가 false면 ApiError를 던진다. 호출부는 엔벨로프를 신경 쓰지 않고 data 타입만 받는다." />

<QuizBox question="VITE_API_BASE_URL 환경변수가 비어 있을 때 API BASE 경로는?" :choices="['http://localhost:8080', '상대경로 /api', '빈 문자열', 'capacitor://localhost']" :answer="1" explanation="BASE는 VITE_API_BASE_URL을 우선 쓰고, 없으면 상대경로 /api로 폴백한다. 웹 개발 시에는 Vite 프록시가 /api를 localhost:8080으로 전달한다." />

<QuizBox question="여러 요청이 동시에 401을 받았을 때 토큰 리프레시가 중복으로 일어나지 않게 하는 메커니즘은?" :choices="['요청마다 setTimeout으로 지연', 'refreshPromise 하나를 공유하는 단일 플라이트', 'localStorage 락 플래그', '서버가 중복 refresh를 막아줌']" :answer="1" explanation="tryRefresh는 진행 중인 refreshPromise가 있으면 그것을 그대로 반환한다. 동시에 401이 떠도 실제 /auth/refresh 호출은 한 번만 일어나고 모든 요청이 그 결과를 공유한다." />

<QuizBox question="JWT access·refresh 토큰을 프론트가 저장하는 위치는?" :choices="['HttpOnly 쿠키', 'sessionStorage 각각 별도 키', 'localStorage 단일 키 careertuner.auth에 JSON으로', 'IndexedDB']" :answer="2" explanation="tokenStore.ts는 localStorage의 KEY=careertuner.auth 한 곳에 accessToken·refreshToken을 JSON 문자열로 저장한다. getAccessToken/getRefreshToken/setTokens/clearTokens로 접근한다." />

<QuizBox question="VITE_USE_MOCK이 true일 때 api 함수의 동작은?" :choices="['항상 빈 배열 반환', '네트워크 대신 mock 레지스트리로 응답하고 미등록 엔드포인트는 에러', '백엔드와 mock을 둘 다 호출해 비교', '콘솔에만 로그를 남기고 통과']" :answer="1" explanation="목 모드에서는 resolveMock으로 응답하고, 핸들러가 없으면(MOCK_UNHANDLED) DEMO_UNAVAILABLE 에러를 던진다. 백엔드 없이 동작하는 데모 APK·GitHub Pages 배포용이다." />

<QuizBox question="CareerTuner의 다크모드 구현 방식으로 맞는 것은?" :choices="['CSS prefers-color-scheme 미디어쿼리만 사용', 'next-themes attribute=class 전략으로 .dark 클래스 토글', '인라인 style로 색을 직접 덮어쓰기', '서버에서 테마별 CSS를 따로 내려줌']" :answer="1" explanation="App.tsx의 ThemeProvider가 attribute=class, defaultTheme=dark, enableSystem=false로 동작한다. theme.css의 @custom-variant dark가 .dark 하위에서 CSS 변수 값만 교체한다." />

<QuizBox question="vite.config.ts의 VitePWA 설정에서 /api 경로를 navigateFallbackDenylist에 넣은 이유는?" :choices="['/api가 너무 느려서', '프로필·분석·결제 등 민감 응답을 캐시하지 않고 백엔드로 직접 보내려고', 'API 라우트가 존재하지 않아서', 'Workbox 버그 회피용']" :answer="1" explanation="정적 자산만 precache하고 /api는 SPA 폴백·캐시 대상에서 제외한다. 민감 데이터를 서비스워커가 캐싱하지 않도록 보장하는 정책이다." />

<QuizBox question="전역 인증 상태(현재 로그인 사용자, isAuthenticated)는 무엇으로 관리하나?" :choices="['Zustand 스토어', 'React Context(AuthContext/AuthProvider)', 'Redux Toolkit', 'localStorage만으로']" :answer="1" explanation="전역 인증은 AuthContext.tsx의 Context + AuthProvider로 관리하고, 그 외 화면 단위 상태는 Zustand와 커스텀 훅으로 나눈다. 인증처럼 앱 전역에서 자주 읽는 값에 Context가 적합하다." />

<QuizBox question="capacitor.config.ts에서 androidScheme를 http로, cleartext를 true로 둔 목적은?" :choices="['앱 크기를 줄이려고', '평문 http 백엔드를 앱에서 same-scheme로 호출하고 cleartext 트래픽을 허용하려고', 'iOS 빌드 호환용', '딥링크를 켜려고']" :answer="1" explanation="androidScheme=http면 앱 origin도 http가 되어 외부 http API와 스킴이 같아지고, cleartext=true면 AndroidManifest의 usesCleartextTraffic이 켜져 평문 http 백엔드 호출이 허용된다." />

<QuizBox question="useApplicationFitAnalysis 훅이 useEffect 안에서 ignore 플래그(let ignore = false; cleanup에서 ignore = true)를 쓰는 이유는?" :choices="['렌더 최적화', '언마운트/의존성 변경 후 도착한 비동기 응답이 상태를 덮어쓰지 않게 하려고', '에러 로깅용', 'StrictMode를 끄려고']" :answer="1" explanation="비동기 fetch가 끝나기 전 컴포넌트가 사라지거나 applicationCaseId가 바뀌면 cleanup에서 ignore=true가 되어, 늦게 도착한 setState를 무시한다. 경쟁 조건(race condition)과 unmount 경고를 막는 표준 패턴이다." />

<QuizBox question="API 호출이 실패(res.ok=false 또는 success=false)했을 때 api 함수가 하는 일은?" :choices="['null을 반환', 'ApiError를 던진다(message·code·status 포함)', 'undefined를 반환하고 콘솔 경고', '자동으로 3회 재시도']" :answer="1" explanation="실패 시 ApiError(env.message, env.code, res.status)를 throw한다. 호출부는 try/catch나 훅의 error 상태로 받아 사용자에게 안내한다. 401만 예외적으로 먼저 리프레시를 시도한다." />

<QuizBox question="라우팅(React Router 7)에서 일반 사용자 라우트와 관리자 라우트를 분리한 방식은?" :choices="['단일 거대한 routes 배열', 'app/routes.ts와 admin/routes.ts로 파일 분리(createBrowserRouter)', '서버 사이드 라우팅', 'URL 쿼리스트링으로만 구분']" :answer="1" explanation="createBrowserRouter 기반으로 app/routes.ts(사용자)와 admin/routes.ts(관리자)를 나눠 관리한다. 관리자 영역은 백엔드 /api/admin/**가 ADMIN 권한을 요구하는 것과 짝을 이룬다." />

<QuizBox question="api.ts의 buildHeaders가 요청 body가 FormData일 때 Content-Type을 application/json으로 강제하지 않는 이유를 설명하라." explanation="FormData를 보낼 때는 브라우저가 multipart/form-data와 boundary를 자동으로 설정해야 한다. 만약 Content-Type을 application/json으로 덮어쓰면 boundary가 빠져 서버가 멀티파트 경계를 파싱하지 못해 파일 업로드가 깨진다. 그래서 buildHeaders는 body가 FormData인지(isFormData) 검사해, FormData가 아니고 헤더에 Content-Type이 없을 때만 application/json을 세팅한다. 공고 PDF 업로드처럼 파일을 보내는 경로에서 중요한 분기다." />

<QuizBox question="왜 전역 인증만 Context로 두고 나머지 상태는 Zustand·로컬 훅으로 나눴는지, 트레이드오프 관점에서 설명하라." explanation="인증 사용자 정보는 헤더, 가드, 여러 페이지에서 광범위하게 읽히고 변경 빈도가 낮아 Context가 적합하다. 반면 Context 값이 바뀌면 하위 소비자가 모두 리렌더되므로, 자주 변하거나 일부 화면에만 필요한 상태(예: 적합도 분석 loading/generating/error)는 Context에 넣지 않고 커스텀 훅의 useState나 Zustand 스토어로 국소화한다. 이렇게 나누면 불필요한 전역 리렌더를 피하면서, 전역으로 공유해야 할 인증만 단일 출처로 유지하는 균형을 얻는다." />
