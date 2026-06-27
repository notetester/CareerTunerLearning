# 애너테이션 (@)

> 코드 위에 붙이는 메타데이터. 프레임워크가 리플렉션으로 읽어 "이건 컨트롤러다, 이건 트랜잭션이다"를 판단하고 대신 동작한다.

## 1. 한 줄 정의

애너테이션(annotation)은 클래스·메서드·필드·파라미터에 붙이는 **추가 정보(메타데이터)** 다. 컴파일러나 프레임워크가 이 표시를 읽고 동작을 바꾼다. CareerTuner 백엔드에서 `@RestController`, `@Service`, `@Transactional` 같은 `@`로 시작하는 것이 전부 애너테이션이다.

## 2. 단어 뜻 (약자·어원)

- annotation = **annotate(주석을 달다) + -ion**. 원뜻은 "여백에 다는 메모".
- 자바에서는 단순 메모가 아니라 **프로그램이 읽고 처리하는 메모**다. 사람이 보는 메모는 `주석(comment)`, 프로그램이 보는 메모는 `애너테이션`.
- `@` 기호는 "at" 으로 읽는다. `@Service` = "at Service".

| 구분 | 주석(comment) | 애너테이션(annotation) |
| --- | --- | --- |
| 문법 | `//`, `/* */` | `@이름` |
| 읽는 주체 | 사람 | 컴파일러 / 프레임워크 / 런타임 |
| 컴파일 후 | 사라짐 | 바이트코드에 남을 수 있음(`RetentionPolicy`) |
| 동작에 영향 | 없음 | 있음 (빈 등록, 트랜잭션, 검증 등) |

## 3. 왜 필요한가 (없으면 무슨 문제)

애너테이션의 핵심 가치는 **선언적 프로그래밍(declarative programming)** 이다. "무엇을 원하는지"만 선언하면 "어떻게 하는지"는 프레임워크가 처리한다.

`@Transactional` 하나가 없다면 모든 서비스 메서드에서 직접 이렇게 써야 한다.

```java
Connection conn = dataSource.getConnection();
try {
    conn.setAutoCommit(false);
    // ... 실제 로직 ...
    conn.commit();
} catch (Exception e) {
    conn.rollback();
    throw e;
} finally {
    conn.close();
}
```

이 보일러플레이트가 모든 메서드에 반복되고, 한 군데라도 `rollback()`을 빠뜨리면 데이터가 깨진다. `@Transactional`을 붙이면 이 흐름을 프레임워크가 프록시로 감싸 자동 처리한다. 즉 애너테이션은 **반복 코드 제거 + 실수 방지 + 의도 명시**를 동시에 해결한다.

:::tip
면접에서 "왜 XML 설정 대신 애너테이션이냐"를 물으면: "설정과 코드가 같은 자리에 있어 응집도가 높고, 무엇을 의도했는지 코드에서 바로 보인다"가 정석 답이다.
:::

## 4. CareerTuner에서 어디에 썼나 (실제 근거)

내가 담당한 영역 C(적합도·취업경향 분석)의 실제 컨트롤러 `analysis/controller/AnalysisController.java`가 애너테이션의 거의 모든 종류를 한 화면에 담고 있다.

```java
@RestController                       // 이 클래스는 REST 컨트롤러(JSON 반환)
@RequestMapping("/api/analysis")      // 이 클래스의 기본 URL 경로
@RequiredArgsConstructor              // (Lombok) final 필드 생성자 자동 생성 → 생성자 주입
public class AnalysisController {

    private final AnalysisService analysisService;

    @GetMapping("/summary")           // GET /api/analysis/summary 매핑
    public ApiResponse<AnalysisSummaryResponse> summary(
            @AuthenticationPrincipal AuthUser authUser) {  // JWT에서 추출된 로그인 사용자 주입
        return ApiResponse.ok(analysisService.getSummary(authUser.id()));
    }

    @PostMapping("/summary/refresh")  // POST /api/analysis/summary/refresh
    public ApiResponse<AnalysisSummaryResponse> refresh(
            @AuthenticationPrincipal AuthUser authUser) {
        return ApiResponse.ok(analysisService.refreshSummary(authUser.id()));
    }
}
```

| 애너테이션 | 위치 | 역할 | CareerTuner 근거 |
| --- | --- | --- | --- |
| `@RestController` | 클래스 | JSON 반환 컨트롤러로 빈 등록 | `AnalysisController`, `CareerPlanController` |
| `@RequestMapping` | 클래스 | 기본 URL 경로 | `/api/analysis` |
| `@GetMapping`/`@PostMapping` | 메서드 | HTTP 메서드+세부 경로 매핑 | `summary`, `refresh`, `history` |
| `@AuthenticationPrincipal` | 파라미터 | `SecurityContext`의 로그인 사용자 주입 | `AuthUser authUser` |
| `@Service` | 클래스 | 비즈니스 로직 빈 | `AnalysisService` 구현체 |
| `@RequiredArgsConstructor` | 클래스 | (Lombok) 생성자 주입 코드 생성 | 거의 모든 서비스/컨트롤러 |
| `@Mapper` | 인터페이스 | MyBatis 매퍼로 인식 | `ProfileMapper`, `UserMapper` 등 |
| `@Transactional` | 메서드/클래스 | 트랜잭션 경계 | 쓰기 서비스 메서드 |
| `@Valid`+`@NotBlank`/`@Size` | 파라미터/DTO 필드 | 요청 검증 | `CreatePostRequest`, `TicketMessageRequest` |
| `@RestControllerAdvice` | 클래스 | 전역 예외 처리 | `GlobalExceptionHandler` |
| `@ConfigurationProperties` | 클래스 | `application.yaml` 값 바인딩 | `CareerTunerProperties(prefix="careertuner")` |
| `@Slf4j` | 클래스 | (Lombok) `log` 필드 생성 | 로깅 쓰는 클래스 |

`@ConfigurationProperties`는 환경 설정을 타입 안전하게 묶는다. `common/config/CareerTunerProperties.java`는 `prefix = "careertuner"`로 `jwt.secret`, 토큰 유효기간, OAuth 키 등을 `application.yaml`의 `${ENV:기본값}` 패턴에서 주입받는다. 자세한 흐름은 [Configuration Properties](/backend/configuration-properties)와 [환경변수·시크릿](/infra/env-and-secrets) 참고.

:::warning 구현 vs 계획
위 표의 애너테이션은 모두 **현재 구현된** 코드다. 영역 C의 자체 LLM career-strategy(폴백 캐시→규칙엔진→OpenAI→Mock)는 아직 계획 단계이며, 이때도 빈 구성은 같은 `@Service`/`@ConfigurationProperties` 패턴을 그대로 쓸 예정이다.
:::

## 5. 핵심 동작 원리 (표·작은 코드)

핵심 메커니즘은 **리플렉션(reflection)** 이다. 애너테이션 자체는 아무 동작도 하지 않는다. 프레임워크가 클래스를 스캔하면서 "이 클래스에 `@RestController`가 붙어 있나?"를 런타임에 조회하고, 붙어 있으면 그에 맞게 처리한다.

```text
[1] 부팅: 컴포넌트 스캔이 패키지를 훑는다
        ↓
[2] @RestController/@Service/@Component 발견 → 빈으로 등록 (IoC 컨테이너)
        ↓
[3] @RequiredArgsConstructor가 만든 생성자로 의존성 주입(DI)
        ↓
[4] 요청: @GetMapping("/summary") 메타데이터로 URL→메서드 라우팅
        ↓
[5] @Transactional·@Valid가 붙은 메서드는 프록시가 감싸 부가동작 수행
```

애너테이션이 언제까지 살아남는지는 `@Retention`이 정한다.

| RetentionPolicy | 살아있는 시점 | 예 |
| --- | --- | --- |
| `SOURCE` | 컴파일 시 사라짐 | `@Override`, Lombok `@Getter` |
| `CLASS` | 바이트코드까지(런타임 X) | 기본값 |
| `RUNTIME` | 런타임에 리플렉션으로 읽힘 | `@RestController`, `@Transactional` |

스프링이 동작에 쓰는 애너테이션은 거의 다 `RUNTIME`이어야 한다. 런타임에 읽지 못하면 빈 등록도 라우팅도 안 되기 때문이다. Lombok의 `@RequiredArgsConstructor`·`@Slf4j`는 성격이 다르다. 런타임이 아니라 **컴파일 시점에 실제 자바 코드(생성자, `log` 필드)를 생성**해 넣는다.

## 6. 면접 답변 3단계

- **초간단(15초):** "애너테이션은 코드에 붙이는 메타데이터입니다. `@`로 표시하면 스프링이 리플렉션으로 읽어서 컨트롤러 등록, 트랜잭션 처리 같은 동작을 대신해 줍니다."
- **기본(45초):** "선언적 프로그래밍을 가능하게 합니다. 예를 들어 제 분석 컨트롤러는 `@RestController`로 JSON 컨트롤러임을, `@GetMapping`으로 URL 매핑을, `@AuthenticationPrincipal`로 로그인 사용자 주입을 선언만 합니다. 실제 처리는 스프링이 합니다. `@Transactional`도 트랜잭션 begin/commit/rollback 보일러플레이트를 프록시로 자동화해 줍니다."
- **꼬리질문 대비(요지):** "애너테이션은 스스로 동작하지 않고, 프레임워크가 리플렉션으로 읽을 때만 의미가 생깁니다. `@Retention(RUNTIME)`이라 런타임에 읽히고, Lombok 계열은 반대로 컴파일 시 코드를 생성하는 방식이라 둘을 구분해서 설명할 수 있습니다."

## 7. 꼬리질문 + 모범답안

:::details Q1. 애너테이션과 주석(comment)의 차이는?
주석은 사람만 읽고 컴파일하면 사라져 동작에 영향이 없다. 애너테이션은 프로그램(컴파일러·프레임워크·런타임)이 읽고 동작을 바꾼다. `@Override`는 컴파일러에게, `@RestController`는 스프링에게, `@Transactional`은 런타임 프록시에게 지시를 준다.
:::

:::details Q2. 애너테이션만 붙이면 알아서 동작하나? 누가 그걸 처리하나?
아니다. 애너테이션은 표시(메타데이터)일 뿐 스스로 아무것도 안 한다. 처리 주체가 따로 있다. 스프링은 부팅 시 컴포넌트 스캔으로 `@Service` 등을 찾아 빈으로 등록하고, 요청 시 핸들러 매핑이 `@GetMapping` 정보로 라우팅한다. 이 모든 게 리플렉션으로 애너테이션을 읽기에 가능하다.
:::

:::details Q3. @Transactional은 어떻게 트랜잭션을 거나?
스프링이 해당 빈을 **프록시**로 감싼다. 메서드 호출이 들어오면 프록시가 먼저 트랜잭션을 시작하고, 본 메서드가 정상 끝나면 commit, 런타임 예외가 터지면 rollback 한다. 그래서 주의점이 있다: 같은 클래스 안에서 메서드를 self-invocation 하면 프록시를 거치지 않아 트랜잭션이 안 걸린다.
:::

:::details Q4. @RequiredArgsConstructor와 @RestController는 처리 시점이 다른가?
다르다. `@RestController`는 `RUNTIME` 리텐션이라 런타임에 스프링이 리플렉션으로 읽는다. `@RequiredArgsConstructor`(Lombok)는 `SOURCE` 단계 애너테이션 프로세서로, **컴파일 시점에** final 필드를 받는 생성자 코드를 실제로 만들어 넣는다. 그래서 컴파일된 클래스에는 Lombok 애너테이션 흔적이 남지 않는다.
:::

:::details Q5. @ConfigurationProperties는 @Value와 뭐가 다른가?
`@Value("${...}")`는 값 하나씩 주입한다. `@ConfigurationProperties(prefix=...)`는 관련 설정을 객체로 **묶어서** 타입 안전하게 바인딩한다. CareerTuner의 `CareerTunerProperties`는 `careertuner.jwt`, `careertuner.oauth` 등을 중첩 클래스로 구조화해 묶었다. 설정이 많고 그룹이 분명할 때 후자가 유지보수에 유리하다.
:::

## 8. 직접 말해보기

아래를 소리 내어 답해보고 막히면 위로 돌아가라.

1. 애너테이션과 주석의 차이를 한 문장으로 말해보라.
2. 내 `AnalysisController`에서 `@GetMapping`을 떼면 무슨 일이 생기나?
3. "애너테이션이 스스로 동작한다"는 말이 왜 틀렸는지 설명해보라.
4. `@Transactional`이 self-invocation에서 안 먹는 이유를 한 번에 설명해보라.
5. Lombok 애너테이션과 스프링 애너테이션의 처리 시점이 어떻게 다른가?

관련 페이지: [Spring Boot](/backend/spring-boot) · [MyBatis](/backend/mybatis) · [트랜잭션](/glossary/transaction) · [예외 처리](/backend/exception-handling) · [DTO](/glossary/dto) · [API 응답 엔벨로프](/glossary/api-response-envelope)

## 퀴즈

<QuizBox question="애너테이션과 주석(comment)의 가장 큰 차이는?" :choices="['둘 다 컴파일하면 사라진다', '애너테이션은 프로그램이 읽고 동작에 영향을 준다', '주석이 더 빠르게 실행된다', '애너테이션은 사람만 읽을 수 있다']" :answer="1" explanation="주석은 사람만 읽고 사라지지만, 애너테이션은 컴파일러·프레임워크·런타임이 리플렉션으로 읽어 빈 등록·트랜잭션 등 실제 동작에 영향을 준다." />

<QuizBox question="CareerTuner의 AnalysisController에서 클래스에 붙어 JSON 반환 컨트롤러로 빈 등록되게 하는 애너테이션은?" :choices="['@Service', '@RestController', '@Mapper', '@Transactional']" :answer="1" explanation="@RestController는 해당 클래스를 REST 컨트롤러(본문 JSON 직렬화)로 빈 등록한다. @Service는 비즈니스 로직, @Mapper는 MyBatis 매퍼, @Transactional은 트랜잭션 경계용이다." />

<QuizBox question="스프링이 @RestController·@Transactional 같은 애너테이션을 런타임에 읽으려면 RetentionPolicy가 무엇이어야 하며, 애너테이션 자체가 스스로 동작하지 않는다는 말은 무슨 뜻인가?" explanation="모범답안: RetentionPolicy.RUNTIME이어야 런타임에 리플렉션으로 읽힌다. 애너테이션은 메타데이터(표시)일 뿐 실행 코드가 없다. 컴포넌트 스캐너·핸들러 매핑·트랜잭션 프록시 같은 '처리 주체'가 그 표시를 읽고 대신 동작하기 때문에, 애너테이션만으로는 아무 일도 일어나지 않는다." />
