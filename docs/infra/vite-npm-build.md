# npm/Vite 빌드 (프론트엔드)

> CareerTuner 프론트는 Vite로 번들링하고, `package.json`의 scripts와 `--mode`로 일반/목(mock)/모바일 빌드를 한 코드베이스에서 분기한다.

## 1. 한 줄 정의

**npm**은 자바스크립트 패키지 매니저(의존성 설치 + scripts 실행기)이고, **Vite**는 그 위에서 도는 프론트엔드 빌드 도구다. 개발 때는 빠른 dev 서버, 배포 때는 최적화된 정적 산출물(`dist/`)을 만든다.

## 2. 단어 뜻 (약자/어원 풀이)

| 용어 | 풀이 |
| --- | --- |
| **npm** | Node Package Manager. `package.json`의 `dependencies`를 설치하고 `scripts`를 실행한다 |
| **Vite** | 프랑스어로 "빠르다(vite)". dev는 네이티브 ESM + esbuild, build는 Rollup 기반 |
| **scripts** | `package.json`의 명령 별칭. `npm run dev`는 사실상 `vite`를 실행 |
| **mode** | Vite의 빌드 모드. `--mode mock`이면 `.env.mock`을 우선 로드 |
| **dist** | distribution. 빌드 산출물(정적 HTML/JS/CSS) 폴더 |
| **npm ci** | clean install. `package-lock.json`을 그대로 따라 재현 가능하게 설치 |

CareerTuner 프론트는 Vite 6.4, React 18.3, TypeScript 5.6, Tailwind v4 조합이다.

## 3. 왜 필요한가 (없으면 무슨 문제가 생기나)

- **브라우저는 TS/JSX를 모른다.** `.tsx`, Tailwind, `@` 별칭 import를 브라우저가 실행할 수 있는 평범한 JS/CSS로 변환·번들링할 도구가 반드시 필요하다.
- **모드 분기가 없으면** "백엔드 붙은 실서비스 빌드"와 "백엔드 없이 도는 데모 빌드"를 위해 코드를 두 벌 들고 있어야 한다. Vite의 `--mode` + `import.meta.env`로 한 코드베이스에서 갈라낸다.
- **재현 가능한 설치가 없으면** 내 PC와 CI 서버의 의존성 버전이 어긋나 "내 컴퓨터에선 됐는데"가 발생한다. `npm ci` + lock 파일이 이를 막는다.

## 4. CareerTuner에서 어디에 썼나 (실제 파일, 영역=인프라)

핵심은 `frontend/package.json`의 scripts다.

| script | 실제 명령 | 용도 |
| --- | --- | --- |
| `dev` | `vite` | 로컬 dev 서버(:5173), `/api`는 프록시로 :8080 전달 |
| `build` | `vite build` | 운영용 정적 산출물 → `frontend/dist/` |
| `dev:mock` | `vite --mode mock` | 백엔드 없이 mock 레지스트리로 dev |
| `build:mock` | `vite build --mode mock` | 자체완결 데모 빌드(웹 데모/APK) |
| `typecheck` | `tsc --noEmit` | 타입만 검사(번들 산출 없음), CI 게이트 |
| `mobile:sync` | `vite build --mode mock && cap sync android` | 모바일용 빌드 후 Capacitor 동기화 |
| `mobile:apk` | `cd android && gradlew assembleDebug` | 안드로이드 디버그 APK 생성 |
| `ios:sync` | `vite build --mode mock && cap sync ios` | iOS 동기화 |
| `preview` | `vite preview` | 빌드 결과를 로컬에서 미리보기 |

설정 파일과 모드 환경변수:

- `frontend/vite.config.ts` — React/Tailwind 플러그인, `vite-plugin-pwa`(PWA 서비스워커), dev 프록시(`/api` → `localhost:8080`), `@` → `src` 별칭, `figmaAssetResolver` 커스텀 플러그인.
- `frontend/.env.mock` — `VITE_USE_MOCK=true`. `--mode mock`일 때만 로드.
- `frontend/.env.example` — 커밋되는 예시 파일. `VITE_API_BASE_URL`, `VITE_VAPID_PUBLIC_KEY` 등 클라이언트 변수 설명.
- `frontend/src/app/lib/api.ts` — 빌드 시 주입된 값을 런타임에서 읽는 곳: `import.meta.env.VITE_API_BASE_URL`, `import.meta.env.VITE_USE_MOCK === "true"`.

CI에서의 사용(영역=인프라, GitHub Actions):

- `frontend-ci.yml` — PR마다 `npm ci → npm run typecheck → npm run build`로 타입 깨짐·빌드 실패를 조기 차단.
- `deploy-demo.yml` — `dev` push 시 `npm run build`를 `VITE_USE_MOCK=true`, `VITE_DEMO_MODE=true`, `VITE_PUBLIC_BASE=/CareerTunerDemo/` 환경으로 돌려 데모 산출물 생성 → `dist` 시크릿 패턴 스캔 → 공개 데모 repo 푸시(GitHub Pages).

:::tip
**왜 `mobile:sync`가 `--mode mock`을 쓰나?** 데모/APK는 백엔드 없이도 돌아야 어디서든 시연되기 때문이다. 실제 백엔드를 붙인 네이티브 빌드가 필요하면 `VITE_API_BASE_URL`을 도달 가능한 절대 URL로 주입해 빌드한다(상대경로 `/api`로는 앱이 PC localhost에 닿지 못함).
:::

## 5. 핵심 동작 원리 (단계/코드)

**(1) 설치 — `npm ci` vs `npm install`**

```bash
npm ci   # package-lock.json을 그대로 재현. node_modules 비우고 정확히 lock대로 설치
```

CI는 항상 `npm ci`를 쓴다. `npm install`은 필요 시 lock을 갱신할 수 있어 재현성이 떨어진다.

**(2) 모드별 env 주입 — `import.meta.env`**

Vite는 `VITE_` 접두사가 붙은 변수만 클라이언트 번들에 노출한다(서버 비밀이 새지 않게). `--mode mock`이면 `.env.mock`이 우선 로드된다.

```ts
// frontend/src/app/lib/api.ts (축약)
const BASE = (import.meta.env.VITE_API_BASE_URL?.replace(/\/+$/, "")) || "/api";
const USE_MOCK = import.meta.env.VITE_USE_MOCK === "true";
```

빌드 시점에 이 `import.meta.env.*`는 **상수로 치환**된다. 즉 런타임에 바뀌는 값이 아니라, 빌드 때 모드에 따라 박혀버린다.

**(3) 빌드 산출 — `dist/`**

`vite build`는 Rollup으로 트리셰이킹·코드 분할·해시 파일명(`index-a1b2c3.js`)을 만들어 `frontend/dist/`에 떨군다. 여기에 `vite-plugin-pwa`가 서비스워커와 precache 매니페스트도 함께 생성한다(단 `/api`는 `navigateFallbackDenylist`로 캐시 제외).

```text
npm ci → tsc --noEmit(타입검사) → vite build(번들) → dist/ → (배포: Pages / cap sync)
```

**(4) typecheck는 빌드와 분리**

`vite build`는 esbuild로 타입을 "지우기만" 하고 검사하지 않는다. 그래서 `tsc --noEmit`을 별도 게이트로 둔다. CI가 typecheck를 빌드보다 먼저 돌리는 이유다.

## 6. 면접 답변 3단계

- **1문장:** "Vite로 번들링하고 `package.json` scripts와 `--mode`로 일반/목/모바일 빌드를 한 코드베이스에서 분기합니다."
- **기본:** "dev는 Vite dev 서버에서 `/api`를 백엔드로 프록시하고, build는 Rollup으로 `dist/`를 만듭니다. 백엔드 없는 데모는 `--mode mock`으로 `.env.mock`의 `VITE_USE_MOCK=true`를 주입해 mock 레지스트리로 돌고, 모바일은 그 mock 빌드 결과를 `cap sync`로 Capacitor에 넣습니다. CI는 `npm ci → typecheck → build` 순으로 검증합니다."
- **꼬리질문 대응:** "타입 검사는 `tsc --noEmit`로 빌드와 분리합니다. Vite build는 타입을 지우기만 하고 검사하지 않아서요. 또 클라이언트엔 `VITE_` 접두사 변수만 노출돼 서버 비밀이 번들에 안 새고, 데모 배포는 `dist` 시크릿 스캔 단계를 통과해야 공개 repo로 나갑니다."

## 7. 자주 나오는 꼬리질문 + 모범답안

:::details npm ci와 npm install의 차이는?
`npm ci`는 `package-lock.json`을 정확히 따라 `node_modules`를 지우고 재설치한다. lock을 갱신하지 않으므로 재현 가능하고 빠르다. CI/배포에서 쓴다. `npm install`은 의존성을 해석하며 lock을 변경할 수 있어 로컬 개발용이다. CareerTuner의 모든 GitHub Actions는 `npm ci`를 쓴다.
:::

:::details Vite의 mode와 환경변수는 어떻게 동작하나?
`--mode mock`을 주면 Vite가 `.env.mock`을 추가 로드한다. `VITE_` 접두사 변수만 클라이언트 번들에 `import.meta.env.X`로 노출되고, 빌드 시점에 상수로 치환된다. 그래서 같은 코드가 빌드 모드에 따라 `VITE_USE_MOCK`을 true/false로 박은 서로 다른 산출물이 된다. 접두사 규칙은 서버 비밀(DB 비번 등)이 실수로 번들에 섞이는 걸 막는 안전장치이기도 하다.
:::

:::details typecheck를 왜 따로 두나? build가 타입을 안 보나?
`vite build`는 esbuild로 타입 주석만 제거하고 타입 검사는 하지 않는다(속도 우선). 그래서 타입 오류가 있어도 빌드가 통과해버린다. `tsc --noEmit`을 별도 script로 두고 CI에서 빌드보다 먼저 돌려 타입 깨짐을 잡는다. 실제로 알림 타입 깨짐이 데모 배포를 막은 사고가 있어 `frontend-ci.yml`이 PR마다 typecheck를 강제하게 됐다.
:::

:::details 빌드 산출물(dist)은 어떻게 배포되나?
`vite build`가 해시 파일명 + PWA 서비스워커까지 포함해 `frontend/dist/`를 만든다. `deploy-demo.yml`은 mock 모드로 빌드한 `dist`를 시크릿 패턴(`OPENAI_API_KEY`, `JWT_SECRET`, DB 접속 문자열, 숫자 IP 등)으로 스캔한 뒤 통과해야만 공개 데모 repo로 푸시해 GitHub Pages에 올린다. SPA 라우팅을 위해 `index.html`을 `404.html`로 복사하는 폴백도 넣는다.
:::

:::details 모바일 빌드는 웹 빌드와 뭐가 다른가?
`mobile:sync`는 `vite build --mode mock && cap sync android`다. 즉 같은 Vite 산출물을 만든 뒤 Capacitor가 그 `dist`를 안드로이드 WebView 자산으로 복사·동기화한다. 코드는 동일하고 셸(브라우저 vs 네이티브 WebView)만 다르다. 실제 백엔드를 붙이려면 `VITE_API_BASE_URL`에 절대 URL을 주입해 빌드해야 한다(앱은 상대 `/api`로 PC localhost에 못 닿음).
:::

## 8. 직접 말해보기

1. "같은 프론트 코드베이스에서 일반 빌드와 백엔드 없는 데모 빌드를 어떻게 분기하나요?"를 `--mode`, `.env.mock`, `import.meta.env.VITE_USE_MOCK`, `dist`를 모두 넣어 30초로 말해보라.
2. CI에서 `npm ci → typecheck → build` 순서가 왜 이 순서인지, 각 단계가 무엇을 막는지 설명해보라.

## 퀴즈

<QuizBox question="CareerTuner CI가 npm install이 아니라 npm ci를 쓰는 주된 이유는?" :choices="['설치 속도가 항상 더 빨라서', 'package-lock.json대로 정확히 재현 설치해 환경 차이를 막으려고', '타입을 함께 검사해줘서', '환경변수를 자동 주입해줘서']" :answer="1" explanation="npm ci는 lock 파일을 그대로 따라 node_modules를 재현 설치한다. lock을 갱신하지 않으므로 CI와 로컬의 의존성 버전이 어긋나는 문제를 막는다." />

<QuizBox question="vite build --mode mock 빌드에서 VITE_USE_MOCK 값이 어떻게 클라이언트 코드에 들어가나?" :choices="['런타임에 서버가 내려준다', '빌드 시점에 .env.mock에서 로드돼 import.meta.env 상수로 치환된다', 'localStorage에 저장된다', 'cookie로 전달된다']" :answer="1" explanation="--mode mock이면 Vite가 .env.mock을 로드하고, VITE_ 접두사 변수를 빌드 시점에 import.meta.env.X 상수로 치환한다. api.ts는 이 값을 읽어 mock 동작을 켠다." />

<QuizBox question="typecheck(tsc --noEmit) script를 vite build와 별도로 두는 이유를 설명하라." explanation="vite build는 esbuild로 타입 주석만 제거하고 타입 검사는 하지 않으므로, 타입 오류가 있어도 빌드가 통과할 수 있다. 따라서 tsc --noEmit를 별도 게이트로 두고 CI에서 빌드보다 먼저 실행해 타입 깨짐을 조기에 차단한다. 실제로 frontend-ci.yml은 PR마다 typecheck를 강제해 타입 오류가 데모 배포를 막는 사고를 예방한다." />
