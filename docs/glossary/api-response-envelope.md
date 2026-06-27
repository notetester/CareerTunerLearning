# ApiResponse 엔벨로프 패턴

> 모든 REST 응답을 `success / code / message / data` 4필드로 똑같이 감싸서, 성공이든 실패든 클라이언트가 한 가지 모양으로만 처리하게 만드는 표준 응답 봉투입니다.

## 1. 한 줄 정의

서버가 내려주는 모든 JSON 응답을 동일한 껍데기(envelope)로 감싸 **성공/실패 판별, 에러 코드, 메시지, 실제 데이터**를 일관된 자리에 담는 패턴. CareerTuner에서는 `ApiResponse<T>` record가 이 봉투입니다.

## 2. 단어 뜻 (약자/어원 풀이)

| 용어 | 뜻 |
| --- | --- |
| Envelope | "봉투". 알맹이(data)를 감싸는 겉포장. 우편 봉투에 보내는 사람/받는 사람을 적듯, 응답 메타정보를 겉에 적는다 |
| `ApiResponse<T>` | 제네릭 봉투. `T`는 알맹이 타입(예: `UserDto`, `List<JobPosting>`) |
| `success` | 비즈니스 성공 여부(boolean). HTTP 상태코드와는 별개의 "앱 레벨" 성공 신호 |
| `code` | 기계가 읽는 결과 코드 문자열(성공은 `OK`, 실패는 `NOT_FOUND` 등 `ErrorCode` enum 이름) |
| `message` | 사람이 읽는 설명. 성공 시엔 보통 비움(null) |
| `data` | 알맹이. 성공 시 실제 페이로드, 실패 시 null |

## 3. 왜 필요한가 (없으면 무슨 문제가 생기나)

봉투가 없으면 컨트롤러마다 응답 모양이 제각각이 됩니다.

- 어떤 API는 `{ "user": {...} }`, 어떤 API는 그냥 `{...}`, 에러는 또 다른 모양 → 프론트가 엔드포인트마다 분기 코드를 새로 짜야 함.
- 성공/실패를 HTTP 상태코드에만 의존하면, 200인데 비즈니스적으로 실패한 경우(예: 크레딧 부족)를 표현하기 애매함.
- 에러 메시지가 표준화되지 않아 토스트/로깅/다국어 처리가 흩어짐.

엔벨로프가 있으면 **프론트의 공통 API 레이어 한 곳**에서 "봉투를 까서 `data`만 돌려주고, 실패면 던진다"를 단 한 번 구현하면 끝납니다. CareerTuner의 `app/lib/api.ts`가 정확히 그 역할을 합니다.

:::tip 핵심 통찰
엔벨로프 패턴의 진짜 가치는 "응답을 예쁘게 포장"이 아니라 **클라이언트의 에러 처리 코드를 한 곳으로 모으는 것**입니다.
:::

## 4. CareerTuner에서 어디에 썼나 (실제 클래스/파일/테이블)

전 영역 공통 규약이며, Owner는 공통 영역(`common/`)이라 팀장입니다. 본인 영역 C(적합도·취업경향·대시보드 AI)의 컨트롤러도 전부 이 봉투를 통해 응답합니다.

| 위치 | 역할 | 영역 |
| --- | --- | --- |
| `backend/.../common/web/ApiResponse.java` | 봉투 본체. `record(success, code, message, data)` + `ok()`/`error()` 팩토리 | 공통(구현됨) |
| `common/exception/ErrorCode` (enum) | `code`에 들어가는 표준 코드 집합: `INVALID_INPUT`, `UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND`, `CONFLICT`, `INSUFFICIENT_CREDIT`, `AI_UNAVAILABLE`, `INTERNAL_ERROR` | 공통(구현됨) |
| `GlobalExceptionHandler` (`@RestControllerAdvice`) | `BusinessException`·검증 실패를 잡아 `ApiResponse.error(...)`로 변환 | 공통(구현됨) |
| `frontend/src/app/lib/api.ts` | `ApiEnvelope<T>` 인터페이스로 봉투를 받아 `data`만 반환, 실패면 `ApiError` throw | 공통(구현됨) |
| C 영역 컨트롤러 (적합도·취업경향·대시보드 AI) | `INSUFFICIENT_CREDIT`/`AI_UNAVAILABLE` 같은 코드로 실패를 봉투에 담아 반환 | C(구현됨) |

`@JsonInclude(NON_NULL)` 덕분에 null 필드(성공 시 `message`, 실패 시 `data`)는 JSON에서 아예 빠져 응답이 깔끔해집니다.

## 5. 핵심 동작 원리 (표/작은 코드/단계)

### 백엔드 — 봉투 본체

```java
@JsonInclude(JsonInclude.Include.NON_NULL)
public record ApiResponse<T>(boolean success, String code, String message, T data) {
    public static <T> ApiResponse<T> ok(T data)  { return new ApiResponse<>(true,  "OK", null, data); }
    public static <T> ApiResponse<T> ok()        { return new ApiResponse<>(true,  "OK", null, null); }
    public static <T> ApiResponse<T> error(String code, String message) {
        return new ApiResponse<>(false, code, message, null);
    }
}
```

실제 JSON 모양:

```json
// 성공
{ "success": true,  "code": "OK", "data": { "fitScore": 82 } }
// 실패
{ "success": false, "code": "INSUFFICIENT_CREDIT", "message": "크레딧이 부족합니다." }
```

### 프론트 — 봉투 까기 (핵심 흐름만)

```ts
const env = await res.json() as ApiEnvelope<T> | null;
if (!res.ok || !env || env.success === false) {
  throw new ApiError(env?.message ?? "요청 실패", env?.code ?? "ERROR", res.status);
}
return env.data as T;   // 호출부는 알맹이만 받는다
```

### 한 요청의 생애

| 단계 | 일어나는 일 |
| --- | --- |
| 1 | 컨트롤러가 성공 시 `ApiResponse.ok(dto)` 반환 |
| 2 | 예외 발생 시 `GlobalExceptionHandler`가 `ErrorCode` → `ApiResponse.error(code, msg)`로 변환 |
| 3 | 프론트 `api()`가 fetch 후 봉투 파싱 |
| 4 | `success === false`면 `ApiError(code, status)` throw, 아니면 `data` 반환 |
| 5 | 401이면 `tryRefresh()`로 토큰 갱신 후 1회 재시도(엔벨로프 모양이 같아 재처리 로직 동일) |

## 6. 면접 답변 3단계

- **초간단(1문장):** "모든 API 응답을 `success/code/message/data` 한 가지 모양으로 통일해서, 프론트가 에러 처리를 한 곳에서만 하게 만든 표준 응답 봉투입니다."
- **기본:** "백엔드는 `ApiResponse`라는 Java record로 성공은 `ok()`, 실패는 `error(code, message)` 팩토리로 응답을 감쌉니다. `code`에는 `ErrorCode` enum 이름이 들어가고, 예외는 `GlobalExceptionHandler`가 일괄로 봉투에 담습니다. 프론트의 공통 `api()` 함수가 봉투를 까서 `data`만 돌려주고 실패면 `ApiError`를 던지기 때문에, 각 화면 코드는 정상 데이터만 신경 쓰면 됩니다."
- **꼬리질문 대응:** "HTTP 상태코드와 별개로 `success` 불리언을 둔 이유는 비즈니스 실패(크레딧 부족 등)를 명시적으로 표현하기 위해서고, `code`는 기계가, `message`는 사람이 읽는 용도로 역할을 분리했습니다. `@JsonInclude(NON_NULL)`로 빈 필드는 직렬화에서 제외해 응답을 가볍게 유지합니다."

## 7. 자주 나오는 꼬리질문 + 모범답안

:::details HTTP 상태코드가 있는데 왜 `success` 필드를 또 두나요?
상태코드는 전송 계층 관점(404, 500 등)이고, `success`는 애플리케이션 비즈니스 관점입니다. 예를 들어 요청 자체는 정상 전달됐지만 크레딧이 부족해 처리 못 한 경우를 `success: false` + `code: INSUFFICIENT_CREDIT`로 명확히 표현할 수 있습니다. 실제로 프론트는 `!res.ok || env.success === false` 둘 다를 실패로 보고 동일하게 `ApiError`로 변환합니다.
:::

:::details `code`와 `message`를 왜 나눴나요?
`code`는 기계가 분기·로깅·다국어 매핑에 쓰는 안정적인 식별자(`ErrorCode` enum 이름)이고, `message`는 사람이 읽는 설명입니다. 메시지 문구가 바뀌어도 `code`로 거는 분기는 깨지지 않습니다.
:::

:::details record로 만든 이유는?
응답 봉투는 불변(immutable)이어야 하고 동등성·toString이 자동으로 필요한 전형적인 값 객체라 Java 21 record가 딱 맞습니다. 보일러플레이트 없이 `success()`, `data()` 접근자가 생기고, 생성을 `ok()`/`error()` 정적 팩토리로 강제해 잘못된 조합(예: 성공인데 code가 에러)을 만들기 어렵게 했습니다.
:::

:::details 모든 컨트롤러가 매번 `ok()`로 감싸면 번거롭지 않나요?
성공은 `ApiResponse.ok(dto)` 한 줄이라 부담이 적고, 실패는 컨트롤러가 직접 감싸지 않고 `BusinessException`만 던지면 `GlobalExceptionHandler`가 일괄로 `error(...)`로 변환합니다. 즉 에러 포장 로직이 분산되지 않습니다. (`ResponseBodyAdvice`로 자동 래핑까지 갈 수도 있지만, 명시적 `ok()`가 가독성·예측가능성 면에서 낫다고 봅니다.)
:::

:::details 프론트는 이 봉투를 어떻게 활용하나요?
`app/lib/api.ts`의 제네릭 `api<T>()` 함수 한 곳에서 봉투를 파싱합니다. 성공이면 `env.data`만 반환하므로 호출부는 알맹이 타입 `T`만 다룹니다. 실패면 `code/message/status`를 담은 `ApiError`를 throw해서 화면 단에서 토스트나 분기 처리를 통일할 수 있고, 401일 때는 같은 봉투 규약 덕분에 토큰 리프레시 후 재시도 로직도 한 군데에 모았습니다.
:::

## 8. 직접 말해보기

1. 동료가 "그냥 데이터만 내려주면 되지 왜 굳이 봉투로 감싸냐"고 묻습니다. `success`와 `code`의 존재 이유를 30초 안에 설명해 보세요.
2. CareerTuner에서 적합도 분석 요청이 크레딧 부족으로 실패하는 순간을, 백엔드 `ApiResponse.error` → `GlobalExceptionHandler` → 프론트 `ApiError`까지 한 흐름으로 말해 보세요.

## 퀴즈

<QuizBox question="ApiResponse 봉투의 4개 필드로 올바른 것은?" :choices="['status, body, headers, error', 'success, code, message, data', 'ok, result, payload, trace', 'type, value, reason, meta']" :answer="1" explanation="ApiResponse record는 success(성공여부), code(결과코드), message(설명), data(알맹이) 네 필드로 구성됩니다." />

<QuizBox question="성공 응답에서 보통 null이라 JSON에 빠지는 필드와, 그것을 가능하게 하는 어노테이션은?" :choices="['data 필드 / @JsonIgnore', 'message 필드 / @JsonInclude(NON_NULL)', 'code 필드 / @JsonProperty', 'success 필드 / @JsonInclude(ALWAYS)']" :answer="1" explanation="ok()는 message를 null로 두고, @JsonInclude(NON_NULL) 덕분에 null 필드는 직렬화에서 제외됩니다. 반대로 실패 시엔 data가 빠집니다." />

<QuizBox question="HTTP 상태코드가 200인데도 success를 false로 둘 수 있는 이유를, 크레딧 부족(INSUFFICIENT_CREDIT) 예시를 들어 설명해 보세요." explanation="HTTP 상태코드는 전송 계층(요청이 서버에 잘 도달했는지)을 나타내고, success는 애플리케이션 비즈니스 성공 여부를 나타냅니다. 요청 자체는 정상 전달돼 200이 가능하지만, 크레딧이 부족해 처리하지 못한 경우는 비즈니스적으로 실패이므로 success:false, code:INSUFFICIENT_CREDIT로 표현합니다. 이렇게 두 관점을 분리하면 프론트는 res.ok와 env.success를 모두 검사해 일관된 ApiError로 변환할 수 있습니다." />
