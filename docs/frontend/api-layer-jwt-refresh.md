# API 레이어와 JWT 자동 리프레시

> 모든 fetch를 제네릭 `api()` 한 곳에 모아서, 401이 뜨면 알아서 토큰을 새로 받고 원래 요청을 재시도합니다. 핵심은 동시 요청이 한꺼번에 401을 맞아도 리프레시는 단 한 번만 일어나게 하는 "단일-플라이트" 처리입니다.

## 1. 한 줄 정의

프론트엔드의 모든 백엔드 호출이 거쳐 가는 단일 함수 `api()`로, 인증 헤더 부착·`ApiResponse` 엔벨로프 해석·만료 토큰 자동 갱신을 한 곳에서 처리하는 **API 추상화 레이어**다.

## 2. 단어 뜻 (약자/어원 풀이)

| 용어 | 풀이 |
| --- | --- |
| API 레이어 | 화면 코드가 `fetch`를 직접 부르지 않고 거쳐 가는 중간 계층. UI는 "데이터만" 받고 인증·에러·갱신은 모른다 |
| JWT | JSON Web Token. 서버가 서명한 토큰. Access(짧음)/Refresh(김) 두 종류 |
| Refresh | Access 토큰이 만료됐을 때, 더 오래 사는 Refresh 토큰으로 새 Access를 받는 동작 |
| 401 Unauthorized | "인증 안 됨" HTTP 상태. 여기선 보통 Access 토큰 만료 신호 |
| 단일-플라이트(single-flight) | 같은 작업 여러 요청이 동시에 들어와도 실제 실행은 1회만. 나머지는 그 결과를 공유 |
| 엔벨로프(envelope) | 실제 데이터를 `success/code/message/data`로 감싼 공통 응답 포장지 |

:::tip
"single-flight"는 비행기 한 편에 여러 사람이 같이 타는 그림으로 기억하면 쉽다. 동시 401들이 각자 리프레시를 날리는 게 아니라, 같은 한 편의 결과를 나눠 탄다.
:::

## 3. 왜 필요한가 (없으면 무슨 문제가 생기나)

API 레이어가 없다면 화면 컴포넌트마다 `fetch`를 직접 쓰게 된다. 그러면:

- **인증 헤더 누락/중복**: `Authorization: Bearer ...`를 컴포넌트마다 손으로 붙이다 빠뜨린다.
- **엔벨로프 해석 중복**: 백엔드는 항상 `ApiResponse`로 감싸 보내는데([ApiResponse](/glossary/api-response-envelope) 참고), 매번 `env.data`를 풀고 `success`를 검사하는 코드가 복붙된다.
- **만료 토큰 처리 불가**: Access 토큰이 30분마다 만료되는데, 만료될 때마다 사용자가 다시 로그인해야 한다.
- **리프레시 폭주(thundering herd)**: 대시보드처럼 화면 진입 시 5~6개 요청을 동시에 쏘면, 토큰 만료 순간 그 요청들이 **전부** 401 → 각자 리프레시를 날린다. 서버에 중복 리프레시가 쏟아지고, Refresh 토큰을 1회용으로 회전(rotation)시키는 설계라면 뒤늦은 요청은 이미 무효가 된 토큰을 들고 실패한다.

`api()` + 단일-플라이트 `tryRefresh()`는 이 네 문제를 한 번에 해결한다.

## 4. CareerTuner에서 어디에 썼나 (영역: 프론트엔드)

전부 **구현됨**. 두 파일이 전부다.

| 파일 | 역할 |
| --- | --- |
| `frontend/src/app/lib/api.ts` | 제네릭 `api<T>()`, `tryRefresh()`, `ApiEnvelope`/`ApiError`, `BASE`/`USE_MOCK` |
| `frontend/src/app/lib/tokenStore.ts` | `localStorage` 키 `careertuner.auth`에 access/refresh 저장·조회·삭제 |

연결 관계:

- 모든 기능 모듈의 `features/<기능>/api/*.ts`가 이 `api()`를 호출한다. 예: 적합도 분석 호출 → `useApplicationFitAnalysis` 훅 → 기능 api → `api()`.
- 전역 인증은 [AuthContext](/frontend/state-management)(`AuthProvider`)가 관리하고, 토큰 저장은 `tokenStore`에 위임한다.
- 백엔드 쪽 짝꿍: `JwtAuthenticationFilter`가 `Bearer` 토큰을 파싱하고, 만료 시 401을 돌려주며, `/api/auth/refresh`가 새 토큰 쌍을 발급한다([JWT](/backend/jwt-security) 참고).
- `BASE`는 기본 `"/api"`(웹은 Vite 프록시 → :8080). `VITE_API_BASE_URL`을 주면 그 절대 URL을 쓴다 — Capacitor 모바일 앱이 LAN 백엔드를 가리킬 때 사용.
- `USE_MOCK`(`VITE_USE_MOCK=true`)이면 네트워크 대신 mock 레지스트리로 응답한다. 백엔드 없이 도는 데모 APK·GitHub Pages 배포용.

## 5. 핵심 동작 원리 (표/작은 코드/단계)

### 5.1 정상 호출 흐름

```ts
// frontend/src/app/lib/api.ts (축약)
export async function api<T>(path, options = {}, config = {}) {
  const withAuth = config.auth ?? true;          // 기본 인증 켜짐
  if (USE_MOCK) return resolveMock(path, options); // 데모 모드 분기

  let res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: buildHeaders(options, withAuth),     // Bearer 토큰·Content-Type 부착
  });

  // ── 401이면 한 번만 갱신 후 재시도 ──
  if (res.status === 401 && withAuth && getRefreshToken()) {
    const ok = await tryRefresh();
    if (ok) res = await fetch(`${BASE}${path}`, { ...options, headers: buildHeaders(options, true) });
  }

  const env = await res.json().catch(() => null); // ApiEnvelope<T>
  if (!res.ok || !env || env.success === false) {
    throw new ApiError(env?.message ?? `요청 실패 (${res.status})`, env?.code ?? "ERROR", res.status);
  }
  return env.data as T;                            // UI엔 data만 반환
}
```

호출부는 `const fit = await api<FitResult>("/applications/1/fit")` 처럼 **데이터 타입만** 신경 쓰면 된다. 엔벨로프·토큰·401은 보이지 않는다.

### 5.2 단일-플라이트 리프레시 (이 페이지의 핵심)

```ts
let refreshPromise: Promise<boolean> | null = null;  // 모듈 전역 1개

function tryRefresh(): Promise<boolean> {
  if (refreshPromise) return refreshPromise;          // ★ 이미 진행 중이면 그 프라미스 공유
  const refreshToken = getRefreshToken();
  if (!refreshToken) return Promise.resolve(false);
  refreshPromise = (async () => {
    try {
      const res = await fetch(`${BASE}/auth/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken }),
      });
      const env = await res.json().catch(() => null);
      if (res.ok && env?.success && env.data) {
        setTokens({ accessToken: env.data.accessToken, refreshToken: env.data.refreshToken });
        return true;
      }
      clearTokens();                                   // 실패 = 강제 로그아웃 상태
      return false;
    } catch {
      return false;
    } finally {
      refreshPromise = null;                            // ★ 끝나면 비워서 다음 만료 때 재사용
    }
  })();
  return refreshPromise;
}
```

동시 5개 요청이 401을 맞는 순간:

| 시점 | 요청 1 | 요청 2~5 |
| --- | --- | --- |
| 첫 401 | `refreshPromise` 비어 있음 → 새로 시작 | - |
| 거의 동시 401 | - | `refreshPromise` 있음 → **그 프라미스를 그대로 await** |
| 리프레시 1회 완료 | 새 토큰 저장 | 같은 결과(`true`) 수신 |
| 재시도 | 새 Access로 재요청 | 각자 새 Access로 재요청 |

→ 네트워크상 `/auth/refresh`는 **딱 한 번**만 나간다.

### 5.3 토큰 보관

`tokenStore.ts`는 access/refresh를 **한 키**(`careertuner.auth`)에 JSON으로 묶어 `localStorage`에 저장한다. `getAccessToken()`/`getRefreshToken()`/`setTokens()`/`clearTokens()` 네 함수가 전부고, 파싱 실패 시 `null`로 안전하게 떨어진다.

:::warning
`localStorage`는 XSS에 노출되면 토큰이 그대로 읽힌다. 이걸 알고 있다는 점을 면접에서 언급하면 좋다. 더 강한 대안은 Refresh 토큰을 `HttpOnly` 쿠키에 두는 것. CareerTuner는 모바일(Capacitor) 동작과 단순성을 우선해 `localStorage` 방식을 택했고, Refresh 토큰은 서버 DB(`refresh_token` 테이블)에도 저장돼 서버 측 무효화가 가능하다.
:::

## 6. 면접 답변 3단계

- **초간단(1문장)**: "모든 API 호출을 `api()` 함수 하나로 모아서, 401이 뜨면 자동으로 토큰을 갱신하고 재시도하는데, 동시 요청이 몰려도 리프레시는 단 한 번만 일어나게 했습니다."
- **기본**: "백엔드가 항상 `ApiResponse` 엔벨로프로 응답하니까 `api()`에서 `data`만 풀어 반환하고, 실패면 `ApiError`로 통일해 던집니다. Access 토큰이 만료돼 401이 오면 Refresh 토큰으로 `/auth/refresh`를 호출해 새 토큰을 받고 원래 요청을 한 번 재시도합니다."
- **꼬리질문 대응**: "여기서 핵심은 단일-플라이트입니다. 대시보드처럼 여러 요청을 동시에 쏠 때 전부 401이 나면 각자 리프레시를 날려 서버에 중복 호출이 쏟아지고 토큰 회전과 충돌할 수 있습니다. 그래서 모듈 전역에 `refreshPromise` 하나를 두고, 진행 중이면 그 프라미스를 공유하다가 끝나면 `finally`에서 다시 비워 다음 만료에 재사용합니다."

## 7. 자주 나오는 꼬리질문 + 모범답안

:::details Q1. 왜 인터셉터 라이브러리(axios) 안 쓰고 직접 `fetch`로 만들었나요?
의존성을 줄이려고요. 필요한 건 헤더 부착·엔벨로프 해석·401 리프레시 세 가지뿐이라 `fetch` 위 얇은 래퍼로 충분했습니다. axios interceptor도 같은 패턴(요청 인터셉터에 토큰, 응답 인터셉터에 401 리프레시)을 쓰지만, 단일-플라이트 큐는 어차피 직접 구현해야 합니다. 번들 크기와 동작 투명성 면에서 직접 만든 게 이득이었습니다.
:::

:::details Q2. 재시도 후에도 401이면 어떻게 되나요? 무한 루프는 안 나나요?
재시도는 **단 한 번**입니다. 401 분기 안에서 한 번만 재요청하고, 그 응답을 그대로 엔벨로프 검사로 흘려보냅니다. 재시도가 또 401이면 `ApiError(status 401)`로 던져지고, `tryRefresh()`가 실패했다면 그 안에서 `clearTokens()`로 토큰을 비운 상태라 사실상 로그아웃입니다. 재시도가 또 `tryRefresh`를 부르는 경로가 없으므로 루프가 생기지 않습니다.
:::

:::details Q3. `finally`에서 `refreshPromise = null`을 안 하면?
한 번 리프레시한 뒤로 `refreshPromise`가 계속 남아, 나중에 또 만료됐을 때 `if (refreshPromise) return refreshPromise`가 **이미 끝난(이미 resolve된) 옛 프라미스**를 그대로 돌려줍니다. 그러면 다시는 리프레시가 안 일어나 사용자가 영영 갱신을 못 받습니다. `finally`로 비우는 게 "한 번에 한 비행"을 보장하는 핵심 장치입니다.
:::

:::details Q4. 리프레시 도중 들어온 새 요청은 옛 토큰을 들고 가지 않나요?
401을 맞은 요청들만 `tryRefresh()`를 `await`하고, 끝난 **뒤** `buildHeaders`로 헤더를 다시 만들어 재요청하므로 그 시점의 최신 Access를 읽습니다. 리프레시 진행 중에 처음 시작하는 요청은 아직 만료 안 된 토큰이면 정상 통과하고, 만료됐다면 401 → 같은 `refreshPromise`에 합류합니다. 즉 헤더를 호출 시점에 매번 새로 만든다는 점이 중요합니다.
:::

:::details Q5. 토큰을 `localStorage`에 두면 XSS에 위험하지 않나요?
맞습니다, `localStorage`는 XSS로 스크립트가 주입되면 읽힙니다. 트레이드오프를 알고 선택했습니다. 더 안전한 건 Refresh 토큰을 `HttpOnly` 쿠키에 두는 것이지만, Capacitor 모바일 앱(`capacitor://localhost` 출처)에서의 쿠키 처리 복잡성과 SPA의 단순함을 고려했습니다. 대신 React 이스케이프로 XSS 표면을 줄이고, Refresh 토큰을 서버 `refresh_token` 테이블에도 저장해 서버 측에서 무효화·만료(14일) 관리가 가능하게 했습니다.
:::

## 8. 직접 말해보기 (말하기 훈련용)

1. 화이트보드 없이 말로만: "동시에 6개 요청이 토큰 만료를 맞았을 때, 리프레시가 단 한 번만 나가는 흐름"을 30초 안에 설명해 보라. `refreshPromise`라는 단어를 꼭 넣어서.
2. "왜 `fetch` 직접 래퍼인가, axios면 뭐가 달랐나"를 트레이드오프 중심으로 1분간 말해 보라.

## 퀴즈

<QuizBox question="동시에 여러 요청이 401을 맞아도 /auth/refresh 호출이 한 번만 나가게 하는 핵심 장치는?" :choices="['요청마다 setTimeout으로 지연','모듈 전역 refreshPromise를 공유하는 단일-플라이트','localStorage에 락 플래그 저장','axios interceptor의 자동 큐']" :answer="1" explanation="진행 중인 리프레시 프라미스를 모듈 전역 변수 refreshPromise에 담아두고, 진행 중이면 새로 시작하지 않고 그 프라미스를 그대로 await해 공유한다. finally에서 null로 비워 다음 만료 때 재사용한다." />

<QuizBox question="api() 함수가 호출부(UI)에 최종적으로 반환하는 것은?" :choices="['ApiResponse 엔벨로프 전체','HTTP Response 객체','엔벨로프의 data 필드만','accessToken 문자열']" :answer="2" explanation="api()는 success를 검사하고 실패 시 ApiError를 던진 뒤, 성공이면 env.data만 풀어 반환한다. UI는 엔벨로프 구조를 몰라도 데이터 타입 T만 다루면 된다." />

<QuizBox question="tryRefresh()의 finally 블록에서 refreshPromise = null을 하지 않으면 어떤 문제가 생기는지 설명하라." explanation="한 번 완료된(이미 resolve된) 옛 프라미스가 전역 변수에 계속 남게 된다. 이후 토큰이 다시 만료돼도 if(refreshPromise) 분기가 그 끝난 프라미스를 그대로 반환하므로 실제 /auth/refresh 호출이 다시는 일어나지 않는다. 결과적으로 사용자는 토큰 갱신을 영영 못 받아 401이 반복된다. finally에서 null로 비워야 다음 만료 사이클에서 새 리프레시가 시작될 수 있다." />
