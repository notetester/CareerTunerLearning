# 프록시 (Proxy)

> 클라이언트와 서버 사이에서 요청을 대신 받아 넘겨주는 중간자. CareerTuner는 Vite dev 서버의 프록시로 `/api` 요청을 백엔드(`localhost:8080`)에 대리 전달해, 브라우저 입장에선 "같은 출처"처럼 보이게 만들어 [CORS](/glossary/cors)를 피한다.

## 1. 한 줄 정의

프록시는 **요청을 직접 처리하지 않고, 다른 서버로 대신 전달(forwarding)한 뒤 그 응답을 되돌려주는 중계 서버**다.

## 2. 단어 뜻 (약자·어원)

- **Proxy**: 라틴어 *procuratio*("대리, 위임")에서 온 영어 단어로 "대리인, 대리 권한"이라는 뜻. 누군가를 **대신해서** 행동하는 주체를 가리킨다.
- 네트워크에서 프록시는 클라이언트를 대신해 서버에 요청하거나(포워드 프록시), 서버 앞에 서서 클라이언트의 요청을 받아 뒤쪽 서버로 넘긴다(리버스 프록시).

| 종류 | 누구를 대리하나 | 위치 | 대표 예시 |
| --- | --- | --- | --- |
| 포워드 프록시 (Forward) | 클라이언트(사용자) | 사용자 쪽 | 사내 프록시, VPN 게이트웨이 |
| 리버스 프록시 (Reverse) | 서버 | 서버 앞 | Nginx, 로드밸런서, **Vite dev 프록시** |

CareerTuner가 쓰는 건 클라이언트 코드를 위해 백엔드 앞에 서는 **리버스 프록시 성격의 dev 프록시**다.

## 3. 왜 필요 (없으면 무슨 문제)

개발 중에는 프런트(`localhost:5173`)와 백엔드(`localhost:8080`)가 **포트가 달라 출처(Origin)가 다르다.** 브라우저는 이를 교차 출처(cross-origin) 요청으로 보고 [CORS](/glossary/cors) 정책으로 막는다.

프록시가 없다면:

- 프런트에서 `fetch('http://localhost:8080/api/...')` 를 직접 부르면 브라우저가 CORS preflight를 던지고, 백엔드가 정확히 허용 헤더를 안 주면 차단된다.
- 코드에 백엔드의 절대 주소(`http://localhost:8080`)가 박혀서, 배포 환경마다 주소를 바꿔야 한다.

프록시가 있으면:

- 프런트는 그냥 `/api/...` 같은 **상대경로**만 부른다. 브라우저 입장에선 자기 자신(`localhost:5173`)에게 요청하는 것이라 **같은 출처 → CORS 자체가 발생하지 않는다.**
- 실제 백엔드 주소는 프록시 설정 한 줄에만 존재한다. 코드에서 호스트/포트가 사라진다.

:::tip 핵심 직관
프록시는 "브라우저를 속이는" 게 아니라, **CORS가 발생할 자리를 브라우저 바깥(서버-서버 통신)으로 옮긴다.** 브라우저→Vite는 동일 출처, Vite→백엔드는 서버끼리라 CORS 규칙 대상이 아니다.
:::

## 4. CareerTuner에서 어디에 썼나 (실제 근거)

핵심은 두 파일의 합작이다.

**1) `frontend/vite.config.ts` — dev 프록시 설정**

```ts
server: {
  port: 5173,
  proxy: {
    // 브라우저가 localhost:5173/api/* 를 치면 Vite 가 localhost:8080/api/* 로 대리 전달
    '/api': {
      target: 'http://localhost:8080',
      changeOrigin: true,
    },
  },
},
```

- `/api`로 시작하는 모든 요청을 `localhost:8080`으로 넘긴다.
- `changeOrigin: true`는 프록시가 백엔드로 보낼 때 `Host` 헤더를 타깃(`localhost:8080`) 기준으로 바꾼다. 백엔드가 Host로 가상호스트를 가르거나 오리진을 검사할 때 어긋나지 않게 하는 옵션이다.

**2) `frontend/src/app/lib/api.ts` — 클라이언트가 상대경로를 쓰는 이유**

```ts
// 기본 BASE 는 상대경로 "/api". (절대 URL 이 필요하면 VITE_API_BASE_URL 로 덮어쓴다)
const BASE = ((import.meta.env.VITE_API_BASE_URL as string | undefined)
  ?.replace(/\/+$/, "")) || "/api";
```

제네릭 `api<T>()`가 항상 `${BASE}${path}` 로 호출하는데, 평소엔 `BASE === "/api"` 라서 상대경로가 나가고 → Vite 프록시가 받아 백엔드로 넘긴다. 이 레이어는 401 자동 리프레시·envelope 파싱도 담당한다(자세히는 [프런트 API 레이어](/frontend/api-layer-jwt-refresh)).

**3) 프록시를 못 쓰는 환경(모바일/배포)은 절대 URL로 우회**

번들된 앱(Capacitor)이나 다른 호스트에 올린 빌드는 자기 출처에 `/api`가 없으니 프록시 트릭이 안 통한다. 그래서:

- `VITE_API_BASE_URL=http://<LAN_IP>:8080/api` 처럼 **절대 URL**을 주입해 빌드한다. (`api.ts`의 `BASE`가 이 값으로 바뀐다.)
- 이때는 진짜 교차 출처 요청이라 **백엔드가 CORS로 허용**해줘야 한다. `backend/.../common/config/SecurityConfig.java`의 `corsConfigurationSource()`가 그 역할:

```java
config.setAllowedOriginPatterns(allowedOriginPatterns); // 기본: localhost:5173, capacitor://localhost 등
config.setAllowCredentials(true);
source.registerCorsConfiguration("/api/**", config);
```

- Capacitor(`frontend/capacitor.config.ts`)는 평문 http 백엔드(Tailscale/LAN)를 부르려고 `androidScheme: 'http'`, `cleartext: true`로 설정돼 있다.

:::warning 정리: 개발은 프록시, 배포·모바일은 절대 URL + CORS
- **dev(웹)**: 상대경로 `/api` → Vite 프록시 → 백엔드. CORS 불필요.
- **배포/모바일**: `VITE_API_BASE_URL` 절대 URL로 직접 호출 → 백엔드 `SecurityConfig`의 CORS 허용 오리진이 반드시 필요.
:::

## 5. 핵심 동작 원리 (표·작은 코드)

요청 한 건이 흐르는 경로(개발 모드):

```text
브라우저(localhost:5173)
   │  GET /api/applications   ← 상대경로, 동일 출처라 CORS 검사 없음
   ▼
Vite dev 서버 (프록시 미들웨어)
   │  GET http://localhost:8080/api/applications   ← 서버-서버, 브라우저 CORS 규칙 밖
   ▼
Spring Boot 백엔드(:8080)
   │  ApiResponse<T> JSON 응답
   ▼  (역순으로 그대로 되돌아옴)
브라우저가 받는 응답: localhost:5173 이 준 것처럼 보임
```

환경별로 어디서 요청이 갈리는지:

| 환경 | `BASE` 값 | 요청 경로 | CORS 검사 | 프록시 사용 |
| --- | --- | --- | --- | --- |
| 웹 개발 | `/api` | `localhost:5173/api/...` | 없음(동일 출처) | Vite 프록시 |
| 웹 배포(동일 출처 백엔드) | `/api` | 같은 도메인 `/api/...` | 없음(동일 출처) | 리버스 프록시(Nginx 등) 권장 |
| 모바일/LAN | `http://IP:8080/api` | 절대 URL 직접 호출 | **있음** | 없음 → 백엔드 CORS 필요 |

핵심 한 줄: **프록시는 "출처가 다르다"는 사실을 브라우저에게서 감춘다.** 그래서 CORS preflight 자체가 안 생긴다.

## 6. 면접 답변 3단계 (초간단 / 기본 / 꼬리질문)

- **초간단**: "프록시는 요청을 대신 받아 다른 서버로 넘겨주는 중간자입니다. 저희는 Vite dev 프록시로 `/api` 요청을 백엔드로 보내 CORS를 피했습니다."
- **기본**: "개발할 때 프런트는 5173, 백엔드는 8080이라 출처가 달라 CORS가 걸립니다. `vite.config.ts`에 `/api`를 `localhost:8080`으로 넘기는 프록시를 두고, 프런트 코드(`api.ts`)는 항상 상대경로 `/api`만 부르게 했습니다. 그러면 브라우저 입장에선 동일 출처라 CORS가 발생하지 않고, 실제 백엔드 주소는 설정 한 줄에만 남습니다."
- **꼬리질문 대비**: "프록시를 못 쓰는 모바일·배포 환경에선 `VITE_API_BASE_URL`로 절대 URL을 주입하고, 그때는 진짜 교차 출처라 백엔드 `SecurityConfig`의 CORS 허용 오리진(`/api/**`)으로 풀어줍니다. 즉 개발은 프록시로, 배포는 CORS로 같은 문제를 다르게 해결합니다."

## 7. 꼬리질문 + 모범답안

:::details Q1. 프록시로 CORS를 피하는 것과 백엔드에서 CORS를 허용하는 것의 차이는?
프록시는 **브라우저가 동일 출처로 인식**하게 만들어 애초에 CORS 검사를 안 받게 한다(주로 개발 편의). CORS 허용은 **교차 출처임을 인정하고 백엔드가 명시적으로 응답 헤더로 허용**하는 것이다. CareerTuner는 dev에선 프록시, 모바일/LAN 배포에선 `SecurityConfig`의 CORS를 쓴다. 동일 출처로 배포할 수 있으면 운영에서도 리버스 프록시(예: Nginx)가 더 깔끔하다.
:::

:::details Q2. `changeOrigin: true`는 왜 켰나?
프록시가 백엔드로 전달할 때 `Host` 헤더를 원래 브라우저 값(`localhost:5173`)이 아니라 **타깃(`localhost:8080`)으로 바꾸는** 옵션이다. 백엔드가 Host 기반 가상호스팅을 하거나 오리진·호스트를 검증할 때 불일치로 거절되는 걸 막는다. 현재 백엔드엔 영향이 작지만, 안전한 기본값이라 켜둔다.
:::

:::details Q3. 프록시를 쓰면 프런트 코드에서 백엔드 주소가 안 보인다는 게 왜 장점인가?
호스트/포트가 코드에 박히지 않으니, 환경(로컬·LAN·운영)이 바뀌어도 **프런트 코드는 그대로**고 설정만 바꾸면 된다. CareerTuner는 평소 상대경로 `/api`만 쓰고, 절대 URL이 필요할 때만 `VITE_API_BASE_URL` 환경변수로 덮어쓴다. 비밀·주소가 코드/번들에 노출되는 면도 줄어든다.
:::

:::details Q4. dev 프록시 설정이 운영 빌드에도 적용되나?
아니다. `vite.config.ts`의 `server.proxy`는 **Vite dev 서버에서만** 동작한다. `npm run build`로 만든 정적 산출물(`dist`)에는 프록시가 없다. 그래서 운영에서는 (1) 백엔드와 동일 출처로 서빙하고 리버스 프록시를 두거나, (2) 절대 URL + 백엔드 CORS로 푼다. CareerTuner의 Capacitor 번들 빌드가 후자다.
:::

:::details Q5. 모바일 APK에서 `localhost`로 백엔드를 못 부르는 이유는?
앱은 자기 자신이 `http(s)://localhost` 출처라서, `/api`를 상대경로로 부르면 PC가 아니라 **폰/에뮬레이터 자기 자신**을 가리킨다(BlueStacks→PC localhost 불가). 그래서 도달 가능한 백엔드(LAN IP·Tailscale 주소)를 `VITE_API_BASE_URL`로 절대 지정해야 하고, 평문 http면 Capacitor의 `androidScheme:'http'`·`cleartext:true`로 허용한다.
:::

## 8. 직접 말해보기

1. "프록시가 정확히 무엇을 대신하나?"를 포워드/리버스 구분과 함께 한 문장으로 말해보라.
2. CareerTuner에서 개발 중 `/api/applications` 요청이 브라우저 → Vite → 백엔드로 가는 과정을 손으로 그리며 설명해보라. CORS 검사가 어디서 안 생기는지 짚어라.
3. "그럼 모바일 앱은 왜 프록시로 안 되나?"라는 질문에, 절대 URL과 백엔드 CORS(`SecurityConfig`)로 어떻게 푸는지 30초 안에 답해보라.

## 퀴즈

<QuizBox question="CareerTuner 웹 개발 환경에서 프런트(5173)와 백엔드(8080) 사이 CORS 문제를 푸는 1차 수단은?" :choices="['백엔드 SecurityConfig에서 모든 오리진 허용', 'Vite dev 서버의 /api 프록시로 동일 출처처럼 전달', '프런트 코드에 백엔드 절대 URL을 하드코딩', '브라우저 보안 정책을 끈다']" :answer="1" explanation="vite.config.ts 의 server.proxy 가 /api 요청을 localhost:8080 으로 대리 전달해 브라우저 입장에선 동일 출처가 되므로 CORS 자체가 발생하지 않는다." />

<QuizBox question="모바일/배포처럼 프록시를 쓸 수 없는 환경에서 CareerTuner가 백엔드를 부르는 방식은?" :choices="['상대경로 /api 를 그대로 사용', 'VITE_API_BASE_URL 절대 URL + 백엔드 CORS 허용', 'changeOrigin 옵션만 켜면 해결', 'Vite 프록시를 빌드 산출물에 포함']" :answer="1" explanation="번들 앱/배포 빌드에는 dev 프록시가 없으므로 BASE 를 VITE_API_BASE_URL 절대 URL 로 바꿔 직접 호출하고, 진짜 교차 출처이므로 SecurityConfig 의 /api/** CORS 허용이 필요하다." />

<QuizBox question="vite.config.ts 의 proxy 설정에서 changeOrigin: true 가 하는 일을 한 문장으로 설명하라." explanation="프록시가 백엔드로 요청을 전달할 때 Host 헤더를 원래 브라우저 출처(localhost:5173)가 아니라 타깃 서버(localhost:8080) 기준으로 바꿔, 백엔드의 Host/오리진 검사나 가상호스팅과 충돌하지 않게 한다." />
