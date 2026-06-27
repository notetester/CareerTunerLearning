# API 문서화 (springdoc / Swagger)

> springdoc가 Spring 컨트롤러를 스캔해 OpenAPI 스펙(JSON)을 자동 생성하고, Swagger UI(`/swagger-ui.html`)로 브라우저에서 바로 호출까지 해볼 수 있게 해주는 도구입니다. 프론트와 백엔드가 합의하는 "계약 문서"를 코드와 항상 동기화시키는 게 핵심입니다.

## 1. 한 줄 정의

**OpenAPI**는 REST API를 기계가 읽을 수 있게 기술하는 표준 스펙(JSON/YAML)이고, **Swagger UI**는 그 스펙을 사람이 보고 직접 호출할 수 있게 그려주는 웹 화면이며, **springdoc**은 Spring Boot 컨트롤러를 런타임에 스캔해 그 스펙을 자동으로 만들어주는 라이브러리입니다.

## 2. 단어 뜻 (약자/어원 풀이)

| 용어 | 풀이 | 메모 |
| --- | --- | --- |
| OpenAPI | "Open" + "API". 원래 이름이 **Swagger Specification**이었는데, 2016년 스펙이 Linux Foundation에 기증되면서 **OpenAPI Specification(OAS)** 으로 개명됨 | 스펙 = OpenAPI, 도구 = Swagger |
| Swagger | OpenAPI를 둘러싼 도구 모음(Swagger UI, Swagger Editor 등)의 브랜드명 | UI는 그대로 "Swagger UI" |
| springdoc | "Spring" + "doc(umentation)". Spring Boot에 OpenAPI를 붙여주는 라이브러리 | 옛 `springfox`의 후속 |
| OAS | OpenAPI Specification | 스펙 자체를 가리킴 |

:::tip 한 문장 정리
**스펙(명사) = OpenAPI, 도구(브랜드) = Swagger, Spring에 연결하는 글루 = springdoc.** 면접에서 이 셋을 구분해 말하면 깊이가 드러납니다.
:::

## 3. 왜 필요한가 (없으면 무슨 문제가 생기나)

API 문서가 자동화되지 않으면 다음 문제가 생깁니다.

- **문서와 코드가 따로 논다.** 별도 위키/노션에 API를 손으로 적으면 코드가 바뀔 때마다 누군가 갱신해야 하고, 거의 항상 누락됨. springdoc은 컨트롤러 코드가 곧 문서라서 빌드만 하면 최신 상태가 됨.
- **프론트가 백엔드 응답 모양을 추측하게 됨.** CareerTuner는 6명이 수직 분담(A~F)이라 프론트(F 등)와 AI 백엔드(C)가 다른 사람임. 합의된 **계약 문서**가 없으면 필드명·타입·중첩 구조에서 어긋남이 생김.
- **수동 테스트가 번거롭다.** Swagger UI의 "Try it out" 버튼으로 브라우저에서 바로 호출/응답 확인이 가능. Postman을 따로 안 띄워도 됨.
- **온보딩이 느려진다.** 새 팀원이 `/swagger-ui.html` 하나만 열면 전체 엔드포인트 목록을 파악.

## 4. CareerTuner에서 어디에 썼나 (백엔드)

| 구성 요소 | 위치 | 역할 |
| --- | --- | --- |
| 의존성 | `backend/build.gradle` → `org.springdoc:springdoc-openapi-starter-webmvc-ui:3.0.2` | Spring MVC용 springdoc + Swagger UI 번들 |
| 메타데이터 설정 | `common/config/OpenApiConfig.java` | `@Bean OpenAPI`로 문서 title/description/version 지정 |
| UI 경로 | `application.yaml` → `springdoc.swagger-ui.path: /swagger-ui.html` | Swagger UI 진입점 |
| 보안 예외 | `common/config/SecurityConfig.java` | 문서 경로를 인증 없이 열어줌(아래 참고) |

실제 `OpenApiConfig` 핵심 (영역: 공통 `common/config`, Owner=팀장):

```java
@Configuration
public class OpenApiConfig {
    @Bean
    public OpenAPI careerTunerOpenAPI() {
        return new OpenAPI().info(new Info()
                .title("CareerTuner API")
                .description("채용공고 기반 AI 취업 전략·가상 면접 준비 플랫폼 백엔드 API")
                .version("v0.1.0"));
    }
}
```

`SecurityConfig`에서 문서 경로를 인증 없이 허용하는 부분:

```java
.requestMatchers("/swagger-ui.html", "/swagger-ui/**",
                 "/v3/api-docs/**", "/api-docs/**").permitAll()
```

:::warning 정직하게 — 현재 구현 수준
CareerTuner는 **컨트롤러에 `@Operation`·`@Tag`·`@Schema` 같은 Swagger 애너테이션을 아직 쓰지 않습니다.** 즉 스펙은 전적으로 **Spring MVC 매핑(`@RestController` / `@RequestMapping` / `@GetMapping` 등)과 DTO 타입에서 자동 추론**됩니다. 설명 텍스트·예시·태그 그룹핑 같은 풍부한 문서화는 아직 안 한 상태입니다. 면접에서 "현재는 자동 생성만 쓰고, 애너테이션으로 설명을 보강하는 건 다음 단계"라고 말하면 정확합니다.

또한 모든 응답이 `ApiResponse<T>` 엔벨로프(`common/web/ApiResponse`)로 감싸지므로, Swagger 스키마에도 `success`/`code`/`message`/`data` 형태로 노출됩니다.
:::

## 5. 핵심 동작 원리 (단계)

springdoc은 **런타임에 동작**합니다. 빌드 시점에 코드를 분석하는 게 아니라, 앱이 뜬 뒤 Spring의 빈/매핑 정보를 읽습니다.

1. **앱 기동** → springdoc 스타터가 자동 설정으로 끼어듦.
2. **핸들러 스캔** → `RequestMappingHandlerMapping`을 뒤져 모든 `@RequestMapping` 메서드(경로·HTTP 메서드·파라미터·반환 타입)를 수집.
3. **스키마 추론** → 요청 DTO(`@RequestBody`)와 응답 타입을 리플렉션으로 분석해 JSON 스키마 생성. Jakarta Validation 애너테이션(`@NotBlank`, `@Size` 등)도 제약조건으로 반영.
4. **스펙 노출** → `/v3/api-docs`(JSON)로 OpenAPI 문서를 서빙.
5. **UI 렌더** → `/swagger-ui.html`이 그 JSON을 받아 화면을 그리고, "Try it out"으로 실제 요청을 보냄.

```text
컨트롤러 코드 + DTO + Validation
        │  (springdoc, 런타임 스캔)
        ▼
GET /v3/api-docs   ← OpenAPI JSON (기계용 계약)
        │
        ▼
GET /swagger-ui.html  ← 사람용 화면 (목록 + Try it out)
```

| 경로 | 누가 읽나 | 용도 |
| --- | --- | --- |
| `/v3/api-docs` | 기계(프론트 코드젠, Postman import) | OpenAPI JSON 원본 |
| `/swagger-ui.html` | 사람 | 탐색 + 직접 호출 |

:::details 빌드타임 vs 런타임 — 왜 중요한가
springdoc은 **런타임 리플렉션** 방식이라 앱이 실제로 떠야 문서가 나옵니다. 장점은 별도 빌드 단계 없이 항상 코드와 일치한다는 것, 단점은 약간의 기동/메모리 비용과 스캔 한계(제네릭 깊은 추론 등)입니다. 빌드타임 생성 방식(예: 애너테이션 프로세서 기반)과 대비되는 트레이드오프입니다.
:::

## 6. 면접 답변 3단계

- **초간단 1문장:** "springdoc으로 컨트롤러에서 OpenAPI 스펙을 자동 생성하고 Swagger UI로 프론트와 공유하는 API 계약 문서를 만들었습니다."
- **기본:** "Spring Boot에 `springdoc-openapi-starter-webmvc-ui`를 붙이면 런타임에 컨트롤러 매핑과 DTO를 스캔해 `/v3/api-docs`로 OpenAPI JSON을, `/swagger-ui.html`로 사람이 보는 화면을 자동으로 줍니다. 우리는 `OpenApiConfig`에서 문서의 title/description/version만 지정하고, SecurityConfig에서 문서 경로를 인증 없이 열었습니다. 응답이 전부 `ApiResponse` 엔벨로프라 스키마에도 그 형태로 노출됩니다."
- **꼬리질문 대응:** "현재는 애너테이션 없이 자동 추론만 쓰고 있어서, 다음 단계로 `@Tag`로 도메인별 그룹핑하고 `@Operation`·`@Schema`로 설명과 예시를 보강할 계획입니다. JWT 보호 엔드포인트는 Swagger의 securityScheme(bearer)을 등록하면 UI에서 토큰을 넣고 바로 호출할 수 있습니다."

## 7. 자주 나오는 꼬리질문 + 모범답안

:::details Q. OpenAPI랑 Swagger 차이가 뭔가요?
**OpenAPI는 스펙(표준), Swagger는 도구 브랜드**입니다. 원래 스펙 이름이 Swagger Specification이었는데 2016년 OpenAPI Specification으로 개명됐고, 지금 "Swagger"는 Swagger UI·Swagger Editor 같은 도구 모음을 가리킵니다. 우리가 쓰는 springdoc은 OpenAPI 스펙을 생성하고 Swagger UI를 번들로 제공하는 라이브러리입니다.
:::

:::details Q. springfox 안 쓰고 springdoc 쓴 이유는?
springfox는 사실상 유지보수가 멈췄고 최신 Spring Boot 버전 지원이 늦습니다. springdoc은 활발히 관리되며 Spring Boot 3/4·Jakarta·OpenAPI 3 표준을 잘 따라옵니다. CareerTuner는 Spring Boot 4 기반이라 springdoc이 사실상 표준 선택입니다.
:::

:::details Q. 스펙이 언제, 어떻게 만들어지나요? 빌드 때인가요?
빌드 때가 아니라 **런타임**입니다. 앱이 뜬 뒤 springdoc이 Spring의 핸들러 매핑과 DTO 타입을 리플렉션으로 읽어 `/v3/api-docs` JSON을 동적으로 만듭니다. 그래서 코드가 곧 문서이고, 컨트롤러를 고치면 다음 기동 때 자동 반영됩니다.
:::

:::details Q. 인증이 걸린 API인데 Swagger UI 자체는 어떻게 열리나요?
SecurityConfig에서 `/swagger-ui.html`, `/swagger-ui/**`, `/v3/api-docs/**`, `/api-docs/**` 경로를 `permitAll()`로 인증 예외 처리했습니다. 문서 화면은 누구나 열되, 실제 보호된 API를 호출할 때는 토큰이 필요합니다. 운영에서는 문서 경로 자체도 내부망/관리자 한정으로 제한하는 게 더 안전합니다.
:::

:::details Q. JWT 보호 엔드포인트를 Swagger에서 테스트하려면?
OpenAPI에 bearer 타입 securityScheme을 등록하면 Swagger UI에 "Authorize" 버튼이 생깁니다. 거기에 Access 토큰을 넣으면 이후 요청에 `Authorization: Bearer ...` 헤더가 자동으로 붙어 보호된 엔드포인트도 UI에서 바로 호출할 수 있습니다. CareerTuner의 인증은 [JWT](/backend/jwt-security)로 처리되고, 토큰은 `/auth/refresh`로 갱신합니다.
:::

:::details Q. 자동 생성만으로 충분한가요? 한계는?
자동 추론은 경로·메서드·타입·검증 제약까지는 잘 잡지만, **"이 엔드포인트가 무엇을 하는지"** 같은 비즈니스 의미와 예시 값은 못 만듭니다. 그래서 `@Operation(summary=...)`, `@Schema(example=...)`, `@Tag`로 보강하는 게 정석입니다. CareerTuner는 현재 보강 전 단계라, 정직하게 "동작은 하지만 설명 보강은 TODO"라고 말합니다.
:::

## 8. 직접 말해보기 (말하기 훈련용)

1. 면접관이 "API 문서는 어떻게 관리했나요?"라고 물었다고 가정하고, **OpenAPI / Swagger / springdoc 세 단어를 정확히 구분**하면서 30초로 답해보세요.
2. "왜 별도 위키가 아니라 자동 생성을 택했나요?"에 대해, **계약 문서의 코드-동기화 이점**과 **6인 분담 협업 맥락**을 엮어 한 문단으로 설명해보세요.

## 퀴즈

<QuizBox question="OpenAPI와 Swagger의 관계로 가장 정확한 것은?" :choices="['OpenAPI는 도구 브랜드, Swagger는 표준 스펙이다', 'OpenAPI는 표준 스펙, Swagger는 그 스펙을 다루는 도구 브랜드다', '둘은 완전히 같은 것이며 이름만 다르다', 'Swagger는 Spring 전용이고 OpenAPI는 Node 전용이다']" :answer="1" explanation="원래 Swagger Specification이 2016년 OpenAPI Specification으로 개명됐습니다. 지금은 OpenAPI가 표준 스펙, Swagger는 Swagger UI 등 도구 브랜드를 가리킵니다." />

<QuizBox question="CareerTuner에서 springdoc이 OpenAPI 스펙을 만들어내는 시점/방식으로 옳은 것은?" :choices="['gradle 빌드 중 애너테이션 프로세서가 정적 분석으로 생성', '앱 런타임에 컨트롤러 매핑과 DTO를 리플렉션으로 스캔해 생성', '개발자가 yaml 파일을 손으로 작성해 커밋', 'CI에서 Postman 컬렉션을 변환해 생성']" :answer="1" explanation="springdoc은 런타임에 Spring의 핸들러 매핑과 DTO 타입을 스캔해 /v3/api-docs JSON을 동적으로 만듭니다. 그래서 코드가 곧 최신 문서가 됩니다." />

<QuizBox question="CareerTuner 컨트롤러의 현재 Swagger 문서화 수준을 정직하게 설명해보세요." explanation="현재는 @Operation·@Tag·@Schema 같은 Swagger 애너테이션을 쓰지 않고, Spring MVC 매핑과 DTO 타입, Jakarta Validation 제약에서 자동 추론된 스펙만 사용합니다. OpenApiConfig에서 문서의 title/description/version 메타데이터만 지정하고, SecurityConfig에서 /swagger-ui.html과 /v3/api-docs 경로를 permitAll로 열어둔 상태입니다. 모든 응답이 ApiResponse 엔벨로프라 스키마에도 success/code/message/data 형태로 노출됩니다. 다음 단계로 애너테이션을 붙여 설명·예시·도메인 그룹핑을 보강하고 bearer securityScheme을 등록해 보호 엔드포인트를 UI에서 직접 테스트하게 하는 것이 개선 방향입니다." />
