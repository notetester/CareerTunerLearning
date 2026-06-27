# 설정 관리 (@ConfigurationProperties)

> "흩어진 설정값을 application.yaml 한 곳에 모으고, 환경변수 기본값 패턴(ENV:기본값)으로 두면, 클론 직후엔 무설정 부팅·배포 땐 환경변수만 갈아끼우면 됩니다. 그 yaml의 `careertuner.*` 블록을 타입 안전한 자바 객체로 받는 게 `@ConfigurationProperties`를 단 `CareerTunerProperties`입니다."

## 1. 한 줄 정의

`@ConfigurationProperties`는 **외부 설정값(yaml/환경변수)을 접두사(prefix) 단위로 묶어, 타입이 있는 자바 객체에 자동 바인딩**해주는 Spring Boot 기능이다. CareerTuner는 `prefix = "careertuner"` 하나로 앱·JWT·메일·OAuth 설정을 한 객체에 모은다.

## 2. 단어 뜻 (약자/어원 풀이)

| 용어 | 뜻 |
| --- | --- |
| Configuration | 설정. 코드를 바꾸지 않고 동작을 바꾸는 외부 값(주소, 키, 만료시간 등) |
| Properties | 키-값 쌍의 설정 모음. 자바 전통의 `*.properties` 개념을 yaml로 확장 |
| Binding(바인딩) | yaml의 `careertuner.jwt.secret` 같은 키를 자바 필드 `jwt.secret`에 자동 연결 |
| prefix | 바인딩 시작점이 되는 접두사. `careertuner`면 `careertuner.*` 하위만 대상 |
| Relaxed Binding | `api-base-url`(yaml 케밥) ↔ `apiBaseUrl`(자바 카멜)을 알아서 매칭 |

핵심 감각: **`@Value`가 값 하나하나를 문자열로 꽂는 산탄총이라면, `@ConfigurationProperties`는 관련 값을 통째로 객체로 받는 컨테이너다.**

## 3. 왜 필요한가 (없으면 무슨 문제가 생기나)

설정을 코드에 흩어두거나 `@Value("${...}")`로 낱개로 받으면 생기는 문제:

- **하드코딩 위험**: JWT 만료시간·DB 주소·API 키가 자바 소스 곳곳에 박혀 환경마다 코드 수정·재빌드가 필요하다.
- **시크릿 유출**: 비밀번호/키가 소스에 박히면 공개 repo에서 그대로 노출된다.
- **타입 안전성 없음**: `@Value`로 받은 만료시간이 문자열이면 `1800`을 매번 파싱·검증해야 한다.
- **응집도 붕괴**: OAuth 설정 3종(카카오/네이버/구글)이 서로 다른 클래스에 흩어져 한눈에 안 보인다.
- **무설정 부팅 불가**: 기본값이 없으면 팀원이 클론하자마자 설정 파일부터 채워야 실행된다.

`@ConfigurationProperties`는 이 다섯을 한 번에 해결한다 — 값은 yaml에, 타입은 객체에, 시크릿은 환경변수에.

## 4. CareerTuner에서 어디에 썼나 (실제 클래스/파일/테이블, 영역 표시)

영역: **백엔드 공통(common, 팀장 Owner 영역)**. 핵심 파일은 다음과 같다.

| 파일 | 역할 |
| --- | --- |
| `common/config/CareerTunerProperties.java` | `@ConfigurationProperties(prefix = "careertuner")` 루트. 내부에 `App / Jwt / Mail / Oauth` 정적 중첩 클래스 |
| `resources/application.yaml` | `careertuner.*` 블록 + 모든 값이 `${ENV:기본값}` 패턴 |
| `CareerTunerApplication.java` | `@ConfigurationPropertiesScan`으로 Properties 클래스 자동 등록 |
| `common/security/JwtTokenProvider.java` | 생성자에서 `CareerTunerProperties`를 주입받아 시크릿·만료시간 사용 |

`CareerTunerProperties` 구조(축약):

```java
@Getter @Setter
@ConfigurationProperties(prefix = "careertuner")
public class CareerTunerProperties {
    private App app = new App();      // frontendUrl, apiBaseUrl
    private Jwt jwt = new Jwt();      // secret, accessTokenValiditySeconds=1800, refreshTokenValiditySeconds=1209600
    private Mail mail = new Mail();   // from, senderName, devMode=true
    private Oauth oauth = new Oauth();// kakao / naver / google (각 Provider: clientId/clientSecret/redirectUri)
}
```

:::tip 도메인별 Properties 분리
프로젝트는 `careertuner` 루트 외에도 도메인 단위로 별도 Properties 클래스를 둔다 — `OpenAiProperties`, `AnthropicProperties`, `InterviewRagProperties`, `JobPostingUploadProperties`, `CareerAnalysisAiProperties`(영역 C) 등. **공통 핵심은 `CareerTunerProperties` 하나로 모으고, 기능별 설정은 그 기능 패키지 안에서 자기 Properties로 갖는다**는 분담 원칙이다.
:::

:::warning 영역 C 입장
적합도/취업경향 분석(영역 C)은 `careertuner.analysis.ai.*` 블록을 쓴다. `provider`(openai/oss), oss `base-url`·`model`·`max-tokens` 등은 `CareerAnalysisAiProperties`로 바인딩되며, **자체 LLM(oss) 경로는 `base-url`이 비면 자동 비활성**되는 "기본값으로 안전" 설계를 따른다. 자체 모델 서빙은 아직 설계·검증 단계다.
:::

## 5. 핵심 동작 원리 (표/작은 코드/단계)

### (1) 환경변수 기본값 패턴 `${ENV:기본값}`

yaml에서 모든 민감/환경 의존 값은 이 형태로 둔다.

```yaml
careertuner:
  app:
    frontend-url: ${APP_FRONTEND_URL:http://localhost:5173}
  jwt:
    secret: ${JWT_SECRET:dev-only-please-change}   # 운영선 반드시 env로 교체
    access-token-validity-seconds: ${JWT_ACCESS_TTL:1800}    # 30분
    refresh-token-validity-seconds: ${JWT_REFRESH_TTL:1209600} # 14일
  mail:
    dev-mode: ${MAIL_DEV_MODE:true}
```

읽는 법: **`APP_FRONTEND_URL` 환경변수가 있으면 그 값을, 없으면 콜론 뒤 기본값을 쓴다.**

- **개발**: 환경변수 0개 → 커밋된 기본값으로 즉시 부팅(무설정 실행).
- **배포**: 동일 이름 환경변수만 주면 코드/파일 변경 없이 교체.
  ```bash
  DB_PASSWORD=*** JWT_SECRET=*** OAUTH_KAKAO_CLIENT_SECRET=*** java -jar app.jar
  ```

### (2) 바인딩 흐름 (부팅 시)

| 단계 | 일어나는 일 |
| --- | --- |
| 1 | `@ConfigurationPropertiesScan`이 `@ConfigurationProperties`가 붙은 클래스를 빈으로 등록 |
| 2 | yaml의 `${ENV:기본값}`이 먼저 치환되어 최종 문자열 확정 |
| 3 | `careertuner.jwt.secret` → `CareerTunerProperties.jwt.secret`로 Relaxed Binding(케밥↔카멜) |
| 4 | 타입 변환(`1800` → `long`, `true` → `boolean`)까지 자동 |
| 5 | 다른 빈이 `CareerTunerProperties`를 생성자 주입으로 받아 사용 |

### (3) 실제 사용처 — 생성자 주입

```java
public JwtTokenProvider(CareerTunerProperties props) {
    this.key = Keys.hmacShaKeyFor(
        props.getJwt().getSecret().getBytes(StandardCharsets.UTF_8));
    this.accessValiditySeconds = props.getJwt().getAccessTokenValiditySeconds();
}
```

문자열이 아니라 **타입이 있는 객체 트리**(`getJwt().getSecret()`)로 받는다는 점이 `@Value`와의 결정적 차이다.

### (4) 등록 방식 — `@ConfigurationPropertiesScan` vs `@EnableConfigurationProperties`

| 방식 | 설명 |
| --- | --- |
| `@ConfigurationPropertiesScan` | 메인 클래스에 한 번 달면 패키지 내 모든 Properties 자동 등록(이 프로젝트 방식) |
| `@EnableConfigurationProperties(X.class)` | 클래스를 명시적으로 하나씩 등록 |
| `@Component` 부착 | Properties 클래스에 직접 빈 어노테이션을 다는 방식 |

## 6. 면접 답변 3단계 (초간단 1문장 / 기본 / 꼬리질문 대응)

- **초간단(10초)**: "yaml 설정을 prefix 단위로 타입 있는 자바 객체에 자동 바인딩하는 Spring Boot 기능이고, 저희는 `careertuner` prefix로 앱·JWT·메일·OAuth 설정을 `CareerTunerProperties`에 모았습니다."

- **기본(30초)**: "값은 `application.yaml`에 `${ENV:기본값}` 패턴으로 둬서, 개발자는 클론 직후 무설정으로 부팅하고 배포 땐 같은 이름의 환경변수만 주면 코드 수정 없이 교체됩니다. `@Value`로 낱개로 받지 않고 `@ConfigurationProperties`로 관련 설정을 한 객체로 묶어, `JwtTokenProvider` 같은 빈이 생성자로 주입받아 `props.getJwt().getSecret()`처럼 타입 안전하게 씁니다."

- **꼬리질문 대응(1분)**: "메인 클래스의 `@ConfigurationPropertiesScan`이 Properties 클래스를 자동 빈 등록하고, 바인딩은 케밥-카멜을 알아서 매칭하는 Relaxed Binding으로 동작합니다. 시크릿은 절대 소스에 박지 않고 환경변수로 주입하며, 공통 핵심 설정만 `CareerTunerProperties`에 모으고 OpenAI·면접 RAG 같은 기능별 설정은 각 도메인 패키지의 자기 Properties로 분리해 응집도를 지킵니다."

## 7. 자주 나오는 꼬리질문 + 모범답안 (3~5개)

:::details Q1. `@Value`와 `@ConfigurationProperties`의 차이는?
`@Value`는 값 하나를 `String`/`int` 등으로 꽂는 방식이라 관련 값이 여러 빈에 흩어지고 타입·검증이 약하다. `@ConfigurationProperties`는 prefix로 묶인 값들을 **타입 있는 객체 트리**로 한 번에 받아 응집도·타입 안전성·테스트 용이성이 높다. CareerTuner의 OAuth처럼 카카오/네이버/구글이 각각 clientId/clientSecret/redirectUri를 갖는 **계층 구조**엔 `@ConfigurationProperties`가 압도적으로 적합하다.
:::

:::details Q2. 시크릿(비밀번호·API 키)은 어떻게 관리하나?
소스에 박지 않고 `${ENV:기본값}` 패턴으로 둬서, 운영 환경에선 환경변수로만 주입한다. 예: `JWT_SECRET`, `OPENAI_API_KEY`, `OAUTH_KAKAO_CLIENT_SECRET`. 개발 기본값은 명백히 "개발 전용"임을 표시(예: `dev-only-...-change-in-production`)하고, OAuth `isConfigured()`처럼 placeholder(`CHANGEME`)면 미설정으로 간주하는 가드를 둔다. 추가로 CI의 deploy-demo 단계에서 빌드 산출물에 시크릿 패턴이 섞였는지 스캔한다.
:::

:::details Q3. 환경변수 기본값 패턴의 장단점은?
장점은 **무설정 부팅**(클론 즉시 실행)과 **코드 무변경 배포**(env만 교체). 단점은 비공개 repo가 아니면 커밋된 기본값이 곧 유출이라는 점 — 그래서 실제 시크릿 기본값은 두지 않고 placeholder/빈 문자열로 둔다. 또 환경별 차이가 커지면 `application-prod.yaml` 같은 **프로파일 분리**로 가는 게 정석이다.
:::

:::details Q4. `@ConfigurationProperties` 객체를 어떻게 빈으로 등록하나?
세 가지 — (1) 메인 클래스에 `@ConfigurationPropertiesScan`(이 프로젝트), (2) `@EnableConfigurationProperties(X.class)`로 명시 등록, (3) Properties 클래스에 `@Component` 직접 부착. 이 프로젝트는 도메인별 Properties가 많아 스캔 방식이 보일러플레이트를 줄여준다.
:::

:::details Q5. 바인딩한 설정값을 검증할 수 있나?
가능하다. Properties 클래스에 `@Validated`를 달고 필드에 `@NotBlank`/`@Min` 등 Jakarta Validation을 붙이면 부팅 시점에 잘못된 설정을 즉시 실패시킬 수 있다(fail-fast). CareerTuner는 코드 레벨 가드(예: `Oauth.Provider.isConfigured()`로 clientId가 비었거나 `CHANGEME`면 미설정 처리)로 같은 효과를 낸다. 관련 입력 검증 개념은 [DTO](/glossary/dto)·[Validation](/backend/validation) 참고.
:::

## 8. 직접 말해보기 (말하기 훈련용 질문 1~2개)

1. 화이트보드 없이 30초 안에: "`${ENV:기본값}` 패턴이 개발과 배포에서 각각 어떻게 동작하는지"를 `JWT_SECRET` 예시로 설명해보라.
2. "왜 OAuth 설정을 `@Value` 9개로 받지 않고 `Oauth → Provider × 3` 중첩 객체로 모았는가?"를 응집도·타입 안전성 키워드로 답해보라.

## 퀴즈

<QuizBox question="application.yaml의 ${APP_FRONTEND_URL:http://localhost:5173} 에서 환경변수 APP_FRONTEND_URL이 설정되지 않았을 때 실제 사용되는 값은?" :choices="['빈 문자열', '애플리케이션 부팅 실패', 'http://localhost:5173 (콜론 뒤 기본값)', 'null']" :answer="2" explanation="ENV:기본값 패턴에서 환경변수가 없으면 콜론 뒤 기본값이 쓰인다. 덕분에 클론 직후 무설정 부팅이 가능하다." />

<QuizBox question="@ConfigurationProperties(prefix=careertuner)의 yaml 키 careertuner.app.api-base-url 이 자바 필드 apiBaseUrl 로 매핑되는 메커니즘 이름은?" :choices="['Reflection Binding', 'Relaxed Binding', 'Lazy Binding', 'Strict Binding']" :answer="1" explanation="Relaxed Binding이 케밥 케이스(api-base-url)와 카멜 케이스(apiBaseUrl)를 자동으로 매칭한다." />

<QuizBox question="JWT 시크릿이나 OAuth client-secret 같은 민감값을 application.yaml에 다룰 때 이 프로젝트가 택한 방식과 그 이유를 설명하라." explanation="실제 시크릿 값을 소스에 박지 않고 ${ENV:기본값} 패턴으로 둬서, 개발에서는 명백히 개발 전용임을 표시한 기본값이나 빈 문자열/placeholder(CHANGEME)로 무설정 부팅을 지원하고, 운영에서는 동일 이름의 환경변수(JWT_SECRET 등)로만 주입한다. 이러면 코드 수정·재빌드 없이 환경만 교체할 수 있고, placeholder 가드(isConfigured)로 미설정을 안전하게 감지하며, CI의 빌드 산출물 시크릿 스캔으로 유출을 한 번 더 막는다." />
