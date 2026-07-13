# API

> "API는 두 소프트웨어가 어떻게 요청하고 어떻게 응답할지 미리 약속해 둔 계약이자 창구입니다. CareerTuner는 프론트(:5173)와 백엔드(:8080)를 REST API `/api/**`로만 연결해 분리했습니다."

## 1. 한 줄 정의

API는 **한 프로그램이 다른 프로그램의 기능을 호출하기 위해 정해 둔 약속(인터페이스)**이다. "이 주소로 이런 형식의 요청을 보내면, 이런 형식으로 응답을 돌려준다"는 계약서다.

## 2. 단어 뜻 (약자/어원 풀이)

| 글자 | 영어 | 뜻 |
| --- | --- | --- |
| A | Application | 응용 프로그램 (우리 백엔드) |
| P | Programming | 프로그래밍, 즉 코드로 호출한다는 의미 |
| I | **Interface** | 접점/창구 — 이 단어가 핵심 |

핵심은 **Interface(접점)**다. 식당의 메뉴판에 비유하면 좋다. 손님(프론트)은 주방(백엔드)이 어떻게 요리하는지 몰라도 된다. **메뉴판(API)에 적힌 이름과 형식**대로 주문하면 음식이 나온다. 주방 내부 구조가 바뀌어도 메뉴판이 그대로면 손님은 영향받지 않는다 — 이게 API가 주는 "구현 은닉"이다.

:::tip 자주 묶이는 단어
**REST API**는 HTTP 메서드(GET/POST/PUT/DELETE)와 URL 경로로 자원을 다루는 API 스타일이고, **엔드포인트(Endpoint)**는 호출 가능한 개별 주소(예: `/api/fit-analyses`)를 말한다.
:::

## 3. 왜 필요한가 (없으면 무슨 문제가 생기나)

API라는 명시적 계약이 없으면 이런 문제가 생긴다.

- **결합도 폭발**: 프론트가 백엔드 내부 구현(테이블 구조, 함수)을 직접 알아야 한다. 백엔드를 고치면 프론트가 줄줄이 깨진다.
- **분업 불가**: 프론트 담당과 백엔드 담당이 동시에 일할 수 없다. CareerTuner는 6명이 A~F로 수직 분담하는데, API 계약이 있어야 "C는 적합도 분석 API를 만들고, 프론트는 그 응답 형식만 보고 화면을 짠다"가 가능하다.
- **언어 장벽**: CareerTuner는 백엔드 Java, 프론트 TypeScript, 공고추출 워커 Python으로 언어가 다르다. API(HTTP+JSON)는 언어 중립적이라 서로 호출할 수 있다.
- **재사용 불가**: 같은 백엔드를 웹(:5173)과 모바일 앱(Capacitor)이 함께 써야 하는데, API가 단일 창구라 양쪽이 같은 백엔드를 그대로 호출한다.

## 4. CareerTuner에서 어디에 썼나 (실제 클래스/파일/테이블)

CareerTuner는 **프론트엔드 SPA와 백엔드를 완전히 분리**하고 그 사이를 REST API로만 연결한다.

| 위치 | 파일/클래스 | 역할 | 영역 |
| --- | --- | --- | --- |
| 백엔드 컨트롤러 | `FitAnalysisController` (`@RequestMapping("/api/fit-analyses")`) | 적합도 분석 API 창구 | C |
| 백엔드 컨트롤러 | `AuthController` (`/api/auth`), `ApplicationCaseController` (`/api/application-cases`) | 인증·지원건 API | A·공통 |
| 응답 표준 | `common/web/ApiResponse` (record) | 모든 응답을 감싸는 envelope | 공통 |
| 프론트 호출 레이어 | `app/lib/api.ts`의 제네릭 `api()` 함수 | 모든 fetch를 한 곳에서 처리 | 공통 |
| 프론트 타입 | `ApiEnvelope<T>` 인터페이스 | 백엔드 envelope과 1:1 매칭 | 공통 |
| 개발 프록시 | `vite.config.ts`의 `server.proxy` | `:5173/api/*` → `:8080`로 전달 | 공통 |

- 모든 백엔드 컨트롤러는 예외 없이 `@RestController` + `@RequestMapping("/api/**")` 하위에 있다(예: `/api/fit-analyses`, `/api/auth`, `/api/billing`).
- 영역 C의 적합도 분석 결과는 `fit_analysis` 테이블에 저장되고, `FitAnalysisController`의 API를 통해 프론트로 나간다.

:::warning API와 모델 endpoint 구분
위 표의 항목은 실제 구현된 제품 API다. C 자체 모델은 별도 사용자 공개 API를 늘리지 않고 `CareerAnalysisOssClient` 뒤의 provider로 연결된다. 제품 계약과 내부 추론 endpoint를 섞어 말하지 말 것.
:::

## 5. 핵심 동작 원리 (표/작은 코드/단계)

CareerTuner의 API 한 번 호출이 흐르는 경로다.

```text
[브라우저:5173] api("/fit-analyses/123")
   │  GET /api/fit-analyses/123  + Authorization: Bearer <token>
   ▼
[Vite 프록시]  /api/* 를 localhost:8080 으로 전달 (개발 시)
   ▼
[Spring Boot:8080]  FitAnalysisController @GetMapping
   │  service → mapper → fit_analysis 테이블
   ▼
[응답] ApiResponse.ok(data)  →  { "success": true, "code": "OK", "data": {...} }
   ▼
[api.ts]  envelope 풀어서 data 만 반환 (실패면 ApiError throw)
```

**백엔드: 모든 응답을 envelope으로 통일한다.** (`ApiResponse.java`)

```java
public record ApiResponse<T>(boolean success, String code, String message, T data) {
    public static <T> ApiResponse<T> ok(T data) {
        return new ApiResponse<>(true, "OK", null, data);
    }
    public static <T> ApiResponse<T> error(String code, String message) {
        return new ApiResponse<>(false, code, message, null);
    }
}
```

**프론트: 그 계약을 그대로 받아서 푼다.** (`api.ts`)

```typescript
const env = (await res.json()) as ApiEnvelope<T> | null;
if (!res.ok || !env || env.success === false) {
  throw new ApiError(env?.message ?? "요청 실패", env?.code ?? "ERROR", res.status);
}
return env.data as T;   // 호출부는 data 만 받는다
```

| 약속한 항목 | 백엔드(Java) | 프론트(TS) |
| --- | --- | --- |
| 성공 여부 | `success` | `env.success` |
| 에러 코드 | `code` (예: `NOT_FOUND`) | `ApiError.code` |
| 실제 데이터 | `data` | `api()`의 반환값 |

이 **이름과 형식이 양쪽에서 똑같다**는 것이 곧 "API 계약"이다. 추가로 `api.ts`는 401(만료) 응답이 오면 `tryRefresh()`로 토큰을 갱신해 한 번 재시도하는데, 이것도 "401이면 갱신한다"는 약속을 클라이언트가 구현한 것이다.

## 6. 면접 답변 3단계

- **초간단 (1문장)**: "API는 프로그램끼리 요청·응답 형식을 미리 정해 둔 계약입니다."
- **기본**: "두 시스템이 서로 내부 구현을 몰라도 통신할 수 있게 해주는 인터페이스입니다. CareerTuner는 React 프론트(:5173)와 Spring Boot 백엔드(:8080)를 REST API `/api/**`로 분리해서, 프론트는 응답 형식만 알면 화면을 만들 수 있게 했습니다."
- **꼬리질문 대응**: "응답은 `ApiResponse`라는 표준 envelope(success/code/message/data)으로 통일했고, 프론트의 `api.ts`가 이 envelope을 풀어 data만 돌려주고 실패 시 `ApiError`를 던집니다. 덕분에 6명이 분업할 때 계약(응답 스펙)만 합의하면 프론트·백엔드를 병렬로 개발할 수 있었습니다."

## 7. 자주 나오는 꼬리질문 + 모범답안

**Q1. API와 REST API의 차이는?**
API는 더 넓은 개념(라이브러리 함수도 API다). REST API는 그중 HTTP 메서드와 URL 경로로 자원을 다루는 특정 스타일이다. CareerTuner는 `GET /api/fit-analyses/{id}` 같은 REST 스타일을 쓴다.

**Q2. 프론트와 백엔드를 왜 분리했나?**
독립 배포·독립 개발·재사용 때문이다. 같은 백엔드를 웹과 Capacitor 모바일 앱이 함께 호출한다. 분리하지 않으면 한쪽 변경이 다른 쪽을 강제로 깨뜨린다.

**Q3. 개발 중 프론트(:5173)가 백엔드(:8080)를 어떻게 호출하나? CORS 문제는?**
브라우저는 같은 출처 `:5173/api/*`로 보내고, Vite 프록시(`vite.config.ts`)가 이를 `:8080`으로 전달한다. 브라우저 입장에선 동일 출처라 개발 중 CORS가 생기지 않는다. 모바일 앱처럼 다른 출처에서 직접 호출할 때는 백엔드 `SecurityConfig`의 CORS 허용 오리진(localhost:5173, capacitor://localhost)으로 처리한다.

**Q4. 응답을 매번 envelope으로 감싸면 번거롭지 않나? 장점은?**
성공/실패 처리가 한 곳으로 통일된다. 프론트 `api()`가 envelope만 보면 되니 모든 호출부가 try/catch와 에러코드 분기를 중복 작성하지 않는다. `code`로 `INSUFFICIENT_CREDIT`, `AI_UNAVAILABLE` 같은 비즈니스 에러를 일관되게 구분할 수 있다.

**Q5. API 버전이 바뀌어 응답 형식이 달라지면?**
계약이 바뀌는 것이라 양쪽이 깨질 수 있다. 그래서 envelope의 바깥 형식(success/code/message/data)은 고정하고 `data` 안쪽만 바꾸거나, 필요하면 경로에 버전을 두는 방식으로 하위호환을 지킨다.

## 8. 직접 말해보기

1. 면접관에게 "프론트엔드와 백엔드를 어떻게 통신시켰나요?"라는 질문을 받았다고 가정하고, `/api/**`, Vite 프록시, `ApiResponse` envelope 세 단어를 모두 넣어 40초 안에 답해보라.
2. 비개발자에게 API를 "식당 메뉴판" 비유로 30초 안에 설명해보라.

## 관련 페이지

- [DTO](/glossary/dto) — API가 주고받는 데이터의 형식
- [JWT / Spring Security](/backend/jwt-security) — API 호출 시 인증 처리
- [REST](/glossary/rest-api) — `/api/**`가 따르는 설계 스타일

## 퀴즈

<QuizBox question="API에서 'I'가 의미하는 단어와 그 핵심 개념으로 가장 적절한 것은?" :choices="['Internet, 즉 인터넷 연결', 'Interface, 즉 두 소프트웨어 사이의 접점/계약', 'Integration, 즉 데이터베이스 통합', 'Instance, 즉 객체 인스턴스']" :answer="1" explanation="API = Application Programming Interface. 핵심은 Interface(접점)로, 내부 구현을 몰라도 약속된 형식으로 호출할 수 있게 하는 계약이다." />

<QuizBox question="CareerTuner에서 개발 중 브라우저가 :5173/api/* 로 보낸 요청이 백엔드 :8080 으로 전달되는 방식은?" :choices="['브라우저가 직접 :8080 으로 요청한다', 'Vite 프록시(vite.config.ts)가 /api 요청을 :8080 으로 포워딩한다', 'Nginx 리버스 프록시가 항상 중간에 있다', 'Capacitor 가 요청을 가로채 전달한다']" :answer="1" explanation="vite.config.ts 의 server.proxy 설정이 /api 경로를 localhost:8080 으로 전달한다. 브라우저는 동일 출처(:5173)로 보내므로 개발 중 CORS 가 발생하지 않는다." />

<QuizBox question="CareerTuner의 ApiResponse envelope(success/code/message/data)으로 모든 응답을 통일했을 때 얻는 이점을 한 문단으로 설명하라." explanation="성공·실패 처리 형식이 한 곳으로 통일되어 프론트의 api() 함수가 envelope만 풀면 되므로 모든 호출부가 에러 처리를 중복 작성하지 않아도 된다. code 필드로 INSUFFICIENT_CREDIT, AI_UNAVAILABLE, NOT_FOUND 같은 비즈니스 에러를 일관되게 구분할 수 있고, 백엔드(Java record)와 프론트(TS 인터페이스)가 동일한 형식을 공유하므로 계약만 합의하면 6명이 프론트와 백엔드를 병렬로 개발할 수 있다." />
