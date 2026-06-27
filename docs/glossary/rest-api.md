# REST API

> "자원을 URI로 가리키고, 그 자원에 대한 행위를 HTTP 메서드로 표현하는 무상태(stateless) 웹 API 스타일입니다. CareerTuner는 React SPA와 Spring Boot 백엔드를 REST로 분리 통신하고, 같은 API를 모바일 앱까지 그대로 씁니다."

## 1. 한 줄 정의

REST API는 **모든 것을 "자원(resource)"으로 보고, 자원을 URI로 식별한 뒤, 그 자원에 대해 무엇을 할지를 HTTP 메서드(GET/POST/PATCH/DELETE)로 표현**하는 API 설계 스타일이다. 핵심 3요소는 **자원(URI) + 행위(HTTP 메서드) + 무상태(stateless)**.

## 2. 단어 뜻 (약자/어원 풀이)

| 약자 | 풀이 | 의미 |
| --- | --- | --- |
| RE | REpresentational | 자원의 "표현"(보통 JSON)을 주고받는다 |
| S | State | 자원의 상태 |
| T | Transfer | 상태를 전송한다 |
| API | Application Programming Interface | 프로그램끼리 약속된 호출 규약 |

- 원래는 Roy Fielding의 2000년 박사논문에서 나온 아키텍처 스타일이다.
- "자원의 표현 상태를 전송한다" → 서버 안의 데이터(상태)를 JSON 같은 표현으로 바꿔서 HTTP로 주고받는다는 뜻.
- 실무에서 "REST API"라고 하면 보통 **HTTP + JSON + 자원 중심 URI** 조합을 가리킨다.

## 3. 왜 필요한가 (없으면 무슨 문제가 생기나)

REST가 없으면(또는 규칙 없이 API를 만들면) 이런 문제가 생긴다.

- **URI가 동사 범벅이 된다.** `/getCase`, `/updateCaseNow`, `/deleteCaseReally` 처럼 엔드포인트마다 작명이 제각각이라 외우기 어렵다. REST는 명사 자원 + 표준 메서드로 통일한다.
- **프론트/백 분리가 어렵다.** CareerTuner는 React SPA(:5173)와 Spring Boot(:8080)가 완전히 분리돼 있다. 둘이 합의할 "계약"이 필요한데, REST가 그 공통 언어다.
- **확장(모바일)이 비싸진다.** REST는 무상태라서 같은 HTTP API를 웹·Capacitor 안드로이드/iOS 앱이 **그대로 재사용**한다. 서버는 누가 호출하는지 신경 쓸 필요가 없다.
- **캐싱/멱등성 이점을 못 쓴다.** GET은 안전(safe)하고 캐시 가능, PUT/DELETE는 멱등(idempotent)이라는 약속이 깨지면 PWA 캐싱이나 재시도 로직을 안전하게 짤 수 없다.

:::tip 무상태(stateless)가 핵심인 이유
서버가 클라이언트 세션을 기억하지 않으므로(요청마다 JWT를 들고 옴) 서버를 여러 대로 늘려도 아무 서버나 요청을 처리할 수 있다. CareerTuner도 `SecurityConfig`에서 세션을 `STATELESS`로 둔다.
:::

## 4. CareerTuner에서 어디에 썼나 (실제 클래스/파일/테이블)

CareerTuner의 모든 백엔드 컨트롤러가 REST 컨트롤러다(`@RestController` + `@RequestMapping("/api/**")`).

| 영역 | 자원 / 파일 | 예시 |
| --- | --- | --- |
| 공통 [C·공통] | `common/web/ApiResponse` (응답 envelope) | 모든 응답을 감싸는 표준 포맷 |
| 지원 건 | `applicationcase/controller/ApplicationCaseController` | `/api/application-cases` |
| 적합도 분석 [C] | `fitanalysis/controller/FitAnalysisController` | `/api/fit-analyses` |
| 취업경향 분석 [C] | `analysis/controller/AnalysisController` | 장기 커리어 분석 |
| 대시보드 [C] | `dashboard/controller/DashboardController` | 요약 인사이트 |
| 인증 | `auth/controller/AuthController` | `/api/auth/refresh` 등 |
| 프론트 클라이언트 | `frontend/src/app/lib/api.ts` 의 제네릭 `api()` | envelope 파싱 + 401 자동 refresh |

**자원 중심 URI 실제 예시 (`ApplicationCaseController`):**

| 메서드 | URI | 행위 |
| --- | --- | --- |
| `GET` | `/api/application-cases` | 지원 건 목록 조회 |
| `POST` | `/api/application-cases` | 지원 건 생성 |
| `GET` | `/api/application-cases/{id}` | 단건 조회 |
| `PATCH` | `/api/application-cases/{id}` | 부분 수정 |
| `DELETE` | `/api/application-cases/{id}` | 삭제 |
| `POST` | `/api/application-cases/{id}/job-analysis` | 하위 자원(공고분석) 생성 |
| `POST` | `/api/fit-analyses/application-cases/{id}` | 적합도 분석 생성 [C] |

URI가 `id`로 자원을 식별하고, 행위는 전부 HTTP 메서드로 표현된다. `/{id}/job-analysis` 처럼 **자원의 하위 자원**을 경로로 중첩한 것도 REST다운 설계다.

:::warning 엄밀히는 "REST-스타일(RESTful HTTP)"
CareerTuner를 포함한 대부분의 실무 API는 HATEOAS(응답에 다음 동작 링크 포함) 같은 REST의 최상위 제약까지는 안 지킨다. 면접에서 "완전한 REST"를 주장하기보다 "자원·메서드·무상태를 지키는 RESTful HTTP API"라고 정확히 말하는 편이 안전하다.
:::

## 5. 핵심 동작 원리 (표/작은 코드/단계)

### HTTP 메서드와 CRUD 대응

| 메서드 | CRUD | 멱등? | 안전? | CareerTuner 예 |
| --- | --- | --- | --- | --- |
| GET | Read | O | O | 적합도 분석 조회 |
| POST | Create | X | X | 지원 건 생성 |
| PATCH | Update(부분) | △ | X | 지원 건 일부 수정 |
| PUT | Update(전체) | O | X | (전체 교체 시) |
| DELETE | Delete | O | X | 지원 건 삭제 |

- **안전(safe)**: 서버 상태를 바꾸지 않음 → GET.
- **멱등(idempotent)**: 같은 요청을 N번 보내도 결과가 같음 → GET/PUT/DELETE.

### 표준 응답 envelope (실제 코드)

CareerTuner는 성공이든 실패든 **항상 같은 모양**으로 응답해서 프론트가 일관되게 파싱한다.

```java
// common/web/ApiResponse.java
public record ApiResponse<T>(boolean success, String code, String message, T data) {
    public static <T> ApiResponse<T> ok(T data) {
        return new ApiResponse<>(true, "OK", null, data);
    }
    public static <T> ApiResponse<T> error(String code, String message) {
        return new ApiResponse<>(false, code, message, null);
    }
}
```

```java
// 컨트롤러는 한 줄로 끝난다
@GetMapping("/{id}")
public ApiResponse<ApplicationCaseResponse> get(@AuthenticationPrincipal AuthUser authUser,
                                                @PathVariable Long id) {
    return ApiResponse.ok(applicationCaseService.get(authUser.id(), id));
}
```

### 요청 한 번의 흐름 (단계)

1. 브라우저/앱이 `GET /api/application-cases` 호출, 헤더에 `Authorization: Bearer <JWT>` 첨부.
2. Vite 프록시가 `/api`를 백엔드 `:8080`으로 전달(웹). 모바일은 `VITE_API_BASE_URL`로 직접 호출.
3. `JwtAuthenticationFilter`가 토큰을 파싱해 무상태로 사용자 식별.
4. `@RestController`가 처리 후 `ApiResponse.ok(data)` 반환 → JSON 직렬화.
5. 프론트 `api()`가 envelope를 풀어 `data`만 돌려주고, 실패면 `ApiError`를 던진다. 401이면 `tryRefresh()`로 한 번 자동 재발급 후 재시도.

## 6. 면접 답변 3단계

- **초간단 (1문장):** "REST는 자원을 URI로 가리키고 행위를 HTTP 메서드로 표현하는 무상태 API 스타일입니다."
- **기본:** "예를 들어 CareerTuner에서 지원 건은 `/api/application-cases`라는 자원이고, 조회는 GET, 생성은 POST, 부분 수정은 PATCH로 표현합니다. 서버가 세션을 기억하지 않고 매 요청에 JWT를 실어 보내므로, 같은 API를 웹 SPA와 모바일 앱이 그대로 재사용할 수 있습니다."
- **꼬리질문 대응:** "응답은 항상 `ApiResponse`라는 envelope로 통일했습니다. `success/code/message/data` 네 필드를 두어 성공·실패 형태가 일정하니, 프론트의 제네릭 `api()` 함수가 envelope를 풀고 401일 때 토큰 자동 재발급까지 한 곳에서 처리합니다. 엄밀히는 HATEOAS까지는 안 지키므로 'RESTful HTTP API'라고 표현합니다."

## 7. 자주 나오는 꼬리질문 + 모범답안

:::details Q1. REST와 그냥 HTTP API의 차이는?
HTTP는 전송 프로토콜이고, REST는 그 위에서 "자원 중심 URI + 표준 메서드 + 무상태"라는 **규칙을 지키는 설계 스타일**이다. 동사형 URI(`/getCase`)를 막 쓰면 HTTP는 맞지만 RESTful은 아니다.
:::

:::details Q2. PUT과 PATCH의 차이는?
PUT은 자원 전체를 보낸 값으로 **통째 교체**(멱등), PATCH는 보낸 필드만 **부분 수정**한다. CareerTuner는 지원 건 일부만 바꾸는 경우가 많아 `@PatchMapping("/{id}")`로 부분 수정을 쓴다.
:::

:::details Q3. stateless인데 로그인 상태는 어떻게 유지하나?
서버가 세션을 안 들고 있으므로, 클라이언트가 매 요청에 JWT Access 토큰을 `Authorization` 헤더로 보낸다. 서버는 토큰만 검증해 사용자를 식별한다. 만료되면 프론트 `api()`가 `/auth/refresh`로 새 토큰을 받아 재시도한다. 자세히는 [JWT](/backend/jwt-security) 참고.
:::

:::details Q4. 멱등성(idempotency)이 왜 중요한가?
모바일은 네트워크가 끊겨 같은 요청을 재시도할 수 있다. GET/PUT/DELETE는 멱등이라 N번 보내도 안전하지만, POST(생성)는 멱등이 아니라 두 번 누르면 두 건이 생긴다. 그래서 생성 버튼 중복 클릭 방지 같은 처리가 필요하다.
:::

:::details Q5. 상태 코드와 envelope의 code를 둘 다 쓰는 이유는?
HTTP 상태 코드(200/401/404)는 전송 계층의 결과이고, envelope의 `code`는 도메인 의미(`INSUFFICIENT_CREDIT`, `AI_UNAVAILABLE` 등)를 담는다. 프론트는 `res.ok`와 `env.success`를 함께 보고 [예외](/backend/exception-handling)를 분기한다.
:::

## 8. 직접 말해보기

1. CareerTuner의 "지원 건"을 예로 들어, 목록 조회·생성·부분 수정·삭제를 각각 어떤 HTTP 메서드와 URI로 표현하는지 30초 안에 설명해 보라.
2. "REST가 무상태라서 좋은 점이 뭐죠?"라는 꼬리질문에, 모바일 앱 확장과 서버 수평 확장 두 가지를 엮어 한 문단으로 답해 보라.

## 퀴즈

<QuizBox question="REST API의 핵심 3요소로 가장 알맞은 것은?" :choices="['자원(URI) + 행위(HTTP 메서드) + 무상태', '데이터베이스 + 캐시 + 세션', 'JSON + XML + HTML', '컨트롤러 + 서비스 + 매퍼']" :answer="0" explanation="REST는 자원을 URI로 식별하고, 행위를 HTTP 메서드로 표현하며, 서버가 상태를 기억하지 않는 무상태 스타일이다." />

<QuizBox question="CareerTuner에서 지원 건 1개를 부분 수정할 때 사용하는 HTTP 메서드와 URI 형태는?" :choices="['POST /api/application-cases', 'PATCH /api/application-cases/{id}', 'GET /api/updateCase', 'DELETE /api/application-cases']" :answer="1" explanation="부분 수정은 PATCH, 자원은 id로 식별하므로 PATCH /api/application-cases/{id} 가 맞다. ApplicationCaseController의 update 메서드가 @PatchMapping을 쓴다." />

<QuizBox question="CareerTuner가 모든 REST 응답을 ApiResponse라는 동일한 envelope(success/code/message/data)로 감싸는 이유를 설명하라." explanation="성공과 실패 응답의 형태가 항상 같으면 프론트의 제네릭 api() 함수가 한 곳에서 envelope를 풀어 data만 돌려주고, code로 도메인 에러를 분기하며, 401일 때 토큰 자동 재발급 같은 공통 처리를 일관되게 적용할 수 있다. 즉 클라이언트와 서버 사이의 계약을 단순하고 예측 가능하게 만든다." />
