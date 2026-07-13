# 입력 검증 (Jakarta Validation)

> 컨트롤러에 들어오는 요청 본문을 DTO 단계에서 `@Valid`로 자동 검증하고, 실패하면 `MethodArgumentNotValidException`을 `GlobalExceptionHandler`가 잡아 `ApiResponse(INVALID_INPUT, 400)`으로 통일해 내려줍니다.

## 1. 한 줄 정의

입력 검증은 "잘못된 요청을 비즈니스 로직에 닿기 전에 걸러내는 것"이고, Jakarta Validation은 그 규칙을 DTO 필드에 어노테이션(`@NotBlank`, `@Size`, `@Email`)으로 선언적으로 붙이는 표준 스펙입니다.

## 2. 단어 뜻 (약자/어원 풀이)

| 용어 | 풀이 |
| --- | --- |
| Jakarta Validation | 자바 표준 검증 스펙(구 Bean Validation, JSR-380). 패키지가 `jakarta.validation.constraints.*` |
| `@Valid` | "이 객체를 검증 규칙대로 검사하라"는 트리거 어노테이션 |
| Constraint(제약) | 필드가 만족해야 하는 조건. `@NotBlank` 등 어노테이션 1개 = 제약 1개 |
| `MethodArgumentNotValidException` | `@Valid` 검증이 실패했을 때 Spring MVC가 던지는 예외 |
| `BindingResult` / `FieldError` | 어떤 필드가 왜 실패했는지 담은 결과 객체 |

:::tip 선언적(declarative) vs 명령적(imperative)
`if (email == null || email.isBlank()) throw ...` 처럼 직접 검사 코드를 쓰는 것이 명령적. `@NotBlank String email` 처럼 "규칙만 선언"하고 검사는 프레임워크가 하는 것이 선언적. Jakarta Validation은 선언적 방식입니다.
:::

## 3. 왜 필요한가 (없으면 무슨 문제가 생기나)

검증이 없으면 잘못된 데이터가 서비스 계층, 그리고 DB까지 그대로 흘러들어갑니다.

- **방어선 부재**: 빈 비밀번호, 형식이 깨진 이메일, 255자 초과 회사명이 DB `INSERT`까지 도달 → DB 제약 위반으로 500 에러
- **에러 응답 제각각**: 컨트롤러마다 `if`로 막으면 메시지 형식·HTTP 상태가 들쭉날쭉 → 프런트가 일관되게 처리 불가
- **로직 오염**: 서비스 메서드 첫 줄마다 null/길이 체크가 반복 → 핵심 로직이 검증 코드에 묻힘
- **AI 비용 낭비**: CareerTuner 특성상 검증 없이 통과하면 빈 입력으로 OpenAI 호출이 발생 → `ai_usage_log`에 의미 없는 비용 기록

검증을 DTO 한 곳에 모으면 "잘못된 입력은 400, 그 외는 정상 흐름"이라는 단순한 계약이 성립합니다.

## 4. CareerTuner에서 어디에 썼나 (실제 클래스/파일/테이블)

영역 표시: 공통(C 영역도 동일 패턴 사용), 실제 파일은 `backend/src/main/java/com/careertuner/**`.

| 위치 | 역할 |
| --- | --- |
| `auth/dto/RegisterRequest.java` | 회원가입 입력 검증. `@NotBlank @Email email`, `@NotBlank @Size(min=8,max=64) password`, `@NotBlank @Size(max=100) name` |
| `applicationcase/dto/CreateApplicationCaseRequest.java` | 지원 건 생성. `@NotBlank @Size(max=255) companyName / jobTitle` |
| `analysis/dto/CareerGoalRequest.java` (C 영역) | 취업경향 분석용 목표 입력. `@Size(max=255)` 등 길이 상한만 |
| `auth/controller/AuthController.java` | `@PostMapping("/register")` 에서 `@Valid @RequestBody RegisterRequest` 로 검증 트리거 |
| `common/exception/GlobalExceptionHandler.java` | `@RestControllerAdvice` 로 `MethodArgumentNotValidException` 잡아 `INVALID_INPUT` 응답 생성 |
| `common/exception/ErrorCode.java` | `INVALID_INPUT(HttpStatus.BAD_REQUEST, "잘못된 요청입니다.")` 정의 |
| `common/web/ApiResponse.java` | `error(code, message)` 로 실패 envelope 생성 |

실제 DTO는 모두 `record` 입니다. 예시(축약):

```java
public record RegisterRequest(
        @NotBlank @Email String email,
        @NotBlank @Size(min = 8, max = 64) String password,
        @NotBlank @Size(max = 100) String name,
        Boolean termsAgreed) {
}
```

:::tip 경계별 검증
사용자 REST 입력은 DTO + `@Valid` + 공통 핸들러로 검증한다. C 자체 모델 provider 응답은 이와 별도로 스키마·판단 불변식·grounding 가드를 통과해야 저장된다. 외부 입력과 모델 출력은 신뢰 경계가 다르므로 검증 위치도 분리한다.
:::

## 5. 핵심 동작 원리 (표/작은 코드/단계)

요청 한 건이 검증을 통과/실패하는 흐름:

1. 클라이언트가 JSON 바디로 `POST /api/auth/register` 호출
2. Spring이 JSON을 `RegisterRequest` record로 역직렬화
3. 파라미터에 `@Valid`가 붙어 있으면 → 필드 제약(`@NotBlank` 등)을 검사
4. **통과** → 컨트롤러 메서드 본문 실행 (서비스 호출)
5. **실패** → `MethodArgumentNotValidException` 발생, 메서드 본문은 아예 실행 안 됨
6. `GlobalExceptionHandler`가 그 예외를 잡아 첫 번째 `FieldError`로 메시지 조립
7. `ApiResponse.error("INVALID_INPUT", "email: ...")` 를 HTTP 400으로 반환

핸들러 핵심(실제 코드 축약):

```java
@ExceptionHandler(MethodArgumentNotValidException.class)
public ResponseEntity<ApiResponse<Void>> handleValidation(MethodArgumentNotValidException ex) {
    FieldError fieldError = ex.getBindingResult().getFieldError();
    String message = fieldError != null
            ? "%s: %s".formatted(fieldError.getField(), fieldError.getDefaultMessage())
            : ErrorCode.INVALID_INPUT.getDefaultMessage();
    return ResponseEntity.status(ErrorCode.INVALID_INPUT.getStatus())
            .body(ApiResponse.error(ErrorCode.INVALID_INPUT.name(), message));
}
```

자주 쓰는 제약 한눈에:

| 어노테이션 | 의미 | 주의 |
| --- | --- | --- |
| `@NotNull` | null 금지 (빈 문자열·공백은 허용) | String엔 보통 부족함 |
| `@NotBlank` | null·빈 문자열·공백 전부 금지 | String 필수값에 적합 |
| `@Size(min, max)` | 길이/크기 범위 | null은 통과(길이 검사만) → 필수면 `@NotBlank`와 같이 |
| `@Email` | 이메일 형식 | null은 통과 → 필수면 `@NotBlank @Email` 조합 |

:::warning @NotNull vs @NotBlank
필수 문자열에 `@NotNull`만 쓰면 `""`(빈 문자열)이 통과해 버립니다. CareerTuner DTO가 `email`/`password`/`companyName`에 `@NotBlank`를 쓰는 이유입니다.
:::

## 6. 면접 답변 3단계

- **초간단 1문장**: "요청 DTO 필드에 검증 어노테이션을 붙이고 컨트롤러에서 `@Valid`로 트리거해, 실패 시 글로벌 핸들러가 400 표준 응답으로 통일합니다."
- **기본**: "잘못된 입력이 서비스·DB까지 가지 않도록 입력 단계에서 막는 게 목적입니다. Jakarta Validation 표준을 써서 `RegisterRequest` 같은 record DTO에 `@NotBlank`, `@Size`, `@Email`을 선언하고, 컨트롤러 파라미터에 `@Valid`를 붙입니다. 검증 실패는 `MethodArgumentNotValidException`으로 던져지는데, `@RestControllerAdvice`인 `GlobalExceptionHandler`가 이를 받아 `ErrorCode.INVALID_INPUT`(400)으로 변환해 `ApiResponse` envelope로 내려줍니다. 덕분에 에러 응답 형식이 전 API에서 동일합니다."
- **꼬리질문 대응**: "검증을 DTO에 둔 이유는 관심사 분리입니다. 형식·필수·길이 같은 '구조적 검증'은 어노테이션으로 선언하고, 이메일 중복 같은 'DB 의존 검증'은 서비스에서 `BusinessException(CONFLICT)`로 처리합니다. 검증 규칙이 한곳에 모여 컨트롤러·서비스 코드가 깨끗하게 유지됩니다."

## 7. 자주 나오는 꼬리질문 + 모범답안

:::details Q1. 검증을 왜 컨트롤러 본문의 if문이 아니라 DTO에 두나요?
관심사 분리와 일관성 때문입니다. if문으로 흩으면 컨트롤러마다 메시지·상태코드가 제각각이 되고 로직이 검증 코드에 묻힙니다. DTO 어노테이션으로 선언하면 규칙이 타입과 함께 한곳에 보이고, 실패 응답은 `GlobalExceptionHandler` 한 곳에서 `INVALID_INPUT`으로 통일됩니다.
:::

:::details Q2. @Valid가 없으면 어떻게 되나요?
어노테이션이 붙어 있어도 검증이 트리거되지 않아 그냥 통과합니다. `@NotBlank`는 "규칙 선언"일 뿐이고, 실제 검사는 파라미터의 `@Valid`(또는 `@Validated`)가 있어야 실행됩니다. 그래서 CareerTuner의 `AuthController.register`는 `@Valid @RequestBody RegisterRequest`로 받습니다.
:::

:::details Q3. @NotNull과 @NotBlank의 차이는?
`@NotNull`은 null만 막고 `""`나 공백은 통과시킵니다. `@NotBlank`는 null·빈 문자열·공백 모두 막습니다. 또 `@Size`와 `@Email`은 값이 null이면 검사를 건너뛰므로, 필수 문자열에는 `@NotBlank`를 함께 붙여야 빈 값이 새지 않습니다.
:::

:::details Q4. 형식 검증과 비즈니스 검증은 어떻게 나누나요?
구조적·형식적 검증(필수, 길이, 이메일 형식)은 Jakarta Validation으로 DTO에서, DB나 상태에 의존하는 검증(이메일 중복, 크레딧 잔액)은 서비스 계층에서 `BusinessException` + `ErrorCode`로 처리합니다. 전자는 400 `INVALID_INPUT`, 후자는 `CONFLICT`/`INSUFFICIENT_CREDIT` 등으로 매핑됩니다.
:::

:::details Q5. 검증 실패 응답은 어떤 모양인가요?
`ApiResponse` envelope의 실패 형태입니다. `{ success: false, code: "INVALID_INPUT", message: "email: ..." }` 이고 HTTP 상태는 400. 메시지는 핸들러가 첫 번째 `FieldError`의 필드명과 기본 메시지를 합쳐 만듭니다. 프런트는 `code`만 보고 일관되게 분기할 수 있습니다.
:::

## 8. 직접 말해보기

1. "회원가입 API에 잘못된 이메일과 빈 비밀번호가 들어왔을 때, 요청이 어디서 막히고 클라이언트는 어떤 JSON과 상태코드를 받는지 흐름 순서대로 설명해 보세요."
2. "검증을 DTO 어노테이션으로 두는 것과 서비스 if문으로 두는 것의 트레이드오프를, CareerTuner의 `RegisterRequest`와 이메일 중복 검사를 예로 비교해 말해 보세요."

## 퀴즈

<QuizBox question="@NotBlank String password 만 선언하고 컨트롤러 파라미터에 @Valid를 붙이지 않으면 어떻게 되나요?" :choices="['검증이 트리거되지 않아 빈 값도 그대로 통과한다','컴파일 에러가 난다','자동으로 검증되어 400을 반환한다','서버가 500을 던진다']" :answer="0" explanation="제약 어노테이션은 규칙 선언일 뿐이고, 실제 검사는 파라미터의 @Valid(또는 @Validated)가 트리거합니다. 빠지면 검증이 실행되지 않습니다." />

<QuizBox question="CareerTuner에서 @Valid 검증 실패 시 최종적으로 클라이언트가 받는 응답 코드와 HTTP 상태는?" :choices="['CONFLICT / 409','INVALID_INPUT / 400','INTERNAL_ERROR / 500','UNAUTHORIZED / 401']" :answer="1" explanation="MethodArgumentNotValidException을 GlobalExceptionHandler가 잡아 ErrorCode.INVALID_INPUT(HttpStatus.BAD_REQUEST=400)으로 변환해 ApiResponse.error로 내려줍니다." />

<QuizBox question="형식 검증(필수·길이·이메일)과 비즈니스 검증(이메일 중복 등)을 CareerTuner가 어떻게 분리해 처리하는지 설명해 보세요." explanation="형식·구조적 검증은 Jakarta Validation 어노테이션으로 DTO(record)에서 선언하고 @Valid로 트리거하며 실패 시 INVALID_INPUT(400)으로 통일됩니다. 반면 DB·상태에 의존하는 비즈니스 검증은 서비스 계층에서 BusinessException과 ErrorCode(CONFLICT, INSUFFICIENT_CREDIT 등)로 처리합니다. 두 경로 모두 GlobalExceptionHandler를 거쳐 ApiResponse envelope로 통일되므로 프런트는 code 값만으로 일관되게 분기할 수 있습니다." />
