# HTTP 메서드와 상태코드

> "메서드는 무엇을 할지(동사), 상태코드는 결과가 어땠는지(점수)를 알려줍니다. CareerTuner는 이 둘을 `ApiResponse` 엔벨로프와 `GlobalExceptionHandler`로 일관되게 매핑합니다."

## 1. 한 줄 정의

**HTTP 메서드**는 서버 리소스에 "무엇을 할지"를 나타내는 동사(GET/POST/PUT/PATCH/DELETE)이고, **HTTP 상태코드**는 그 요청의 처리 결과를 3자리 숫자(2xx 성공 / 4xx 클라이언트 잘못 / 5xx 서버 잘못)로 표준화한 응답 신호다.

## 2. 단어 뜻 (약자/어원 풀이)

| 용어 | 풀이 |
| --- | --- |
| HTTP | HyperText Transfer Protocol — 웹에서 클라이언트와 서버가 주고받는 약속(프로토콜) |
| Method | "방법/동사" — 리소스에 가하는 행위 |
| Status Code | "상태 부호" — RFC 9110에 정의된 결과 신호 |
| Idempotent (멱등) | "같은 요청을 N번 보내도 서버 상태 결과가 1번과 같다" |
| Safe (안전) | "서버 상태를 바꾸지 않는다" (읽기 전용) |

:::tip 동사 5개 한 줄 외우기
GET = 읽기, POST = 새로 만들기, PUT = 통째로 교체, PATCH = 일부만 수정, DELETE = 삭제.
:::

## 3. 왜 필요한가 (없으면 무슨 문제가 생기나)

메서드와 상태코드는 **REST의 공용어**다. 없으면 이런 문제가 생긴다.

- **메서드를 안 쓰면**: 모든 요청을 POST `/doEverything`로 보내야 한다. 캐싱·재시도·권한 정책을 URL만 보고 판단할 수 없다.
- **상태코드를 무시하면**: 서버가 항상 `200 OK`를 주고 본문에 "사실은 실패했어요"를 숨긴다. 그러면 브라우저, 로드밸런서, 모니터링, 프런트의 자동 처리(예: 401 → 토큰 리프레시)가 전부 망가진다.
- **멱등성을 모르면**: 네트워크 타임아웃 시 안전하게 재시도할 수 있는 요청(GET/PUT/DELETE)과 그렇지 않은 요청(POST)을 구분하지 못해 중복 결제·중복 생성이 발생한다.

## 4. CareerTuner에서 어디에 썼나 (실제 클래스/파일/테이블)

CareerTuner 백엔드 컨트롤러는 전부 `/api/**` 하위이며 Spring의 메서드별 어노테이션을 그대로 사용한다.

| 메서드 | Spring 어노테이션 | 실제 예시 (영역) |
| --- | --- | --- |
| GET | `@GetMapping` | `AdminGuidelineController` 목록/단건 조회 (어드민) |
| POST | `@PostMapping` | `AutoPrepController#/run`, `IntakeController#/ask` (AI/C·공통) |
| PUT | `@PutMapping` | `AdminGuidelineController` 가이드라인 통째 수정 (어드민) |
| PATCH | `@PatchMapping` | `AdminApplicationCaseController#/{id}/status`, `AdminUserController#/{id}/status` (어드민) |
| DELETE | `@DeleteMapping` | `AdminGuidelineController#/{id}` 삭제 (어드민) |

상태코드 매핑의 진실의 원천은 두 클래스다.

- `common/web/ApiResponse` — 모든 응답을 감싸는 record 엔벨로프. 성공은 `ok()`가 `code="OK"`, 실패는 `error(code, message)`.
- `common/exception/ErrorCode` — 도메인 에러 코드 enum이 각자 `HttpStatus`를 들고 있다. 즉 **애플리케이션 코드 문자열과 HTTP 상태코드가 한 곳에서 1:1로 묶여 있다.**
- `common/exception/GlobalExceptionHandler` (`@RestControllerAdvice`) — 예외를 잡아 `ResponseEntity.status(code.getStatus())` + `ApiResponse.error(code.name(), ...)`로 변환한다.

[C 구현됨] 적합도 분석 흐름(`fitanalysis/ai`)에서 크레딧이 모자라면 `INSUFFICIENT_CREDIT`(→ HTTP 402), AI 호출이 일시 실패하면 `AI_UNAVAILABLE`(→ HTTP 502)로 내려간다.

## 5. 핵심 동작 원리 (표/작은 코드/단계)

### 5-1. 메서드별 안전성·멱등성

| 메서드 | Safe(읽기전용) | Idempotent(멱등) | 의미 |
| --- | --- | --- | --- |
| GET | O | O | 조회. 부작용 없음 |
| POST | X | X | 새 리소스 생성. 두 번 보내면 두 개 생김 |
| PUT | X | O | 전체 교체. 같은 값으로 N번 = 1번과 동일 |
| PATCH | X | △(보통 아님) | 부분 수정. 구현에 따라 다름 |
| DELETE | X | O | 삭제. 두 번째부터는 "이미 없음"이라 결과 동일 |

:::warning PATCH는 자동으로 멱등이 아니다
`{ "score": "+10" }`처럼 상대 증감 PATCH는 보낼 때마다 값이 달라져 멱등이 아니다. CareerTuner의 `@PatchMapping("/{id}/status")`는 상태값을 **절대값으로 덮어쓰기** 때문에 멱등하게 동작한다.
:::

### 5-2. 상태코드 분류

| 범위 | 뜻 | CareerTuner 매핑 예 |
| --- | --- | --- |
| 2xx | 성공 | 200 OK (`ApiResponse.ok()`) |
| 4xx | 클라이언트 잘못 | 400 `INVALID_INPUT`, 401 `UNAUTHORIZED`, 403 `FORBIDDEN`, 404 `NOT_FOUND`, 409 `CONFLICT`, 402 `INSUFFICIENT_CREDIT` |
| 5xx | 서버 잘못 | 500 `INTERNAL_ERROR`, 502 `AI_UNAVAILABLE`·`PAYMENT_CONFIRM_FAILED` |

### 5-3. 코드로 본 매핑 (축약)

```java
// ErrorCode.java — 코드 문자열과 HTTP 상태를 한 곳에 묶는다
public enum ErrorCode {
    NOT_FOUND(HttpStatus.NOT_FOUND, "대상을 찾을 수 없습니다."),
    INSUFFICIENT_CREDIT(HttpStatus.PAYMENT_REQUIRED, "크레딧이 부족합니다."),
    AI_UNAVAILABLE(HttpStatus.BAD_GATEWAY, "AI 초안 생성에 일시적으로 실패했습니다.");
    // ...
}
```

```java
// GlobalExceptionHandler.java — 예외 → 상태코드 + 엔벨로프
@ExceptionHandler(BusinessException.class)
public ResponseEntity<ApiResponse<Void>> handleBusiness(BusinessException ex) {
    ErrorCode code = ex.getErrorCode();
    return ResponseEntity.status(code.getStatus())          // 502 등 HTTP 상태
            .body(ApiResponse.error(code.name(), ex.getMessage())); // "AI_UNAVAILABLE"
}
```

:::details 검증 실패(400)는 어떻게 잡히나
`@Valid` DTO 검증이 깨지면 Spring이 `MethodArgumentNotValidException`을 던지고, `GlobalExceptionHandler`가 이를 받아 `INVALID_INPUT`(400)으로 변환하면서 어떤 필드가 틀렸는지 `필드명: 메시지` 형식으로 채워 넣는다.
:::

### 5-4. 프런트의 상태코드 활용

`frontend/src/app/lib/api.ts`의 제네릭 `api()`는 응답 상태코드를 보고 분기한다. **401**을 받으면 `tryRefresh()`로 `/auth/refresh`를 단일-플라이트 호출해 토큰을 자동 갱신한다 — 상태코드가 표준이라서 가능한 동작이다.

## 6. 면접 답변 3단계

1. **초간단(1문장)**: "메서드는 무엇을 할지(GET 읽기·POST 생성·PUT 교체·PATCH 일부수정·DELETE 삭제)를, 상태코드는 결과가 성공(2xx)인지 클라이언트(4xx)·서버(5xx) 잘못인지를 표준으로 알려줍니다."

2. **기본**: "GET·PUT·DELETE는 멱등이라 네트워크 실패 시 안전하게 재시도할 수 있고, POST는 멱등이 아니라 중복 생성 위험이 있습니다. CareerTuner는 응답을 `ApiResponse` 엔벨로프로 통일하고, `ErrorCode` enum에 코드 문자열과 `HttpStatus`를 함께 정의해 `GlobalExceptionHandler`에서 한 번에 매핑합니다."

3. **꼬리질문 대응**: "예를 들어 적합도 분석에서 크레딧이 부족하면 `INSUFFICIENT_CREDIT`→402, AI 호출 실패는 `AI_UNAVAILABLE`→502로 내려갑니다. 프런트 `api()`는 401을 받으면 토큰 리프레시를 단일-플라이트로 자동 수행합니다. 즉 상태코드를 정직하게 내려주는 것이 프런트 자동화의 전제입니다."

## 7. 자주 나오는 꼬리질문 + 모범답안

:::details Q1. PUT과 PATCH 차이는?
PUT은 리소스를 **통째로 교체**(보낸 값으로 전체 덮어쓰기, 빠진 필드는 비워질 수 있음)하고, PATCH는 **일부 필드만 수정**한다. CareerTuner에서 가이드라인 전체 수정은 `@PutMapping`, 지원 건 상태처럼 한 필드만 바꾸는 건 `@PatchMapping("/{id}/status")`로 구분한다.
:::

:::details Q2. POST와 PUT 중 생성은 어느 쪽?
둘 다 가능하지만 관례가 다르다. 서버가 ID를 정하면 POST `/resources`(멱등 아님), 클라이언트가 ID를 알고 그 위치에 만들/덮어쓸 거면 PUT `/resources/{id}`(멱등). CareerTuner의 생성은 주로 POST를 쓴다(예: `TicketController` 문의 생성).
:::

:::details Q3. 401과 403의 차이는?
401 UNAUTHORIZED는 "**누구인지 모름**(인증 안 됨)" — 로그인/토큰 갱신이 필요. 403 FORBIDDEN은 "**누군지는 알지만 권한 없음**". CareerTuner SecurityConfig는 `/api/admin/**`에 관리자 권한을 요구하므로, 로그인은 됐지만 일반 사용자가 어드민 API를 부르면 403이 맞다.
:::

:::details Q4. 비즈니스 실패에 200을 주고 본문에 success:false면 안 되나?
권장하지 않는다. 모니터링·캐시·재시도·프런트 인터셉터가 HTTP 상태로 판단하기 때문이다. CareerTuner는 `ApiResponse.success` 플래그도 두지만 **HTTP 상태도 반드시 의미 있게 내려서**(`ResponseEntity.status(code.getStatus())`) 둘이 일치하게 한다.
:::

:::details Q5. 멱등성이 실무에서 왜 중요한가?
타임아웃·재시도 안전성 때문이다. 결제·생성처럼 멱등이 아닌 POST는 클라이언트가 같은 요청을 두 번 보내면 중복이 생긴다. 그래서 POST에는 멱등키(Idempotency-Key)를 붙이거나, 가능하면 멱등한 PUT/DELETE 설계로 바꾼다.
:::

## 8. 직접 말해보기

1. CareerTuner에서 "AI 호출이 일시적으로 실패"했을 때 어떤 `ErrorCode`와 HTTP 상태가 내려가고, 프런트는 그걸 어떻게 다뤄야 하는지 30초로 설명해 보라.
2. "왜 PATCH를 멱등하게 설계했나"를 `@PatchMapping("/{id}/status")` 예로 한 문단으로 말해 보라.

## 퀴즈

<QuizBox question="다음 중 안전(safe)하면서 멱등(idempotent)한 메서드는?" :choices="['GET', 'POST', 'PATCH', '없다']" :answer="0" explanation="GET은 서버 상태를 바꾸지 않아 안전하고, 여러 번 호출해도 결과가 같아 멱등이다. POST는 둘 다 아니고, PATCH는 보통 멱등이 아니다." />

<QuizBox question="CareerTuner에서 크레딧이 부족할 때 내려가는 ErrorCode와 HTTP 상태코드 짝으로 옳은 것은?" :choices="['INSUFFICIENT_CREDIT / 402', 'INVALID_INPUT / 400', 'AI_UNAVAILABLE / 502', 'FORBIDDEN / 403']" :answer="0" explanation="ErrorCode enum에서 INSUFFICIENT_CREDIT은 HttpStatus.PAYMENT_REQUIRED(402)에 묶여 있다. AI 일시 실패는 AI_UNAVAILABLE/502다." />

<QuizBox question="401 UNAUTHORIZED와 403 FORBIDDEN의 차이를 CareerTuner 예로 설명하라." explanation="401은 인증 자체가 안 된 상태로, 누구인지 서버가 모른다는 뜻이며 로그인이나 토큰 리프레시가 필요하다. CareerTuner 프런트 api()는 401을 받으면 tryRefresh()로 /auth/refresh를 단일-플라이트 호출해 토큰을 갱신한다. 403은 인증은 됐지만 권한이 없는 상태로, SecurityConfig가 /api/admin/**에 관리자 권한을 요구하므로 일반 사용자가 어드민 API를 호출하면 403이 내려간다." />
