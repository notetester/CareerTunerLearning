# 의존성 주입(DI)과 IoC, Bean

> 객체가 필요한 부품을 스스로 `new`로 만들지 않고, 스프링 컨테이너가 만들어서 넣어주는 구조다. 그래서 코드가 부품 교체에 흔들리지 않고 테스트하기 쉬워진다.

## 1. 한 줄 정의

- **IoC(제어의 역전)**: 객체의 생성과 연결을 내 코드가 아니라 **프레임워크(스프링 컨테이너)** 가 담당하게 뒤집은 설계 원칙.
- **DI(의존성 주입)**: 한 객체가 필요로 하는 다른 객체(의존성)를 **외부에서 넣어주는** 방식. IoC를 실제로 구현하는 대표 기법.
- **Bean(빈)**: 스프링 컨테이너가 생성·관리·주입하는 객체. CareerTuner의 `@Service`, `@Component`, `@Configuration`의 `@Bean` 결과물이 전부 빈이다.

## 2. 단어 뜻 (약자·어원)

| 용어 | 풀이 | 핵심 뉘앙스 |
| --- | --- | --- |
| IoC | Inversion of Control (제어의 역전) | "내가 호출"에서 "프레임워크가 나를 호출/조립"으로 흐름이 뒤집힘 |
| DI | Dependency Injection (의존성 주입) | 의존 객체를 직접 만들지 않고 **주입받음** |
| Bean | (스프링) 컨테이너가 관리하는 객체 | 자바 표준 JavaBeans에서 유래, 스프링이 생명주기까지 관리 |
| 컨테이너 | IoC Container / ApplicationContext | 빈을 담아두고 의존 관계를 엮어주는 객체 저장소 |

- "역전(Inversion)"의 기준은 **제어 흐름**이다. 일반 코드는 내가 `new`로 부품을 만들고 호출한다. IoC에서는 컨테이너가 부품을 만들어 내 생성자에 끼워 넣어준다. 호출의 주도권이 넘어갔다는 뜻이다.
- DI는 IoC를 구현하는 한 가지 방법일 뿐이다. 그래서 "IoC가 원칙, DI가 그 구현"이라고 외워두면 면접 꼬리질문에서 흔들리지 않는다.

## 3. 왜 필요한가 (없으면 무슨 문제가 생기나)

부품을 직접 `new`로 만들면 다음 문제가 생긴다.

```java
// 안티패턴: 서비스가 협력 객체를 직접 생성
public class ProfileServiceImpl {
    private final ProfileMapper profileMapper = new ProfileMapper();      // 구현체에 강결합
    private final ProfileAiService aiService = new OpenAiProfileAiService(); // 교체 불가
}
```

- **강결합**: 서비스가 특정 구현체(`OpenAiProfileAiService`)를 직접 알아버린다. 규칙 기반/Mock으로 갈아끼우려면 코드를 고쳐야 한다.
- **테스트 불가**: 테스트에서 가짜 `Mapper`나 가짜 AI를 넣을 길이 없다. 진짜 DB·진짜 OpenAI가 떠야만 테스트가 돈다.
- **객체 관리 중복**: 누가 언제 만들고 닫는지, 싱글톤인지 매번 손으로 챙겨야 한다.

DI를 쓰면 의존성을 **인터페이스로 받고 외부에서 주입**하므로, 위 세 문제가 한 번에 풀린다. 이건 [4계층 구조](/glossary/layered-architecture)에서 각 층이 아래 층의 인터페이스만 의존하게 만드는 기반이기도 하다.

## 4. CareerTuner에서 어디에 썼나 (실제 근거)

CareerTuner 백엔드는 빈 등록과 DI를 전 영역에서 표준으로 쓴다. 모두 실제 클래스 기준이다.

| 용도 | 실제 파일/클래스 | 어노테이션 |
| --- | --- | --- |
| 서비스 빈 + 생성자 주입 | `profile/service/ProfileServiceImpl` | `@Service` + `@RequiredArgsConstructor` |
| 컴포넌트 빈(필터) | `common/security/JwtAuthenticationFilter` | `@Component` + `@RequiredArgsConstructor` |
| 설정 클래스의 수동 빈 | `common/config/SecurityConfig` | `@Configuration` + `@Bean` |
| 매퍼 빈(인터페이스) | `profile/mapper/ProfileMapper` 등 | `@Mapper` (MyBatis가 프록시 빈 생성) |

`ProfileServiceImpl`은 다섯 개 협력 객체를 전부 `final` 필드로 두고 생성자로 주입받는다.

```java
@Service
@RequiredArgsConstructor          // final 필드만 받는 생성자를 Lombok이 생성
public class ProfileServiceImpl implements ProfileService {
    private final ProfileMapper profileMapper;            // MyBatis 매퍼 빈
    private final ApplicationCaseMapper applicationCaseMapper;
    private final ConsentService consentService;
    private final ProfileAiService profileAiService;      // 인터페이스 → 구현 교체 가능
    private final ObjectMapper objectMapper;              // Jackson 빈
}
```

여기서 `profileAiService` 타입이 **인터페이스**라는 점이 핵심이다. 구현은 `OpenAiProfileAiService`(실 호출)와 `RuleBasedProfileAiService`(규칙 기반)가 둘 다 존재하고, 스프링이 어떤 빈을 주입할지 결정한다. 이게 C 영역에서 계획한 **폴백 전략(캐시 → 규칙엔진 → OpenAI → Mock)** 을 코드 수정 없이 빈 구성으로 갈아끼울 수 있는 토대다. → [자체 LLM 전략](/ai/self-llm-strategy)

`SecurityConfig`는 직접 만들 수 없는 프레임워크 객체를 `@Bean`으로 등록한 사례다. `SecurityFilterChain`, `PasswordEncoder`(BCrypt), `CorsConfigurationSource`를 메서드로 만들어 반환하면, 컨테이너가 이를 빈으로 등록하고 필요한 곳(예: 로그인 서비스가 `PasswordEncoder`)에 주입한다. → [JWT 보안](/backend/jwt-security)

:::tip 왜 `@Service`로 충분한가
`@Service`, `@Component`, `@RestController`, `@Configuration`는 모두 `@Component`의 특수화다. 스프링이 컴포넌트 스캔으로 이들을 찾아 빈으로 등록한다. 의미를 드러내려고 계층별로 다른 이름을 쓸 뿐 등록 메커니즘은 같다.
:::

## 5. 핵심 동작 원리 (표·작은 코드)

주입 방식은 세 가지이고, CareerTuner는 **생성자 주입**으로 통일한다.

| 방식 | 코드 표식 | 평가 |
| --- | --- | --- |
| 생성자 주입 | 생성자 파라미터 (`@RequiredArgsConstructor`) | 권장. `final` 보장, 불변, 테스트·순환참조 감지 유리 |
| 필드 주입 | `@Autowired` 필드 | 비권장. `final` 불가, 테스트 시 주입 어려움 |
| 세터 주입 | `@Autowired` setter | 선택적 의존성에만 가끔 사용 |

생성자 주입의 동작 순서:

```text
1. 컨테이너 부팅 → @Component/@Service/@Bean 스캔
2. 빈 정의 등록 (이름·타입·의존 목록)
3. 의존 그래프 분석 → 생성 순서 결정
4. 생성자 호출하며 필요한 빈을 인자로 주입
5. 완성된 빈을 ApplicationContext에 보관(기본 싱글톤)
```

:::details 생성자 주입이 테스트를 살리는 방식
테스트에서는 컨테이너 없이도 생성자에 가짜 객체를 넣어 바로 만들 수 있다.

```java
// 진짜 DB·진짜 OpenAI 없이 단위 테스트
var fakeMapper = mock(ProfileMapper.class);
var fakeAi = mock(ProfileAiService.class);
var service = new ProfileServiceImpl(fakeMapper, ..., fakeAi, new ObjectMapper());
```

필드 주입이었다면 `private` 필드라 외부에서 넣을 수 없어 리플렉션이나 스프링 컨텍스트가 필요했을 것이다.
:::

## 6. 면접 답변 3단계 (초간단 / 기본 / 꼬리질문)

- **초간단**: "객체가 필요한 부품을 직접 만들지 않고 스프링이 만들어 넣어주는 구조입니다. 그 부품을 빈이라 부릅니다."
- **기본**: "IoC는 객체 생성·연결의 제어권을 컨테이너로 넘기는 원칙이고, DI는 그걸 구현하는 기법으로 의존성을 외부에서 주입합니다. CareerTuner는 `@Service` + `@RequiredArgsConstructor`로 생성자 주입을 표준화했고, 협력 객체를 `final` 인터페이스로 받아 결합도를 낮췄습니다."
- **꼬리질문 대비**: "예를 들어 `ProfileServiceImpl`은 `ProfileAiService` 인터페이스를 주입받는데, 구현체가 OpenAI/규칙기반 둘이라 빈 구성만 바꾸면 호출 코드 수정 없이 교체됩니다. 직접 만들 수 없는 `PasswordEncoder` 같은 객체는 `SecurityConfig`에서 `@Bean`으로 등록합니다."

## 7. 꼬리질문 + 모범답안

:::details Q1. IoC와 DI의 차이를 한 문장으로?
IoC는 "제어권을 프레임워크로 역전한다"는 **원칙**이고, DI는 그 원칙을 "의존성을 외부에서 주입한다"로 **구현한 기법**입니다. DI 외에 서비스 로케이터 같은 다른 IoC 구현도 있습니다.
:::

:::details Q2. 왜 생성자 주입을 쓰나? 필드 주입의 문제는?
생성자 주입은 의존성을 `final`로 둘 수 있어 객체가 불변이 되고, 주입 누락 시 컴파일/기동 단계에서 바로 드러나며, 테스트에서 가짜 객체를 생성자로 쉽게 넣을 수 있습니다. 필드 주입은 `final`이 불가하고 순환참조를 기동 시점에 숨기며 테스트가 어렵습니다. CareerTuner는 그래서 `@RequiredArgsConstructor`로 생성자 주입을 강제합니다.
:::

:::details Q3. `@RequiredArgsConstructor`가 정확히 뭘 해주나?
Lombok이 `final`(또는 `@NonNull`) 필드만 인자로 받는 생성자를 자동 생성합니다. 스프링은 생성자가 하나면 `@Autowired` 없이도 그 생성자로 주입하므로, 두 어노테이션 조합만으로 보일러플레이트 없는 생성자 주입이 완성됩니다.
:::

:::details Q4. 같은 인터페이스 구현체가 둘이면 어떤 빈이 주입되나?
타입만으로 모호하면 스프링은 주입에 실패합니다. 해결책은 `@Primary`로 기본 구현을 지정하거나, `@Qualifier`로 이름을 명시하거나, `@ConditionalOnProperty` 같은 조건으로 환경별 한 개만 빈 등록하는 것입니다. CareerTuner의 OpenAI/규칙기반/Mock 교체 전략이 바로 이 방식 위에 설계됩니다.
:::

:::details Q5. 빈의 기본 스코프는? 싱글톤이면 동시성 문제는 없나?
기본 스코프는 싱글톤(컨테이너당 1개)입니다. 그래서 빈은 상태 없이(stateless) 설계해야 안전합니다. CareerTuner의 서비스들도 필드는 주입받은 협력 객체뿐이고 요청별 가변 상태를 두지 않아 단일 인스턴스를 여러 요청이 공유해도 문제가 없습니다.
:::

## 8. 직접 말해보기

- `ProfileServiceImpl`이 `ProfileMapper`를 `new`로 만들지 않고 주입받음으로써 얻는 이점 3가지를 말해보기.
- IoC·DI·Bean을 각각 한 문장으로, 서로의 관계까지 엮어 설명해보기.
- `@Bean`(수동 등록)과 `@Service`(컴포넌트 스캔)를 언제 각각 쓰는지, `SecurityConfig`의 `PasswordEncoder`를 예로 설명해보기.

## 퀴즈

<QuizBox question="IoC(제어의 역전)에서 '역전'되는 것은 무엇인가?" :choices="['데이터가 흐르는 방향', '객체 생성·연결의 제어권', 'HTTP 요청과 응답의 순서', 'DB 트랜잭션의 커밋 시점']" :answer="1" explanation="IoC는 객체의 생성과 연결(제어권)을 내 코드가 아니라 프레임워크 컨테이너가 갖도록 뒤집는 원칙이다." />

<QuizBox question="CareerTuner가 @Service에 @RequiredArgsConstructor를 함께 붙여 얻는 것은?" :choices="['필드 주입 자동화', 'final 필드 기반 생성자 주입', '트랜잭션 자동 롤백', 'JSON 직렬화']" :answer="1" explanation="@RequiredArgsConstructor는 final 필드만 받는 생성자를 만들고, 스프링은 단일 생성자로 의존성을 주입한다 — 즉 생성자 주입이 완성된다." />

<QuizBox question="직접 인스턴스화할 수 없는 PasswordEncoder(BCrypt)를 SecurityConfig에서 빈으로 등록할 때 쓰는 어노테이션은 무엇이며, 컴포넌트 스캔(@Service) 대신 이 방식을 쓰는 이유를 한 문장으로 설명하라." explanation="@Configuration 클래스 안의 @Bean 메서드로 등록한다. PasswordEncoder처럼 우리가 소스를 소유하지 않거나 생성 과정에 설정 코드가 필요한 객체는 @Service로 스캔할 수 없으므로, 메서드에서 직접 만들어 반환하고 그 반환값을 컨테이너가 빈으로 관리하게 한다." />
