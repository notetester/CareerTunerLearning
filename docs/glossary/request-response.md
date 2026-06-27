# Request / Response

> "HTTP 통신은 요청(메서드·URL·헤더·바디)을 보내고 응답(상태코드·헤더·바디)을 받는 한 쌍입니다. CareerTuner는 인증을 `Authorization: Bearer` 헤더로 싣고, 응답 바디는 항상 `ApiResponse` 엔벨로프로 감싸 `success`/`code`/`message`/`data` 형태로 통일했습니다."

## 1. 한 줄 정의

클라이언트가 서버에 보내는 데이터 묶음이 **요청(Request)**, 서버가 돌려주는 데이터 묶음이 **응답(Response)**이며, HTTP에서는 둘 다 "시작줄 + 헤더 + 바디"라는 같은 골격을 가진다.

## 2. 단어 뜻 (구성요소 풀이)

| 용어 | 풀이 |
| --- | --- |
| Request | 요청. "이걸 해줘"라는 클라이언트의 한 번의 호출 |
| Response | 응답. 그 호출에 대한 서버의 한 번의 답 |
| Method | 요청의 동사. `GET`(조회) / `POST`(생성) / `PATCH`(부분수정) / `PUT`(교체) / `DELETE`(삭제) |
| Header | 본문이 아닌 부가정보(메타데이터). 인증·콘텐츠 타입 등 key-value |
| Body | 실제로 주고받는 데이터 본문. 보통 JSON |
| Query string | URL 뒤 `?key=value` 형태의 필터·옵션 |
| Path variable | URL 경로 안에 박힌 식별자. 예) `/fit-analyses/{id}` |
| Status code | 응답 시작줄의 3자리 숫자. 결과의 종류를 표준화 |

:::tip 메서드는 "동사", 경로는 "명사"
`POST /api/fit-analyses/application-cases/42` = "42번 지원 건에 대해 적합도 분석을 생성(POST)하라". REST는 이렇게 동사(메서드)와 명사(리소스 경로)를 분리한다.
:::

## 3. 왜 필요한가 (없으면 무슨 문제가 생기나)

- **구조가 없으면 파싱이 지옥이 된다.** 헤더/바디 구분이 없으면 인증정보와 실제 데이터가 뒤섞인다. HTTP는 이 경계를 표준으로 못 박아 둔다.
- **상태코드가 없으면 성공·실패를 본문 내용으로 추측해야 한다.** `200`인지 `404`인지 `401`인지로 프런트가 분기할 수 있어야 자동 리프레시·에러 토스트 같은 로직이 성립한다.
- **응답 모양이 들쭉날쭉하면 클라이언트 코드가 엔드포인트마다 다른 파싱을 해야 한다.** CareerTuner가 응답을 `ApiResponse` 하나로 통일한 이유 — 프런트의 `api()` 함수 한 곳에서 모든 응답을 똑같이 풀 수 있다.

## 4. CareerTuner에서 어디에 썼나 (실제 클래스/파일/테이블)

| 위치 | 영역 | 역할 |
| --- | --- | --- |
| `common/web/ApiResponse.java` | 공통(팀장) | 모든 응답을 감싸는 표준 엔벨로프 `record(success, code, message, data)` |
| `common/exception/ErrorCode.java` | 공통 | 실패 응답의 `code` 값 enum (`NOT_FOUND`, `UNAUTHORIZED`, `INSUFFICIENT_CREDIT` 등) |
| `common/security/JwtAuthenticationFilter.java` | 공통 | 요청의 `Authorization: Bearer ...` 헤더를 파싱해 인증 주입 |
| `fitanalysis/controller/FitAnalysisController.java` | **C(본인)** | `@RestController` 가 요청을 받아 `ApiResponse.ok(...)` 로 응답 |
| `frontend/src/app/lib/api.ts` | 프런트 | 요청 헤더 빌드 + 응답 엔벨로프 해석을 한 곳에 모은 제네릭 `api()` |
| `frontend/src/app/lib/tokenStore.ts` | 프런트 | `Authorization` 헤더에 실을 access 토큰 보관소 |

본인 영역 C의 적합도 분석 컨트롤러가 실제로 어떻게 생겼는지(축약):

```java
@RestController
@RequestMapping("/api/fit-analyses")            // 공통 경로(명사)
@RequiredArgsConstructor
public class FitAnalysisController {

    private final FitAnalysisService fitAnalysisService;

    // POST + Path variable + 인증 주체 → ApiResponse 로 감싼 응답
    @PostMapping("/application-cases/{applicationCaseId}")
    public ApiResponse<FitAnalysisDetailResponse> generate(
            @AuthenticationPrincipal AuthUser authUser,   // Bearer 토큰에서 풀린 사용자
            @PathVariable Long applicationCaseId) {        // 경로 변수
        return ApiResponse.ok(
            fitAnalysisService.generate(authUser.id(), applicationCaseId));
    }
}
```

여기서 `@AuthenticationPrincipal AuthUser` 는 컨트롤러가 직접 토큰을 까는 게 아니라, 앞단의 `JwtAuthenticationFilter` 가 이미 `Authorization` 헤더를 검증해 넣어둔 결과를 받는 것이다.

## 5. 핵심 동작 원리 (요청·응답의 한 살이)

**(1) 프런트가 요청을 만든다** — `api.ts` 가 헤더를 조립한다.

```ts
function buildHeaders(options, withAuth) {
  const headers = new Headers(options.headers ?? {});
  // JSON 바디면 Content-Type 자동 부여(FormData면 브라우저가 알아서)
  if (body && !isFormData && !headers.has("Content-Type"))
    headers.set("Content-Type", "application/json");
  // 인증 필요 호출이면 access 토큰을 Bearer 로 싣는다
  if (withAuth) {
    const token = getAccessToken();
    if (token) headers.set("Authorization", `Bearer ${token}`);
  }
  return headers;
}
```

**(2) 백엔드가 요청을 받는다** — 필터 → 컨트롤러 순서.

```text
요청  →  JwtAuthenticationFilter ("Authorization: Bearer ..." 파싱)
      →  컨트롤러 (@PathVariable / @RequestBody / @AuthenticationPrincipal 로 분해)
      →  서비스 → 매퍼
```

**(3) 백엔드가 응답을 만든다** — 항상 같은 엔벨로프.

```json
// 성공
{ "success": true,  "code": "OK",        "data": { "score": 78 } }
// 실패
{ "success": false, "code": "NOT_FOUND", "message": "지원 건을 찾을 수 없습니다." }
```

`ApiResponse` 는 `@JsonInclude(NON_NULL)` 이라 성공일 때 `message`, 실패일 때 `data` 처럼 null 필드는 JSON에서 빠진다.

**(4) 프런트가 응답을 해석한다** — `api()` 가 엔벨로프를 풀고 `data` 만 반환, 실패면 `ApiError` 를 던진다. 특히 `401`이면 한 번 자동으로 refresh 후 재시도한다.

```ts
let res = await fetch(`${BASE}${path}`, { ...options, headers: buildHeaders(options, withAuth) });
if (res.status === 401 && withAuth && getRefreshToken()) {
  if (await tryRefresh()) {                       // refresh 단일 프라미스로 공유
    res = await fetch(`${BASE}${path}`, { ...options, headers: buildHeaders(options, true) });
  }
}
const env = await res.json();
if (!res.ok || !env || env.success === false)
  throw new ApiError(env?.message ?? "요청 실패", env?.code ?? "ERROR", res.status);
return env.data;                                   // 호출부는 data 만 받는다
```

자주 쓰는 상태코드:

| 코드 | 의미 | CareerTuner에서 |
| --- | --- | --- |
| 200 | OK | 정상 조회/수정 |
| 400 | Bad Request | `@Valid` 검증 실패 → `INVALID_INPUT` |
| 401 | Unauthorized | 토큰 없음/만료 → 프런트가 자동 refresh 시도 |
| 403 | Forbidden | 권한 부족(`/api/admin/**` 등) → `FORBIDDEN` |
| 404 | Not Found | 리소스 없음 → `NOT_FOUND` |
| 409 | Conflict | 중복 등 → `CONFLICT` |

:::warning HTTP 상태코드와 엔벨로프 `code`는 다른 층이다
HTTP `status`는 전송 계층의 표준 신호, 엔벨로프의 `code`(`OK`/`NOT_FOUND`/`INSUFFICIENT_CREDIT`)는 애플리케이션 도메인 신호다. 둘 다 본다 — 프런트는 `res.ok`(전송)와 `env.success`(도메인)를 함께 검사한다.
:::

## 6. 면접 답변 3단계

- **초간단(1문장):** "요청은 메서드·URL·헤더·바디로 서버에 보내는 호출, 응답은 상태코드·헤더·바디로 받는 답입니다."
- **기본:** "인증은 `Authorization: Bearer` 헤더에 access 토큰을 실어 보냅니다. 백엔드는 응답을 항상 `ApiResponse` 엔벨로프(`success`/`code`/`message`/`data`)로 통일해서, 프런트의 `api()` 함수 한 곳에서 모든 응답을 똑같이 파싱하고 `data`만 꺼내 씁니다."
- **꼬리질문 대응:** "401이 오면 프런트 `api.ts`가 단일 프라미스로 한 번만 refresh를 시도하고 성공 시 같은 요청을 재시도합니다. 헤더의 `Content-Type`은 JSON일 때만 자동으로 붙이고 FormData면 브라우저에 맡깁니다. 토큰 검증 자체는 컨트롤러가 아니라 앞단 `JwtAuthenticationFilter`가 끝내 두고, 컨트롤러는 `@AuthenticationPrincipal`로 결과만 받습니다."

## 7. 자주 나오는 꼬리질문 + 모범답안

:::details Q. 헤더와 바디는 어떻게 구분하나요?
HTTP 메시지는 시작줄 → 헤더들 → 빈 줄 한 개 → 바디 순서다. 그 빈 줄(`\r\n\r\n`)이 헤더와 바디의 경계다. 헤더는 메타데이터(인증, 콘텐츠 타입, 길이 등), 바디는 실제 데이터(JSON)다.
:::

:::details Q. 인증 정보를 왜 바디가 아니라 헤더에 넣나요?
인증은 "무엇을 하느냐"와 무관한 부가정보라 헤더(`Authorization`)가 의미상 맞고, `GET`처럼 바디가 없는 요청에도 실을 수 있어야 하기 때문이다. 또 미들웨어/필터가 바디를 파싱하기 전에 헤더만 보고 인증을 끝낼 수 있다 — CareerTuner의 `JwtAuthenticationFilter`가 그렇게 한다.
:::

:::details Q. 왜 응답을 ApiResponse로 감싸나요? 그냥 data만 주면 안 되나요?
성공·실패 응답의 모양을 통일하기 위해서다. 엔벨로프가 없으면 성공은 객체, 실패는 에러 문자열처럼 모양이 달라져 클라이언트가 엔드포인트마다 다르게 파싱해야 한다. `success`/`code`로 일관되게 분기하면 프런트의 `api()` 한 곳에서 모든 응답을 처리하고 `code`로 에러 종류까지 구분할 수 있다.
:::

:::details Q. Path variable과 Query string은 언제 무엇을 쓰나요?
리소스를 "특정"하는 식별자는 경로(`/fit-analyses/application-cases/{id}`)에, 같은 리소스 컬렉션을 "거르거나 정렬"하는 옵션은 쿼리(`?sort=latest&page=2`)에 둔다. 경로는 그 자원이 무엇인지, 쿼리는 그 자원을 어떻게 볼지를 나타낸다고 설명하면 된다.
:::

:::details Q. 401과 403의 차이는?
401(Unauthorized)은 "네가 누구인지 모르겠다" — 인증 실패(토큰 없음·만료). 403(Forbidden)은 "누구인지는 알지만 권한이 없다" — 인가 실패. CareerTuner에서 401은 프런트가 자동 refresh를 시도하는 신호이고, 403은 `/api/admin/**`처럼 권한 부족일 때 나온다.
:::

## 8. 직접 말해보기

1. "CareerTuner에서 적합도 분석을 생성하는 요청 한 건이 프런트의 fetch부터 백엔드 응답이 다시 화면에 닿기까지, 메서드·헤더·상태코드·엔벨로프를 모두 언급하며 끝까지 말해보세요."
2. "401 응답이 왔을 때 우리 프런트 `api.ts`가 정확히 무슨 일을 하는지, 왜 단일 프라미스로 묶었는지 30초 안에 설명해보세요."

## 퀴즈

<QuizBox question="CareerTuner 백엔드가 모든 REST 응답을 감싸는 표준 엔벨로프 record의 필드 구성으로 옳은 것은?" :choices="['status, body, headers, error', 'success, code, message, data', 'ok, result, reason, payload', 'type, value, error, meta']" :answer="1" explanation="ApiResponse.java 는 record(boolean success, String code, String message, T data) 이며 ok()/error() 정적 메서드를 제공한다." />

<QuizBox question="프런트 api.ts 에서 HTTP 401 응답을 받았을 때 일어나는 동작으로 가장 정확한 것은?" :choices="['즉시 로그인 페이지로 이동시킨다', 'refresh 토큰으로 단일 프라미스 refresh 를 시도하고 성공하면 같은 요청을 재시도한다', '바디의 success 값만 보고 무시한다', '3번까지 같은 요청을 그대로 재전송한다']" :answer="1" explanation="api() 는 401 이고 refresh 토큰이 있으면 tryRefresh()(refreshPromise 단일 공유)로 한 번만 갱신을 시도하고, 성공 시 새 Authorization 헤더로 동일 요청을 다시 보낸다." />

<QuizBox question="요청에서 'Authorization: Bearer ...' 헤더로 인증 정보를 바디가 아닌 헤더에 싣는 이유를 한 문단으로 설명하세요." explanation="인증은 요청이 무엇을 하는지와 무관한 부가정보(메타데이터)라 헤더가 의미상 적절하고, 바디가 없는 GET 요청에도 실을 수 있어야 하기 때문이다. 또 헤더는 바디 파싱 이전에 읽을 수 있어, CareerTuner의 JwtAuthenticationFilter처럼 미들웨어/필터 단계에서 토큰을 먼저 검증해 SecurityContext에 인증을 채우고 컨트롤러는 @AuthenticationPrincipal로 결과만 받는 구조가 가능해진다." />
