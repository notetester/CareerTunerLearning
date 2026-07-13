# 백엔드 퀴즈

> CareerTuner 백엔드의 핵심 패턴(ApiResponse · MyBatis · JWT · 검증 · 예외 · 트랜잭션 · CORS)을 문제로 풀며 면접 답변을 손에 익히는 페이지다.

## 1. 한 줄 정의

이 페이지는 **개념 설명이 아니라 자가 점검용 퀴즈**다. 각 학습 페이지를 읽은 뒤 여기서 객관식·주관식으로 스스로를 시험하고, 막히는 항목은 해설의 링크를 타고 다시 복습한다.

## 2. 왜 퀴즈로 점검하나

면접은 "읽어서 아는 것"이 아니라 "**입으로 끊김 없이 설명하는 것**"을 검증한다. 눈으로 본 지식은 안다고 착각하기 쉽다(친숙함의 함정). 객관식은 헷갈리는 경계를, 주관식은 30초 답변 구성 능력을 훈련한다.

:::tip 사용법
1. 객관식은 답을 고른 뒤 해설을 끝까지 읽는다(오답 이유까지).
2. 주관식은 입으로 먼저 말해보고 나서 모범답안과 비교한다.
3. 두 번 이상 틀린 주제는 해설의 학습 페이지 링크로 돌아가 복습한다.
:::

## 3. 출제 범위 한눈에

| 영역 | 핵심 키워드 | 학습 페이지 |
| --- | --- | --- |
| 응답 규약 | ApiResponse 엔벨로프, record, ok/error | [ApiResponse](/glossary/api-response-envelope) |
| 영속성 | MyBatis @Mapper, XML, JPA 금지 | [MyBatis](/backend/mybatis) |
| 인증/보안 | JWT, Spring Security, CORS, BCrypt | [JWT 보안](/backend/jwt-security) |
| 검증 | Jakarta Validation, @Valid | [검증](/backend/validation) |
| 예외 | BusinessException, ErrorCode, @RestControllerAdvice | [예외 처리](/backend/exception-handling) |
| 트랜잭션 | @Transactional, 롤백 규칙 | [트랜잭션](/glossary/transaction) |
| 용어 | DTO, REST, ORM 등 | [용어집](/glossary/) |

## 4. 응답 규약 · 영속성 퀴즈

CareerTuner의 모든 컨트롤러 응답은 `common/web/ApiResponse`로 감싸고, 영속성은 MyBatis만 사용한다.

<QuizBox
  question="CareerTuner의 ApiResponse는 어떤 자바 타입으로 선언되어 있고 필드 구성은 무엇인가?"
  :choices="['일반 class 이며 success 필드 하나만 가진다','record 이며 success, code, message, data 4개 필드를 가진다','enum 이며 OK / ERROR 두 상수를 가진다','interface 이며 구현체가 도메인마다 따로 있다']"
  :answer="1"
  explanation="ApiResponse는 record(success, code, message, data) 로 선언된 불변 엔벨로프다. ok()는 success=true·code OK, error(code, message)는 success=false로 만든다. 자세히는 ApiResponse 페이지 참고: /backend/api-response"
/>

<QuizBox
  question="성공 응답을 만들 때 호출하는 정적 팩터리 메서드는?"
  :choices="['ApiResponse.success(data)','ApiResponse.of(data)','ApiResponse.ok(data)','new ApiResponse(data)']"
  :answer="2"
  explanation="ApiResponse.ok(data) 가 success=true, code=OK 인 응답을 만든다. 데이터가 없으면 ok() 오버로드를 쓴다. 실패는 error(code, message). 참고: /backend/api-response"
/>

<QuizBox
  question="CareerTuner의 영속성 계층에 대한 설명으로 옳은 것은?"
  :choices="['JPA 엔티티와 Repository 를 사용한다','MyBatis @Mapper 인터페이스와 resources/mapper 의 XML 을 사용하고 JPA 는 금지다','JdbcTemplate 만 직접 사용한다','MyBatis 와 JPA 를 도메인마다 골라 쓴다']"
  :answer="1"
  explanation="아키텍처 규칙상 영속성은 MyBatis 전용이고 JPA 는 금지다. @Mapper 인터페이스 + resources/mapper/**/*.xml 조합에 map-underscore-to-camel-case 로 snake_case 컬럼을 camelCase 필드로 매핑한다. 참고: /backend/mybatis"
/>

<QuizBox
  question="MySQL 컬럼 user_login_history.created_at 을 자바 필드 createdAt 으로 자동 매핑해 주는 MyBatis 설정은?"
  :choices="['camelCase-to-snake-case','map-underscore-to-camel-case','auto-mapping-behavior=FULL 만으로 충분','snake-case-resolver']"
  :answer="1"
  explanation="map-underscore-to-camel-case=true 가 snake_case 컬럼명을 camelCase 프로퍼티로 매핑한다. 이게 없으면 resultMap 에서 일일이 column-property 를 적어야 한다. 참고: /backend/mybatis"
/>

## 5. 인증 · 보안 퀴즈

JWT(jjwt 0.12.6) + Spring Security 조합. `JwtTokenProvider`, `JwtAuthenticationFilter`, `SecurityConfig`가 핵심.

<QuizBox
  question="CareerTuner의 토큰 만료 정책으로 옳은 것은?"
  :choices="['Access·Refresh 둘 다 30분','Access 30분, Refresh 14일(DB 저장)','Access 14일, Refresh 30분','Access 24시간, Refresh 무제한']"
  :answer="1"
  explanation="JwtTokenProvider 기준 Access 30분, Refresh 14일이며 Refresh 는 refresh_token 테이블에 저장해 서버에서 폐기·검증할 수 있게 한다. OAuth state token 은 CSRF 방지용 5분짜리 별도 토큰이다. 참고: /backend/jwt-security"
/>

<QuizBox
  question="요청 헤더의 'Authorization: Bearer <토큰>' 를 파싱해 SecurityContext 에 인증을 채우는 컴포넌트는?"
  :choices="['SecurityConfig','JwtAuthenticationFilter','JwtTokenProvider','GlobalExceptionHandler']"
  :answer="1"
  explanation="JwtAuthenticationFilter 가 매 요청마다 Bearer 토큰을 파싱·검증해 인증 객체를 SecurityContext 에 넣는다. JwtTokenProvider 는 토큰 생성·서명·파싱 유틸, SecurityConfig 는 필터 체인·정책 설정을 담당한다. 참고: /backend/jwt-security"
/>

<QuizBox
  question="SecurityConfig 의 세션 정책과 비밀번호 인코딩으로 맞는 조합은?"
  :choices="['STATEFUL 세션 + MD5','STATELESS 세션 + BCrypt PasswordEncoder','STATEFUL 세션 + 평문 저장','IF_REQUIRED 세션 + SHA-256']"
  :answer="1"
  explanation="JWT 기반이므로 세션은 STATELESS(서버가 세션을 들지 않음)이고, 비밀번호는 BCrypt PasswordEncoder 로 해시한다. /api/admin/** 는 관리자 권한을 요구한다. 참고: /backend/jwt-security"
/>

<QuizBox
  question="브라우저가 다른 출처(localhost:5173)에서 API 를 호출할 때 막히지 않도록, CareerTuner가 허용 오리진으로 명시한 것에 포함되는 것은?"
  :choices="['모든 오리진(*) 무조건 허용','localhost:5173 과 capacitor://localhost','오직 localhost:8080 자기 자신','파일 프로토콜 file:// 만']"
  :answer="1"
  explanation="SecurityConfig 의 CORS 설정이 프런트 개발 서버 localhost:5173 과 모바일 WebView 오리진 capacitor://localhost 를 허용 오리진으로 둔다. credentials 를 쓰는 구성에서는 와일드카드(*) 를 그대로 못 쓰기 때문에 오리진을 명시한다. 참고: /backend/jwt-security · 용어: /glossary"
/>

## 6. 검증 · 예외 · 트랜잭션 퀴즈

요청 검증은 Jakarta Validation, 도메인 오류는 `BusinessException` + `ErrorCode`, 전역 변환은 `GlobalExceptionHandler`.

<QuizBox
  question="DTO 필드에 @NotBlank, @Size 를 달고 컨트롤러 파라미터에 @Valid 를 붙였을 때, 검증 실패 시 던져지는 예외와 적절한 HTTP 상태는?"
  :choices="['NullPointerException / 500','MethodArgumentNotValidException / 400','BusinessException / 409','IllegalStateException / 403']"
  :answer="1"
  explanation="@Valid 검증 실패는 MethodArgumentNotValidException 으로 떨어지고, GlobalExceptionHandler 가 이를 잡아 INVALID_INPUT(400) 형태의 ApiResponse.error 로 변환한다. 참고: /backend/validation · /backend/exception-handling"
/>

<QuizBox
  question="CareerTuner 의 ErrorCode enum 에서 INSUFFICIENT_CREDIT 에 매핑된 HTTP 상태는?"
  :choices="['400 Bad Request','402 Payment Required','403 Forbidden','409 Conflict']"
  :answer="1"
  explanation="ErrorCode 는 각 상수에 HttpStatus 를 함께 들고 있으며 INSUFFICIENT_CREDIT 은 402 Payment Required 다. AI 사용 크레딧이 부족할 때 ai_usage_log 흐름에서 사용된다. 다른 매핑: NOT_FOUND 404, CONFLICT 409, AI_UNAVAILABLE 502. 참고: /backend/exception-handling"
/>

<QuizBox
  question="서비스 곳곳에서 던진 BusinessException 을 가로채 ApiResponse 엔벨로프로 일관되게 바꿔주는 클래스에 붙는 애너테이션은?"
  :choices="['@ControllerAdvice 없이 컨트롤러마다 try-catch','@RestControllerAdvice 가 붙은 GlobalExceptionHandler','@Transactional','@ExceptionFilter']"
  :answer="1"
  explanation="@RestControllerAdvice 가 붙은 GlobalExceptionHandler 가 BusinessException·MethodArgumentNotValidException 등을 한 곳에서 잡아 ApiResponse.error 로 변환한다. 컨트롤러마다 try-catch 를 흩뿌리지 않는 이유다. 참고: /backend/exception-handling"
/>

<QuizBox
  question="@Transactional 메서드 안에서 RuntimeException(예: BusinessException) 이 던져지면 기본 동작은?"
  :choices="['커밋된다','롤백된다','무시되고 계속 진행','체크 예외만 롤백된다']"
  :answer="1"
  explanation="Spring 의 기본 롤백 규칙은 unchecked(RuntimeException·Error) 발생 시 롤백, checked 예외는 기본적으로 롤백하지 않는다. BusinessException 은 RuntimeException 계열이라 롤백된다. 적합도 분석 결과를 fit_analysis 에 저장하는 것 같은 다단계 쓰기에서 일관성을 지켜준다. 참고: /backend/transaction"
/>

## 7. 주관식 (입으로 답해보기)

선택지를 보지 말고 먼저 30초로 소리 내어 답해본 뒤 모범답안과 비교한다.

<QuizBox
  question="왜 모든 API 응답을 ApiResponse 엔벨로프로 감싸나? 장점을 두 가지 이상 말해보라."
  explanation="모범답안: 성공·실패 응답 형태를 통일해 프런트의 파싱 분기를 단순화한다. ApiResponse(success, code, message, data) 라는 고정 스키마 덕분에 프런트 app/lib/api.ts 가 항상 같은 방식으로 envelope 를 풀고, 실패 시 code/message 로 일관된 에러 표시를 한다. 또 도메인 에러 코드(ErrorCode)를 HTTP 상태와 분리해 클라이언트가 의미 단위로 분기할 수 있고, 성공 시에도 메타 정보를 실어 보낼 여지를 남긴다. 참고: /backend/api-response"
/>

<QuizBox
  question="JWT 기반 인증에서 Access 토큰은 짧게(30분), Refresh 토큰은 길게(14일) 두고 Refresh 만 DB 에 저장하는 이유를 설명하라."
  explanation="모범답안: Access 토큰은 매 요청에 실려 다니므로 탈취 위험이 크다. 그래서 수명을 짧게 둬 탈취되어도 피해 시간을 제한한다. 대신 매번 로그인하지 않도록 수명이 긴 Refresh 토큰으로 Access 를 재발급한다. Refresh 를 refresh_token 테이블에 저장하는 건 JWT 가 본래 무상태(stateless)라 서버가 강제 만료를 못 시키는 약점을 보완하기 위함이다. 로그아웃·탈취 시 DB 의 Refresh 를 폐기하면 재발급을 막을 수 있다. 프런트는 401 을 만나면 tryRefresh() 단일-플라이트로 /auth/refresh 를 호출한다. 참고: /backend/jwt-security"
/>

<QuizBox
  question="'검증은 Jakarta Validation 으로, 비즈니스 규칙 위반은 BusinessException 으로' 처럼 둘을 나누는 기준은 무엇인가?"
  explanation="모범답안: Jakarta Validation(@NotBlank, @Size, @Valid)은 요청 자체의 형식적 유효성, 즉 '값이 비었나, 길이가 범위 안인가' 같은 입력 형태 검사를 컨트롤러 진입 시점에 처리한다(실패 시 400). 반면 BusinessException 은 '크레딧이 부족하다', '이미 존재하는 지원 건이다' 처럼 DB 상태나 도메인 규칙을 봐야 알 수 있는 위반을 서비스 계층에서 표현한다. 전자는 데이터가 들어오기 전에, 후자는 비즈니스 로직 한가운데서 발생하며 둘 다 GlobalExceptionHandler 가 ApiResponse.error 로 통일한다. 참고: /backend/validation · /backend/exception-handling"
/>

## 8. 직접 말해보기

다음 질문을 화면을 보지 않고 60초 안에 끊김 없이 말로 설명해 본다(녹음 추천).

1. "CareerTuner 백엔드 요청 한 건이 컨트롤러에 들어와서 응답이 나갈 때까지, ApiResponse·MyBatis·예외 처리가 각각 어디서 개입하는지 흐름으로 설명해 주세요."
2. "JWT 인증이 SecurityConfig·JwtAuthenticationFilter·JwtTokenProvider·refresh_token 테이블로 어떻게 나뉘어 동작하는지, 토큰이 만료됐을 때까지 포함해 말해 주세요."

:::details 막혔다면 — 복습 순서
[용어집](/glossary/) → [ApiResponse](/glossary/api-response-envelope) → [MyBatis](/backend/mybatis) → [검증](/backend/validation) → [예외 처리](/backend/exception-handling) → [트랜잭션](/glossary/transaction) → [JWT 보안](/backend/jwt-security)
:::

## 퀴즈

위 4~7장의 QuizBox 문항이 이 페이지의 퀴즈다. 객관식 10문항 + 주관식 3문항을 모두 막힘없이 통과하면 백엔드 핵심 패턴 면접 준비가 된 것이다. 한 번에 다 풀려 하지 말고, 학습 페이지를 한 편 읽을 때마다 해당 영역 문항만 골라 풀어도 좋다.
