# 백엔드 개요

> CareerTuner 백엔드는 Spring Boot 4 + Java 21 + MyBatis + MySQL 8 로 만든 REST API 서버다. 모든 응답을 `ApiResponse` 한 형태로 통일하고, `controller -> service -> mapper -> domain` 4계층으로 책임을 나눈 것이 핵심 철학이다.

이 페이지는 백엔드 영역의 **인덱스**다. 개별 기술의 상세는 각 페이지로 흩어져 있고, 여기서는 "전체 그림"과 "어떤 순서로 공부할지"를 잡는다.

## 백엔드 영역 소개

CareerTuner는 채용공고에 맞춰 스펙과 면접 답변을 조정하는 AI 취업 전략 플랫폼이다. 핵심 단위는 공고가 아니라 **지원 건(Application Case)**. 백엔드는 이 지원 건을 중심으로 사용자 인증, 공고/기업 분석, 적합도 분석, 가상 면접, 크레딧/결제 등 모든 도메인을 REST API로 제공한다.

| 항목 | 내용 |
| --- | --- |
| 프레임워크 | Spring Boot 4.0.6 |
| 언어 | Java 21 |
| 영속성 | MyBatis (JPA 금지) + MySQL 8 |
| 포트 | `:8080` (프런트 Vite 프록시가 `/api` 를 여기로 전달) |
| 빌드 | Gradle (`./gradlew bootRun`, `bootJar`) |
| 보안 | Spring Security + JWT (jjwt 0.12.6) |
| 문서화 | springdoc OpenAPI (`/swagger-ui.html`) |

도메인 패키지는 `com.careertuner` 아래에 기능별로 나뉜다: `auth`, `applicationcase`, `jobposting`, `jobanalysis`, `companyanalysis`, `fitanalysis`, `analysis`, `dashboard`, `interview`, `credit`, `payment`, `notification`, 그리고 횡단 공통 코드가 모이는 `common`.

:::tip 영역 표시
백엔드 도메인은 6영역(A~F)이 나눠 소유한다 — 예: A `auth`/`profile`, B `jobposting`/`jobanalysis`, C `fitanalysis`/`analysis`/`dashboard`, D `interview`, E `correction`/`payment`, F `community`/`support`. `common`·보안·라우팅 같은 공통 영역은 팀 공통 규약이다. 영역별 상세는 [영역별 심화](/areas/) 참고.
:::

## 두 가지 핵심 철학

### 1. 응답은 항상 `ApiResponse` 엔벨로프

성공이든 실패든 모든 REST 응답이 같은 봉투(envelope)에 담긴다. 프런트는 `success` 하나만 보면 분기할 수 있다.

```java
// common/web/ApiResponse — record + 정적 팩토리 (축약)
@JsonInclude(JsonInclude.Include.NON_NULL)
public record ApiResponse<T>(boolean success, String code, String message, T data) {
    public static <T> ApiResponse<T> ok(T data)    { return new ApiResponse<>(true,  "OK", null, data); }
    public static <T> ApiResponse<T> error(String code, String message) {
        return new ApiResponse<>(false, code, message, null);
    }
}
```

- 성공: `{ "success": true, "code": "OK", "data": { ... } }`
- 실패: `{ "success": false, "code": "NOT_FOUND", "message": "..." }`
- `@JsonInclude(NON_NULL)` 로 `null` 필드는 JSON에서 빠진다(성공 응답엔 `message`가, 실패 응답엔 `data`가 안 나간다).
- 프런트 `app/lib/api.ts` 가 이 봉투를 풀어서 `data` 만 화면에 돌려준다. 자세히는 [API 응답 엔벨로프](/glossary/api-response-envelope).

### 2. 4계층 + 표준 예외 처리

```text
Controller   @RestController, /api/** 라우팅, 요청/응답(DTO) 담당
   ↓
Service      @Service @RequiredArgsConstructor, 비즈니스 로직·트랜잭션
   ↓
Mapper       @Mapper 인터페이스 + resources/mapper/**/*.xml (SQL)
   ↓
Domain       DB 테이블에 대응하는 도메인 객체
```

예외는 도메인 코드에서 `BusinessException(ErrorCode)` 로 던지면, `GlobalExceptionHandler`(`@RestControllerAdvice`)가 잡아서 전부 `ApiResponse.error(...)` 로 변환한다. 컨트롤러마다 try-catch를 반복할 필요가 없다.

| ErrorCode | HTTP 상태 | 의미 |
| --- | --- | --- |
| `INVALID_INPUT` | 400 | 잘못된 요청 / 검증 실패 |
| `UNAUTHORIZED` | 401 | 인증 필요 |
| `FORBIDDEN` | 403 | 권한 없음 |
| `NOT_FOUND` | 404 | 대상 없음 |
| `CONFLICT` | 409 | 중복/충돌 |
| `INSUFFICIENT_CREDIT` | 402 | 크레딧 부족 |
| `AI_UNAVAILABLE` | 502 | AI 호출 일시 실패 |
| `INTERNAL_ERROR` | 500 | 예기치 못한 서버 오류 |

:::tip
`GlobalExceptionHandler`는 `MethodArgumentNotValidException`(Jakarta Validation 실패)도 잡아서 어떤 필드가 왜 틀렸는지(`필드명: 메시지`)까지 만들어 준다. 즉 **검증 실패 응답도 같은 엔벨로프**로 나간다. 자세히는 [예외 처리](/backend/exception-handling).
:::

## 왜 이 구조가 중요한가

설계 결정마다 "없었으면 터졌을 문제"가 짝지어 있다. 면접에서는 이 짝을 말로 풀 수 있어야 "써봤다"가 아니라 "이유를 안다"로 들린다.

| 만약 없다면 | 생기는 문제 |
| --- | --- |
| `ApiResponse` 통일이 없으면 | 엔드포인트마다 응답 모양이 제각각 → 프런트가 분기를 매번 새로 짬 |
| 전역 예외 처리가 없으면 | 컨트롤러마다 try-catch 중복, 에러 포맷 불일치, 스택트레이스 노출 위험 |
| 4계층 분리가 없으면 | 컨트롤러에 SQL과 비즈니스 로직이 뒤섞여 테스트·재사용 불가 |
| MyBatis 매퍼 분리가 없으면 | SQL이 자바 문자열로 흩어져 관리 불가 |

한 줄 요약을 물으면 → **"Spring Boot REST 서버인데, 응답을 `ApiResponse` 하나로 통일하고 예외를 전역 핸들러로 모아 일관성을 강제한 4계층 구조"** 라고 답하면 된다.

## 권장 학습 순서

아래 순서는 "골격 → 데이터 → 요청 안전장치 → 인증/보안 → 부가 기능 → 운영 편의"로 흐른다. **위에서부터 읽으면 다음 주제가 앞 주제를 전제로 쌓인다.**

### 1단계 — 기초 골격 (무엇으로 만드나)

1. [Spring Boot](/backend/spring-boot) — 자동 설정, 내장 톰캣, 시작점
2. [Spring MVC / REST](/backend/spring-mvc-rest) — `@RestController`, `@RequestMapping`, `ApiResponse` 엔벨로프

### 2단계 — 데이터 계층 (어디에 저장하나)

3. [MyBatis](/backend/mybatis) — `@Mapper` + XML, `map-underscore-to-camel-case`
4. [MySQL 스키마](/backend/mysql-schema) — 주요 테이블(`application_case`, `fit_analysis`, `users` 등)

### 3단계 — 요청 안전장치 (잘못된 입력을 어떻게 막나)

5. [Validation 검증](/backend/validation) — `@Valid`, `@NotBlank`, `@Size`
6. [예외 처리](/backend/exception-handling) — `BusinessException` + `ErrorCode` + `GlobalExceptionHandler`

### 4단계 — 인증/보안 (누구인지 어떻게 아나)

7. [JWT 보안](/backend/jwt-security) — Access/Refresh, `JwtTokenProvider`, `JwtAuthenticationFilter`
8. [OAuth2 소셜로그인](/backend/oauth2) — Kakao/Naver/Google, state 토큰 CSRF
9. [BCrypt 비밀번호](/backend/bcrypt-password) — `PasswordEncoder`, 해시·솔트

### 5단계 — 부가 기능 (바깥 세계와 어떻게 주고받나)

10. [파일/텍스트 추출](/backend/file-text-extraction) — PDFBox/Jsoup, SSRF 방지, Vision OCR 폴백
11. [메일 발송](/backend/mail) — Spring Mail, dev 모드 링크 로그
12. [푸시 알림](/backend/push-notification) — Web Push(VAPID) + FCM + 로깅 폴백

### 6단계 — 운영 편의 (어떻게 굴러가게 하나)

13. [Swagger / OpenAPI](/backend/openapi-swagger) — `/swagger-ui.html`
14. [설정 관리](/backend/configuration-properties) — `CareerTunerProperties`, `ENV:기본값` 패턴
15. [로깅](/backend/logging) — Lombok `@Slf4j`

:::details 왜 하필 이 순서인가?
Spring Boot·MVC는 나머지 전부가 올라타는 토대라 맨 앞이다. 골격이 있어야 그 위에 데이터(MyBatis/스키마)를 얹고, 데이터가 오가야 검증·예외 같은 안전장치가 의미 있다. 인증/보안은 "요청이 도는 길"이 정해진 뒤 그 길에 문지기를 세우는 일이라 그다음, 메일·푸시·파일 같은 부가 기능은 핵심 흐름에 가지를 치는 것이라 더 뒤, Swagger·설정·로깅은 완성된 서버를 운영하기 좋게 다듬는 마지막 층이다.
:::

용어가 막히면 [DTO](/glossary/dto), [REST API](/glossary/rest-api), [계층형 아키텍처](/glossary/layered-architecture), [ORM과 MyBatis](/glossary/orm-and-mybatis) 같은 [용어집](/glossary/) 페이지를 곁들여 본다.

## 핵심 동작 한눈에 (요청 한 번의 여정)

```text
[1] 클라이언트가 /api/fit-analysis 호출 (Bearer 토큰 포함)
[2] JwtAuthenticationFilter 가 토큰 파싱 → SecurityContext 에 인증 주입
[3] @RestController 진입, @Valid 로 DTO 검증 (실패 시 GlobalExceptionHandler)
[4] @Service 비즈니스 로직 → @Mapper 로 MySQL 조회/저장
[5] 결과를 ApiResponse.ok(data) 로 감싸 반환
[6] 도중 오류 시 BusinessException → GlobalExceptionHandler → ApiResponse.error
```

이 흐름의 각 단계가 위 학습 순서의 각 페이지와 거의 1:1로 대응한다. 즉 한 요청을 끝까지 따라가며 설명할 수 있으면 백엔드를 다 설명한 셈이다.

## 이 영역 단골 면접질문 5개

정식 답변은 연결된 상세 페이지에서 단계별로 훈련한다. 여기서는 30초 요약만.

:::details 1. 이 프로젝트 백엔드 아키텍처를 한 줄로 설명해 주세요.
Spring Boot 4 기반 REST API 서버이고, 모든 응답을 `ApiResponse` 엔벨로프로 통일하며 `controller -> service -> mapper -> domain` 4계층으로 책임을 분리했습니다. 영속성은 JPA 대신 MyBatis만 사용합니다.
:::

:::details 2. 왜 JPA가 아니라 MyBatis를 썼나요?
팀 아키텍처 규칙이 MyBatis 전용입니다. SQL을 직접 통제할 수 있어 복잡한 분석 쿼리나 조인을 명시적으로 다루기 좋고, `@Mapper` 인터페이스와 XML로 SQL을 코드에서 분리해 관리합니다. `map-underscore-to-camel-case` 로 스네이크 케이스 컬럼을 카멜 케이스 필드에 자동 매핑합니다.
:::

:::details 3. 에러 응답은 어떻게 일관되게 관리하나요?
도메인 코드는 `BusinessException(ErrorCode)` 만 던지고, `@RestControllerAdvice` 인 `GlobalExceptionHandler` 가 모든 예외를 가로채 `ApiResponse.error(code, message)` 로 변환합니다. `ErrorCode` enum 이 HTTP 상태까지 들고 있어 코드와 상태가 한곳에서 관리됩니다. 검증 실패(`MethodArgumentNotValidException`)도 같은 핸들러가 처리합니다.
:::

:::details 4. 인증은 어떻게 처리하나요?
Spring Security + JWT 입니다. 로그인 시 Access 토큰(30분)과 Refresh 토큰(14일, DB 저장)을 발급하고, `JwtAuthenticationFilter` 가 매 요청의 Bearer 헤더를 파싱해 인증을 주입합니다. 세션은 STATELESS, 비밀번호는 BCrypt 로 해시합니다. 소셜 로그인은 Kakao/Naver/Google OAuth2 를 지원합니다.
:::

:::details 5. ApiResponse 엔벨로프를 쓰면 뭐가 좋나요?
성공/실패 응답 구조가 항상 같아서 프런트가 `success` 플래그 하나로 분기할 수 있습니다. `code` 로 에러 종류를 식별하고 `data` 에만 본문이 담깁니다. `record` 와 정적 팩토리(`ok`/`error`)로 만들어 불변·간결하고, `@JsonInclude(NON_NULL)` 로 불필요한 `null` 필드를 응답에서 제거합니다.
:::

## 직접 말해보기

1. CareerTuner 백엔드를 처음 듣는 사람에게 30초 안에 소개해 보세요. (힌트: 무슨 서버인지 → `ApiResponse` 통일 → 4계층 → MyBatis 전용)
2. 클라이언트가 `/api/fit-analysis` 를 호출한 순간부터 응답이 나갈 때까지, 필터 → 컨트롤러 → 검증 → 서비스 → 매퍼 → 엔벨로프로 이어지는 흐름을 한 호흡으로 말해보세요. 중간에 오류가 나면 어디서 어떻게 가로채는지도 짚으세요.

## 퀴즈

<QuizBox question="CareerTuner 백엔드의 표준 응답 엔벨로프 클래스 이름은?" :choices="['ResponseEntity', 'ApiResponse', 'ResultDto', 'CommonResult']" :answer="1" explanation="common/web/ApiResponse 가 success/code/message/data 4개 필드를 가진 record 로 모든 REST 응답을 감쌉니다. ok()/error() 정적 팩토리로 생성합니다." />

<QuizBox question="CareerTuner 백엔드가 영속성 계층으로 사용하는 기술은?" :choices="['JPA / Hibernate', 'Spring Data JDBC', 'MyBatis', 'QueryDSL']" :answer="2" explanation="아키텍처 규칙상 JPA는 금지이고 MyBatis만 사용합니다. @Mapper 인터페이스와 resources/mapper 의 XML로 SQL을 관리하며, map-underscore-to-camel-case 로 컬럼을 필드에 매핑합니다." />

<QuizBox question="GlobalExceptionHandler가 하는 역할을 면접에서 한두 문장으로 설명해 보세요." explanation="@RestControllerAdvice 로 전 컨트롤러의 예외를 한곳에서 가로채는 클래스입니다. BusinessException 은 그 안의 ErrorCode 에 맞는 HTTP 상태와 메시지로, 검증 실패(MethodArgumentNotValidException)는 어떤 필드가 틀렸는지 담아, 예기치 못한 예외는 INTERNAL_ERROR 로 변환해 모두 동일한 ApiResponse.error 포맷으로 응답합니다. 덕분에 컨트롤러마다 try-catch 를 반복하지 않아도 에러 응답이 일관됩니다." />
