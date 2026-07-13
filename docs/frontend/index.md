# 프론트엔드 개요

> CareerTuner 프론트엔드는 React 19.2.7 + Vite 8.1.4 + TypeScript 7.0.2 + Tailwind CSS 4.3.2로 만든 SPA이고, 기능별로 폴더를 쪼갠 feature-first 구조에 Context로 인증·Zustand로 나머지 상태를 관리하며, 한 곳의 API 레이어가 토큰과 401 자동 리프레시까지 책임진다.

이 페이지는 프론트엔드 영역의 입구다. 무엇으로 만들었고, 왜 그렇게 나눴고, 어떤 순서로 공부해야 면접에서 막힘없이 설명할 수 있는지를 정리한다. 세부 기술은 각 하위 페이지로 연결된다.

## 1. 영역 소개 — 한 줄로

채용공고에 맞춰 스펙·면접 답변을 조정하는 AI 취업 플랫폼의 **사용자/관리자 단일 페이지 앱(SPA)**이다. 한 번 로드한 뒤 페이지 이동을 자바스크립트가 처리하고, 데이터는 백엔드 REST API(`/api/**`)에서 가져온다. 웹과 안드로이드/iOS 앱(Capacitor)이 **같은 코드베이스 하나**를 공유한다.

| 항목 | 기술 / 버전 | 한 줄 역할 |
| --- | --- | --- |
| UI 라이브러리 | React 19.2.7 | 컴포넌트 기반 화면 구성 |
| 빌드 도구 | Vite 8.1.4 | 개발 서버(HMR) + 프로덕션 번들 |
| 언어 | TypeScript 5.6 | 타입 안정성, `tsc --noEmit` 검증 |
| 스타일 | Tailwind v4.1 (`@tailwindcss/vite`) | 유틸리티 클래스 + CSS 변수 다크모드 |
| 라우팅 | React Router 7 | `createBrowserRouter` 기반 경로 |
| 전역 상태 | React Context + Zustand 5 | 인증은 Context, 나머지는 Zustand |
| 폼 | React Hook Form 7.55 | 비제어 폼 + 검증 |
| 차트 | Recharts 2.15 | 분석/대시보드 시각화 |
| 모바일 | Capacitor 8.4 | 같은 코드로 네이티브 앱 패키징 |
| PWA | vite-plugin-pwa | 오프라인 셸 + 자동 업데이트 |

## 2. 왜 이 영역이 중요한가

- **사용자가 만지는 전부가 여기다.** 백엔드가 아무리 좋아도 사용자는 화면으로만 제품을 판단한다.
- **하나의 코드가 3개 타깃(웹/안드로이드/iOS)을 커버한다.** Capacitor로 웹 빌드를 그대로 네이티브 앱에 싣기 때문에, 프론트 구조가 곧 제품 전체 전달 채널을 결정한다.
- **AI 기능의 체감 품질이 여기서 갈린다.** 적합도 분석·취업경향 분석 같은 무거운 AI 호출은 응답이 느리므로, `loading` / `generating` / `error` 상태를 잘 그리는 커스텀 훅(예: `useApplicationFitAnalysis`)이 사용자 경험을 좌우한다.
- **데모를 코드 변경 없이 만든다.** `VITE_USE_MOCK` 토글 하나로 백엔드 없이 mock 응답만으로 동작하는 빌드를 뽑아 GitHub Pages·자체완결 APK로 배포한다.

:::tip 면접에서의 한 줄
"React 19 + Vite 8 + TypeScript SPA이고, 웹과 모바일 앱이 Capacitor로 같은 코드를 공유합니다. 기능 단위로 폴더를 쪼갠 feature-first 구조에, 인증만 Context로 두고 나머지는 Zustand로 관리합니다."
:::

## 3. feature-first 구조 (실제 폴더)

화면(페이지)이 아니라 **기능(feature)** 을 1차 분할 기준으로 삼는다. 한 기능에 필요한 코드(`api` / `components` / `hooks` / `pages` / `types` / `utils`)를 한 폴더에 모은다. 그래야 기능을 추가/삭제할 때 한 폴더만 보면 되고, 6명 수직 분담(영역 A~F)과 폴더 경계가 일치한다.

```text
frontend/src/
  app/                       공통 골격(Owner: 팀장 영역)
    routes.ts                createBrowserRouter 전체 라우트 정의
    lib/api.ts               제네릭 api() — envelope 파싱 + 401 리프레시
    lib/tokenStore.ts        localStorage 토큰 보관
    lib/mock/                VITE_USE_MOCK용 mock 레지스트리
    auth/AuthContext.tsx     전역 인증 Context/Provider
    components/ui/           shadcn/Radix 공용 컴포넌트(~50개)
  features/<기능>/
    api/                     이 기능의 백엔드 호출
    components/              이 기능 전용 UI
    hooks/                   상태 로직(예: useApplicationFitAnalysis)
    pages/                   라우트가 가리키는 화면
    types/                   요청/응답 타입
  admin/                     관리자 SPA(별도 routes.ts)
```

실제 `features/` 안에는 `analysis`(적합도·취업경향, 영역 C), `applications`(지원 건), `interview`(가상면접), `autoprep`(오케스트레이션 진행), `community`, `notification`, `support` 등이 있다. 예를 들어 적합도 분석 화면은 `features/analysis/hooks/useApplicationFitAnalysis.ts`가 `api/fitAnalysisApi`를 호출하고, 그 결과를 패널 컴포넌트가 그린다.

:::warning 공통 영역 주의
`app/routes.ts`, `app/lib/api.ts`, `app/components/ui/`, 인증 관련 파일은 **공통 영역(팀장 Owner)** 이다. 자기 feature 폴더 밖을 건드릴 때는 합의가 먼저다. 면접에서 "구조 규칙을 팀 협업과 연결했다"는 점을 어필하기 좋은 포인트다.
:::

## 4. 데이터 흐름 — 모든 요청이 거치는 한 곳

프론트에서 백엔드로 가는 호출은 전부 `app/lib/api.ts`의 제네릭 `api<T>()`를 통과한다. 이 한 함수가 공통 책임을 다 처리하므로 각 feature의 `api/`는 경로와 타입만 신경 쓰면 된다.

| 책임 | 어떻게 |
| --- | --- |
| 베이스 URL | `VITE_API_BASE_URL` 있으면 그 절대 URL, 없으면 상대경로 `/api`(Vite 프록시 → :8080) |
| 응답 풀기 | 백엔드 `ApiResponse` envelope를 받아 `data`만 반환, 실패 시 `ApiError`로 던짐 |
| 인증 헤더 | `tokenStore`의 access 토큰을 `Authorization: Bearer ...`로 부착 |
| 401 자동 복구 | 401이면 `tryRefresh()`로 `/auth/refresh` 호출, 성공 시 원요청 1회 재시도 |
| 동시 401 | 여러 요청이 동시에 401이어도 refresh는 **단일 프라미스(single-flight)** 로 한 번만 |
| 데모 모드 | `VITE_USE_MOCK === 'true'`면 네트워크 대신 mock 레지스트리로 응답 |

```ts
// app/lib/api.ts (축약)
let refreshPromise: Promise<boolean> | null = null;

export async function api<T>(path: string, options = {}, config = {}) {
  let res = await fetch(`${BASE}${path}`, { ...options, headers: buildHeaders(...) });
  if (res.status === 401 && withAuth && getRefreshToken()) {
    if (await tryRefresh()) res = await fetch(...); // 토큰 갱신 후 1회 재시도
  }
  const env = await res.json();           // ApiEnvelope<T>
  if (!res.ok || !env?.success) throw new ApiError(env?.message, env?.code, res.status);
  return env.data as T;                   // 컴포넌트는 data만 받는다
}
```

토큰은 `app/lib/tokenStore.ts`가 `localStorage`의 `careertuner.auth` 키에 access/refresh를 함께 보관한다. 자세한 인증 연결은 [JWT & 시큐리티](/backend/jwt-security) 참고.

## 5. 권장 학습 순서

프론트 입문부터 CareerTuner 고유 패턴까지, 의존 관계 순서대로 따라가면 된다. 각 항목은 해당 학습 페이지로 연결한다(없는 페이지는 곧 추가될 자리).

1. **[React 기본](/frontend/react)** — 컴포넌트, props, state, 렌더링. 모든 것의 토대.
2. **[TypeScript](/frontend/typescript)** — 타입, 인터페이스, 제네릭. `api<T>()`를 이해하려면 필수.
3. **[Vite](/frontend/vite)** — 개발 서버(HMR), 프록시(`/api` → :8080), `import.meta.env` 환경변수.
4. **[Tailwind & 다크모드](/frontend/tailwind-darkmode)** — 유틸리티 클래스, CSS 변수 + `next-themes` 다크모드(`attribute=class`).
5. **[React Router](/frontend/react-router)** — `createBrowserRouter`, 중첩 라우트, `:id` 파라미터, `basename`.
6. **[상태 관리: Context vs Zustand](/frontend/state-management)** — 왜 인증만 Context이고 나머지는 Zustand인가.
7. **[커스텀 훅](/frontend/custom-hooks)** — `useApplicationFitAnalysis`로 보는 loading/generating/error 패턴.
8. **[API 레이어 & JWT 리프레시](/frontend/api-layer-jwt-refresh)** — `api()`, envelope 파싱, single-flight 자동 리프레시.
9. **[컴포넌트 아키텍처](/frontend/component-architecture)** — shadcn/Radix UI, feature 컴포넌트 분리.
10. **[React Hook Form](/frontend/react-hook-form)** — 폼 상태, 검증, 백엔드 Jakarta Validation과의 짝.
11. **[Recharts](/frontend/recharts)** — 분석/대시보드 차트.
12. **[PWA](/frontend/pwa)** — `vite-plugin-pwa`, Workbox, `/api`는 캐시 제외(navigateFallbackDenylist).
13. **[Capacitor 모바일](/frontend/capacitor-mobile)** — 같은 코드 → 네이티브 앱, `androidScheme http`로 평문 백엔드 호출.

:::details 빨리 끝내야 한다면 (최소 코어)
시간이 없으면 1 → 2 → 6 → 8 순서만이라도. React·TS로 기본을 잡고, 상태 관리 선택 이유와 API 레이어/토큰 리프레시만 설명할 수 있으면 프론트 핵심은 막히지 않는다.
:::

## 6. 이 영역 단골 면접질문 5개

1. **SPA가 뭐고 왜 썼나요?** — 첫 로드 후 페이지 전환을 JS가 처리하는 단일 페이지 앱. 화면 전환이 매끄럽고, 웹/모바일이 코드를 공유하기에 유리하다.
2. **Context와 Zustand를 왜 나눠 쓰나요?** — 인증처럼 트리 전체가 구독하고 갱신이 드문 값은 Context, 그 외 빈번하거나 지역적인 상태는 보일러플레이트가 적은 Zustand. → [상태 관리](/frontend/state-management)
3. **토큰 만료(401)는 어떻게 처리하나요?** — `api()`에서 401이면 `/auth/refresh`로 갱신 후 원요청 1회 재시도. 동시 401은 single-flight로 refresh를 한 번만 돌린다. → [API 레이어](/frontend/api-layer-jwt-refresh)
4. **웹과 모바일 앱은 코드가 다른가요?** — 같다. 웹 빌드를 Capacitor가 네이티브 셸에 싣는다. 차이는 `platform/capacitor.ts`의 분기와 `androidScheme http`(평문 백엔드 허용) 정도. → [Capacitor](/frontend/capacitor-mobile)
5. **폴더는 왜 기능 단위로 나눴나요?** — 한 기능에 필요한 api/components/hooks/types를 한 곳에 모으면 추가·삭제·소유권 분담이 쉽다. 화면 단위보다 응집도가 높다.

## 퀴즈

<QuizBox question="CareerTuner 프론트엔드의 전역 상태 관리 전략으로 맞는 것은?" :choices="['모든 상태를 Redux로 관리한다','인증은 React Context, 나머지는 Zustand로 관리한다','전부 Zustand 하나로 관리한다','상태 관리 라이브러리를 쓰지 않고 props로만 내린다']" :answer="1" explanation="전역 인증 상태는 AuthContext/AuthProvider(React Context)로, 그 외 상태는 Zustand 5로 관리한다. 책임에 맞춰 도구를 나눈 설계다." />

<QuizBox question="app/lib/api.ts의 api() 함수가 401 응답을 받았을 때 동작으로 옳은 것은?" :choices="['즉시 로그인 페이지로 리다이렉트한다','tryRefresh로 토큰을 갱신하고 원요청을 1회 재시도하며, 동시 401은 single-flight로 refresh를 한 번만 실행한다','아무 처리 없이 ApiError를 던진다','3회까지 자동 재시도한다']" :answer="1" explanation="401이면 /auth/refresh로 토큰을 갱신하고 성공 시 원요청을 한 번 재시도한다. 여러 요청이 동시에 401이어도 refreshPromise 하나로 묶어 갱신은 한 번만 일어난다." />

<QuizBox question="feature-first(기능 우선) 폴더 구조를 화면 우선 구조 대신 채택했을 때의 장점을 면접에서 설명해보라." explanation="기능 우선 구조는 한 기능에 필요한 api·components·hooks·pages·types를 같은 폴더에 모은다. 그래서 기능을 추가하거나 삭제할 때 한 폴더만 보면 되고, 응집도가 높아 관련 코드를 찾기 쉽다. CareerTuner는 6명이 영역 A~F로 수직 분담하는데, 이 구조가 소유권 경계와 그대로 맞아떨어져 충돌 없이 병렬 작업하기 좋다는 점도 함께 말하면 좋다." />
