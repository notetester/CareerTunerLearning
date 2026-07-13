# Vite

> "Vite는 개발 중엔 번들을 안 만들고 브라우저의 네이티브 ESM을 그대로 써서 dev 서버를 즉시 띄우고, 빌드 때만 Rollup으로 한 번에 번들링하는 프런트엔드 빌드 도구입니다."

## 1. 한 줄 정의

Vite는 **ESM(ES Modules) 기반의 빠른 개발 서버 + Rollup 기반 프로덕션 번들러**를 합친 프런트엔드 빌드 도구다. CareerTuner 프런트엔드(React 19 + TypeScript)는 Vite 8.1.4로 dev 서버를 띄우고, dev 서버는 `/api` 요청을 Spring Boot 백엔드(:8080)로 프록시한다.

## 2. 단어 뜻 (약자/어원 풀이)

| 용어 | 풀이 |
| --- | --- |
| Vite | 프랑스어로 "빠르다(quick)". 발음은 "비트"가 아니라 "빗"에 가깝다 |
| ESM | ECMAScript Modules. `import`/`export` 표준 모듈 시스템. 브라우저가 직접 이해한다 |
| HMR | Hot Module Replacement. 페이지 새로고침 없이 바뀐 모듈만 교체 |
| Rollup | Vite가 프로덕션 빌드에 쓰는 번들러 |
| esbuild | Go로 작성된 초고속 트랜스파일러. dev 의존성 사전 번들에 사용 |
| 번들링(bundling) | 흩어진 수백 개 모듈을 브라우저가 받기 좋게 소수 파일로 합치는 작업 |

핵심 대비: **dev = 번들 안 함(ESM 직배달), build = 번들 함(Rollup)**. 이 두 모드가 다르게 동작하는 게 Vite의 정체성이다.

## 3. 왜 필요한가 (없으면 무슨 문제가 생기나)

옛날 도구(Webpack 등)는 dev 서버를 켤 때도 **앱 전체를 먼저 번들링**해야 첫 화면이 떴다. 프로젝트가 커질수록 dev 서버 부팅과 HMR이 선형으로 느려진다.

Vite는 이 문제를 두 갈래로 푼다.

- **dev:** 번들을 안 만든다. 브라우저가 `import`를 만나면 그 모듈 파일을 dev 서버에 HTTP로 요청하고, Vite는 그 파일만 즉석 변환해서 돌려준다. 그래서 부팅이 거의 즉시고, HMR은 **바뀐 모듈 하나만** 다시 보낸다.
- **build:** 프로덕션에서는 수백 개 모듈을 그대로 import하면 요청 폭주(워터폴)가 나므로, Rollup으로 트리쉐이킹·코드분할·압축을 거쳐 최적화된 정적 파일로 번들링한다.

CareerTuner처럼 Radix UI 약 50개 + MUI 일부 + Recharts + Motion 등 의존성이 많은 프로젝트에서, 이 "dev는 안 묶고 build만 묶는" 구조가 개발 속도에 직접적인 이득을 준다.

:::tip 왜 dev와 build가 다른 도구를 쓰나
"개발 빠름"과 "운영 최적화"는 요구가 정반대다. dev는 즉시성이, build는 결과물 크기·요청 수가 중요하다. Vite는 이걸 한 도구가 두 모드로 처리한다 — dev는 esbuild/ESM, build는 Rollup.
:::

## 4. CareerTuner에서 어디에 썼나 (프런트엔드 영역)

설정의 단일 진실은 [`frontend/vite.config.ts`](/frontend/vite)이고, 실행 스크립트는 `frontend/package.json`에 있다.

| 항목 | 실제 설정/파일 | 역할 |
| --- | --- | --- |
| 플러그인 | `@vitejs/plugin-react`, `@tailwindcss/vite`, `vite-plugin-pwa` | React JSX·Fast Refresh, Tailwind v4, PWA 서비스워커 |
| 커스텀 플러그인 | `figmaAssetResolver()` (vite.config.ts 내부) | `figma:asset/...` import를 `src/assets`로 매핑 |
| 경로 별칭 | `resolve.alias['@'] -> ./src` | `@/features/...` 식 절대 import |
| dev 프록시 | `server.proxy['/api'] -> http://localhost:8080` | 브라우저 `:5173/api/*` 를 백엔드로 전달 |
| 환경변수 | `import.meta.env.VITE_API_BASE_URL`, `VITE_USE_MOCK` | `app/lib/api.ts`의 BASE/USE_MOCK 토글 |
| 모드 | `vite --mode mock` → `.env.mock` 로드 | 백엔드 없는 데모/APK 빌드 |
| base | `process.env.VITE_PUBLIC_BASE ?? '/'` | GitHub Pages 데모 서브경로 배포 |

스크립트 (`package.json`):

```json
{
  "dev": "vite",
  "build": "vite build",
  "dev:mock": "vite --mode mock",
  "build:mock": "vite build --mode mock",
  "mobile:sync": "vite build --mode mock && cap sync android"
}
```

:::details 실제 api.ts에서 import.meta.env를 읽는 부분 (축약)
```ts
// app/lib/api.ts
const BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined)
  ?.replace(/\/+$/, "") || "/api";

const USE_MOCK = import.meta.env.VITE_USE_MOCK === "true";
```
`VITE_API_BASE_URL`이 없으면 상대경로 `/api`를 쓰고, 웹에서는 dev 프록시가 :8080으로 전달한다. Capacitor 네이티브 앱은 상대경로로 PC localhost에 닿지 못해 절대 URL로 빌드해야 한다.
:::

## 5. 핵심 동작 원리 (표/단계)

### dev 서버가 화면을 띄우는 순서

1. `npm run dev` → Vite가 `:5173`에 dev 서버를 올린다(번들링 없음).
2. 브라우저가 `index.html`을 받고 `<script type="module">`로 엔트리를 요청한다.
3. 브라우저가 `import`를 만날 때마다 해당 모듈을 dev 서버에 HTTP로 요청한다.
4. Vite가 그 파일만 즉석에서 변환(TS→JS, JSX 변환)해 ESM으로 돌려준다.
5. `node_modules`의 무거운 의존성은 부팅 시 **esbuild로 사전 번들(pre-bundle)**해 요청 수를 줄인다.

### dev vs build 비교

| 구분 | dev (`vite`) | build (`vite build`) |
| --- | --- | --- |
| 번들링 | 안 함 (ESM 직배달) | 함 (Rollup) |
| 변환기 | esbuild | esbuild + Rollup |
| 코드 변경 반영 | HMR (바뀐 모듈만) | 전체 재빌드 |
| 결과물 | 없음 (메모리 서비스) | `dist/` 정적 파일 |
| 최적화 | 최소 | 트리쉐이킹·분할·압축 |

### 프록시가 CORS를 피하는 원리

```text
브라우저(:5173) ──/api/login──> Vite dev서버(:5173)
                                  └─프록시─> 백엔드(:8080) /api/login
```

브라우저 입장에선 **항상 같은 출처(:5173)**로만 요청하므로 CORS가 발생하지 않는다. 교차 출처 호출은 Vite ↔ 백엔드 서버 간(브라우저 정책 밖)에서 일어난다. `changeOrigin: true`는 백엔드로 보내는 Host 헤더를 타깃(:8080)에 맞춘다.

### import.meta.env / 모드 규칙

- 클라이언트 코드에 노출되는 변수는 반드시 **`VITE_` 접두사**여야 한다(시크릿 유출 방지).
- `--mode mock`이면 `.env.mock`가 우선 로드된다 → `VITE_USE_MOCK=true`로 백엔드 없이 mock 레지스트리가 응답.
- `import.meta.env.MODE`, `.DEV`, `.PROD`, `.BASE_URL`은 Vite가 기본 제공한다.

:::warning 시크릿을 VITE_ 변수에 넣지 마라
`VITE_` 변수는 빌드 결과 JS에 **그대로 문자열로 박힌다.** API 키·JWT 시크릿 같은 비밀은 절대 넣지 말고 백엔드에서만 다룬다. CareerTuner의 `deploy-demo` CI는 빌드 산출물을 시크릿 패턴으로 스캔해 사고를 막는다. (참고: VAPID 공개키는 의도적으로 공개 가능한 값이라 예외)
:::

## 6. 면접 답변 3단계

- **초간단(1문장):** "Vite는 dev에선 ESM을 직배달해 즉시 띄우고, build에선 Rollup으로 번들링하는 프런트엔드 빌드 도구입니다."
- **기본:** "옛 번들러는 dev 서버도 전체 번들 후에야 떠서 프로젝트가 크면 느렸습니다. Vite는 dev에서 번들을 안 만들고 브라우저 네이티브 ESM으로 모듈을 요청 단위로 변환·전달해 부팅과 HMR이 빠릅니다. 프로덕션은 요청 폭주를 막으려고 Rollup으로 번들링합니다. 저희는 vite.config.ts에서 React·Tailwind·PWA 플러그인을 쓰고, server.proxy로 /api를 :8080 백엔드로 넘깁니다."
- **꼬리질문 대응:** "환경변수는 import.meta.env로 읽고 클라이언트 노출은 VITE_ 접두사만 허용됩니다. 모드는 --mode mock으로 .env.mock을 로드해 백엔드 없이 mock으로 도는 데모/APK 빌드를 만듭니다."

## 7. 자주 나오는 꼬리질문 + 모범답안

**Q. Webpack과 뭐가 다른가?**
A. Webpack은 dev에서도 전체를 번들해야 서버가 뜨지만, Vite는 dev에서 번들 없이 브라우저 ESM으로 모듈을 요청 단위로 변환·전달합니다. 그래서 콜드스타트와 HMR이 빠릅니다. 프로덕션은 둘 다 번들링하지만 Vite는 Rollup을 씁니다.

**Q. 그럼 build는 왜 굳이 번들링하나? dev처럼 ESM 그대로 쓰면 안 되나?**
A. 프로덕션에서 수백 개 모듈을 그대로 import하면 네트워크 요청이 폭주(워터폴)하고 느려집니다. Rollup으로 트리쉐이킹·코드분할·압축을 해서 파일 수와 용량을 줄입니다.

**Q. dev 프록시는 어떻게 CORS를 피하나?**
A. 브라우저는 항상 같은 출처(:5173)로만 요청하고, Vite dev 서버가 서버-사이드에서 :8080 백엔드로 전달합니다. 교차 출처 호출은 브라우저 정책 밖이라 CORS가 안 생깁니다. 운영 배포에선 동일 출처 백엔드를 쓰거나 백엔드 CORS 설정으로 처리합니다.

**Q. import.meta.env가 process.env와 뭐가 다른가?**
A. Vite는 브라우저 환경이라 Node의 process.env가 없어 표준 ESM의 import.meta.env로 노출합니다. 클라이언트로 나가는 값은 VITE_ 접두사가 붙은 것만 노출돼 시크릿 유출을 막습니다.

**Q. --mode와 NODE_ENV(개발/운영)는 다른 건가?**
A. 모드는 어떤 .env 파일을 로드할지 고르는 라벨이고, dev/build와는 별개입니다. 저희는 build를 production 모드로 하되 --mode mock으로 .env.mock을 덧입혀, 운영 최적화 번들이면서도 백엔드 없이 mock으로 도는 데모 APK를 만듭니다.

## 8. 직접 말해보기

1. 화이트보드 없이, "왜 Vite dev 서버는 Webpack보다 빨리 뜨는가"를 ESM·번들링 두 단어로 30초 안에 설명해보라.
2. CareerTuner의 `vite --mode mock`이 정확히 어떤 파일을 로드하고, 그 결과 `app/lib/api.ts`의 동작이 어떻게 바뀌는지 한 호흡에 말해보라.

## 퀴즈

<QuizBox question="Vite의 dev 서버가 빠른 핵심 이유로 가장 정확한 것은?" :choices="['dev에서 앱 전체를 미리 Rollup으로 번들링해두기 때문', 'dev에서 번들링하지 않고 브라우저 네이티브 ESM으로 모듈을 요청 단위로 변환·전달하기 때문', 'TypeScript를 JavaScript로 변환하지 않기 때문', '모든 의존성을 CDN에서 받아오기 때문']" :answer="1" explanation="Vite는 dev에서 번들을 만들지 않고, 브라우저가 import할 때마다 해당 모듈만 즉석 변환해 ESM으로 돌려준다. 그래서 콜드스타트와 HMR이 빠르다. 번들링(Rollup)은 프로덕션 build에서만 한다." />

<QuizBox question="CareerTuner의 vite.config.ts에서 server.proxy['/api'] -> http://localhost:8080 설정의 목적은?" :choices="['프로덕션에서 백엔드 부하를 분산한다', 'dev에서 브라우저의 /api 요청을 백엔드(:8080)로 전달해 CORS 없이 개발한다', 'API 응답을 캐시한다', 'JWT 토큰을 자동 발급한다']" :answer="1" explanation="dev에서 브라우저는 같은 출처(:5173)로만 요청하고, Vite dev 서버가 서버 측에서 :8080으로 전달한다. 브라우저 입장에선 교차 출처 호출이 없어 CORS가 발생하지 않는다." />

<QuizBox question="클라이언트 코드에서 import.meta.env로 읽으려는 환경변수에 VITE_ 접두사가 반드시 필요한 이유를 설명하라." explanation="Vite는 빌드 시 클라이언트 번들에 노출할 환경변수를 VITE_ 접두사가 붙은 것으로만 제한한다. 접두사 없는 변수는 번들에 들어가지 않아, DB 비밀번호나 API 키 같은 서버 시크릿이 실수로 브라우저 JS에 박혀 유출되는 것을 막는다. 반대로 VITE_ 변수는 빌드 결과 JS에 평문으로 들어가므로, 거기에는 공개돼도 되는 값(예: API 베이스 URL, 공개 VAPID 키)만 넣어야 한다. CareerTuner는 추가 안전장치로 deploy-demo CI가 빌드 산출물을 시크릿 패턴으로 스캔한다." />
