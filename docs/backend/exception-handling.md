# 예외 처리 (@RestControllerAdvice)

> 서비스에서 `BusinessException`을 던지면, `@RestControllerAdvice`가 전역에서 가로채 `ErrorCode`에 매핑된 HTTP 상태와 통일된 `ApiResponse` 에러 응답으로 변환합니다.

## 1. 한 줄 정의

비즈니스 규칙 위반은 `BusinessException(ErrorCode)`로 던지고, 그 예외를 `@RestControllerAdvice`가 붙은 `GlobalExceptionHandler`가 한 곳에서 잡아 **올바른 HTTP 상태 코드 + 통일된 JSON 에러 응답**으로 자동 변환하는 구조입니다.

## 2. 단어 뜻 (약자/어원 풀이)

| 용어 | 풀이 |
| --- | --- |
| `@ControllerAdvice` | "모든 컨트롤러에게 주는 조언(advice)". AOP 기반으로 전 컨트롤러에 공통 로직(예외 처리·바인딩)을 끼워 넣는 어노테이션 |
| `@RestControllerAdvice` | `@ControllerAdvice` + `@ResponseBody`. 핸들러 반환값을 그대로 JSON 본문으로 직렬화 |
| `@ExceptionHandler(X.class)` | "X 예외가 던져지면 이 메서드로 처리해라"라고 매핑하는 어노테이션 |
| `BusinessException` | 비즈니스 규칙 위반을 표현하는 우리 도메인의 `RuntimeException` |
| `ErrorCode` | HTTP 상태 + 기본 메시지를 묶은 표준 enum |
| envelope | 모든 응답을 동일한 봉투(`ApiResponse`) 안에 담는 패턴 |

## 3. 왜 필요한가 (없으면 무슨 문제가 생기나)

전역 예외 처리가 없으면 이런 문제가 생깁니다.

- **상태 코드가 제멋대로**: 못 잡은 예외는 전부 `500 Internal Server Error`로 나가서, 프런트가 "없는 리소스(404)"인지 "권한 없음(403)"인지 구분 불가.
- **응답 모양이 컨트롤러마다 다름**: 어떤 곳은 문자열, 어떤 곳은 스택트레이스. 프런트의 에러 파싱 로직이 통일되지 않음.
- **민감 정보 노출**: 잡지 않은 예외의 스택트레이스가 그대로 클라이언트로 새어 나감(보안 위험).
- **try-catch 중복**: 모든 컨트롤러 메서드마다 `try-catch`를 깔게 되어 비즈니스 로직이 가려짐.

CareerTuner는 프런트가 `app/lib/api.ts`에서 `ApiResponse` 봉투의 `success`/`code`/`message` 필드를 **항상 같은 모양으로** 파싱합니다. 그래서 백엔드 에러 응답이 단 하나의 형식이라는 보장이 필요하고, 그 보장을 `GlobalExceptionHandler`가 만듭니다.

:::tip 핵심 분리
서비스는 "무엇이 잘못됐는지"만 `ErrorCode`로 선언하고 던집니다. "HTTP로 어떻게 변환할지"는 핸들러가 단독으로 결정합니다. 관심사가 깔끔하게 나뉩니다.
:::

## 4. CareerTuner에서 어디에 썼나 (실제 클래스/파일/테이블, 영역 표시)

핵심 3개 클래스는 `backend/.../common/exception/` 패키지에 있습니다(공통 영역, Owner=팀장).

| 파일 | 역할 |
| --- | --- |
| `ErrorCode.java` | 표준 에러 코드 enum. 각 코드가 `HttpStatus` + 기본 메시지를 보유 |
| `BusinessException.java` | `RuntimeException` 상속. `ErrorCode`를 필드로 들고 다님 |
| `GlobalExceptionHandler.java` | `@RestControllerAdvice`. 전 컨트롤러 예외를 `ApiResponse`로 통일 |
| `common/web/ApiResponse.java` | 응답 봉투 record(`success`, `code`, `message`, `data`) |

실제 던지는 지점(영역 C 포함, 전 영역에서 동일 패턴):

```java
// [C] fitanalysis/service/FitAnalysisServiceImpl
throw new BusinessException(ErrorCode.NOT_FOUND, "적합도 분석 결과를 찾을 수 없습니다.");

// [C] analysis/service/CareerPlanServiceImpl (장기 취업경향/학습계획)
throw new BusinessException(ErrorCode.INVALID_INPUT, "학습 계획 종료일은 시작일보다 빠를 수 없습니다.");

// [B] jobanalysis/service/JobAnalysisService
throw new BusinessException(ErrorCode.CONFLICT, "이미 분석이 진행 중입니다. 잠시 후 결과를 확인해 주세요.");

// [C/공통] AI 클라이언트(FaqDraftAiClient 등) — Ollama 호출 실패 폴백
throw new BusinessException(ErrorCode.AI_UNAVAILABLE);

// [공통] billing/credit — 사용량/크레딧 부족
throw new BusinessException(ErrorCode.INSUFFICIENT_CREDIT, "사용 가능한 사용권이 부족합니다.");
```

`INSUFFICIENT_CREDIT`는 `ai_usage_log` 기반 크레딧 차감 로직(billing/credit 서비스)에서, `AI_UNAVAILABLE`은 적합도·FAQ 등 AI 호출 실패 시 폴백 경로에서 실제로 던집니다. 즉 이 enum은 장식이 아니라 도메인 전반에서 살아 있는 계약입니다.

## 5. 핵심 동작 원리 (표/작은 코드/단계)

### 흐름 한 장 요약

```text
Service  →  throw new BusinessException(ErrorCode.NOT_FOUND, "...")
   ↓ (호출 스택을 타고 올라감, Controller는 try-catch 안 함)
@RestControllerAdvice GlobalExceptionHandler
   ↓ @ExceptionHandler(BusinessException.class) 가 매칭
ResponseEntity.status(code.getStatus())  ← ErrorCode가 HTTP 상태 결정
   .body(ApiResponse.error(code.name(), message))  ← 봉투로 통일
   ↓
클라이언트: { "success": false, "code": "NOT_FOUND", "message": "..." }
```

### ErrorCode = (상태, 기본 메시지) 묶음

```java
@Getter
public enum ErrorCode {
    INVALID_INPUT(HttpStatus.BAD_REQUEST,  "잘못된 요청입니다."),
    UNAUTHORIZED (HttpStatus.UNAUTHORIZED, "인증이 필요합니다."),
    NOT_FOUND    (HttpStatus.NOT_FOUND,    "대상을 찾을 수 없습니다."),
    AI_UNAVAILABLE(HttpStatus.BAD_GATEWAY, "AI 초안 생성에 일시적으로 실패했습니다."),
    // ...
}
```

### 핸들러 3종 + 안전망

`GlobalExceptionHandler`는 예외 종류별로 `@ExceptionHandler`를 나눠 잡습니다.

| 핸들러가 잡는 예외 | 결과 코드 | HTTP 상태 | 로깅 |
| --- | --- | --- | --- |
| `BusinessException` | 그 예외의 `ErrorCode.name()` | `ErrorCode.status` | `log.warn` |
| `MethodArgumentNotValidException` (`@Valid` 실패) | `INVALID_INPUT` | 400 | (없음) |
| `MaxUploadSizeExceededException` (업로드 초과) | `INVALID_INPUT` | 400 | (없음) |
| `Exception` (그 외 전부) | `INTERNAL_ERROR` | 500 | `log.error` (스택 포함) |

```java
@ExceptionHandler(BusinessException.class)
public ResponseEntity<ApiResponse<Void>> handleBusiness(BusinessException ex) {
    ErrorCode code = ex.getErrorCode();
    log.warn("BusinessException: {} - {}", code.name(), ex.getMessage());  // 예상된 오류 = warn
    return ResponseEntity.status(code.getStatus())
            .body(ApiResponse.error(code.name(), ex.getMessage()));
}

@ExceptionHandler(Exception.class)   // 마지막 안전망
public ResponseEntity<ApiResponse<Void>> handleUnexpected(Exception ex) {
    log.error("Unexpected error", ex);  // 예상 못한 오류 = error + 스택트레이스
    ErrorCode code = ErrorCode.INTERNAL_ERROR;
    return ResponseEntity.status(code.getStatus())
            .body(ApiResponse.error(code.name(), code.getDefaultMessage())); // 내부 메시지는 숨김
}
```

:::warning 로그 레벨을 의도적으로 나눈다
`BusinessException`은 "사용자가 잘못 요청한, 예상된 상황"이라 `warn`. 못 잡은 `Exception`은 "코드 버그일 수 있는, 예상 못한 상황"이라 `error`로 스택트레이스까지 남깁니다. 운영 중 알람을 거는 기준이 됩니다. 또한 안전망에서는 `ex.getMessage()`가 아니라 `code.getDefaultMessage()`를 내려서 내부 예외 메시지가 새지 않게 합니다.
:::

### 검증 실패는 어느 필드인지까지 알려준다

```java
FieldError fieldError = ex.getBindingResult().getFieldError();
String message = "%s: %s".formatted(fieldError.getField(), fieldError.getDefaultMessage());
// 예) "email: 올바른 이메일 형식이 아닙니다"
```

DTO에 `@NotBlank`, `@Size` 같은 Jakarta Validation 어노테이션을 달고 컨트롤러 파라미터에 `@Valid`를 붙이면, 위반 시 Spring이 `MethodArgumentNotValidException`을 던지고 이 핸들러가 첫 번째 위반 필드를 메시지에 담아 줍니다.

## 6. 면접 답변 3단계 (초간단 1문장 / 기본 / 꼬리질문 대응)

**초간단 (1문장)**
"비즈니스 예외를 `BusinessException`으로 던지면 `@RestControllerAdvice`가 전역에서 잡아 통일된 에러 응답으로 바꿔 줍니다."

**기본 (30초)**
"에러 코드를 `ErrorCode` enum 하나에 모아 각각 HTTP 상태와 기본 메시지를 묶어 뒀습니다. 서비스 계층은 규칙을 어기면 `BusinessException(ErrorCode.NOT_FOUND, ...)` 처럼 의미만 던지고, `GlobalExceptionHandler`가 `@ExceptionHandler`로 받아서 enum의 상태 코드와 우리 표준 응답 봉투 `ApiResponse`로 변환합니다. 검증 실패와 업로드 초과는 400으로, 그 외 못 잡은 예외는 마지막 안전망에서 500으로 처리하면서 내부 메시지는 숨깁니다."

**꼬리질문 대응 (확장)**
"로그 레벨도 의도적으로 나눴습니다. 예상된 비즈니스 예외는 `warn`, 못 잡은 예외는 스택트레이스와 함께 `error`로 남겨 운영 알람 기준으로 씁니다. 프런트는 이 봉투의 `code`/`message`만 일관되게 파싱하면 되고, 새 에러 상황이 생기면 enum에 한 줄 추가하는 것으로 끝납니다."

## 7. 자주 나오는 꼬리질문 + 모범답안

:::details Q. `@ControllerAdvice`와 `@RestControllerAdvice` 차이는?
`@RestControllerAdvice` = `@ControllerAdvice` + `@ResponseBody`입니다. 후자는 핸들러 반환값(여기선 `ApiResponse`)을 뷰 이름이 아니라 JSON 응답 본문으로 직렬화합니다. REST API라 `@RestControllerAdvice`를 씁니다.
:::

:::details Q. 왜 checked exception이 아니라 RuntimeException을 상속했나?
`BusinessException`은 `RuntimeException`을 상속합니다. checked로 만들면 호출 스택의 모든 메서드에 `throws` 선언이 전염돼 코드가 지저분해지고, 우리는 그 예외를 컨트롤러에서 직접 잡을 게 아니라 전역 핸들러까지 그냥 흘려보내는 게 목적이기 때문입니다.
:::

:::details Q. HTTP 상태 코드는 어디서 결정되나? 컨트롤러가 정하나?
컨트롤러도 서비스도 아닙니다. `ErrorCode` enum이 각 코드마다 `HttpStatus`를 들고 있고, 핸들러가 `ResponseEntity.status(code.getStatus())`로 그대로 사용합니다. 그래서 같은 에러는 어디서 던져도 항상 같은 상태 코드가 나갑니다. 예: `INSUFFICIENT_CREDIT`은 `402 PAYMENT_REQUIRED`.
:::

:::details Q. AI 호출 실패는 왜 500이 아니라 502인가?
`AI_UNAVAILABLE`을 `BAD_GATEWAY(502)`로 매핑했습니다. 우리 서버 버그(500)가 아니라 외부/하위 AI 서비스(OpenAI, Ollama)가 일시적으로 응답하지 못한 상황이라는 의미를 정확히 담기 위해서입니다. 클라이언트는 502를 보고 "잠시 후 재시도" UX를 띄울 수 있습니다.
:::

:::details Q. 핸들러가 여러 개일 때 어떤 게 우선 매칭되나?
Spring은 가장 구체적인 예외 타입에 매칭합니다. `BusinessException`이 던져지면 `@ExceptionHandler(BusinessException.class)`가 먼저 잡고, 어떤 전용 핸들러에도 안 걸리는 예외만 최상위 `@ExceptionHandler(Exception.class)` 안전망으로 떨어집니다.
:::

:::details Q. 클라이언트는 이 에러를 어떻게 소비하나?
프런트 `app/lib/api.ts`가 모든 응답을 `ApiResponse` 봉투로 파싱합니다. `success === false`면 `code`/`message`를 꺼내 사용자에게 토스트로 보여 주거나, `code`별로 분기(예: `UNAUTHORIZED`면 로그인 유도)합니다. 백엔드가 형식을 통일했기 때문에 가능한 일입니다.
:::

## 8. 직접 말해보기 (말하기 훈련용 질문)

1. "전역 예외 처리가 없을 때 생기는 문제 3가지와, `@RestControllerAdvice`가 각각을 어떻게 해결하는지"를 30초 안에 설명해 보세요.
2. "서비스에서 `throw new BusinessException(ErrorCode.NOT_FOUND, ...)` 한 줄이 클라이언트의 `404 + JSON 봉투`로 바뀌기까지의 흐름"을 화살표로 그려 가며 말로 설명해 보세요.

## 관련 페이지

- [ApiResponse 응답 봉투](/glossary/api-response-envelope)
- [DTO와 Validation](/glossary/dto)
- [JWT와 Spring Security](/backend/jwt-security)

## 퀴즈

<QuizBox question="GlobalExceptionHandler에서 BusinessException은 warn, 못 잡은 Exception은 error로 로깅을 나눈 이유로 가장 적절한 것은?" :choices="['로그 양을 줄이기 위해', '예상된 사용자 오류와 예상 못한 시스템 버그를 운영상 구분하기 위해', 'warn이 error보다 빠르기 때문', 'Spring이 강제하는 규칙이라서']" :answer="1" explanation="BusinessException은 사용자의 잘못된 요청 같은 예상된 상황이라 warn, 못 잡은 Exception은 코드 버그일 수 있는 예상 못한 상황이라 스택트레이스와 함께 error로 남겨 알람 기준으로 삼습니다." />

<QuizBox question="ErrorCode.AI_UNAVAILABLE이 500(INTERNAL_ERROR)이 아니라 502(BAD_GATEWAY)로 매핑된 이유는?" :choices="['우연히 그렇게 설정됨', '우리 서버 버그가 아니라 외부/하위 AI 서비스의 일시적 실패임을 나타내려고', '502가 보안상 더 안전해서', 'AI 응답은 항상 502여야 하는 표준이라서']" :answer="1" explanation="AI_UNAVAILABLE은 OpenAI/Ollama 같은 외부 의존 서비스가 일시적으로 응답하지 못한 게이트웨이성 오류이므로 502가 의미상 정확하고, 클라이언트는 재시도 UX로 대응할 수 있습니다." />

<QuizBox question="서비스가 BusinessException(ErrorCode.NOT_FOUND, '...')를 던졌을 때, 최종 클라이언트 응답의 HTTP 상태 코드를 결정하는 곳은 어디인가? 그 이유를 함께 설명하라." explanation="HTTP 상태는 컨트롤러나 서비스가 아니라 ErrorCode enum이 결정합니다. 각 enum 상수가 HttpStatus를 필드로 보유하고, GlobalExceptionHandler가 ResponseEntity.status(code.getStatus())로 그 값을 그대로 사용합니다. 덕분에 같은 에러는 어느 도메인에서 던져도 항상 동일한 상태 코드와 동일한 ApiResponse 봉투 형식으로 응답되어 일관성이 보장됩니다." />
