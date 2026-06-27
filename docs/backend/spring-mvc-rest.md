# Spring MVC와 REST 컨트롤러

> Spring MVC는 HTTP 요청을 자바 메서드에 자동으로 연결해 주는 프레임워크고, REST 컨트롤러는 그 결과를 화면(HTML)이 아니라 JSON으로 돌려주는 진입점입니다. CareerTuner는 모든 컨트롤러가 `/api/**` 하위에서 `ApiResponse` 엔벨로프를 반환합니다.

## 1. 한 줄 정의

Spring MVC는 "들어온 HTTP 요청을 적절한 컨트롤러 메서드로 라우팅하고, 메서드 반환값을 HTTP 응답으로 변환"하는 웹 계층 프레임워크다. `@RestController`는 그 메서드의 반환값을 뷰가 아니라 JSON 본문으로 직렬화하라는 표시다.

## 2. 단어 뜻 (약자/어원 풀이)

| 용어 | 풀이 |
| --- | --- |
| MVC | Model-View-Controller. 데이터(Model) / 표현(View) / 흐름 제어(Controller)를 분리하는 패턴 |
| REST | Representational State Transfer. 자원을 URL로 표현하고 HTTP 메서드(GET/POST/PUT/PATCH/DELETE)로 행위를 표현하는 설계 스타일 |
| Controller | 요청을 받아 서비스를 호출하고 응답을 만드는 입구 계층 |
| DispatcherServlet | 모든 요청을 가장 먼저 받아 적절한 컨트롤러로 분배하는 Spring MVC의 "프런트 컨트롤러" |
| HandlerMapping | URL+메서드 조합을 어떤 컨트롤러 메서드가 처리할지 찾아주는 매핑 |
| HttpMessageConverter | 자바 객체 ↔ JSON 변환을 담당(CareerTuner는 Jackson 사용) |

`@RestController`는 `@Controller` + `@ResponseBody`를 합친 합성 애너테이션이다. 즉 "이 클래스의 모든 메서드 반환값은 응답 본문으로 직렬화한다"는 뜻.

## 3. 왜 필요한가 (없으면 무슨 문제가 생기나)

- **라우팅 수작업 제거**: MVC가 없으면 `if (path.equals("/api/...") && method.equals("GET"))` 같은 분기를 서블릿에서 직접 짜야 한다. 애너테이션으로 선언만 하면 프레임워크가 분배한다.
- **변환 자동화**: 요청 JSON을 DTO로, DTO를 응답 JSON으로 바꾸는 일을 `HttpMessageConverter`가 대신한다. 직접 파싱하면 보일러플레이트와 버그가 폭증한다.
- **계층 분리**: 컨트롤러는 "입출력 + 검증"만 맡고 실제 로직은 서비스로 내려간다. 이게 없으면 HTTP 코드와 비즈니스 로직이 한 덩어리가 된다.
- **일관된 응답 계약**: 프런트(`app/lib/api.ts`)는 항상 같은 모양(`success`/`code`/`data`)을 기대한다. 컨트롤러가 제각각이면 프런트 파싱이 깨진다.

## 4. CareerTuner에서 어디에 썼나 (실제 클래스/파일/테이블)

CareerTuner의 모든 REST 진입점이 Spring MVC 컨트롤러다. 영역 C(적합도/경향/대시보드 분석)와 공통 영역에서 실제로 쓰인 예시:

| 클래스 (영역) | 베이스 경로 | 비고 |
| --- | --- | --- |
| `FitAnalysisController` (C) | `/api/fit-analyses` | 적합도 분석 조회/생성/학습과제 갱신, `fit_analysis` 테이블 |
| `AdminAiUsageController` (관리자) | `/api/admin/ai-usage` | AI 사용 로그/요약 조회, `ai_usage_log` 테이블 |
| `DashboardController` (C) | 대시보드 요약 인사이트 진입점 |
| `InterviewController` (D) | 가상 면접 세션/답변 |

공통 규칙(`AGENTS.md`): 모든 컨트롤러는 `@RestController` + `@RequestMapping("/api/**")`, `@RequiredArgsConstructor`로 서비스를 주입받고, 반환 타입은 항상 `ApiResponse<T>`(`common/web/ApiResponse`). 4계층(`controller → service → mapper → domain`)에서 컨트롤러는 가장 바깥 입구다.

:::tip 실제 코드로 본 ApiResponse
```java
@RestController
@RequestMapping("/api/fit-analyses")
@RequiredArgsConstructor
public class FitAnalysisController {

    private final FitAnalysisService fitAnalysisService;

    @GetMapping("/application-cases/{applicationCaseId}")
    public ApiResponse<FitAnalysisDetailResponse> getByApplicationCase(
            @AuthenticationPrincipal AuthUser authUser,
            @PathVariable Long applicationCaseId) {
        return ApiResponse.ok(
            fitAnalysisService.getByApplicationCase(authUser.id(), applicationCaseId));
    }
}
```
`ApiResponse`는 `record(success, code, message, data)`이고 `ok()`/`error()` 정적 팩터리로 만든다. `@JsonInclude(NON_NULL)`이라 `message`가 null이면 성공 응답에서 빠진다.
:::

## 5. 핵심 동작 원리 (요청 한 번의 여정)

```text
HTTP 요청
  → DispatcherServlet (모든 요청의 단일 입구)
  → HandlerMapping (URL+메서드 → 어느 컨트롤러 메서드?)
  → JwtAuthenticationFilter는 이미 SecurityContext에 AuthUser를 채워둠
  → 인자 바인딩 (@PathVariable / @RequestParam / @RequestBody / @AuthenticationPrincipal)
  → @Valid 검증 (실패 시 GlobalExceptionHandler로)
  → 컨트롤러 메서드 실행 → service 호출
  → 반환된 ApiResponse<T>를 Jackson이 JSON으로 직렬화
  → HTTP 응답
```

### 매핑 애너테이션

| 애너테이션 | 역할 |
| --- | --- |
| `@RequestMapping("/api/...")` | 클래스/메서드의 공통 베이스 경로 |
| `@GetMapping` / `@PostMapping` / `@PatchMapping` | HTTP 메서드별 단축. `@RequestMapping(method=...)`의 축약형 |

### 인자 바인딩 애너테이션 (가장 자주 묻는 부분)

| 애너테이션 | 어디서 값을 꺼내나 | CareerTuner 실제 예 |
| --- | --- | --- |
| `@PathVariable` | URL 경로 변수 | `/application-cases/{applicationCaseId}` → `Long applicationCaseId` |
| `@RequestParam` | 쿼리스트링(`?key=val`) | `AdminAiUsageController`의 `featureType`, `limit`, `offset` 등 |
| `@RequestBody` | 요청 본문(JSON) → DTO | `UpdateLearningTaskRequest request` |
| `@AuthenticationPrincipal` | SecurityContext의 인증 주체 | `AuthUser authUser` (JWT에서 복원된 record) |

:::tip @RequestParam 옵션 세 가지
`AdminAiUsageController`가 한 화면에 다 보여준다.
- `@RequestParam(required = false) String featureType` — 없어도 됨(필터)
- `@RequestParam(defaultValue = "50") int limit` — 없으면 50
- `@RequestParam(required = false) @DateTimeFormat(iso = ISO.DATE) LocalDate createdFrom` — `2026-06-27` 문자열을 `LocalDate`로 자동 변환
:::

```java
// PATCH /api/fit-analyses/{fitAnalysisId}/learning-tasks/{taskId}
// 경로 변수 2개 + 본문 DTO 1개 + 인증 주체를 한 번에 바인딩
@PatchMapping("/{fitAnalysisId}/learning-tasks/{taskId}")
public ApiResponse<FitAnalysisLearningTaskResponse> updateLearningTask(
        @AuthenticationPrincipal AuthUser authUser,
        @PathVariable Long fitAnalysisId,
        @PathVariable Long taskId,
        @RequestBody UpdateLearningTaskRequest request) {
    return ApiResponse.ok(fitAnalysisService.updateLearningTask(
            authUser.id(), fitAnalysisId, taskId, request.completed()));
}
```

:::warning @PathVariable vs @RequestParam 헷갈리지 말 것
- `/users/{id}` 의 `id` → 경로의 일부(자원 식별) → `@PathVariable`
- `/users?role=ADMIN` 의 `role` → 필터/검색 조건 → `@RequestParam`
"자원을 특정하면 path, 자원을 거르면 param"으로 외우면 된다.
:::

## 6. 면접 답변 3단계

- **초간단(1문장)**: "Spring MVC는 HTTP 요청을 컨트롤러 메서드로 라우팅하고 반환값을 JSON으로 바꿔 주는 웹 계층이고, 저희는 모든 진입점을 `@RestController` + `/api/**`로 두고 `ApiResponse` 엔벨로프로 응답을 통일했습니다."
- **기본**: "요청은 DispatcherServlet이 받아 HandlerMapping으로 컨트롤러를 찾고, `@PathVariable`/`@RequestParam`/`@RequestBody`로 인자를 바인딩합니다. 인증 주체는 JWT 필터가 채워둔 `AuthUser`를 `@AuthenticationPrincipal`로 주입받습니다. 반환한 `ApiResponse<T>`는 Jackson이 직렬화하고요. 예를 들어 적합도 분석 컨트롤러는 `@PatchMapping`에서 경로 변수 2개와 본문 DTO를 함께 받습니다."
- **꼬리질문 대응**: "검증은 DTO에 Jakarta Validation을 걸고 `@Valid`로 트리거하며, 실패나 비즈니스 예외는 `GlobalExceptionHandler`(`@RestControllerAdvice`)가 잡아 `ErrorCode` 기반의 동일한 `ApiResponse` 실패 형태로 변환합니다. 그래서 프런트는 성공/실패를 한 가지 계약으로 처리할 수 있습니다."

## 7. 자주 나오는 꼬리질문 + 모범답안

:::details @Controller와 @RestController 차이는?
`@Controller`는 반환값을 뷰 이름으로 해석해 템플릿을 렌더링하려 한다. `@RestController` = `@Controller` + `@ResponseBody`라서 반환 객체를 그대로 본문(JSON)으로 직렬화한다. CareerTuner는 SPA(React)에 JSON만 내려주므로 전부 `@RestController`다.
:::

:::details @PathVariable과 @RequestParam은 언제 무엇을?
경로에 박혀 자원을 식별하면 `@PathVariable`(`/fit-analyses/{id}`), 쿼리스트링으로 필터/페이지네이션이면 `@RequestParam`(`?limit=50&offset=0`). REST 관점에서 "자원 식별 = path, 자원 조회 조건 = param"이 원칙이다.
:::

:::details @RequestBody는 어떻게 JSON을 객체로 만드나?
`HttpMessageConverter`(Jackson)가 요청 Content-Type이 `application/json`일 때 본문을 읽어 대상 DTO로 역직렬화한다. 그래서 본문 받는 메서드는 보통 POST/PUT/PATCH다. GET은 본문 대신 `@RequestParam`/`@PathVariable`을 쓴다.
:::

:::details 응답을 왜 ApiResponse로 감싸나? 그냥 DTO 반환하면 안 되나?
가능하지만 그러면 성공/실패 모양이 달라진다. CareerTuner는 항상 `success`/`code`/`message`/`data`로 감싸서, 프런트(`app/lib/api.ts`)가 단일 파싱 로직으로 성공/에러를 처리하고 401이면 자동 토큰 리프레시까지 돌릴 수 있게 했다. 일관된 계약이 핵심이다.
:::

:::details @AuthenticationPrincipal로 받는 값은 어디서 오나?
컨트롤러가 직접 토큰을 파싱하지 않는다. `JwtAuthenticationFilter`가 `Authorization: Bearer ...`를 파싱해 `AuthUser`(record: id/email/role)를 SecurityContext에 넣어두고, `@AuthenticationPrincipal AuthUser authUser`가 그걸 꺼내 주입한다. 덕분에 컨트롤러는 인증 로직과 분리되고 `authUser.id()`만 쓰면 된다.
:::

## 8. 직접 말해보기 (말하기 훈련용)

1. "URL `PATCH /api/fit-analyses/12/learning-tasks/3`에 `{ completed: true }` 본문이 왔을 때, Spring MVC가 어떤 애너테이션으로 12, 3, 그리고 본문을 각각 어떻게 받는지 메서드 시그니처를 말로 설명해 보세요."
2. "CareerTuner에서 컨트롤러가 `ApiResponse`로 응답을 통일하면 프런트엔드에 어떤 이점이 생기는지, 그리고 에러 응답은 누가 만드는지 한 호흡으로 설명해 보세요."

## 퀴즈

<QuizBox question="@RestController가 @Controller와 다른 핵심 차이는?" :choices="['JSON 직렬화 없이 뷰 이름을 렌더링한다','@ResponseBody가 포함되어 반환값을 응답 본문(JSON)으로 직렬화한다','DB 트랜잭션을 자동으로 시작한다','URL 라우팅을 비활성화한다']" :answer="1" explanation="@RestController는 @Controller + @ResponseBody의 합성 애너테이션이라, 메서드 반환값을 뷰가 아니라 응답 본문(JSON)으로 직렬화한다. CareerTuner는 SPA에 JSON만 내려주므로 모든 컨트롤러가 @RestController다." />

<QuizBox question="경로가 /api/fit-analyses/application-cases/{applicationCaseId} 일 때 applicationCaseId 값을 받는 올바른 애너테이션은?" :choices="['@RequestBody','@RequestParam','@PathVariable','@AuthenticationPrincipal']" :answer="2" explanation="중괄호로 경로에 박힌 자원 식별자는 @PathVariable로 받는다. 쿼리스트링(?key=val)이면 @RequestParam, JSON 본문이면 @RequestBody다." />

<QuizBox question="CareerTuner 컨트롤러에서 @AuthenticationPrincipal AuthUser authUser로 주입받는 값은 어디서 채워지며, 컨트롤러는 토큰을 직접 파싱하는가? 한 문단으로 설명하라." explanation="컨트롤러는 토큰을 직접 파싱하지 않는다. JwtAuthenticationFilter가 Authorization Bearer 헤더를 파싱해 AuthUser(record: id/email/role)를 SecurityContext에 저장해 둔다. @AuthenticationPrincipal은 그 인증 주체를 메서드 인자로 꺼내 주입할 뿐이다. 덕분에 인증 로직과 비즈니스 로직이 분리되고, 컨트롤러는 authUser.id()처럼 식별 정보만 꺼내 서비스에 넘긴다." />
