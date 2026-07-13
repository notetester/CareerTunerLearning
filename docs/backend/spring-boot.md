# Spring Boot

> Spring Boot는 Spring 프레임워크를 "설정 없이 바로 실행되는 서버"로 만들어주는 도구이고, CareerTuner 백엔드는 Spring Boot 4.1.0 + Java 21로 만든 REST API 서버다.

## 1. 한 줄 정의

Spring Boot는 **Spring 프레임워크에 자동 설정(auto-configuration), 내장 웹 서버, 스타터 의존성을 얹어서, `main()` 하나로 바로 실행되는 독립 서버 애플리케이션을 만들게 해주는 프레임워크**다.

핵심을 분리하면 이렇다.

| 구분 | 무엇 |
| --- | --- |
| **Spring** | 객체(빈) 생성·연결을 컨테이너가 대신 해주는 DI/IoC 프레임워크 |
| **Boot** | 그 Spring을 "설정 자동 + 톰캣 내장 + 스타터" 로 즉시 돌게 포장한 것 |

## 2. 단어 뜻 (약자/어원 풀이)

- **Spring**: 자바 진영의 대표 백엔드 프레임워크. 무거웠던 J2EE(EJB) 시대를 "가볍게(spring처럼 가뿐하게)" 풀어주자는 의미에서 출발.
- **Boot**: "bootstrap(부트스트랩)"에서 온 말. 신발끈(bootstrap)을 스스로 당겨 신는다 → **외부 도움 없이 스스로 기동(self-start)** 한다는 뜻. 그래서 별도 톰캣 설치/배포(WAR) 없이 `java -jar`로 바로 뜬다.
- **DI (Dependency Injection, 의존성 주입)**: 객체가 필요로 하는 다른 객체를 내가 직접 `new` 하지 않고, 컨테이너가 만들어서 넣어준다.
- **IoC (Inversion of Control, 제어의 역전)**: 객체 생성·생명주기 제어권을 내 코드가 아니라 프레임워크가 갖는다. DI는 IoC를 구현하는 한 방식.

:::tip 30초 암기
"Spring = 객체를 대신 만들어 연결해주는 DI/IoC 컨테이너. Boot = 그걸 자동설정 + 내장톰캣 + 스타터로 바로 실행되게 포장한 것."
:::

## 3. 왜 필요한가 (없으면 무슨 문제가 생기나)

순수 Spring만 쓰던 시절의 고통을 알면 Boot의 가치가 보인다.

| Boot 없으면 | Boot 있으면 |
| --- | --- |
| XML/자바 설정으로 DataSource, 트랜잭션, 디스패처서블릿을 일일이 등록 | 의존성만 추가하면 **자동 설정**이 합리적 기본값으로 등록 |
| 외부 Tomcat 설치 → WAR 빌드 → 배포 | **내장 Tomcat** 포함, `java -jar` 한 방 / `bootRun` |
| 라이브러리 버전 궁합 직접 맞춤 (버전 지옥) | **스타터 + BOM**이 검증된 버전 세트를 묶어줌 |
| 운영 모니터링/헬스체크 직접 구현 | Actuator 등으로 표준 제공 |

CareerTuner처럼 6명이 수직 분담해서 빠르게 기능을 쌓아 올리는 프로젝트에서, "설정에 시간 안 쓰고 비즈니스 로직에 집중" 하게 해주는 게 Boot의 핵심 가치다.

## 4. CareerTuner에서 어디에 썼나

CareerTuner 백엔드 전체가 Spring Boot 위에서 돈다. (영역: 백엔드 공통, Owner 팀장 / 본인=영역 C도 이 토대 위에서 AI 분석 기능을 얹음)

**진입점** — `backend/src/main/java/com/careertuner/CareerTunerApplication.java`

```java
@SpringBootApplication            // 자동설정 + 컴포넌트 스캔 + @Configuration 한 번에
@ConfigurationPropertiesScan      // @ConfigurationProperties 클래스 스캔 (CareerTunerProperties)
public class CareerTunerApplication {
    public static void main(String[] args) {
        SpringApplication.run(CareerTunerApplication.class, args);
    }
}
```

**버전·런타임** — `backend/build.gradle`

| 항목 | 값 |
| --- | --- |
| Spring Boot 플러그인 | `org.springframework.boot` **4.0.6** |
| 의존성 관리 | `io.spring.dependency-management` (BOM 버전 정렬) |
| Java toolchain | **21** |
| 실행 포트 | 8080 (`/api/**` 하위 컨트롤러) |

**실제로 쓰는 스타터들** (build.gradle 발췌, 자동설정의 출발점)

| 스타터 | 무엇을 자동 켜주나 | CareerTuner에서 쓰는 곳 |
| --- | --- | --- |
| `spring-boot-starter-webmvc` | 내장 Tomcat + DispatcherServlet + Jackson | 모든 `@RestController`, `ApiResponse` 엔벨로프 |
| `spring-boot-starter-jdbc` | DataSource/트랜잭션 | MyBatis가 이 위에 얹힘 (JPA 금지) |
| `mybatis-spring-boot-starter` | `@Mapper` 스캔 + SqlSession | `resources/mapper/**/*.xml` 매퍼 |
| `spring-boot-starter-security` | 시큐리티 필터 체인 | `SecurityConfig`, `JwtAuthenticationFilter` |
| `spring-boot-starter-validation` | Jakarta Validation | DTO의 `@Valid`, `@NotBlank`, `@Size` |
| `spring-boot-starter-mail` | JavaMailSender | 이메일 인증·비밀번호 재설정 메일 |
| `springdoc-openapi-starter-webmvc-ui` | Swagger UI 자동 노출 | `/swagger-ui.html` API 문서 |
| `langchain4j-...-spring-boot4-starter` | `@AiService` 스캔, Ollama 오토컨피그 | 로컬 LLM(FaqDraftAiClient 등) |

:::warning Spring Boot 4 주의점
이 프로젝트는 **Boot 4**라서 LangChain4j도 Boot 3용(`-spring-boot-starter`)이 아니라 **`-spring-boot4-starter`** 를 써야 한다. build.gradle 주석에도 명시돼 있다. 면접에서 "Boot 버전 올렸을 때 뭐가 깨지나" 물으면 이 의존성 호환성 얘기를 꺼내면 좋다.
:::

## 5. 핵심 동작 원리 (3대 기둥)

Boot의 마법은 사실 세 가지로 요약된다.

**1) 자동 설정 (Auto-configuration)**
`@SpringBootApplication` 안에는 `@EnableAutoConfiguration`이 들어있다. 부팅 시 클래스패스를 보고 "MySQL 드라이버가 있네 → DataSource 만들자", "Security 스타터가 있네 → 필터체인 켜자" 식으로 **조건부(@ConditionalOn...)** 빈을 자동 등록한다. 우리가 설정을 명시하면 그게 자동설정을 덮어쓴다(=오버라이드).

**2) 내장 웹 서버 (Embedded Tomcat)**
webmvc 스타터가 Tomcat을 라이브러리로 포함한다. 그래서 외부 톰캣 설치 없이 `SpringApplication.run`이 톰캣을 띄우고 8080을 연다. 배포 시 `bootJar`로 만든 **실행 가능한 fat JAR** 하나면 끝 (Dockerfile도 JRE21에 이 JAR만 얹는 멀티스테이지).

**3) 스타터 + BOM (Starter Dependencies)**
`starter-*` 의존성 하나가 "그 기능에 필요한 라이브러리 묶음 + 검증된 버전"을 끌어온다. `dependency-management` 플러그인이 BOM으로 버전을 정렬해줘서 버전 충돌을 줄인다.

**부팅 순서 한눈에**

```text
java -jar (또는 gradlew bootRun)
  → main() 실행 → SpringApplication.run()
  → 컴포넌트 스캔(@Controller/@Service/@Mapper 빈 등록)
  → 자동설정으로 DataSource·SecurityFilterChain·DispatcherServlet 구성
  → DI로 빈끼리 연결 (생성자 주입, @RequiredArgsConstructor)
  → 내장 Tomcat 기동, 8080 listen → 요청 받을 준비 완료
```

**DI/IoC가 실제 코드에서 보이는 모습** — CareerTuner는 생성자 주입을 쓴다.

```java
@Service
@RequiredArgsConstructor   // final 필드를 받는 생성자를 Lombok이 생성 → Boot가 주입
public class SomeService {
    private final SomeMapper mapper;   // new 안 함. 컨테이너가 넣어줌
}
```

## 6. 면접 답변 3단계

- **초간단(1문장)**: "Spring Boot는 Spring을 자동설정·내장톰캣·스타터로 포장해서 `main()` 하나로 바로 뜨는 서버를 만들게 해주는 프레임워크입니다."
- **기본**: "CareerTuner 백엔드는 Spring Boot 4.1.0, Java 21로 만든 REST API 서버입니다. `@SpringBootApplication`이 붙은 진입점에서 컴포넌트 스캔과 자동설정이 돌고, webmvc 스타터의 내장 Tomcat이 8080을 엽니다. DI 컨테이너가 controller→service→mapper 빈을 생성자 주입으로 연결합니다."
- **꼬리질문 대응**: "영속성은 JPA 대신 MyBatis 스타터만 쓰고, 응답은 `ApiResponse` 엔벨로프로 통일했습니다. 보안은 security 스타터 위에 JWT 필터를 얹었고, 자동설정이 합리적 기본값을 깔아주되 우리가 명시한 `SecurityConfig` 같은 설정이 그걸 오버라이드합니다."

## 7. 자주 나오는 꼬리질문 + 모범답안

:::details Q1. 자동 설정(auto-configuration)은 정확히 어떻게 동작하나요?
부팅 시 클래스패스에 어떤 라이브러리가 있는지를 보고, `@ConditionalOnClass` / `@ConditionalOnMissingBean` 같은 조건 어노테이션으로 빈을 등록할지 결정합니다. 예를 들어 MySQL 드라이버와 jdbc 스타터가 있으면 DataSource를, security 스타터가 있으면 기본 필터체인을 자동 구성합니다. 내가 같은 타입의 빈을 직접 정의하면 `@ConditionalOnMissingBean` 덕분에 자동설정이 비켜서고 내 설정이 우선됩니다.
:::

:::details Q2. Spring과 Spring Boot의 차이는?
Spring은 DI/IoC 컨테이너와 MVC·트랜잭션 같은 기능을 제공하는 프레임워크 자체이고, Boot는 그 Spring을 "설정 자동화 + 내장 서버 + 스타터"로 감싼 도구입니다. Boot를 쓴다고 Spring을 안 쓰는 게 아니라, Spring 위에서 보일러플레이트 설정을 없애주는 레이어입니다.
:::

:::details Q3. 내장 톰캣을 쓰면 뭐가 좋고 단점은?
장점은 외부 WAS 설치·배포가 필요 없어 `java -jar` 하나로 실행되고, 환경마다 톰캣 버전이 달라지는 문제가 없어 컨테이너 배포(Docker)에 잘 맞습니다. 단점은 한 JAR에 서버가 박혀 있어 서버 단독 튜닝/공유가 어렵고, 여러 앱을 한 톰캣에 올리는 전통적 구성은 안 맞습니다. CareerTuner는 Docker Compose로 배포하므로 내장 방식이 이득입니다.
:::

:::details Q4. 왜 JPA 대신 MyBatis 스타터를 썼나요?
복잡한 동적 쿼리와 조인이 많은 분석 기능(적합도·경향 분석 등)에서 SQL을 직접 제어하는 게 유리하다고 판단했습니다. Boot는 `mybatis-spring-boot-starter`로 MyBatis도 자동설정해주므로, jdbc 스타터 위에 `@Mapper` 인터페이스와 XML 매퍼를 얹는 구조를 씁니다. 팀 규칙으로 JPA는 의존성에서 의도적으로 제외했습니다.
:::

:::details Q5. @SpringBootApplication 하나에 뭐가 들어있나요?
세 어노테이션의 합성입니다. `@Configuration`(설정 클래스), `@ComponentScan`(이 패키지 하위 빈 자동 스캔), `@EnableAutoConfiguration`(자동설정 활성화). CareerTuner는 여기에 `@ConfigurationPropertiesScan`을 더해 `CareerTunerProperties` 같은 `@ConfigurationProperties` 설정 객체를 스캔합니다.
:::

## 8. 직접 말해보기

1. "CareerTuner 백엔드의 부팅 순서를 `main()`부터 8080 listen까지 30초 안에 말로 설명해보세요." (자동설정·컴포넌트스캔·내장톰캣 단어가 나와야 함)
2. "면접관이 '왜 굳이 Boot를 썼냐, 순수 Spring으로는 안 됐냐'고 물으면 뭐라고 답할지 한 문단으로 말해보세요."

연관 개념: [DI/IoC](/glossary/di-ioc) · [MyBatis](/backend/mybatis) · [ApiResponse 엔벨로프](/glossary/api-response-envelope) · [JWT 시큐리티](/backend/jwt-security)

## 퀴즈

<QuizBox question="Spring Boot의 'Boot'가 의미하는 바로 가장 정확한 것은?" :choices="['부팅 속도가 빠르다는 뜻', 'bootstrap에서 온 말로 외부 도움 없이 스스로 기동한다는 뜻', '컴퓨터를 재부팅한다는 뜻', '신발 브랜드 이름']" :answer="1" explanation="Boot는 bootstrap(부트스트랩)에서 온 말로, 내장 톰캣 덕분에 외부 WAS 없이 스스로 기동(self-start)한다는 의미입니다." />

<QuizBox question="CareerTuner 백엔드에서 @SpringBootApplication이 붙은 진입점 클래스와, 이 어노테이션이 합성하고 있는 세 가지 어노테이션을 설명해보세요." explanation="진입점은 CareerTunerApplication 클래스이며 main()에서 SpringApplication.run()을 호출합니다. @SpringBootApplication은 @Configuration(설정 클래스), @ComponentScan(하위 패키지 빈 자동 스캔), @EnableAutoConfiguration(클래스패스 기반 자동설정)의 합성 어노테이션입니다. CareerTuner는 추가로 @ConfigurationPropertiesScan으로 CareerTunerProperties 같은 설정 객체를 스캔합니다." />

<QuizBox question="CareerTuner가 영속성 계층에서 JPA를 쓰지 않고 선택한 기술과, Spring Boot가 그것을 어떻게 지원하는지 설명해보세요." explanation="MyBatis만 사용합니다(JPA는 의존성에서 의도적 제외). Spring Boot는 jdbc 스타터로 DataSource를 자동설정하고, 그 위에 mybatis-spring-boot-starter가 @Mapper 인터페이스 스캔과 SqlSession을 자동 구성합니다. 매핑은 resources/mapper 하위 XML로 작성하고 map-underscore-to-camel-case 설정으로 컬럼명을 카멜케이스에 매핑합니다." />
